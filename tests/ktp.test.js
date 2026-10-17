const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const levels = require('../src/config/levels');

let api;
const TG = 1101;

before(async () => {
  await h.setupDb();
  await h.addTeacher({ telegram_id: TG, hollihop_id: '101', full_name: 'Иванова Анна' });
  api = await h.start();
});
after(() => api.close());

const admin = (method, url, body) => api.request(method, '/admin-api' + url, { admin: true, body });

test('уровни групп HollyHop приводятся к уровням КТП', () => {
  const cases = {
    'Beginner': 'Beginner', 'Elementary': 'Elementary', 'Pre-Intermediate': 'Pre-Intermediate', 'Intermediate': 'Intermediate',
    'Inter + (plus)': 'Intermediate Plus', 'Intermediate Plus': 'Intermediate Plus', 'Upper intermediate': 'Upper Intermediate',
    'Upper-Intermediate': 'Upper Intermediate', 'Advanced': 'Advanced',
    'Family and Friends': null, 'Proficiency': null, 'IELTS': null, '[Все]': null, '': null,
  };
  for (const [raw, expected] of Object.entries(cases)) assert.equal(levels.normalize(raw), expected, raw);
});

test('админка: категории добавляются, переименовываются; с темами не удаляются', async () => {
  assert.equal((await admin('POST', '/ktp/categories', { name: 'Nef (Взрослые 15+)' })).status, 200);
  assert.equal((await admin('POST', '/ktp/categories', { name: 'Nef (Взрослые 15+)' })).status, 409);
  assert.equal((await admin('POST', '/ktp/categories', { name: ' ' })).status, 400);
  let [cat] = (await admin('GET', '/ktp/categories')).json;
  await admin('POST', '/ktp/categories', { id: cat.id, name: 'Nef' });
  [cat] = (await admin('GET', '/ktp/categories')).json;
  assert.equal(cat.name, 'Nef');

  assert.equal((await admin('POST', '/ktp/topics', { category_id: cat.id, level: 'Elementary', title: '' })).status, 400);
  assert.equal((await admin('POST', '/ktp/topics', { category_id: cat.id, level: 'IELTS', title: 'x' })).status, 400);
  const saved = await admin('POST', '/ktp/topics', { category_id: cat.id, level: 'Elementary', num: '1', week: '1', lesson: '1', title: 'Unit 1A · Hello', grammar: 'to be' });
  assert.equal(saved.status, 200);
  assert.equal((await admin('DELETE', '/ktp/categories/' + cat.id)).status, 409);
});

test('вставка из Excel: заголовок пропускается, пустая тема отбрасывается, replace заменяет', async () => {
  const [cat] = (await admin('GET', '/ktp/categories')).json;
  const rows = [
    ['№', 'Неделя', 'День', 'Урок', 'Препод', 'Секция', 'Стр.SB', 'Тема / раздел книги', 'Роль', 'Грам./фокус', 'Лексика', 'Домашнее задание (из книги)', 'Тест/контроль'],
    ['3', '1', 'Ср', '3', 'Local', '1C', '10', 'Unit 1C · Family', 'Lead', 'possessives', 'family', 'WB p.6', ''],
    ['2', '1', 'Пн', '2', 'Foreign', '1B', '8', 'Unit 1B · Jobs', '', 'a/an', 'jobs', 'WB p.5', 'Quiz'],
    ['4', '', '', '', '', '', '', '', '', '', '', '', ''],
  ];
  const res = await admin('POST', '/ktp/topics/import', { category_id: cat.id, level: 'Elementary', rows: rows.slice(1) });
  assert.equal(res.json.added, 2);
  const list = (await admin('GET', `/ktp/topics?category=${cat.id}&level=Elementary`)).json;
  assert.deepEqual(list.map(x => x.title), ['Unit 1A · Hello', 'Unit 1B · Jobs', 'Unit 1C · Family']);   // по №
  assert.equal(list[2].homework, 'WB p.6');
  assert.equal(list[1].test_control, 'Quiz');

  const other = await admin('POST', '/ktp/topics/import', { category_id: cat.id, level: 'Advanced', rows: [['1', '', '', '', '', '', '', 'Advanced topic']] });
  assert.equal(other.json.added, 1);
  await admin('POST', '/ktp/topics/import', { category_id: cat.id, level: 'Advanced', replace: true, rows: [['1', '', '', '', '', '', '', 'Replaced']] });
  assert.deepEqual((await admin('GET', `/ktp/topics?category=${cat.id}&level=Advanced`)).json.map(x => x.title), ['Replaced']);
});

test('преподаватель видит темы уровня группы, выбранная тема сохраняется в отметке', async () => {
  await admin('POST', '/ktp/categories', { name: 'Go better' });
  const cats = (await admin('GET', '/ktp/categories')).json;
  await admin('POST', '/ktp/topics', { category_id: cats.find(c => c.name === 'Go better').id, level: 'Elementary', title: 'Go better 1' });

  const view = (await api.request('GET', `/api/groups/9001/students?date=${h.WED}`, { tg: TG })).json;   // 9001 — Elementary
  assert.equal(view.ktp.level, 'Elementary');
  assert.deepEqual(view.ktp.categories.map(c => c.name), ['Nef', 'Go better']);
  assert.equal(view.ktp.categories[0].topics.length, 3);
  assert.ok(!view.ktp.categories.some(c => c.topics.some(x => x.title === 'Replaced')), 'темы другого уровня не видны');

  const sandbox = (await api.request('GET', `/api/groups/31/students?date=${h.WED}`, { tg: TG })).json;  // уровень «Test» — без КТП
  assert.deepEqual(sandbox.ktp, { level: null, categories: [] });

  const topic = view.ktp.categories[0].topics[0];
  const list = view.students.map(s => ({ id: s.id, status: 'present', skills: { 13: 5, 9: 5, 10: 5 } }));
  const saved = await api.request('POST', '/api/lessons', { tg: TG, body: { key: h.uuid(), groupId: '9001', date: h.WED, topic: topic.title, ktpTopicId: topic.id, students: list } });
  assert.equal(saved.status, 200);
  const after = (await api.request('GET', `/api/groups/9001/students?date=${h.WED}`, { tg: TG })).json;
  assert.equal(after.submitted.payload.ktpTopicId, topic.id);
  assert.equal(after.submitted.payload.topic, 'Unit 1A · Hello');
});
