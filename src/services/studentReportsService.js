// Вкладки «Тестов учеников» по ученикам из наших отметок (submissions.payload), не из HollyHop:
// «По преподавателям» — средний % тестов каждого ученика преподавателя в колонке своего диапазона (≥80%, 70–79%, <70%);
// «Посещаемость» — сколько учеников с 1 и 2 пропусками и с долей пропусков от 15%, 30%, 50% — по преподавателю или по всем.
const Submission = require('../models/submissionModel');
const personalTests = require('../config/personalTests');
const testing = require('../config/testing');
const xlsx = require('../lib/xlsx');
const { BANDS, bandOf, lookupGroups, ruDate, PCT_STYLE } = require('./testsExportService');

const PAGE = 1000;
const ALL = 'all';
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

/** Отметки за период страницами по id; names — ФИО учеников старых отметок из HollyHop. */
async function eachSubmission(from, to, onRow) {
  const found = { names: new Map(), levels: new Map() };
  for (let afterId = 0, page; (page = await Submission.pageForTests(from, to, afterId, PAGE)).length; afterId = page[page.length - 1].id) {
    const rows = page.map(r => ({ ...r, payload: Submission.parse(r.payload) }));
    await lookupGroups(rows, found);
    for (const r of rows) {
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
exports.results = async (from, to) => {
  const teachers = new Map();
  await eachSubmission(from, to, (r, nameOf) => {
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
  const rows = [...students.values()].map(r => ({ ...r, rate: round(r.absent / r.lessons) })).sort(byStudent);
  const counts = Object.fromEntries(CRITERIA.map(([key, , test]) => [key, rows.filter(r => test(r.absent, r.lessons)).length]));
  return { id, name, students: rows.length, counts, rows: rows.filter(r => r.absent) };
}

/** Посещаемость: { criteria, scopes: [все, ...преподаватели] }; rows — ученики хотя бы с одним пропуском. */
exports.attendance = async (from, to) => {
  const all = new Map(), seen = new Set(), teachers = new Map();
  const add = (map, r, s, name) => {
    const key = `${r.group_id}:${s.id}`;
    if (!map.has(key)) map.set(key, { student: name, group: r.group_name || r.group_id, lessons: 0, absent: 0 });
    const row = map.get(key);
    row.lessons++;
    if (s.status === 'absent') row.absent++;
  };
  await eachSubmission(from, to, (r, nameOf) => {
    const t = String(r.teacher_id);
    if (!teachers.has(t)) teachers.set(t, { id: t, name: r.full_name, students: new Map() });
    const date = isoOf(r.lesson_date);
    for (const s of r.payload.students) {
      const name = nameOf(s);
      add(teachers.get(t).students, r, s, name);
      // Урок могут отметить два преподавателя: в «все преподаватели» ученик урока считается один раз (по первой отметке).
      const lesson = `${r.group_id}:${date}:${s.id}`;
      if (!seen.has(lesson)) { seen.add(lesson); add(all, r, s, name); }
    }
  });
  return {
    criteria: CRITERIA.map(([key, label]) => [key, label]),
    scopes: [scope(ALL, 'Все преподаватели', all), ...teacherList(teachers).map(t => scope(t.id, t.name, t.students))],
  };
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
    name: 'Пропуски учеников', freeze: { rows: 1, cols: 2 }, widths: [5, 34, 24, 10, 11, 12],
    rows: [['№', 'ФИО ученика', 'Группа', 'Уроков', 'Пропусков', '% пропусков'].map(head),
      ...sc.rows.map((r, i) => [num(i + 1), { v: r.student, s: S.cell }, { v: r.group, s: S.cell }, num(r.lessons), num(r.absent),
        { v: r.rate, s: r.rate >= 0.3 ? S.pctBad : r.rate >= 0.15 ? S.pctMid : S.pct }])],
  };
  return [summary, list];
};
