// Тест группы в HollyHop: AddEditEdUnitTestResult (типы 131/132, навыки 8/11/13/9/10).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let api, ru, en;
const TG = { ru: 4001, en: 4002 };

before(async () => {
  await h.setupDb();
  ru = await h.addTeacher({ telegram_id: TG.ru, hollihop_id: '101', full_name: 'Local Teacher', lang: 'ru' });
  en = await h.addTeacher({ telegram_id: TG.en, hollihop_id: '102', full_name: 'Foreign Teacher', lang: 'en' });
  api = await h.start();
});
after(() => api.close());
beforeEach(async () => { h.mock.reset(); await h.db.query('DELETE FROM submissions'); await h.db.query('DELETE FROM substitutions'); });

const save = (tg, group, list, topic = '') => api.request('POST', '/api/lessons', { tg, body: { key: h.uuid(), groupId: group, date: h.WED, topic, students: list } });

test('тестовая группа 31: тип 132 для местного, навык 8 всегда 45, «опоздал» → «был»', async () => {
  const me = (await api.request('GET', '/api/me', { tg: TG.ru })).json;
  assert.equal(me.testing.typeId, 132);
  assert.deepEqual(me.testing.skills.map(k => [k.id, k.name, k.max, k.pass ?? null, k.default ?? null]),
    [[8, 'Was present for (min)', 45, null, 45], [13, 'Домашнее задание', 5, 4, null], [9, 'Активность', 5, 4, null], [10, 'Дисциплина', 5, 4, null]]);

  const noTest = await save(TG.ru, '31', [{ id: '3101', status: 'present', skills: { 13: 4, 9: 5, 10: 5 } }, { id: '3102', status: 'present' }]);
  assert.equal(noTest.json.error, 'test_required', 'ежедневный тест обязателен');
  assert.equal(noTest.json.student, '3102');

  const res = await save(TG.ru, '31', [{ id: '3101', status: 'present', skills: { 13: 4, 9: 5, 10: 5 } }, { id: '3102', status: 'absent', excused: false }, { id: '3103', status: 'late', skills: { 8: 40, 13: '3,5', 9: 2, 10: 2 } }]);
  assert.equal(res.json.status, 'done', JSON.stringify(res.json));
  assert.equal(h.mock.state.writes.length, 3, 'посещаемость — всем');
  assert.equal(h.mock.state.tests.length, 2, 'тест — только присутствовавшим');
  assert.deepEqual(h.mock.state.tests[0], { edUnitId: 31, studentClientId: 3101, date: h.WED, testTypeId: 132,
    skills: [{ skillId: 8, score: 45 }, { skillId: 13, score: 4 }, { skillId: 9, score: 5 }, { skillId: 10, score: 5 }], commentHtml: '' });
  assert.deepEqual(h.mock.state.tests[1].skills, [{ skillId: 8, score: 45 }, { skillId: 13, score: 3.5 }, { skillId: 9, score: 2 }, { skillId: 10, score: 2 }]);
});

test('иностранный преподаватель → тип теста 131', async () => {
  assert.equal((await api.request('GET', '/api/me', { tg: TG.en })).json.testing.typeId, 131);
  const roster = (await api.request('GET', `/api/groups/9002/students?date=${h.WED}`, { tg: TG.en })).json.students;
  // навыки типа 132 для иностранного преподавателя не подходят
  const wrong = await save(TG.en, '9002', [{ id: roster[1].id, status: 'present', skills: { 11: 5 } }]);
  assert.equal(wrong.json.error, 'test_incomplete');           // для 131 нужны 11, 9 и 10; навык 13 (тип 132) не считается
  const res = await save(TG.en, '9002', [{ id: roster[0].id, status: 'present', skills: { 11: 5, 9: 5, 10: 5 } }]);
  assert.equal(res.json.status, 'done');
  assert.equal(h.mock.state.tests[0].testTypeId, 131);
  assert.deepEqual(h.mock.state.tests[0].skills.map(k => k.skillId), [8, 11, 9, 10]);
});

test('валидация баллов: неполный набор, выше максимума, не число, отрицательные', async () => {
  const one = body => save(TG.ru, '31', [{ id: '3101', status: 'present', skills: body }]);
  assert.equal((await one({ 13: 4 })).json.error, 'test_incomplete');                  // нет навыков 9 и 10
  const over = await one({ 13: 6, 9: 5, 10: 5 });
  assert.equal(over.json.error, 'score_out_of_range'); assert.equal(over.json.max, 5);
  assert.equal((await one({ 13: -1, 9: 5, 10: 5 })).json.error, 'score_out_of_range');
  assert.equal((await one({ 13: 'x', 9: 5, 10: 5 })).json.error, 'bad_score');
  assert.equal(h.mock.state.tests.length, 0);
});

test('пропустившему тест не записывается, даже если баллы пришли', async () => {
  const res = await save(TG.ru, '31', [{ id: '3101', status: 'absent', excused: true, skills: { 13: 5, 9: 5, 10: 5 } }]);
  assert.equal(res.json.status, 'done');
  assert.equal(h.mock.state.tests.length, 0);
});

test('сбой теста → «частично», досылка не дублирует посещаемость и тест', async () => {
  for (let i = 0; i < 5; i++) h.mock.failNext('AddEditEdUnitTestResult', { status: 502 });
  const key = h.uuid();
  const list = [{ id: '3101', status: 'present', skills: { 13: 5, 9: 5, 10: 5 } }, { id: '3102', status: 'present', skills: { 13: 4, 9: 4, 10: 4 } }];
  const res = await api.request('POST', '/api/lessons', { tg: TG.ru, body: { key, groupId: '31', date: h.WED, topic: '', students: list } });
  assert.equal(res.json.status, 'partial');
  assert.equal(h.mock.state.writes.length, 2);
  assert.equal(h.mock.state.tests.length, 1);
  const card = (await api.request('GET', `/api/lessons?date=${h.WED}`, { tg: TG.ru })).json.find(g => g.id === '31');
  assert.equal(card.total, 4); assert.equal(card.done, 3);                              // записано 3 из 4

  assert.equal((await require('../src/services/submissionService').push(key)).status, 'done');
  assert.equal(h.mock.state.writes.length, 2);
  assert.equal(h.mock.state.tests.length, 2);
  assert.deepEqual(h.mock.state.tests.map(t => t.studentClientId).sort(), [3101, 3102]);
});

test('HollyHop отклонил тест (400) → «нужно внимание» без бесконечных повторов', async () => {
  h.mock.failNext('AddEditEdUnitTestResult', { status: 400, body: { Error: 'Набор навыков не соответствует типу теста' } });
  const res = await save(TG.ru, '31', [{ id: '3101', status: 'present', skills: { 13: 5, 9: 5, 10: 5 } }]);
  assert.equal(res.json.status, 'attention');
  const [[row]] = await h.db.query('SELECT last_error FROM submissions');
  assert.match(row.last_error, /навыков/);
});

test('в commentHtml уходит тема урока (экранирована), свой комментарий ученика игнорируется', async () => {
  await save(TG.ru, '31', [{ id: '3101', status: 'present', skills: { 13: 5, 9: 5, 10: 5 }, comment: 'чужой текст' }], 'Past & Present');
  assert.equal(h.mock.state.tests[0].commentHtml, 'Past &amp; Present');
});
