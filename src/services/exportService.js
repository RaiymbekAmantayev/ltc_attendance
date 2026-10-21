// Выгрузка для админки: «Расписание» (из HollyHop) и «Фактические отметки» (наши сабмиты) — уроки преподавателей по дням.
// Листы: иностранные и местные преподаватели — по ФИО: латиница — иностранный, кириллица — местный.
const hollihop = require('./hollihopService');
const Submission = require('../models/submissionModel');
const Teacher = require('../models/teacherModel');
const xlsx = require('../lib/xlsx');
const { isDate, addDays } = require('../lib/date');
const { AppError } = require('../middleware/errorHandler');

const MAX_DAYS = 62;
const ACADEMIC_HOUR = 45;                                // минут в академическом часе
const POSITION = { teacher: 'преподаватель', coordinator: 'координатор', director: 'директор' };
const SHEETS = [['foreign', 'Иностранные'], ['local', 'Местные']];
const KINDS = { schedule: 'Расписание', submissions: 'Фактические отметки' };

exports.KINDS = KINDS;

/** Проверенный период не длиннее MAX_DAYS; иначе 400. */
exports.period = (from, to) => {
  if (!isDate(from) || !isDate(to) || from > to) throw new AppError(400, 'Укажите дату начала и дату конца');
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  if (days.length > MAX_DAYS) throw new AppError(400, `Период не длиннее ${MAX_DAYS} дней`);
  return days;
};

/** Иностранный или местный — по ФИО: есть кириллица (в том числе казахские буквы) — местный, иначе иностранный. */
const sheetOf = name => (/[\u0400-\u04FF]/.test(name) ? 'local' : 'foreign');
exports.sheetOf = sheetOf;
const newRow = (teacher, name) => ({
  sheet: sheetOf(name), name, position: POSITION[teacher?.role] || POSITION.teacher, counts: {}, lessons: 0, minutes: 0,
});

/** Таблица отчёта: строки по листам, по алфавиту; ак. часы — только у расписания. */
function report(kind, from, to, days, rows) {
  const sheets = SHEETS.map(([key, name]) => ({
    key, name,
    rows: [...rows.values()].filter(r => r.sheet === key).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
      .map(({ sheet, minutes, ...r }) => (kind === 'schedule' ? { ...r, hours: Math.round((minutes / ACADEMIC_HOUR) * 100) / 100 } : r)),
  }));
  return { kind, title: KINDS[kind], from, to, days, sheets };
}

/** Расписание HollyHop: сколько уроков по группам у каждого преподавателя в каждый день. Все преподаватели реестра — даже без уроков. */
exports.schedule = async (from, to) => {
  const days = exports.period(from, to);
  const [lessons, staff] = await Promise.all([hollihop.lessonsInRange(from, to), Teacher.findAll()]);
  const byHollihopId = new Map(staff.filter(t => t.hollihop_id).map(t => [String(t.hollihop_id), t]));
  const rows = new Map();
  for (const t of staff) if (t.active && t.role === 'teacher' && t.hollihop_id) rows.set(String(t.hollihop_id), newRow(t, t.full_name));

  // Кого нет в реестре — полное имя из HollyHop (если не удалось — как в расписании).
  const unknownIds = new Set(lessons.flatMap(l => l.teacherIds).filter(id => !byHollihopId.has(id)));
  const hhNames = unknownIds.size ? new Map((await hollihop.teachers().catch(() => [])).map(t => [t.id, t.name])) : new Map();

  for (const l of lessons) {
    l.teacherIds.forEach((id, i) => {
      const teacher = byHollihopId.get(id);
      if (!rows.has(id)) rows.set(id, newRow(teacher, teacher?.full_name || hhNames.get(id) || l.teacherNames[i] || `HollyHop ID ${id}`));
      const row = rows.get(id);
      row.counts[l.date] = (row.counts[l.date] || 0) + 1;
      row.lessons++;
      row.minutes += l.minutes;
    });
  }
  return report('schedule', from, to, days, rows);
};

/** Фактические отметки: сколько уроков каждый преподаватель отметил (отправил в HollyHop) в каждый день. */
exports.submissions = async (from, to) => {
  const days = exports.period(from, to);
  const rows = new Map();
  for (const s of await Submission.list({ from, to })) {
    const key = String(s.teacher_id);
    if (!rows.has(key)) rows.set(key, newRow({ lang: s.teacher_lang, role: s.teacher_role }, s.full_name));
    const row = rows.get(key);
    row.counts[s.lesson_date] = (row.counts[s.lesson_date] || 0) + 1;
    row.lessons++;
  }
  return report('submissions', from, to, days, rows);
};

/** Подпись дня в шапке: у расписания «21.09», у отметок — число месяца. */
const dayLabel = (kind, iso) => (kind === 'schedule' ? `${Number(iso.slice(8))}.${iso.slice(5, 7)}` : String(Number(iso.slice(8))));
exports.dayLabel = dayLabel;

/** Лист Excel в формате учебного отдела: № п/п · ФИО · Должность · числа месяца · итоги. */
function sheet(rep, { name, rows }) {
  const { col, STYLES: S } = xlsx;
  const D = rep.days.length, first = 3, last = first + D - 1;
  const schedule = rep.kind === 'schedule';
  const tail = schedule ? ['академ.часы\n45 мин', 'Ставка за ак.час, ₸', 'Зп за период'] : ['Итого уроков'];
  const head = v => ({ v, s: S.head });
  const num = v => ({ v, s: S.num });

  const head1 = [head('№ п/п'), head('ФИО'), head('Должность'), head('Числа месяца'), ...Array(D - 1).fill(head('')), ...tail.map(head)];
  const head2 = [head(''), head(''), head(''), ...rep.days.map(d => head(dayLabel(rep.kind, d))), ...tail.map(() => head(''))];
  const merges = ['A1:A2', 'B1:B2', 'C1:C2', `${col(first)}1:${col(last)}1`, ...tail.map((_, i) => `${col(last + 1 + i)}1:${col(last + 1 + i)}2`)];
  if (D === 1) merges.splice(3, 1);

  const body = rows.map((r, i) => {
    const n = i + 3, hours = col(last + 1), rate = col(last + 2);
    return [num(i + 1), { v: r.name, s: S.cell }, { v: r.position, s: S.cell }, ...rep.days.map(d => num(r.counts[d] || null)),
      ...(schedule
        ? [num(r.hours), num(null), { f: `IF(${rate}${n}="","",${hours}${n}*${rate}${n})`, s: S.num }]
        : [num(r.lessons)])];
  });
  const sum = c => ({ f: `SUM(${col(c)}3:${col(c)}${rows.length + 2})`, s: S.total });
  const total = rows.length ? [[{ v: '', s: S.total }, { v: 'Итого', s: S.total }, { v: '', s: S.total },
    ...rep.days.map((_, i) => sum(first + i)),
    ...(schedule ? [sum(last + 1), { v: '', s: S.total }, sum(last + 3)] : [sum(last + 1)])]] : [];

  return {
    name, merges, rows: [head1, head2, ...body, ...total], freeze: { rows: 2, cols: 3 }, heights: { 1: 32 },
    widths: [6, 34, 16, ...Array(D).fill(6), ...(schedule ? [12, 14, 14] : [12])],
  };
}

/** Книга Excel: лист иностранных и лист местных преподавателей. */
exports.toXlsx = rep => xlsx.build(rep.sheets.map(s => sheet(rep, s)));

exports.fileName = rep => `LTC_${rep.kind}_${rep.from}_${rep.to}.xlsx`;
