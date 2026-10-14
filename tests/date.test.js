const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.BOT_TOKEN = 'x'; process.env.DATABASE_URL = 'mysql://x'; process.env.HH_MOCK = '1'; process.env.APP_TZ = 'Asia/Almaty';
const d = require('../src/lib/date');

test('isDate принимает только настоящие даты', () => {
  assert.ok(d.isDate('2026-10-14'));
  assert.ok(!d.isDate('2026-02-31'));
  assert.ok(!d.isDate('14.10.2026'));
  assert.ok(!d.isDate(undefined));
});

test('маска дня недели HollyHop: Пн=1 … Вс=64', () => {
  assert.equal(d.weekdayBit('2026-10-12'), 1);           // понедельник
  assert.equal(d.weekdayBit('2026-10-14'), 4);           // среда
  assert.equal(d.weekdayBit('2026-10-18'), 64);          // воскресенье
});

test('«день отметки» считается в поясе отдела (UTC+5), а не по UTC', () => {
  assert.equal(d.localDayOf('2026-10-14 20:30:00'), '2026-10-15');   // 01:30 в Алматы уже следующего дня
  assert.equal(d.localDayOf('2026-10-14 10:00:00'), '2026-10-14');
});

test('period: по умолчанию текущий месяц, перевёрнутые даты исправляются', () => {
  const p = d.period('2026-10-20', '2026-10-01');
  assert.deepEqual(p, { from: '2026-10-01', to: '2026-10-20' });
  assert.equal(d.addDays('2026-10-31', 1), '2026-11-01');
});
