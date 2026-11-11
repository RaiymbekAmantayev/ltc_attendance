// API сервиса менторов: INTEGRATION_KEY не задан → API закрыт.
global.__TEST_ENV__ = { INTEGRATION_KEY: '' };
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let api;
before(async () => { await h.setupDb(); api = await h.start(); });
after(() => api.close());

test('INTEGRATION_KEY пуст → 401 на любой ключ', async () => {
  for (const headers of [{}, { 'x-api-key': 'mentor-key' }, { 'x-api-key': '' }, { authorization: 'Bearer ' }, { authorization: 'Bearer anything' }]) {
    assert.equal((await api.request('GET', '/integration-api/absences?from=2026-09-01&to=2026-09-30', { headers })).status, 401, JSON.stringify(headers));
  }
});
