// HH_READONLY=1 (локалка с боевым ключом и копией прод-базы): чтение идёт в HollyHop, запись — нет, и при этом
// отметка, коины, доп. тест и правка по одобренному запросу проходят до конца, а не падают в «нужно внимание».
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { hollihop } = require('../src/config/env');

let api;
const TG = 4301;
const DAILY = { 13: 5, 9: 5, 10: 5 };
const PROGRESS = { 1: 10, 2: 15, 3: 40, 4: 40, 5: 20, 6: 15, 7: 10, 21: 2 };
const sent = [];                                                 // что ушло «в сеть» HollyHop
const realFetch = global.fetch;

before(async () => {
  await h.setupDb();
  await h.addTeacher({ telegram_id: TG, hollihop_id: '101', full_name: 'Local Teacher', lang: 'ru' });
  // Сеть HollyHop: Get* отвечает демо-данными, любая запись — ошибка теста.
  Object.assign(hollihop, { mock: false, readOnly: true, domain: 'readonly-test', authKey: 'k' });
  global.fetch = async (url, init) => {
    const m = /\.t8s\.ru\/Api\/V2\/(\w+)/.exec(String(url));
    if (!m) return realFetch(url, init);
    sent.push(m[1]);
    if (!m[1].startsWith('Get')) throw new Error(`запись ${m[1]} ушла в HollyHop`);
    const { status, body } = await h.mock.respond(m[1], JSON.parse(init.body));
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  api = await h.start();
});
after(() => {
  global.fetch = realFetch;
  Object.assign(hollihop, { mock: true, readOnly: false });
  api.close();
});

const save = (students, personal = null) => api.request('POST', '/api/lessons',
  { tg: TG, body: { key: h.uuid(), groupId: '31', date: h.WED, topic: 'Unit 3', homework: 'Ex. 1', personal, students } });

test('отметка с тестом, доп. тестом и коинами — «готово», записи в HollyHop нет', async () => {
  const res = await save([{ id: '3101', status: 'present', skills: DAILY, personalSkills: PROGRESS }, { id: '3102', status: 'absent' }],
    { categoryId: 1, testTypeId: 1 });
  assert.equal(res.json.status, 'done', JSON.stringify(res.json));
  assert.ok(sent.length > 0, 'чтение шло в HollyHop');
  assert.deepEqual(sent.filter(m => !m.startsWith('Get')), [], 'записи в сеть нет');
  assert.deepEqual([h.mock.state.writes.length, h.mock.state.tests.length, h.mock.state.personal.length], [0, 0, 0]);

  const [[row]] = await h.db.query('SELECT hh_results FROM submissions WHERE group_id = "31"');
  const results = JSON.parse(row.hh_results);
  assert.deepEqual(Object.keys(results).sort(), ['p:3101', 'r:3101']);
  assert.ok(Object.values(results).every(id => id < 0), 'условные Id не совпадают с настоящими');
});

test('правка по одобренному запросу отметки с настоящими Id из прод-базы — «готово»', async () => {
  // как в базе, скопированной с прода: результаты в HollyHop записаны, Id настоящие
  await h.db.query('UPDATE submissions SET hh_results = ? WHERE group_id = "31"', [JSON.stringify({ 'r:3101': 555001, 'p:3101': 555002 })]);
  assert.equal((await api.request('POST', '/api/lessons/edit-request', { tg: TG, body: { groupId: '31', date: h.WED, reason: 'баллы' } })).status, 200);
  const { requests } = (await api.request('GET', '/admin-api/edit-requests?status=', { admin: true })).json;
  assert.equal((await api.request('POST', `/admin-api/edit-requests/${requests[0].id}/approve`, { admin: true, body: {} })).status, 200);

  const res = await api.request('POST', '/api/lessons/edit', { tg: TG, body: { editKey: h.uuid(), groupId: '31', date: h.WED, topic: 'Unit 4',
    homework: 'Ex. 2', personal: { categoryId: 1, testTypeId: 1 }, students: [{ id: '3101', status: 'present', skills: { 13: 2, 9: 1, 10: 3 }, personalSkills: PROGRESS }] } });
  assert.equal(res.json.status, 'done', JSON.stringify(res.json));
  assert.deepEqual(sent.filter(m => !m.startsWith('Get')), []);
  const [[row]] = await h.db.query('SELECT hh_results FROM submissions WHERE group_id = "31"');
  assert.deepEqual(JSON.parse(row.hh_results), { 'r:3101': 555001, 'p:3101': 555002 }, 'Id прежние');
});
