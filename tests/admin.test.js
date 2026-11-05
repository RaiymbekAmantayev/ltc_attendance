const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let api;
before(async () => { await h.setupDb(); api = await h.start(); });
after(() => api.close());

test('админка закрыта паролем; неверные пароли блокируются', async () => {
  assert.equal((await api.request('GET', '/admin-api/teachers')).status, 401);
  assert.equal((await api.request('GET', '/admin/')).status, 401);
  assert.equal((await api.request('GET', '/admin-api/teachers', { admin: 'admin:wrong' })).status, 401);
  assert.equal((await api.request('GET', '/admin-api/teachers', { admin: true })).status, 200);
});

test('CRUD преподавателей, роли и валидация', async () => {
  const post = body => api.request('POST', '/admin-api/teachers', { admin: true, body });
  assert.equal((await post({ full_name: 'Без ID' })).status, 400);                              // преподавателю нужен HollyHop ID
  assert.equal((await post({ full_name: 'Куратор', role: 'coordinator' })).status, 400);       // координатору нужен Telegram ID
  assert.equal((await post({ full_name: 'Куратор', role: 'coordinator', telegram_id: '777' })).status, 200);
  assert.equal((await post({ full_name: 'Петр', hollihop_id: '101', telegram_id: '778', lang: 'en' })).status, 200);
  assert.equal((await post({ full_name: 'Дубль', hollihop_id: '101' })).status, 409);
  const list = (await api.request('GET', '/admin-api/teachers', { admin: true })).json;
  assert.equal(list.length, 2);
  assert.equal(list.find(t => t.hollihop_id === '101').lang, 'en');
  const imp = await api.request('POST', '/admin-api/teachers/import', { admin: true });
  assert.equal(imp.json.added, 2);                                                              // 102, 103 (101 уже есть, уволенный 104 пропущен)
  const audit = (await api.request('GET', '/admin-api/audit?action=teacher_create', { admin: true })).json;
  assert.ok(audit.length >= 2 && audit.every(a => a.actor === 'admin'));
});

test('Id учеников HollyHop по ClientId для карточки отметки', async () => {
  const r = await api.request('GET', '/admin-api/student-ids?clientIds=3511,3101', { admin: true });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { 3511: '503511', 3101: '503101' });                                // в демо Id = ClientId + 500000
  assert.equal((await api.request('GET', '/admin-api/student-ids?clientIds=abc', { admin: true })).status, 400);
});

test('заголовки безопасности и healthcheck', async () => {
  const r = await api.request('GET', '/healthz');
  assert.equal(r.json.ok, 1);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-powered-by'), null);
  const me = await api.request('GET', '/api/me');
  assert.equal(me.headers.get('cache-control'), 'no-store');
});

test('обзор: фильтр по городу, уроки без отметки по расписанию, доп. тесты ≥80%', async () => {
  const personalTests = require('../src/config/personalTests');
  const t = await h.addTeacher({ hollihop_id: '901', full_name: 'Обзор Тест', branch: 'Абая' });
  const type = personalTests.find(1, 1).type;
  const score = share => Object.fromEntries(type.skills.map(k => [k.id, Math.round(k.max * share)]));
  const insert = (group, branch, students, extra = {}) => h.db.query(
    `INSERT INTO submissions (idem_key, teacher_id, group_id, group_name, branch, lesson_date, slot, payload, progress, status) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [h.uuid(), t, group, `G${group}`, branch, '2026-10-12', 1, JSON.stringify({ topic: 'x', students, ...extra }), '[]', 'done']);
  // Понедельник 12.10: в демо-HollyHop у Абая (офис 7 — Алматы) уроки 9001, 9003, 9005, 31; у Хайвилла (Астана) — 9002.
  await insert('9001', 'Абая', [{ id: '1', status: 'present', personalSkills: score(1) }, { id: '2', status: 'present', personalSkills: score(0.5) }],
    { personal: { categoryId: 1, testTypeId: 1 } });
  await insert('9002', 'Хайвилл', [{ id: '3', status: 'absent' }]);
  const get = async url => (await api.request('GET', `/admin-api/${url}`, { admin: true })).json;
  const range = 'from=2026-10-12&to=2026-10-12';

  const almaty = await get(`overview?${range}&city=${encodeURIComponent('Алматы')}`);
  assert.deepEqual([almaty.kpi.lessonsMarked, almaty.attendance.present, almaty.attendance.absent], [1, 2, 0]);
  assert.deepEqual(almaty.kpi.personalTests, { count: 2, good: 1, rate: 50 });
  const astana = await get(`overview?${range}&city=${encodeURIComponent('Астана')}`);
  assert.deepEqual([astana.kpi.lessonsMarked, astana.attendance.absent, astana.kpi.personalTests.count], [1, 1, 0]);
  assert.equal((await get(`overview?${range}`)).kpi.lessonsMarked, 2);

  assert.deepEqual(await get(`overview/unmarked?${range}&city=${encodeURIComponent('Алматы')}`), { expected: 4, marked: 1, unmarked: 3 });
  assert.deepEqual(await get(`overview/unmarked?${range}&city=${encodeURIComponent('Астана')}`), { expected: 1, marked: 1, unmarked: 0 });
  assert.deepEqual(await get(`overview/unmarked?${range}`), { expected: 5, marked: 2, unmarked: 3 });

  const ts = await get(`teacher-stats?${range}&city=${encodeURIComponent('Астана')}`);
  assert.equal(ts.find(x => x.id === t).lessons, 1);                                         // в Астане — только урок Хайвилла
});
