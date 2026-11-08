// Сколько уроков засчитывать: занятие от 90 минут — за два; у старых отметок длительность — из расписания HollyHop.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const hollihop = require('../src/services/hollihopService');
const units = require('../src/services/lessonUnitsService');

test('длительность по времени группы и число уроков', () => {
  assert.deepEqual(['10:00–11:30', '9:00-10:00', '15:00 – 16:30', '', null].map(units.minutesOfTime), [90, 60, 90, null, null]);
  assert.deepEqual([45, 89, 90, 120, null].map(units.unitsOf), [1, 1, 2, 2, 1]);
});

test('старые отметки: самое длинное занятие группы за день, а не сумма (45 + 45 у двух преподавателей — по уроку)', async t => {
  t.mock.method(hollihop, 'lessonsInRange', async () => [
    { date: '2026-11-02', groupId: '1338', minutes: 45, teacherIds: ['3237'] },   // местный
    { date: '2026-11-02', groupId: '1338', minutes: 45, teacherIds: ['2485'] },   // иностранный
    { date: '2026-11-02', groupId: '9001', minutes: 90, teacherIds: ['101'] },
  ]);
  const row = (group, payload = {}) => ({ group_id: group, lesson_date: '2026-11-02', payload: JSON.stringify({ students: [], ...payload }) });
  const unitsOf = await units.forSubmissions([row('1338'), row('9001'), row('7777'), row('1338', { minutes: 90 })]);
  assert.deepEqual([row('1338'), row('9001'), row('7777'), row('1338', { minutes: 90 })].map(unitsOf), [1, 2, 1, 2]);
});
