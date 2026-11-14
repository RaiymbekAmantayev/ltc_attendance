// /attendance-api/v1: IP-allowlist (ATTENDANCE_API_IPS). Приложение за прокси (TRUST_PROXY) — IP берётся из X-Forwarded-For от Caddy.
global.__TEST_ENV__ = { ATTENDANCE_API_IPS: '10.0.0.1, 10.0.0.2', ATTENDANCE_API_RATE_PER_MIN: '1000' };
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let api;
before(async () => { await h.setupDb(); api = await h.start(); });
after(() => api.close());

test('IP не из списка → 403 ip_not_allowed даже с верным ключом; из списка — по ключу', async () => {
  const get = headers => api.request('GET', '/attendance-api/v1/meta', { headers });
  const denied = await get({ 'x-api-key': 'att-key' });                        // 127.0.0.1
  assert.deepEqual([denied.status, denied.json], [403, { error: 'ip_not_allowed' }]);
  assert.equal((await get({ 'x-api-key': 'att-key', 'x-forwarded-for': '10.0.0.2' })).status, 200);
  assert.equal((await get({ 'x-forwarded-for': '10.0.0.1' })).status, 401);
  assert.equal((await get({ 'x-api-key': 'att-key', 'x-forwarded-for': '10.0.0.3' })).status, 403);
});
