// API сервиса менторов: общий лимит по IP (RATE_LIMIT_PER_MIN, здесь 5) → 429 rate_limited.
global.__TEST_ENV__ = { RATE_LIMIT_PER_MIN: '5' };
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let api;
before(async () => { await h.setupDb(); api = await h.start(); });
after(() => api.close());

test('6-й запрос за минуту → 429 rate_limited; запросы без ключа тоже считаются', async () => {
  const get = headers => api.request('GET', '/integration-api/absences?from=2026-09-01&to=2026-09-30', { headers });
  for (let i = 0; i < 5; i++) assert.notEqual((await get(i % 2 ? {} : { 'x-api-key': 'mentor-key' })).status, 429);
  assert.deepEqual(Object.values(await get({ 'x-api-key': 'mentor-key' })).slice(0, 2), [429, { error: 'rate_limited' }]);
});
