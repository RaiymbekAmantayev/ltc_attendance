// Внешний API только для чтения (/attendance-api/v1): журнал уроков, тесты и справочники из отметок кабинета (submissions.payload).
// Все ключи — HollyHop: ученик = ClientId, группа = EdUnit, преподаватель — hollihop_id. В HollyHop запросов не делаем — только наша БД.
const Submission = require('../models/submissionModel');
const Teacher = require('../models/teacherModel');
const testing = require('../config/testing');
const personalTests = require('../config/personalTests');
const { AppError } = require('../middleware/errorHandler');
const { isDate, todayIso, addDays } = require('../lib/date');

const LIMIT = { def: 100, max: 500 };
const BATCH = 250;                 // отметок из БД за один запрос
const MAX_SCAN = 2000;             // отметок за один вызов API: дальше — next_cursor (страница может быть неполной)
const MAX_SPAN_DAYS = 366;
const DEFAULT_DAYS = 30;           // период журнала/тестов по умолчанию (без date_from/date_to/updated_since)
const DIR_DEFAULT_DAYS = 60;       // окно справочников учеников/групп по умолчанию
const DIR_MAX_DAYS = 180;
const ACTIVE_DAYS = 30;            // ученик/группа «active», если последний урок не старше
const DIR_CACHE_MS = Number(process.env.ATTENDANCE_API_CACHE_MS ?? 5 * 60 * 1000);
const SCALE = { min: 0, max: 5 };  // ДЗ, активность, поведение (ежедневный тест)

/* ---------------- Параметры ---------------- */

const bad = param => new AppError(400, 'bad_param', { param });
const str = (q, name, re) => {
  const v = q[name];
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || (re && !re.test(v))) throw bad(name);
  return v.trim();
};
const DIGITS = /^\d{1,20}$/;

function limitOf(q) {
  if (q.limit == null || q.limit === '') return LIMIT.def;
  const n = Number(q.limit);
  if (!Number.isInteger(n) || n < 1 || n > LIMIT.max) throw bad('limit');
  return n;
}
function offsetOf(q) {
  if (q.offset == null || q.offset === '') return 0;
  const n = Number(q.offset);
  if (!Number.isInteger(n) || n < 0) throw bad('offset');
  return n;
}
const dateParam = (q, name) => { const v = str(q, name); if (v != null && !isDate(v)) throw bad(name); return v; };

// ISO 8601: дата (= 00:00 UTC) или дата-время с часовым поясом. Без пояса не принимаем — иначе непонятно, чьи часы.
const ISO_TZ = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d{1,9})?)?(Z|[+-]\d\d:?\d\d)$/i;
function sinceParam(q) {
  const v = str(q, 'updated_since');
  if (v == null) return null;
  const d = isDate(v) ? new Date(v + 'T00:00:00Z') : ISO_TZ.test(v) ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) throw bad('updated_since');
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** Курсор: base64url("<id отметки>.<индекс ученика в отметке>") — с какой записи продолжать. */
const encodeCursor = (s, i) => Buffer.from(`${s}.${i}`).toString('base64url');
function decodeCursor(q) {
  const v = str(q, 'cursor');
  if (v == null) return { s: 0, i: 0 };
  const m = /^(\d{1,15})\.(\d{1,5})$/.exec(Buffer.from(v, 'base64url').toString());
  if (!m) throw bad('cursor');
  return { s: Number(m[1]), i: Number(m[2]) };
}

/** Фильтры журнала и тестов. Без периода и updated_since — последние DEFAULT_DAYS дней. */
function recordFilters(q) {
  let dateFrom = dateParam(q, 'date_from'), dateTo = dateParam(q, 'date_to');
  const createdSince = sinceParam(q);
  if (dateFrom && dateTo && dateFrom > dateTo) throw bad('date_from');
  if (dateFrom && dateTo && (new Date(dateTo) - new Date(dateFrom)) / 864e5 + 1 > MAX_SPAN_DAYS) throw new AppError(400, 'period_too_long', { maxDays: MAX_SPAN_DAYS });
  if (!dateFrom && !dateTo && !createdSince) { dateTo = todayIso(); dateFrom = addDays(dateTo, -DEFAULT_DAYS); }
  return {
    dateFrom, dateTo, createdSince,
    branch: str(q, 'branch'),
    groupId: str(q, 'group_id', DIGITS),
    teacherId: str(q, 'teacher_id', DIGITS),
    hhTeacherId: str(q, 'hollyhop_teacher_id', DIGITS),
    clientId: str(q, 'hollyhop_client_id', DIGITS),
  };
}

/* ---------------- Общие поля ---------------- */

const isoOf = d => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));
const stampOf = v => (v ? String(v).replace(' ', 'T').slice(0, 19) + 'Z' : null);
const parse = Submission.parse;
const teacherTypeOf = (p, row) => (p.testTypeId ? (Number(p.testTypeId) === testing.testTypeIds.foreign ? 'foreign' : 'local') : row.lang === 'en' ? 'foreign' : 'local');
const hhTeacherOf = (p, row) => (p.teacherId != null ? String(p.teacherId) : row.hollihop_id || null);
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** Поля урока, общие для записей журнала и тестов. */
const lessonFields = (row, p) => ({
  date: isoOf(row.lesson_date),
  group_id: String(row.group_id), hollyhop_edunit_id: String(row.group_id), group_name: row.group_name || null,
  branch: row.branch || null, level: p.level || null,
  teacher_id: String(row.teacher_id), hollyhop_teacher_id: hhTeacherOf(p, row), teacher_fio: row.full_name || null,
  teacher_type: teacherTypeOf(p, row),
});

/** Баллы ежедневного теста: ДЗ, активность, поведение (по порядку навыков типа теста, см. config/testing.js). */
function dailyScores(s, p) {
  const skills = testing.skillsFor(p.testTypeId).filter(k => !k.fixed);
  const at = i => (s.skills && skills[i] && s.skills[skills[i].id] != null ? Number(s.skills[skills[i].id]) : null);
  return { homework: at(0), activity: at(1), behaviour: at(2) };
}

/* ---------------- Постраничный обход отметок ---------------- */

/**
 * Записи «ученик × отметка» по курсору. toRecord(row, payload, student) → запись или null (не подходит).
 * Возвращает { data, page: { limit, next_cursor, has_more } }. Пустая страница с next_cursor возможна (лимит просмотра) — идти дальше.
 */
async function pageRecords(q, toRecord) {
  const limit = limitOf(q), cursor = decodeCursor(q), f = recordFilters(q);
  const data = [];
  let fromId = cursor.s, scanned = 0;
  for (;;) {
    const rows = await Submission.pageForApi(f, fromId, BATCH);
    for (const row of rows) {
      const p = parse(row.payload);
      const students = Array.isArray(p.students) ? p.students : [];
      for (let i = row.id === cursor.s ? cursor.i : 0; i < students.length; i++) {
        const s = students[i];
        if (f.clientId && String(s.id) !== f.clientId) continue;
        const rec = toRecord(row, p, s);
        if (!rec) continue;
        if (data.length === limit) return { data, page: { limit, next_cursor: encodeCursor(row.id, i), has_more: true } };
        data.push(rec);
      }
      if (++scanned >= MAX_SCAN) return { data, page: { limit, next_cursor: encodeCursor(row.id + 1, 0), has_more: true } };
    }
    if (rows.length < BATCH) return { data, page: { limit, next_cursor: null, has_more: false } };
    fromId = rows[rows.length - 1].id + 1;
  }
}

/* ---------------- 4.4 Журнал уроков ---------------- */

exports.lessons = q => {
  const attendance = str(q, 'attendance', /^(present|absent)$/);
  return pageRecords(q, (row, p, s) => {
    const status = s.status === 'absent' ? 'absent' : 'present';
    if (attendance && status !== attendance) return null;
    const scores = dailyScores(s, p);
    return {
      record_id: `${row.id}:${s.id}`,
      lesson_id: `${row.group_id}:${isoOf(row.lesson_date)}`,
      submission_id: String(row.id),
      ...lessonFields(row, p),
      student_id: String(s.id), hollyhop_client_id: String(s.id), student_fio: s.name || null,
      attendance: status,
      absence_reason: null,                      // в кабинете не ведётся
      homework: scores.homework, activity: scores.activity, behaviour: scores.behaviour,
      homework_assignment: p.homework || null,
      topic: p.topic || null,
      ktp_topic_id: p.ktpTopicId ?? null,
      comment: null,                             // свободного комментария в кабинете нет (комментарий = тема урока)
      has_extra_test: !!(s.personalSkills && p.personal),
      updated_at: stampOf(row.created_at),
    };
  });
};

/* ---------------- 4.5 Результаты тестов (доп. тесты) ---------------- */

exports.tests = q => {
  const category = str(q, 'test_category_id', DIGITS);
  return pageRecords(q, (row, p, s) => {
    if (!s.personalSkills || !p.personal) return null;
    if (category && String(p.personal.categoryId) !== category) return null;
    const found = personalTests.find(p.personal.categoryId, p.personal.testTypeId);
    const skillDefs = found ? found.type.skills : [];
    const score = round(Object.values(s.personalSkills).reduce((a, v) => a + Number(v || 0), 0));
    const max = found ? skillDefs.reduce((a, k) => a + k.max, 0) : null;
    return {
      test_id: `${row.id}:${s.id}`,
      submission_id: String(row.id),
      ...lessonFields(row, p),
      student_id: String(s.id), hollyhop_client_id: String(s.id), student_fio: s.name || null,
      test_category_id: Number(p.personal.categoryId),
      test_type: found ? found.category.name : null,
      test_type_id: found ? found.type.id : Number(p.personal.testTypeId),
      test_name: found ? found.type.name : null,
      score, max_score: max, percent: max ? round(score / max * 100, 1) : null,
      skills: Object.entries(s.personalSkills).map(([id, v]) => {
        const k = skillDefs.find(x => String(x.id) === id);
        return { skill_id: Number(id), name: k ? k.name : null, score: v == null ? null : Number(v), max: k ? k.max : null };
      }),
      updated_at: stampOf(row.created_at),
    };
  });
};

/* ---------------- 4.1 / 4.3 Справочники учеников и групп ---------------- */

/** Окно справочника: since — с какой даты урока смотреть (по умолчанию DIR_DEFAULT_DAYS назад, не больше DIR_MAX_DAYS). */
function directoryWindow(q) {
  const today = todayIso();
  const since = dateParam(q, 'active_since') || addDays(today, -DIR_DEFAULT_DAYS);
  if (since > today || since < addDays(today, -DIR_MAX_DAYS)) throw new AppError(400, 'bad_param', { param: 'active_since', maxDays: DIR_MAX_DAYS });
  return { since, today };
}

const dirCache = new Map();
/** Один проход по отметкам окна → ученики и группы. Кэш DIR_CACHE_MS; одинаковые одновременные запросы ждут один расчёт. */
function directory(since, today) {
  const key = `${since}:${today}`, hit = dirCache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = buildDirectory(since, today);
  dirCache.set(key, { value, until: Date.now() + DIR_CACHE_MS });
  value.catch(() => dirCache.delete(key));
  for (const [k, v] of dirCache) if (v.until < Date.now()) dirCache.delete(k);
  return value;
}
exports._clearCache = () => dirCache.clear();

async function buildDirectory(since, today) {
  const students = new Map(), groups = new Map();
  const activeFrom = addDays(today, -ACTIVE_DAYS);
  const touchTeacher = (map, row, p, date) => {
    const id = String(row.teacher_id);
    if (!map.has(id)) map.set(id, { teacher_id: id, hollyhop_teacher_id: hhTeacherOf(p, row), fio: row.full_name || null, type: teacherTypeOf(p, row), lessons: 0, last_lesson_date: date });
    const t = map.get(id);
    t.lessons++;
    if (date >= t.last_lesson_date) t.last_lesson_date = date;
  };
  for (let fromId = 0, rows; (rows = await Submission.pageForApi({ dateFrom: since, dateTo: today }, fromId, 1000)).length; fromId = rows[rows.length - 1].id + 1) {
    for (const row of rows) {
      const p = parse(row.payload), date = isoOf(row.lesson_date), gid = String(row.group_id);
      if (!groups.has(gid)) groups.set(gid, { group_id: gid, name: null, branch: null, level: null, last_lesson_date: '', lessons: new Set(), students: new Set(), teachers: new Map() });
      const g = groups.get(gid);
      if (date >= g.last_lesson_date) Object.assign(g, { name: row.group_name || g.name, branch: row.branch || g.branch, level: p.level || g.level, last_lesson_date: date });
      g.lessons.add(date);
      touchTeacher(g.teachers, row, p, date);
      for (const s of Array.isArray(p.students) ? p.students : []) {
        const sid = String(s.id);
        g.students.add(sid);
        if (!students.has(sid)) students.set(sid, { id: sid, fio: null, last: '', groups: new Map() });
        const st = students.get(sid);
        if (s.name && (date >= st.last || !st.fio)) st.fio = s.name;   // ФИО — с самого свежего урока, где оно есть
        if (date >= st.last) st.last = date;
        if (!st.groups.has(gid)) st.groups.set(gid, { last: date, teachers: new Map() });
        const sg = st.groups.get(gid);
        if (date > sg.last) sg.last = date;
        touchTeacher(sg.teachers, row, p, date);
      }
    }
  }

  // Основной преподаватель — больше всего уроков, при равенстве — последний урок позже.
  const rank = list => [...list.values()].sort((a, b) => b.lessons - a.lessons || b.last_lesson_date.localeCompare(a.last_lesson_date));
  const teacherOut = ({ lessons, ...t }) => ({ ...t, lessons_count: lessons });
  const status = date => (date >= activeFrom ? 'active' : 'inactive');

  const groupList = [...groups.values()].map(g => {
    const teachers = rank(g.teachers), main = teachers[0];
    return {
      group_id: g.group_id, hollyhop_edunit_id: g.group_id, name: g.name, branch: g.branch, level: g.level,
      teacher_id: main?.teacher_id || null, hollyhop_teacher_id: main?.hollyhop_teacher_id || null, teacher_fio: main?.fio || null,
      teachers: teachers.map(teacherOut),
      students_count: g.students.size, lessons_count: g.lessons.size,
      last_lesson_date: g.last_lesson_date, status: status(g.last_lesson_date),
      schedule: null,                            // расписание ведётся в HollyHop (GetEdUnits по hollyhop_edunit_id)
    };
  }).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru') || a.group_id.localeCompare(b.group_id));

  const studentList = [...students.values()].map(st => {
    const gs = [...st.groups.entries()].map(([gid, sg]) => {
      const g = groups.get(gid), teachers = rank(sg.teachers);
      return {
        group_id: gid, hollyhop_edunit_id: gid, group_name: g.name, branch: g.branch, level: g.level,
        last_lesson_date: sg.last, teachers: teachers.map(teacherOut),
      };
    }).sort((a, b) => b.last_lesson_date.localeCompare(a.last_lesson_date) || a.group_id.localeCompare(b.group_id));
    const cur = gs[0], main = cur.teachers[0];
    return {
      student_id: st.id, hollyhop_client_id: st.id, fio: st.fio,
      branch: cur.branch, group_id: cur.group_id, group_name: cur.group_name, level: cur.level,
      teacher_id: main?.teacher_id || null, hollyhop_teacher_id: main?.hollyhop_teacher_id || null, teacher_fio: main?.fio || null,
      teachers: cur.teachers,
      status: status(st.last), last_lesson_date: st.last,
      groups: gs,
    };
  }).sort((a, b) => String(a.fio ?? '\uffff').localeCompare(String(b.fio ?? '\uffff'), 'ru') || a.student_id.localeCompare(b.student_id));

  return { students: studentList, groups: groupList };
}

const offsetPage = (list, q, extra = {}) => {
  const limit = limitOf(q), offset = offsetOf(q);
  return { data: list.slice(offset, offset + limit), page: { limit, offset, total: list.length, has_more: offset + limit < list.length }, ...extra };
};

exports.students = async q => {
  const { since, today } = directoryWindow(q);
  const branch = str(q, 'branch'), groupId = str(q, 'group_id', DIGITS), clientId = str(q, 'hollyhop_client_id', DIGITS);
  const teacherId = str(q, 'teacher_id', DIGITS), status = str(q, 'status', /^(active|inactive)$/);
  limitOf(q); offsetOf(q);                                  // ошибки параметров — до тяжёлого расчёта
  const list = (await directory(since, today)).students.filter(s => (!clientId || s.student_id === clientId)
    && (!status || s.status === status) && (!branch || s.groups.some(g => g.branch === branch))
    && (!groupId || s.groups.some(g => g.group_id === groupId))
    && (!teacherId || s.groups.some(g => g.teachers.some(t => t.teacher_id === teacherId))));
  return offsetPage(list, q, { window: { active_since: since, to: today } });
};

exports.groups = async q => {
  const { since, today } = directoryWindow(q);
  const branch = str(q, 'branch'), groupId = str(q, 'group_id', DIGITS), teacherId = str(q, 'teacher_id', DIGITS);
  const status = str(q, 'status', /^(active|inactive)$/);
  limitOf(q); offsetOf(q);
  const list = (await directory(since, today)).groups.filter(g => (!branch || g.branch === branch) && (!groupId || g.group_id === groupId)
    && (!status || g.status === status) && (!teacherId || g.teachers.some(t => t.teacher_id === teacherId)));
  return offsetPage(list, q, { window: { active_since: since, to: today } });
};

/* ---------------- 4.2 Преподаватели ---------------- */

exports.teachers = async q => {
  const branch = str(q, 'branch'), active = str(q, 'active', /^(true|false|1|0)$/);
  limitOf(q); offsetOf(q);
  const list = (await Teacher.findAll())
    .filter(t => (!branch || t.branch === branch) && (active == null || !!t.active === /^(true|1)$/.test(active)))
    .map(t => ({
      teacher_id: String(t.id), hollyhop_teacher_id: t.hollihop_id || null, fio: t.full_name || null, branch: t.branch || null,
      type: t.lang === 'en' ? 'foreign' : 'local', role: t.role, active: !!t.active,
    }));
  return offsetPage(list, q);
};

/* ---------------- Справка: шкалы, типы тестов, лимиты ---------------- */

exports.meta = ({ ratePerMin, maxConcurrent }) => ({
  version: 'v1',
  ids: { student: 'hollyhop_client_id = ClientId ученика в HollyHop', group: 'hollyhop_edunit_id = EdUnit HollyHop', teacher: 'hollyhop_teacher_id = Id преподавателя HollyHop' },
  attendance: ['present', 'absent'],
  daily_scores: {
    scale: SCALE,
    fields: { homework: 'Домашнее задание / Homework', activity: 'Активность / Engagement', behaviour: 'Дисциплина / Discipline' },
    note: 'Ежедневный тест — только у присутствовавших; у отсутствующих null',
  },
  test_categories: personalTests.categories.map(c => ({
    test_category_id: c.id, name: c.name,
    types: c.types.map(t => ({ test_type_id: t.id, name: t.name, max_score: t.skills.reduce((a, k) => a + k.max, 0), skills: t.skills.map(k => ({ skill_id: k.id, name: k.name, max: k.max })) })),
  })),
  not_available: { absence_reason: 'не ведётся в кабинете', comment: 'свободного комментария нет', recommendations: 'в кабинете нет поля рекомендаций', schedule: 'берите в HollyHop по hollyhop_edunit_id' },
  limits: { requests_per_minute_per_ip: ratePerMin, max_concurrent_requests: maxConcurrent, page_limit_max: LIMIT.max, page_limit_default: LIMIT.def, max_period_days: MAX_SPAN_DAYS, directory_max_days: DIR_MAX_DAYS, directory_cache_seconds: Math.round(DIR_CACHE_MS / 1000) },
});

exports.LIMITS = { LIMIT, MAX_SCAN, MAX_SPAN_DAYS, DEFAULT_DAYS, DIR_DEFAULT_DAYS, DIR_MAX_DAYS, ACTIVE_DAYS };
