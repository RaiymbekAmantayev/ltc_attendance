// Клиент HollyHop API 2.0: https://hollipedia.t8s.ru/books/api/page/hollihop-api-20
// Из эталонного коннектора LTC: повторы с экспоненциальной паузой и jitter, уважение Retry-After,
// таймаут, ограничение частоты (лимит HollyHop ≈ 600 запросов / 30 с), типизированные ошибки.
const { hollihop } = require('../config/env');
const { weekdayBit } = require('../lib/date');
const mock = require('./hollihopMock');
const testing = require('../config/testing');
const personalTests = require('../config/personalTests');

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

/** Приводит учебную единицу HollyHop к виду, который нужен кабинету. */
function toGroup(edUnit, date, teacherId) {
  const all = edUnit.ScheduleItems || [];
  const items = all.filter(item => (!date || item.Weekdays & weekdayBit(date)) && hasTeacher(item, teacherId));
  const first = items[0] || all[0] || {};
  const students = edUnit.StudentsCount ?? null;
  return {
    id: String(edUnit.Id),
    name: edUnit.Name,
    branch: edUnit.OfficeOrCompanyName || '',
    time: first.BeginTime ? `${first.BeginTime}–${first.EndTime}` : '',
    days: daysLabel(items.length ? items : all),
    students,
    vacancies: edUnit.Vacancies ?? null,
    level: edUnit.Level || '',
    discipline: edUnit.Discipline || '',
    teacher: first.Teacher || first.TeacherName || '',
    teacherId: first.TeacherIds?.[0] != null ? String(first.TeacherIds[0]) : null,
    hasLessonOnDate: items.length > 0,
  };
}

const GROUP_TYPES = 'Group,MiniGroup,Individual';

// Короткий кэш: один заход преподавателя порождает несколько запросов с одинаковым ответом.
const CACHE_TTL_MS = Number(process.env.HH_CACHE_TTL_MS ?? 30000);
const cache = new Map();
async function cached(key, load) {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await load();
  cache.set(key, { value, until: Date.now() + CACHE_TTL_MS });
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

exports.groupById = id => cached(`gi:${id}`, async () => {
  const { EdUnits = [] } = await call('GetEdUnits', { id });
  return EdUnits[0] ? toGroup(EdUnits[0]) : null;
});

exports.students = groupId => cached(`st:${groupId}`, async () => {
  const { EdUnitStudents = [] } = await call('GetEdUnitStudents', { edUnitId: groupId, statuses: 'Normal,WorkingOff' });
  return EdUnitStudents.map(s => ({ id: String(s.StudentClientId), name: s.StudentName }));
});

exports.teachers = async () => {
  const { Teachers = [] } = await call('GetTeachers', { take: 10000 });
  return Teachers.filter(t => !t.Fired).map(t => ({
    id: String(t.Id),
    name: `${t.LastName || ''} ${t.FirstName || ''}`.trim(),
    branch: t.Offices?.[0]?.Name || null,
  }));
};

/* ---------------- Запись ---------------- */

// Посещаемость: SetStudentPasses принимает МАССИВ записей (у дня поля Date, Pass, Description).
// Поля payable и overwriteAcceptedManually не указываем: по документации неуказанный параметр
// не меняется. Повторная запись той же даты перезаписывает — поэтому повтор безопасен (разд. 7.1 ТЗ).
exports.writeAttendance = (groupId, date, s) => {
  const note = s.status === 'absent' ? 'Пропуск: ' + (s.excused ? 'уважительная' : 'неуважительная')
    : undefined;                                          // undefined = примечание не трогаем

  return call('SetStudentPasses', [{
    Date: date,
    EdUnitId: Number(groupId),
    StudentClientId: Number(s.id),
    Pass: s.status === 'absent',
    Description: note,
  }]);
};

const escapeHtml = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Нужно ли писать тест для этой учебной единицы (HH_TEST_EDUNIT_IDS пуст = для всех). */
exports.testEnabledFor = groupId => !testing.edUnitIds.length || testing.edUnitIds.includes(String(groupId));

/**
 * Результат теста ученика: AddEditEdUnitTestResult. Повторный вызов с той же датой и типом теста
 * редактирует результат, поэтому повтор безопасен (разд. 7.1 ТЗ). Комментарий (= тема урока) уходит в commentHtml.
 * Без баллов (s.skills пуст) в HollyHop ничего не пишем — комментарий остаётся у нас.
 */
exports.writeReport = async (groupId, date, s, payload = {}) => {
  if (!s.skills || !payload.testTypeId || !exports.testEnabledFor(groupId)) return { local: true };
  return call('AddEditEdUnitTestResult', {
    edUnitId: Number(groupId),
    studentClientId: Number(s.id),
    date,
    testTypeId: payload.testTypeId,
    skills: testing.skillsFor(payload.testTypeId).map(k => ({ skillId: k.id, score: Number(s.skills[k.id]) })),
    commentHtml: s.comment ? escapeHtml(s.comment).replace(/\n/g, '<br>') : '',
  });
};

/**
 * Персональный тест ученика: AddEditPersonalTestResult (без id — добавление). Набор навыков — весь набор выбранного типа теста.
 * Комментарий (= тема урока) уходит в commentHtml. Шаг идёт в общей очереди: после успеха повторно не отправляется.
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
    commentHtml: s.comment ? escapeHtml(s.comment).replace(/\n/g, '<br>') : '',
  });
};

// Тема урока: в API 2.0 нет документированного метода — хранится только у нас (уточнить в песочнице).
exports.writeTopic = async () => ({ local: true });

exports.HollyHopError = HollyHopError;
exports._toGroup = toGroup;
