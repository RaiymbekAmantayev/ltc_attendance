// API сервиса менторов: 10 неверных ключей за 15 минут с одного IP → 429 too_many_attempts (отдельный процесс: блокировка живёт в памяти).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let api;
const GET = headers => api.request('GET', '/integration-api/absences?from=2026-09-01&to=2026-09-30', { headers });
before(async () => { await h.setupDb(); api = await h.start(); });
after(() => api.close());

test('запросы без ключа не считаются попытками; после 9 неверных верный ключ работает', async () => {
  for (let i = 0; i < 15; i++) assert.equal((await GET({})).status, 401);
  for (let i = 0; i < 9; i++) assert.equal((await GET({ 'x-api-key': 'bad' + i })).status, 401);
  assert.equal((await GET({ 'x-api-key': 'mentor-key' })).status, 200);
});

test('10-й неверный ключ → 429 too_many_attempts, в том числе с верным ключом и на POST', async () => {
  assert.equal((await GET({ authorization: 'Bearer bad' })).status, 401);
  assert.deepEqual(Object.values(await GET({ 'x-api-key': 'bad' })).slice(0, 2), [429, { error: 'too_many_attempts' }]);
  assert.equal((await GET({ 'x-api-key': 'mentor-key' })).status, 429);
  assert.equal((await api.request('POST', '/integration-api/absence-feedback', { headers: { 'x-api-key': 'mentor-key' }, body: [] })).status, 429);
});
