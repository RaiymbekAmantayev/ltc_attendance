// Даты в часовом поясе учебного отдела (по умолчанию Asia/Almaty, UTC+5).
const { timezone } = require('../config/env');

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Настоящая календарная дата вида YYYY-MM-DD (31 февраля не пройдёт). */
const isDate = value => {
  if (!/^\d{4}-\d\d-\d\d$/.test(value || '')) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};

const todayIso = () => dayFormat.format(new Date());

const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const monthStart = iso => iso.slice(0, 7) + '-01';

/** Битовая маска дня недели HollyHop: Пн=1 … Вс=64. */
const weekdayBit = iso => 1 << ((new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7);

/** Календарная дата (в поясе отдела) для метки времени MySQL в UTC «YYYY-MM-DD HH:MM:SS». */
const localDayOf = utcStamp => dayFormat.format(new Date(String(utcStamp).replace(' ', 'T') + 'Z'));

/** Период из query-параметров from/to; по умолчанию — текущий месяц. */
const period = (from, to) => {
  const end = isDate(to) ? to : todayIso();
  const start = isDate(from) ? from : monthStart(end);
  return start <= end ? { from: start, to: end } : { from: end, to: start };
};

module.exports = { isDate, todayIso, addDays, monthStart, weekdayBit, localDayOf, period };
