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

test('заголовки безопасности и healthcheck', async () => {
  const r = await api.request('GET', '/healthz');
  assert.equal(r.json.ok, 1);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-powered-by'), null);
  const me = await api.request('GET', '/api/me');
  assert.equal(me.headers.get('cache-control'), 'no-store');
});
