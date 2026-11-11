// Вкладки «Тестов учеников» по ученикам из наших отметок (submissions.payload), не из HollyHop:
// «По преподавателям» — средний % тестов каждого ученика преподавателя в колонке своего диапазона (≥80%, 70–79%, <70%);
// «Посещаемость» — сколько учеников с 1 и 2 пропусками и с долей пропусков от 15%, 30%, 50% — по преподавателю или по всем.
// В посещаемости — только ученики, которые сейчас учатся в группе (GetEdUnitStudents: BeginDate есть, EndDate нет или не прошла),
// и по ученику одна строка: уроки всех его текущих групп вместе.
const Submission = require('../models/submissionModel');
const AbsenceFeedback = require('../models/absenceFeedbackModel');
const personalTests = require('../config/personalTests');
const testing = require('../config/testing');
const xlsx = require('../lib/xlsx');
const { localDayOf } = require('../lib/date');
const hollihop = require('./hollihopService');
const { BANDS, bandOf, lookupGroups, newFound, matcher, withCity, ruDate, PCT_STYLE } = require('./testsExportService');

const PAGE = 1000;
const ALL = 'all';
const HH_CONCURRENCY = 4;
/** Критерии посещаемости: test(пропусков, уроков). Проценты — «не меньше», поэтому ученик может попасть в несколько строк. */
const CRITERIA = [
  ['one', '1 пропуск', (absent) => absent === 1],
  ['two', '2 пропуска', (absent) => absent === 2],
  ['p15', '≥15% пропусков', (absent, lessons) => absent / lessons >= 0.15],
  ['p30', '≥30% пропусков', (absent, lessons) => absent / lessons >= 0.3],
  ['p50', '≥50% пропусков', (absent, lessons) => absent / lessons >= 0.5],
];

const round = (v, digits = 4) => Math.round(v * 10 ** digits) / 10 ** digits;
const isoOf = d => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));
const byStudent = (a, b) => a.student.localeCompare(b.student, 'ru');

/** Отметки за период страницами по id, подходящие под фильтры (город, уровень, преподаватель); names — ФИО учеников старых отметок из HollyHop. */
async function eachSubmission(from, to, filters, onRow, onPage) {
  const [found, cityOf] = await Promise.all([newFound(from, to), hollihop.cityResolver()]), match = matcher(filters);
  for (let afterId = 0, page; (page = await Submission.pageForTests(from, to, afterId, PAGE)).length; afterId = page[page.length - 1].id) {
    const rows = withCity(page, cityOf);
    await lookupGroups(rows, found);
    if (onPage) await onPage(rows, found);
    for (const r of rows.filter(x => match(x, found))) {
      const nameOf = s => s.name || found.names.get(r.group_id)?.get(String(s.id)) || `ID ${s.id}`;
      onRow(r, nameOf);
    }
  }
}

/** Преподаватели отчёта по алфавиту: [{ id, name, rows }]. */
const teacherList = map => [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));

/** Доли результатов ученика: ежедневный тест — за каждый урок, доп. тест — каждый. */
function resultsOf(s, p) {
  const out = [];
  if (s.skills) {
    const skills = testing.skillsFor(p.testTypeId).filter(k => !k.fixed);
    const max = skills.reduce((a, k) => a + k.max, 0);
    if (max) out.push(skills.reduce((a, k) => a + Number(s.skills[k.id] || 0), 0) / max);
  }
  const choice = s.personalSkills && p.personal && personalTests.find(p.personal.categoryId, p.personal.testTypeId);
  if (choice) {
    const max = choice.type.skills.reduce((a, k) => a + k.max, 0);
    if (max) out.push(Object.values(s.personalSkills).reduce((a, v) => a + Number(v || 0), 0) / max);
  }
  return out;
}

/** Результаты по преподавателям: [{ id, name, rows: [{ student, results, pct, band }] }]. */
exports.results = async (from, to, filters = {}) => {
  const teachers = new Map();
  await eachSubmission(from, to, filters, (r, nameOf) => {
    const key = String(r.teacher_id);
    if (!teachers.has(key)) teachers.set(key, { id: key, name: r.full_name, students: new Map() });
    const students = teachers.get(key).students;
    for (const s of r.payload.students) {
      const results = resultsOf(s, r.payload);
      if (!results.length) continue;
      const id = String(s.id);
      if (!students.has(id)) students.set(id, { student: nameOf(s), sum: 0, results: 0 });
      const row = students.get(id);
      row.sum += results.reduce((a, v) => a + v, 0);
      row.results += results.length;
    }
  });
  const list = teacherList(teachers).map(({ students, ...t }) => ({
    ...t,
    rows: [...students.values()].map(({ sum, results, student }) => {
      const pct = round(sum / results);
      return { student, results, pct, band: bandOf(pct) };
    }).sort(byStudent),
  })).filter(t => t.rows.length);
  return list;
};

/** Строки учеников и счётчики критериев по набору уроков ученика. */
function scope(id, name, students) {
  const rows = [...students.values()].map(({ groups, ...r }) => ({
    ...r, group: [...groups.values()].join(', '), groups: [...groups].map(([gid, name]) => ({ id: String(gid), name })), rate: round(r.absent / r.lessons),
  })).sort(byStudent);
  const counts = Object.fromEntries(CRITERIA.map(([key, , test]) => [key, rows.filter(r => test(r.absent, r.lessons)).length]));
  return { id, name, students: rows.length, counts, rows: rows.filter(r => r.absent) };
}

/**
 * Текущий состав групп страницы: groupId → Set(id учеников). Сначала — из составов за период (found.rosters, один массовый запрос),
 * группы, которых там нет, — по запросу на группу. Не удалось получить состав — null: ученики группы не отбрасываются.
 */
async function loadActive(rows, active, found) {
  for (const id of new Set(rows.map(r => r.group_id))) {
    const g = !active.has(id) && found.rosters?.get(id);
    if (g) active.set(id, new Set(g.students.filter(s => s.current).map(s => s.id)));
  }
  const need = [...new Set(rows.map(r => r.group_id))].filter(id => !active.has(id));
  for (let i = 0; i < need.length; i += HH_CONCURRENCY) {
    await Promise.all(need.slice(i, i + HH_CONCURRENCY).map(async id => {
      try { active.set(id, new Set((await hollihop.students(id)).map(s => String(s.id)))); }
      catch (error) { console.warn(`посещаемость: состав группы ${id} не получен — ${error.message}`); active.set(id, null); }
    }));
  }
}

/** Обратная связь для ответа: дата — ISO в UTC. */
const feedbackOf = f => (f ? {
  status: f.status, reason: f.reason, mentor: f.mentor, period: { from: isoOf(f.period_from), to: isoOf(f.period_to) },
  feedbackAt: String(f.feedback_at).replace(' ', 'T') + 'Z',
} : null);

/** Посещаемость: { criteria, scopes: [все, ...преподаватели] }; rows — ученики хотя бы с одним пропуском, groups — их текущие группы. */
exports.attendance = async (from, to, filters = {}) => {
  const all = new Map(), seen = new Set(), teachers = new Map(), active = new Map();
  const add = (map, r, s, name) => {
    const key = String(s.id);
    if (!map.has(key)) map.set(key, { id: key, student: name, groups: new Map(), lessons: 0, absent: 0 });
    const row = map.get(key);
    row.groups.set(r.group_id, r.group_name || r.group_id);   // группа — по id: после переименования в HollyHop — последнее название
    row.lessons++;
    if (s.status === 'absent') row.absent++;
  };
  const isActive = (r, s) => { const ids = active.get(r.group_id); return ids == null || ids.has(String(s.id)); };
  await eachSubmission(from, to, filters, (r, nameOf) => {
    const t = String(r.teacher_id);
    if (!teachers.has(t)) teachers.set(t, { id: t, name: r.full_name, students: new Map() });
    const date = isoOf(r.lesson_date);
    for (const s of r.payload.students.filter(x => isActive(r, x))) {
      const name = nameOf(s);
      add(teachers.get(t).students, r, s, name);
      // Урок могут отметить два преподавателя: в «все преподаватели» ученик урока считается один раз (по первой отметке).
      const lesson = `${r.group_id}:${date}:${s.id}`;
      if (!seen.has(lesson)) { seen.add(lesson); add(all, r, s, name); }
    }
  }, (rows, found) => loadActive(rows, active, found));
  const scopes = [scope(ALL, 'Все преподаватели', all), ...teacherList(teachers).map(t => scope(t.id, t.name, t.students))];
  // Обратная связь менторов (absence_feedback) — последняя по ученику среди периодов, пересекающихся с отчётом.
  const feedback = await AbsenceFeedback.latestFor(from, to);
  for (const sc of scopes) for (const r of sc.rows) r.feedback = feedbackOf(feedback.get(r.id));
  return { criteria: CRITERIA.map(([key, label]) => [key, label]), scopes };
};

/* ---------------- Excel ---------------- */

const periodRow = (rep, extra, width) => {
  const { STYLES: S } = xlsx;
  return [{ v: `${ruDate(rep.from)} — ${ruDate(rep.to)}${extra ? ' · ' + extra : ''}`, s: S.total }, ...Array(width - 1).fill({ v: '', s: S.total })];
};

/** Лист «По преподавателям»: по блоку на преподавателя (teacherId — только он) — ФИО ученика и его средний % в колонке своего диапазона, итог — число учеников. */
exports.resultsSheet = (rep, teacherId) => {
  const { col, STYLES: S } = xlsx;
  const head = v => ({ v, s: S.head });
  const teachers = teacherId && teacherId !== ALL ? rep.byTeacher.filter(t => t.id === String(teacherId)) : rep.byTeacher;
  const rows = [periodRow(rep, teachers.length === 1 ? teachers[0].name : '', 4)];
  const merges = ['A1:D1'];
  for (const t of teachers) {
    rows.push([]);
    if (teachers.length > 1) {
      rows.push([head(t.name), head(''), head(''), head('')]);
      merges.push(`A${rows.length}:D${rows.length}`);
    }
    rows.push([head('ФИО ученика'), ...BANDS.map(([, label]) => head(label))]);
    const first = rows.length + 1;
    for (const r of t.rows) rows.push([{ v: r.student, s: S.cell }, ...BANDS.map(([band]) => (band === r.band ? { v: r.pct, s: S[PCT_STYLE[band]] } : { v: '', s: S.num }))]);
    const last = rows.length;
    rows.push([{ v: 'Учеников', s: S.total }, ...[1, 2, 3].map(c => ({ f: `COUNT(${col(c)}${first}:${col(c)}${last})`, s: S.total }))]);
  }
  if (!teachers.length) rows.push([], ['Нет тестов за период']);
  return { name: 'По преподавателям', rows, merges, widths: [36, 12, 12, 12], heights: { 1: 22 } };
};

/** Листы посещаемости (rep.attendance): «Посещаемость» — критерии и количество, «Пропуски учеников» — у кого были пропуски. */
exports.attendanceSheets = (rep, teacherId) => {
  const { STYLES: S } = xlsx;
  const head = v => ({ v, s: S.head }), num = v => ({ v, s: S.num });
  const att = rep.attendance;
  const sc = att.scopes.find(x => x.id === String(teacherId || ALL)) || att.scopes[0];
  const summary = {
    name: 'Посещаемость', merges: ['A1:B1'], widths: [24, 12], heights: { 1: 22 },
    rows: [periodRow(rep, sc.name, 2), [], [head('Критерий'), head('Кол-во')],
      ...att.criteria.map(([key, label]) => [{ v: label, s: S.cell }, num(sc.counts[key])]),
      [{ v: 'Учеников всего', s: S.total }, { v: sc.students, s: S.total }]],
  };
  const list = {
    name: 'Пропуски учеников', freeze: { rows: 1, cols: 2 }, widths: [5, 34, 24, 10, 11, 12, 16, 40, 14],
    rows: [['№', 'ФИО ученика', 'Группы', 'Уроков', 'Пропусков', '% пропусков', 'Статус', 'Причина', 'Дата ОС'].map(head),
      ...sc.rows.map((r, i) => [num(i + 1), { v: r.student, s: S.cell }, { v: r.group, s: S.cell }, num(r.lessons), num(r.absent),
        { v: r.rate, s: r.rate >= 0.3 ? S.pctBad : r.rate >= 0.15 ? S.pctMid : S.pct },
        { v: r.feedback?.status || '', s: S.cell }, { v: r.feedback?.reason || '', s: S.cell },
        { v: r.feedback ? ruDate(localDayOf(r.feedback.feedbackAt.slice(0, 19).replace('T', ' '))) : '', s: S.cell }])],
  };
  return [summary, list];
};
