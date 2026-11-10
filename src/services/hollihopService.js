// Клиент HollyHop API 2.0: https://hollipedia.t8s.ru/books/api/page/hollihop-api-20
// Из эталонного коннектора LTC: повторы с экспоненциальной паузой и jitter, уважение Retry-After,
// таймаут, ограничение частоты (лимит HollyHop ≈ 600 запросов / 30 с), типизированные ошибки.
const { hollihop } = require('../config/env');
const { weekdayBit, addDays, todayIso } = require('../lib/date');
const mock = require('./hollihopMock');
const testing = require('../config/testing');
const personalTests = require('../config/personalTests');
const coins = require('../config/coins');
const cities = require('../config/cities');

const MAX_RETRIES = Number(process.env.HH_MAX_RETRIES ?? 4);
const RETRY_BASE_MS = Number(process.env.HH_RETRY_BASE_MS ?? 700);
const TIMEOUT_MS = Number(process.env.HH_TIMEOUT_MS ?? 30000);
const MIN_GAP_MS = 60;                                   // ≈ 16 запросов/с — с запасом под лимит

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const backoff = attempt => Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), 15000) * (0.75 + Math.random() * 0.5);

class HollyHopError extends Error {
  constructor(message, code) { super(message); this.name = 'HollyHopError'; this.code = code; }
}

// Простая очередь: запросы уходят не чаще одного раза в MIN_GAP_MS.
let nextSlot = 0;
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_GAP_MS;
  if (wait) await sleep(wait);
}

async function send(method, payload) {
  if (hollihop.mock) return mock.respond(method, payload);
  const url = `https://${hollihop.domain}.t8s.ru/Api/V2/${method}?authkey=${encodeURIComponent(hollihop.authKey)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body, headers: { 'retry-after': response.headers.get('retry-after') } };
}

/** Вызов метода API. Ключ авторизации в логи и тексты ошибок не попадает. */
function extractReason(body) {
  if (body == null || body === '') return '';
  if (typeof body === 'string') {
    return body
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')   // выкинуть скрипты/стили
      .replace(/<[^>]+>/g, ' ')                           // убрать теги
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);
  }
  const r = body.Error ?? body.error ?? body.Message ?? body.message ?? body.ExceptionMessage;
  return String(r ?? JSON.stringify(body)).slice(0, 300);
}

async function call(method, payload = {}) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    await throttle();
    let result;
    try {
      result = await send(method, payload);
    } catch (error) {                                    // сеть, таймаут
      const cause = error.cause?.code || error.cause?.message || error.message || error.name;
      lastError = new HollyHopError(`HH ${method}: сеть недоступна (${cause})`, 'NETWORK');
      if (attempt <= MAX_RETRIES) { await sleep(backoff(attempt)); continue; }
      throw lastError;
    }

    const { status, body } = result;
    const reason = extractReason(body);
    const message = reason || String(status);

    if (status === 401 || status === 403 || (body?.Error && /доступ|прав|access|forbidden|denied|authkey/i.test(message))) {
      throw new HollyHopError(`HH ${method}: ${message}`, 'NO_RIGHTS');
    }
    if (status === 429 || status >= 500) {
      const isRate = status === 429;
      const label = isRate ? 'лимит запросов' : `ошибка сервера ${status}`;
      lastError = new HollyHopError(
        `HH ${method}: ${label}${reason ? ` — ${reason}` : ''} (попытка ${attempt}/${MAX_RETRIES + 1})`,
        isRate ? 'RATE_LIMIT' : 'SERVER'
      );
      lastError.status = status;
      lastError.body = body;                             // сырой ответ для логов
      if (attempt <= MAX_RETRIES) {
        const retryAfter = Number(result.headers?.['retry-after']);
        await sleep(retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : backoff(attempt));
        continue;
      }
      throw lastError;
    }
    if (status >= 400 || body?.Error) throw new HollyHopError(`HH ${method}: ${message}`, 'BAD_REQUEST');
    return body;
  }
  throw lastError;
}

/* ---------------- Чтение ---------------- */

const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const daysLabel = items => {
  const mask = items.reduce((acc, item) => acc | (item.Weekdays || 0), 0);
  return DAY_NAMES.filter((_, i) => mask & (1 << i)).join(' ');
};
const hasTeacher = (item, teacherId) => !teacherId || !item.TeacherIds || item.TeacherIds.map(String).includes(String(teacherId));

// Название офиса → Id: запоминаем из ответов HollyHop, чтобы у старых отметок (в БД только название филиала) знать город.
const officeIds = new Map();
const rememberOffice = (name, id) => { if (name && id != null) officeIds.set(String(name).trim(), String(id)); };

/** Приводит учебную единицу HollyHop к виду, который нужен кабинету. */
function toGroup(edUnit, date, teacherId) {
  rememberOffice(edUnit.OfficeOrCompanyName, edUnit.OfficeOrCompanyId);
  const officeId = edUnit.OfficeOrCompanyId ?? officeIds.get(String(edUnit.OfficeOrCompanyName || '').trim());
  const all = edUnit.ScheduleItems || [];
  // Строки дня по времени: у группы бывает несколько слотов с разными преподавателями (09:30 — один, 10:20 — другой).
  const items = all.filter(item => (!date || item.Weekdays & weekdayBit(date)) && hasTeacher(item, teacherId))
    .sort((a, b) => hhmm(a.BeginTime).localeCompare(hhmm(b.BeginTime)));
  const first = items[0] || all[0] || {};
  const last = items.length ? items.reduce((a, b) => (hhmm(b.EndTime) > hhmm(a.EndTime) ? b : a)) : first;
  const teachers = [...new Set((items.length ? items : [first]).map(i => i.Teacher || i.TeacherName).filter(Boolean))];
  const students = edUnit.StudentsCount ?? null;
  return {
    id: String(edUnit.Id),
    name: edUnit.Name,
    branch: edUnit.OfficeOrCompanyName || '',
    city: (edUnit.OfficeOrCompanyName || officeId != null) ? cities.of(officeId) : '',
    time: first.BeginTime ? `${first.BeginTime}–${last.EndTime || first.EndTime}` : '',
    days: daysLabel(items.length ? items : all),
    students,
    vacancies: edUnit.Vacancies ?? null,
    level: edUnit.Level || '',
    discipline: edUnit.Discipline || '',
    teacher: teachers.join(', '),
    teacherId: first.TeacherIds?.[0] != null ? String(first.TeacherIds[0]) : null,
    slots: teacherSlots(items),
    hasLessonOnDate: items.length > 0,
  };
}

const hhmm = t => String(t || '99:99').padStart(5, '0');   // «9:30» → «09:30» для сравнения строк

/** Слоты преподавателей в группе: [{teacherId, teacher, time}] по времени — кого из них можно заменить отдельно. */
function teacherSlots(items) {
  const byTeacher = new Map();
  for (const item of items) {
    const id = item.TeacherIds?.[0] != null ? String(item.TeacherIds[0]) : null;
    if (!id) continue;
    const slot = byTeacher.get(id);
    if (!slot) byTeacher.set(id, { teacherId: id, teacher: item.Teacher || item.TeacherName || '', from: item.BeginTime, to: item.EndTime });
    else {
      if (hhmm(item.BeginTime) < hhmm(slot.from)) slot.from = item.BeginTime;
      if (hhmm(item.EndTime) > hhmm(slot.to)) slot.to = item.EndTime;
    }
  }
  return [...byTeacher.values()].map(({ from, to, ...s }) => ({ ...s, time: from ? `${from}–${to}` : '' }));
}

const GROUP_TYPES = 'Group,MiniGroup,Individual';

// Короткий кэш: один заход преподавателя порождает несколько запросов с одинаковым ответом.
// Храним промис: одновременные одинаковые запросы ждут один ответ HollyHop, а не идут каждый сам; ошибка не кэшируется.
const CACHE_TTL_MS = Number(process.env.HH_CACHE_TTL_MS ?? 30000);
const cache = new Map();
function cached(key, load, ttl = CACHE_TTL_MS) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = Promise.resolve().then(load);
  cache.set(key, { value, until: Date.now() + ttl });
  value.catch(() => { if (cache.get(key)?.value === value) cache.delete(key); });
  if (cache.size > 500) for (const [k, v] of cache) if (v.until < Date.now()) cache.delete(k);
  return value;
}
exports.clearCache = () => cache.clear();

exports.teacherGroups = (teacherId, date) => cached(`tg:${teacherId}:${date}`, async () => {
  if (!teacherId) return [];
  const { EdUnits = [] } = await call('GetEdUnits',
    { types: GROUP_TYPES, teacherId, dateFrom: date, dateTo: date, weekdays: weekdayBit(date) });
  return EdUnits.map(u => toGroup(u, date, teacherId)).filter(g => g.hasLessonOnDate);
});

/** Все рабочие группы, у которых в этот день есть занятие (для замен и обзора). */
exports.groupsOnDate = date => cached(`go:${date}`, async () => {
  const { EdUnits = [] } = await call('GetEdUnits',
    { types: GROUP_TYPES, dateFrom: date, dateTo: date, weekdays: weekdayBit(date), statuses: 'Working' });
  return EdUnits.map(u => toGroup(u, date)).filter(g => g.hasLessonOnDate);
});

/** Строки расписания на дату: какая группа, с какого по какое время и какие преподаватели (для проверки занятости при замене). */
exports.scheduleOnDate = date => cached(`sd:${date}`, async () => {
  const { EdUnits = [] } = await call('GetEdUnits',
    { types: GROUP_TYPES, dateFrom: date, dateTo: date, weekdays: weekdayBit(date), statuses: 'Working' });
  return EdUnits.flatMap(u => (u.ScheduleItems || [])
    .filter(item => item.Weekdays & weekdayBit(date) && item.BeginTime && item.EndTime)
    .map(item => ({ groupId: String(u.Id), group: u.Name, from: item.BeginTime, to: item.EndTime, teacherIds: (item.TeacherIds || []).map(String) })));
});

/**
 * Занятия по расписанию за период: [{date, groupId, group, teacherIds, minutes}] — для выгрузки «Расписание».
 * Если HollyHop отдал дни занятий (queryDays), берём их; иначе разворачиваем строки расписания по дням недели.
 */
exports.lessonsInRange = (from, to) => cached(`lr:${from}:${to}`, async () => {   // у каждой строки city — город офиса группы
  const { EdUnits = [] } = await call('GetEdUnits',
    { types: GROUP_TYPES, dateFrom: from, dateTo: to, statuses: 'Working,Stopped,Finished', queryDays: true });
  return lessonsFromEdUnits(EdUnits, from, to);
});

const dayOf = v => String(v || '').trim().slice(0, 10);   // «2014-01-01 » и «2014-01-01T00:00:00» → дата
const toMinutes = t => { const m = /^(\d{1,2}):(\d\d)/.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const itemMinutes = item => {
  const a = toMinutes(item.BeginTime), b = toMinutes(item.EndTime);
  return a != null && b != null && b > a ? b - a : null;
};

function lessonsFromEdUnits(edUnits, from, to) {
  const out = [];
  for (const u of edUnits) {
    rememberOffice(u.OfficeOrCompanyName, u.OfficeOrCompanyId);
    const officeId = u.OfficeOrCompanyId ?? officeIds.get(String(u.OfficeOrCompanyName || '').trim());
    const city = (u.OfficeOrCompanyName || officeId != null) ? cities.of(officeId) : '';
    const items = u.ScheduleItems || [];
    const byId = new Map(items.map(i => [String(i.Id), i]));
    const push = (date, item, minutes) => out.push({
      date, groupId: String(u.Id), group: u.Name, city, minutes: minutes || 0,
      teacherIds: (item.TeacherIds || []).map(String), teacherNames: item.Teachers || [],
    });
    if (Array.isArray(u.Days) && u.Days.length) {
      for (const d of u.Days) {
        const date = dayOf(d.Date);
        if (date < from || date > to) continue;
        for (const id of d.ScheduleItemIds || []) {
          const item = byId.get(String(id));
          if (item) push(date, item, itemMinutes(item) ?? d.Minutes);
        }
      }
      continue;
    }
    for (let date = from; date <= to; date = addDays(date, 1)) {
      for (const item of items) {
        if (!(item.Weekdays & weekdayBit(date))) continue;
        if (dayOf(item.BeginDate) && dayOf(item.BeginDate) > date) continue;
        if (dayOf(item.EndDate) && dayOf(item.EndDate) < date) continue;
        push(date, item, itemMinutes(item));
      }
    }
  }
  return out;
}
exports._lessonsFromEdUnits = lessonsFromEdUnits;

/** Группа по Id; с датой — время и слоты преподавателей именно этого дня. */
exports.groupById = (id, date) => cached(`gi:${id}:${date || ''}`, async () => {
  const { EdUnits = [] } = await call('GetEdUnits', { id });
  if (!EdUnits[0]) return null;
  const onDate = date && toGroup(EdUnits[0], date);
  return onDate?.hasLessonOnDate ? onDate : toGroup(EdUnits[0]);
});

/** Актуальный ученик: связка началась (BeginDate есть), а EndDate нет или она ещё не прошла. */
const isCurrent = (s, today) => !!s.beginDate && (!s.endDate || String(s.endDate).slice(0, 10) >= today);

const allStudents = groupId => cached(`st:${groupId}`, async () => {
  const { EdUnitStudents = [] } = await call('GetEdUnitStudents', { edUnitId: groupId, statuses: 'Normal,WorkingOff' });
  return EdUnitStudents.map(s => ({ id: String(s.StudentClientId), name: s.StudentName, beginDate: s.BeginDate, endDate: s.EndDate }));
});

const pickName = ({ id, name }) => ({ id, name });

/** Актуальный состав группы — для отметки занятия и карточки группы. */
exports.students = async groupId => {
  const today = todayIso();
  return (await allStudents(groupId)).filter(s => isCurrent(s, today)).map(pickName);
};

/** Все ученики группы, включая выбывших, — чтобы в отчётах по старым отметкам не терялись ФИО. */
exports.allStudents = async groupId => (await allStudents(groupId)).map(pickName);

/**
 * Составы всех групп, у которых связка ученика пересекается с периодом, — пачками по 1000 вместо запроса на каждую группу
 * (за месяц ≈ 300 групп: по одной — десятки секунд из-за лимита HollyHop). Для отчётов; кэш 10 минут.
 * Map groupId → { level, students: [{ id, name, beginDate, endDate, current }] }; current — учится сейчас (см. isCurrent).
 */
const ROSTER_PAGE = 1000, ROSTER_TTL_MS = Number(process.env.HH_ROSTER_TTL_MS ?? 10 * 60 * 1000);
exports.rostersInRange = (from, to) => cached(`rr:${from}:${to}`, async () => {
  // dateTo — на год вперёд: связки, которые начнутся позже (BeginDate в будущем, без EndDate), по правилу isCurrent тоже актуальны.
  const until = addDays(to > todayIso() ? to : todayIso(), 366);
  const page = skip => call('GetEdUnitStudents', { statuses: 'Normal,WorkingOff', dateFrom: from, dateTo: until, take: ROSTER_PAGE, skip })
    .then(r => r.EdUnitStudents || []);
  const rows = await page(0);
  for (let skip = ROSTER_PAGE, last = rows.length; last === ROSTER_PAGE; skip += ROSTER_PAGE * 4) {   // дальше — по 4 страницы разом
    const pages = await Promise.all([0, 1, 2, 3].map(i => page(skip + i * ROSTER_PAGE)));
    for (const p of pages) rows.push(...p);
    last = pages[pages.length - 1].length;
  }
  const today = todayIso(), out = new Map();
  for (const s of rows) {
    const id = String(s.EdUnitId);
    rememberOffice(s.EdUnitOfficeOrCompanyName, s.EdUnitOfficeOrCompanyId);
    if (!out.has(id)) out.set(id, { level: s.EdUnitLevel || '', students: [] });
    const st = { id: String(s.StudentClientId), name: s.StudentName, beginDate: s.BeginDate, endDate: s.EndDate };
    out.get(id).students.push({ ...st, current: isCurrent(st, today) });
  }
  return out;
}, ROSTER_TTL_MS);

/**
 * Id ученика в HollyHop по ClientId (GetEdUnitStudents отдаёт только StudentClientId) — для показа в админке.
 * Запись в HollyHop идёт по ClientId; Id не меняется, поэтому кэш долгий. Не нашли — null.
 */
const studentIdCache = new Map();
exports.studentIds = async clientIds => {
  const out = {};
  for (const clientId of [...new Set(clientIds.map(String))]) {
    if (!studentIdCache.has(clientId)) {
      const { Students = [] } = await call('GetStudents', { clientId: Number(clientId) });
      const found = Students.find(s => String(s.ClientId) === clientId) || Students[0];
      if (found?.Id != null) studentIdCache.set(clientId, String(found.Id));
    }
    out[clientId] = studentIdCache.get(clientId) ?? null;
  }
  return out;
};

exports.teachers = async () => {
  const { Teachers = [] } = await call('GetTeachers', { take: 10000 });
  for (const t of Teachers) for (const o of t.Offices || []) rememberOffice(o.Name, o.Id);
  return Teachers.filter(t => !t.Fired).map(t => ({
    id: String(t.Id),
    name: `${t.LastName || ''} ${t.FirstName || ''}`.trim(),
    branch: t.Offices?.[0]?.Name || null,
  }));
};

/**
 * Город по названию филиала (у отметок в БД хранится только название): офисы из GetOffices + запомненные из других ответов.
 * Возвращает функцию name → «Алматы» / «Астана»; без названия — «—». Список офисов кэшируется на 10 минут.
 */
let officesLoaded = { until: 0 };
exports.cityResolver = async () => {
  if (officesLoaded.until < Date.now()) {
    try {
      const { Offices = [] } = await call('GetOffices', {});
      for (const o of Offices) rememberOffice(o.Name, o.Id);
      officesLoaded = { until: Date.now() + 10 * 60 * 1000 };
    } catch (error) {
      console.warn('HH GetOffices:', error.message);       // без списка офисов — по запомненным названиям
      officesLoaded = { until: Date.now() + 60 * 1000 };
    }
  }
  return name => (String(name || '').trim() ? cities.of(officeIds.get(String(name).trim())) : cities.NONE);
};

/* ---------------- Запись ---------------- */

// Посещаемость: SetStudentPasses принимает МАССИВ записей (у дня поля Date, Pass, Description).
// Поля payable и overwriteAcceptedManually не указываем: по документации неуказанный параметр
// не меняется. Повторная запись той же даты перезаписывает — поэтому повтор безопасен (разд. 7.1 ТЗ).
exports.writeAttendance = (groupId, date, s) =>
  call('SetStudentPasses', [{
    Date: date,
    EdUnitId: Number(groupId),
    StudentClientId: Number(s.id),
    Pass: s.status === 'absent',
  }]);

const escapeHtml = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** commentHtml теста: тема урока, под ней — домашнее задание «Дз/Hw: …» (у старых отметок ДЗ нет). */
const commentHtml = (s, payload = {}) => [s.comment, payload.homework && `Дз/Hw: ${payload.homework}`]
  .filter(Boolean).map(v => escapeHtml(v).replace(/\n/g, '<br>')).join('<br>');

/** Нужно ли писать тест для этой учебной единицы (HH_TEST_EDUNIT_IDS пуст = для всех). */
exports.testEnabledFor = groupId => !testing.edUnitIds.length || testing.edUnitIds.includes(String(groupId));

/**
 * Ежедневный тест ученика — тоже персональный: AddEditPersonalTestResult с типом 131/132 (без id — добавление).
 * У каждого преподавателя свой результат (teacherId, время его занятия), поэтому два преподавателя одного урока не затирают друг друга.
 * Шаг идёт в общей очереди: после успеха повторно не отправляется. В commentHtml — тема урока и под ней ДЗ.
 */
exports.writeReport = async (groupId, date, s, payload = {}) => {
  if (!s.skills || !payload.testTypeId || !exports.testEnabledFor(groupId)) return { local: true };
  return call('AddEditPersonalTestResult', {
    studentClientId: Number(s.id),
    dateTime: payload.dateTime || `${date}T00:00:00`,      // отметки, сохранённые до перевода на персональные тесты
    discipline: personalTests.discipline,
    ...(payload.teacherId ? { teacherId: payload.teacherId } : {}),
    testTypeId: payload.testTypeId,
    skills: testing.skillsFor(payload.testTypeId).map(k => ({ skillId: k.id, score: Number(s.skills[k.id]) })),
    commentHtml: commentHtml(s, payload),
  });
};

/**
 * Персональный тест ученика: AddEditPersonalTestResult (без id — добавление). Набор навыков — весь набор выбранного типа теста.
 * В commentHtml — тема урока и под ней ДЗ. Шаг идёт в общей очереди: после успеха повторно не отправляется.
 */
exports.writePersonalTest = async (s, payload) => {
  const found = payload.personal && personalTests.find(payload.personal.categoryId, payload.personal.testTypeId);
  if (!s.personalSkills || !found) return { local: true };
  return call('AddEditPersonalTestResult', {
    studentClientId: Number(s.id),
    dateTime: payload.personal.dateTime,
    discipline: personalTests.discipline,
    ...(payload.personal.teacherId ? { teacherId: payload.personal.teacherId } : {}),
    testTypeId: found.type.id,
    skills: found.type.skills.map(k => ({ skillId: k.id, score: Number(s.personalSkills[k.id]) })),
    commentHtml: commentHtml(s, payload),
  });
};

/**
 * Начисление коинов: читаем пользовательское поле «Коины» ученика (GetStudents → ExtraFields), прибавляем и пишем
 * обратно через EditUserExtraFields. Запросы по одному ученику идут строго по очереди, чтобы два урока не затёрли друг друга.
 */
const coinLocks = new Map();
exports.addCoins = (clientId, amount) => {
  const key = String(clientId);
  const run = (coinLocks.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
    const { Students = [] } = await call('GetStudents', { clientId: Number(clientId) });
    const student = Students.find(s => String(s.ClientId) === key) || Students[0];
    if (!student) throw new HollyHopError(`HH GetStudents: ученик ${key} не найден`, 'BAD_REQUEST');
    // EditUserExtraFields заменяет весь набор полей: шлём все поля ученика, меняя только «Коины», иначе остальные сотрутся.
    const fields = (student.ExtraFields || []).map(f => ({ name: f.Name, value: f.Value ?? '' }));
    const isCoins = f => String(f.name).trim().toLowerCase() === coins.field.toLowerCase();
    const field = fields.find(isCoins);
    const current = Number(String(field?.value ?? '').replace(',', '.').replace(/\s/g, '')) || 0;
    const total = Math.round((current + amount) * 100) / 100;
    if (field) field.value = String(total);
    else fields.push({ name: coins.field, value: String(total) });
    await call('EditUserExtraFields', { studentClientId: Number(clientId), fields });
    return { before: current, added: amount, total };
  });
  coinLocks.set(key, run);
  run.finally(() => { if (coinLocks.get(key) === run) coinLocks.delete(key); }).catch(() => {});
  return run;
};

// Тема урока: в API 2.0 нет документированного метода — хранится только у нас (уточнить в песочнице).
exports.writeTopic = async () => ({ local: true });

exports.HollyHopError = HollyHopError;
exports._toGroup = toGroup;
