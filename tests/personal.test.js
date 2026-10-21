// Персональный (доп.) тест: AddEditPersonalTestResult — не больше одного на урок, по желанию, рядом с обязательным ежедневным.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let api;
const TG = 4101;
const DAILY = { 13: 5, 9: 5, 10: 5 };
const PROGRESS = { 1: 10, 2: 15, 3: 40, 4: 40, 5: 20, 6: 15, 7: 10, 21: 2 };

before(async () => {
  await h.setupDb();
  await h.addTeacher({ telegram_id: TG, hollihop_id: '101', full_name: 'Local Teacher', lang: 'ru' });
  api = await h.start();
});
after(() => api.close());
beforeEach(async () => { h.mock.reset(); await h.db.query('DELETE FROM submissions'); });

const save = (list, personal, topic = 'Unit 3') => api.request('POST', '/api/lessons',
  { tg: TG, body: { key: h.uuid(), groupId: '31', date: h.WED, topic, personal, students: list } });

test('/me отдаёт 4 категории доп. теста', async () => {
  const me = (await api.request('GET', '/api/me', { tg: TG })).json;
  assert.deepEqual(me.personalTests.map(c => [c.id, c.name, c.types.length]),
    [[1, 'Progress Test', 1], [4, 'Final Test', 1], [6, 'Entry test', 6], [5, 'Revise&Check', 3], [45, 'File Test NEF', 12]]);
});

test('Progress Test пишется тем, кому введены баллы; остальным — только ежедневный', async () => {
  const res = await save([
    { id: '3101', status: 'present', skills: DAILY, personalSkills: PROGRESS },
    { id: '3102', status: 'present', skills: DAILY },
    { id: '3103', status: 'absent', personalSkills: PROGRESS },
  ], { categoryId: 1, testTypeId: 1 }, 'Unit 3 & 4');
  assert.equal(res.json.status, 'done', JSON.stringify(res.json));
  assert.equal(h.mock.state.tests.length, 2);
  assert.equal(h.mock.state.personal.length, 1);
  assert.deepEqual(h.mock.state.personal[0], {
    studentClientId: 3101, dateTime: `${h.WED}T09:00:00`, discipline: 'Английский', teacherId: 101, testTypeId: 1,
    skills: [1, 2, 3, 4, 5, 6, 7, 21].map(id => ({ skillId: id, score: PROGRESS[id] })), commentHtml: 'Unit 3 &amp; 4',
  });
  const card = (await api.request('GET', `/api/lessons?date=${h.WED}`, { tg: TG })).json.find(g => g.id === '31');
  assert.equal(card.total, 7); assert.equal(card.done, 7);                    // тема + 3 посещаемости + 2 ежедневных + 1 доп.
});

test('Entry test и Revise&Check: нужен тип; навыки — по типу', async () => {
  assert.equal((await save([{ id: '3101', status: 'present', skills: DAILY, personalSkills: { 3: 20, 4: 20 } }], { categoryId: 6 })).json.error, 'bad_personal_test');
  assert.equal((await save([{ id: '3101', status: 'present', skills: DAILY, personalSkills: { 3: 20, 4: 20 } }], { categoryId: 6, testTypeId: 999 })).json.error, 'bad_personal_test');
  const entry = await save([{ id: '3101', status: 'present', skills: DAILY, personalSkills: { 3: 20, 4: '24,5' } }], { categoryId: 6, testTypeId: 112 });
  assert.equal(entry.json.status, 'done', JSON.stringify(entry.json));
  assert.deepEqual(h.mock.state.personal[0].skills, [{ skillId: 3, score: 20 }, { skillId: 4, score: 24.5 }]);
  assert.equal(h.mock.state.personal[0].testTypeId, 112);

  await h.db.query('DELETE FROM submissions');
  const rc = await save([{ id: '3101', status: 'present', skills: DAILY, personalSkills: { 1: 4, 2: 9, 3: 20, 4: 30 } }], { categoryId: 5, testTypeId: 6 });
  assert.equal(rc.json.status, 'done', JSON.stringify(rc.json));
  assert.equal(h.mock.state.personal[1].testTypeId, 6);
});

test('валидация доп. теста: неполный набор, выше максимума, выбран без баллов', async () => {
  const one = (personalSkills, personal = { categoryId: 4, testTypeId: 1 }) => save([{ id: '3101', status: 'present', skills: DAILY, personalSkills }], personal);
  const partial = await one({ 1: 5 });
  assert.equal(partial.json.error, 'test_incomplete'); assert.equal(partial.json.test, 'personal');
  const over = await one({ 1: 11, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 });
  assert.equal(over.json.error, 'score_out_of_range'); assert.equal(over.json.max, 10);
  assert.equal((await one(null)).json.error, 'personal_empty');
  assert.equal((await one({ 1: 1 }, null)).json.status, 'done', 'без выбранного теста баллы доп. теста игнорируются');
  assert.equal(h.mock.state.personal.length, 0);
});

test('ежедневный тест обязателен и при выбранном доп. тесте', async () => {
  const res = await save([{ id: '3101', status: 'present', personalSkills: PROGRESS }], { categoryId: 1, testTypeId: 1 });
  assert.equal(res.json.error, 'test_required');
});

test('сбой доп. теста → «частично», досылка пишет только его', async () => {
  for (let i = 0; i < 5; i++) h.mock.failNext('AddEditPersonalTestResult', { status: 502, when: p => p.testTypeId === 1 });   // только доп. тест
  const key = h.uuid();
  const res = await api.request('POST', '/api/lessons', { tg: TG, body: { key, groupId: '31', date: h.WED, topic: '', personal: { categoryId: 1, testTypeId: 1 },
    students: [{ id: '3101', status: 'present', skills: DAILY, personalSkills: PROGRESS }] } });
  assert.equal(res.json.status, 'partial');
  assert.equal((await require('../src/services/submissionService').push(key)).status, 'done');
  assert.equal(h.mock.state.writes.length, 1);
  assert.equal(h.mock.state.tests.length, 1);
  assert.equal(h.mock.state.personal.length, 1);
});
