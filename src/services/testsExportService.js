// Выгрузка «Тесты учеников»: результаты персональных (доп.) тестов и ежедневного теста за период — из наших отметок, не из HollyHop.
// Всё, что ученик сдал через кабинет, уже лежит в submissions.payload: одна выборка из БД вместо запроса в HollyHop по каждому ученику.
// ФИО и уровень группы новые отметки хранят сами; для старых — состав и уровень группы из HollyHop (по запросу на группу, из кэша).
const hollihop = require('./hollihopService');
const Submission = require('../models/submissionModel');
const personalTests = require('../config/personalTests');
const testing = require('../config/testing');
const levels = require('../config/levels');
const xlsx = require('../lib/xlsx');

const DAILY_SLOTS = [['hw', 'Домашнее задание'], ['eng', 'Активность'], ['disc', 'Дисциплина']];   // по порядку навыков в config/testing.js
const BANDS = [['good', '≥80%'], ['mid', '70–79%'], ['bad', '<70%']];
const HH_CONCURRENCY = 4;
const PAGE = 1000;                                       // отметок из БД за раз — память не растёт с периодом

const round = (v, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits;
const bandOf = pct => (pct >= 0.8 ? 'good' : pct >= 0.7 ? 'mid' : 'bad');
const levelOf = raw => levels.normalize(raw) || String(raw || '').trim() || '—';
const levelRank = level => (levels.LEVELS.includes(level) ? levels.LEVELS.indexOf(level) : levels.LEVELS.length);

/** Дополняет found ФИО учеников и уровнем групп, которых нет в старых отметках: names — groupId → Map(id → name), levels — groupId → level. */
async function lookupGroups(rows, { names, levels: groupLevels }) {
  const need = [...new Set(rows.filter(r => !r.payload.level || r.payload.students.some(s => !s.name)).map(r => r.group_id))]
    .filter(id => !names.has(id));
  for (let i = 0; i < need.length; i += HH_CONCURRENCY) {
    await Promise.all(need.slice(i, i + HH_CONCURRENCY).map(async id => {
      const [students, group] = await Promise.all([hollihop.allStudents(id).catch(() => []), hollihop.groupById(id).catch(() => null)]);
      names.set(id, new Map(students.map(s => [s.id, s.name])));
      groupLevels.set(id, group?.level || '');
    }));
  }
}

const NONE = '—';
/** Уровень группы отметки: из payload, у старых — из HollyHop (found.levels). */
const levelOfRow = (r, found) => levelOf(r.payload.level || found.levels.get(r.group_id));
/** Фильтр отметок по городу (r.city — см. withCity), уровню группы и преподавателю (пусто — все); без филиала — «—». */
const matcher = ({ city, level, teacher } = {}) => (r, found) =>
  (!city || (r.city || NONE) === city) && (!teacher || String(r.teacher_id) === String(teacher)) && (!level || levelOfRow(r, found) === level);

/** Страница отметок из БД: payload разобран, city — город филиала отметки. */
const withCity = (page, cityOf) => page.map(r => ({ ...r, payload: Submission.parse(r.payload), city: cityOf(r.branch) }));

/** Отчёт за период: { kind, from, to, summary, sheets, filters, options }. filters — { city, level, teacher }; период проверяет вызывающий. */
exports.report = async (from, to, filters = {}) => {
  const found = { names: new Map(), levels: new Map() };
  const match = matcher(filters), cityOf = await hollihop.cityResolver();
  const options = { cities: new Set(), levels: new Set(), teachers: new Map() };   // что есть за период — для фильтров
  const personal = new Map();                            // categoryId → лист
  const daily = new Map();                               // ученик + группа + преподаватель → строка средних
  for (let afterId = 0, page; (page = await Submission.pageForTests(from, to, afterId, PAGE)).length; afterId = page[page.length - 1].id) {
    const rows = withCity(page, cityOf);
    await lookupGroups(rows, found);
    for (const r of rows) {
      options.cities.add(r.city); options.levels.add(levelOfRow(r, found)); options.teachers.set(String(r.teacher_id), r.full_name);
      if (match(r, found) && r.payload.students.some(s => s.skills || s.personalSkills)) collect(r);
    }
  }

  function collect(r) {
    const p = r.payload, level = levelOfRow(r, found);
    const date = typeof r.lesson_date === 'string' ? r.lesson_date.slice(0, 10) : r.lesson_date.toISOString().slice(0, 10);
    const choice = p.personal && personalTests.find(p.personal.categoryId, p.personal.testTypeId);
    const dailySkills = (testing.skillsByType[p.testTypeId] || testing.skillsByType[testing.testTypeIds.local]).filter(k => !k.fixed);

    for (const s of p.students) {
      const base = {
        student: s.name || found.names.get(r.group_id)?.get(String(s.id)) || `ID ${s.id}`,
        teacher: r.full_name, group: r.group_name || r.group_id, level,
      };

      if (s.personalSkills && choice) {
        const { category, type } = choice;
        if (!personal.has(category.id)) personal.set(category.id, { key: `p${category.id}`, name: category.name, category, extra: [], rows: [] });
        const sheet = personal.get(category.id);
        for (const id of Object.keys(s.personalSkills)) if (!type.skills.some(k => String(k.id) === id) && !sheet.extra.includes(id)) sheet.extra.push(id);
        const total = round(Object.values(s.personalSkills).reduce((a, v) => a + Number(v || 0), 0));
        const max = type.skills.reduce((a, k) => a + k.max, 0);
        sheet.rows.push({ ...base, date, test: type.name, scores: s.personalSkills, total, max, pct: max ? round(total / max, 4) : 0 });
      }

      if (s.skills) {
        const key = `${r.group_id}:${s.id}:${r.teacher_id}`;
        if (!daily.has(key)) daily.set(key, { ...base, lessons: 0, sums: {} });
        const row = daily.get(key);
        row.lessons++;
        dailySkills.forEach((k, i) => {
          const slot = DAILY_SLOTS[i]?.[0];
          if (slot && s.skills[k.id] != null) row.sums[slot] = (row.sums[slot] || 0) + Number(s.skills[k.id]);
        });
      }
    }
  }

  const byName = (a, b) => a.student.localeCompare(b.student, 'ru') || a.date?.localeCompare(b.date || '') || 0;
  const sheets = personalTests.categories.filter(c => personal.has(c.id)).map(c => {
    const sheet = personal.get(c.id);
    // Колонки навыков: все навыки типов категории по порядку + навыки старых отметок, которых в настройке уже нет.
    const skills = [];
    for (const t of c.types) for (const k of t.skills) if (!skills.some(x => x.id === k.id)) skills.push({ id: k.id, name: k.name, maxes: new Set() });
    for (const t of c.types) for (const k of t.skills) skills.find(x => x.id === k.id).maxes.add(k.max);
    for (const id of sheet.extra) skills.push({ id: Number(id), name: `Навык ${id}`, maxes: new Set() });
    return {
      key: sheet.key, name: sheet.name, info: [['date', 'Дата'], ['test', 'Тест']],
      skills: skills.map(({ maxes, ...k }) => ({ ...k, max: maxes.size === 1 ? [...maxes][0] : null })),   // разный максимум у типов — не пишем
      rows: sheet.rows.sort(byName),
    };
  });

  const dailyMax = DAILY_SLOTS.length * 5;
  const dailyRows = [...daily.values()].map(({ sums, lessons, ...row }) => {
    const scores = Object.fromEntries(DAILY_SLOTS.map(([slot]) => [slot, sums[slot] != null ? round(sums[slot] / lessons) : null]));
    const total = round(Object.values(scores).reduce((a, v) => a + (v || 0), 0));
    return { ...row, lessons, scores, total, max: dailyMax, pct: round(total / dailyMax, 4) };
  }).sort(byName);
  if (dailyRows.length) {
    sheets.push({
      key: 'daily', name: 'Daily test', info: [['lessons', 'Уроков']],
      skills: DAILY_SLOTS.map(([id, name]) => ({ id, name, max: 5 })), rows: dailyRows, average: true,
    });
  }

  // Сводка по уровням (как «Отчет» учебного отдела): сколько сдали и сколько в каждом диапазоне процента.
  const summary = sheets.filter(s => s.key !== 'daily').map(s => {
    const byLevel = new Map();
    for (const r of s.rows) {
      if (!byLevel.has(r.level)) byLevel.set(r.level, { level: r.level, count: 0, good: 0, mid: 0, bad: 0 });
      const row = byLevel.get(r.level);
      row.count++;
      row[bandOf(r.pct)]++;
    }
    return { key: s.key, name: s.name, levels: [...byLevel.values()].sort((a, b) => levelRank(a.level) - levelRank(b.level) || a.level.localeCompare(b.level)) };
  });

  const sortRu = list => list.sort((a, b) => a.localeCompare(b, 'ru'));
  return {
    kind: 'tests', title: 'Тесты учеников', from, to, summary, sheets,
    filters: { city: filters.city || '', level: filters.level || '', teacher: filters.teacher ? String(filters.teacher) : '' },
    options: {
      cities: sortRu([...options.cities]),
      levels: [...options.levels].sort((a, b) => levelRank(a) - levelRank(b) || a.localeCompare(b)),
      teachers: [...options.teachers].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    },
  };
};

exports.BANDS = BANDS;
exports.bandOf = bandOf;
exports.lookupGroups = lookupGroups;
exports.matcher = matcher;
exports.withCity = withCity;
exports.ruDate = iso => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
exports.PCT_STYLE = { good: 'pctGood', mid: 'pctMid', bad: 'pctBad' };

/* ---------------- Excel ---------------- */

const { ruDate, PCT_STYLE } = exports;

/** Лист «Отчет»: по каждой категории — уровни, сколько сдали, сколько ≥80%, 70–79%, <70%; итоги и доли формулами. */
function summarySheet(rep) {
  const { col, STYLES: S } = xlsx;
  const head = v => ({ v, s: S.head }), num = v => ({ v, s: S.num });
  const rows = [[{ v: `Период: ${ruDate(rep.from)} — ${ruDate(rep.to)}`, s: S.total }, ...Array(4).fill({ v: '', s: S.total })]];
  const merges = ['A1:E1'];
  for (const block of rep.summary) {
    rows.push([]);
    const top = rows.length + 1;
    rows.push([head(block.name), head(''), head(''), head(''), head('')]);
    merges.push(`A${top}:E${top}`);
    rows.push([head('Уровень'), head('Количество сдавших'), ...BANDS.map(([, label]) => head(label))]);
    const first = rows.length + 1;
    for (const l of block.levels) rows.push([{ v: l.level, s: S.cell }, num(l.count), ...BANDS.map(([band]) => num(l[band]))]);
    const last = rows.length, totalRow = rows.length + 1;
    rows.push([{ v: 'Итого', s: S.total }, ...[1, 2, 3, 4].map(c => ({ f: `SUM(${col(c)}${first}:${col(c)}${last})`, s: S.total }))]);
    rows.push([{ v: '', s: S.cell }, { v: '', s: S.cell },
      ...[2, 3, 4].map(c => ({ f: `IF($B${totalRow}=0,"",${col(c)}${totalRow}/$B${totalRow})`, s: S.pct }))]);
  }
  if (!rep.summary.length) rows.push([], ['Нет доп. тестов за период']);
  return { name: 'Отчет', rows, merges, widths: [26, 20, 12, 12, 12], heights: { 1: 22 } };
}

/** Лист категории (или Daily test): строка максимумов, шапка, строка на результат; % раскрашен по диапазону, ноль по навыку — красный. */
function resultsSheet(sheet) {
  const { STYLES: S } = xlsx;
  const head = v => ({ v, s: S.head });
  const fixed = ['№', 'Ученик', 'Преподаватель', 'Группа', 'Уровень', ...sheet.info.map(([, label]) => label)];
  const tail = sheet.average ? ['Средний балл', 'Макс. балл', 'Результат, %'] : ['Результат теста', 'Макс. балл', 'Результат теста, %'];
  const maxRow = [...fixed.map(() => null), ...sheet.skills.map(k => (k.max != null ? { v: k.max, s: S.num } : null)), ...tail.map(() => null)];
  const body = sheet.rows.map((r, i) => [
    { v: i + 1, s: S.num }, { v: r.student, s: S.cell }, { v: r.teacher, s: S.cell }, { v: r.group, s: S.cell }, { v: r.level, s: S.cell },
    ...sheet.info.map(([key]) => (key === 'date' ? { v: ruDate(r.date), s: S.num } : { v: r[key], s: S.num })),
    ...sheet.skills.map(k => {
      const v = r.scores[k.id];
      return v == null ? { v: '', s: S.num } : { v: Number(v), s: Number(v) === 0 ? S.numBad : S.num };
    }),
    { v: r.total, s: S.num }, { v: r.max, s: S.num }, { v: r.pct, s: S[PCT_STYLE[bandOf(r.pct)]] },
  ]);
  return {
    name: sheet.name, rows: [maxRow, [...fixed, ...sheet.skills.map(k => k.name), ...tail].map(head), ...body],
    freeze: { rows: 2, cols: 2 }, heights: { 2: 32 },
    widths: [5, 32, 28, 22, 16, ...sheet.info.map(() => 12), ...sheet.skills.map(() => 12), 12, 10, 13],
  };
}

/** Листы книги «Тесты учеников»: «Отчет» и по листу на категорию / Daily test. */
exports.xlsxSheets = rep => [summarySheet(rep), ...rep.sheets.map(resultsSheet)];
