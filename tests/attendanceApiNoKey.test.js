// /attendance-api/v1: ATTENDANCE_API_KEY не задан → API закрыт для любого ключа.
global.__TEST_ENV__ = { ATTENDANCE_API_KEY: '' };
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let api;
before(async () => { await h.setupDb(); api = await h.start(); });
after(() => api.close());

test('ATTENDANCE_API_KEY пуст → 401 на любой ключ', async () => {
  for (const headers of [{}, { 'x-api-key': 'att-key' }, { 'x-api-key': '' }, { authorization: 'Bearer ' }, { authorization: 'Bearer anything' }, { 'x-api-key': 'mentor-key' }]) {
    assert.equal((await api.request('GET', '/attendance-api/v1/lessons', { headers })).status, 401, JSON.stringify(headers));
  }
});

test('10 неверных ключей за 15 минут → IP блокируется (429 too_many_attempts)', async () => {
  for (let i = 0; i < 10; i++) await api.request('GET', '/attendance-api/v1/meta', { headers: { 'x-api-key': 'bad' + i } });
  assert.deepEqual(Object.values(await api.request('GET', '/attendance-api/v1/meta', { headers: { 'x-api-key': 'att-key' } })).slice(0, 2), [429, { error: 'too_many_attempts' }]);
});
