// /attendance-api/v1: лимит запросов (здесь 3 в минуту), лимит одновременных запросов, лимит просмотра отметок за вызов.
global.__TEST_ENV__ = { ATTENDANCE_API_RATE_PER_MIN: '3' };
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const h = require('./helpers');
const { apiQuota } = require('../src/middleware/security');

let api;
before(async () => { await h.setupDb(); api = await h.start(); });
after(() => api.close());

test('4-й запрос за минуту → 429 rate_limited с Retry-After; запросы без ключа тоже считаются; API менторов не затронут', async () => {
  const get = headers => api.request('GET', '/attendance-api/v1/meta', { headers });
  const r1 = await get({ 'x-api-key': 'att-key' });
  assert.deepEqual([r1.status, r1.headers.get('x-ratelimit-limit'), r1.headers.get('x-ratelimit-remaining')], [200, '3', '2']);
  assert.equal((await get({})).status, 401);
  assert.equal((await get({ 'x-api-key': 'att-key' })).headers.get('x-ratelimit-remaining'), '0');
  const r4 = await get({ 'x-api-key': 'att-key' });
  assert.deepEqual([r4.status, r4.json], [429, { error: 'rate_limited' }]);
  const retry = Number(r4.headers.get('retry-after'));
  assert.ok(retry >= 1 && retry <= 60, String(retry));
  assert.equal(r4.headers.get('x-ratelimit-remaining'), '0');
  // свой счётчик: сервис менторов продолжает работать
  assert.equal((await api.request('GET', '/integration-api/absences?from=2026-09-01&to=2026-09-30', { headers: { 'x-api-key': 'mentor-key' } })).status, 200);
});

/** Фейковые req/res для проверки middleware без сервера. */
const fake = ip => {
  const res = new EventEmitter();
  Object.assign(res, { statusCode: 200, headers: {}, body: null,
    set(k, v) { if (typeof k === 'object') Object.assign(this.headers, k); else this.headers[k] = v; return this; },
    status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
  return { req: { ip }, res };
};

test('одновременные запросы: сверх maxConcurrent → 429 too_many_concurrent; место освобождается по finish/close', () => {
  const quota = apiQuota({ perMin: 100, maxConcurrent: 2 });
  const run = () => { const { req, res } = fake('1.1.1.1'); let passed = false; quota(req, res, () => { passed = true; }); return { res, passed }; };
  const a = run(), b = run(), c = run();
  assert.deepEqual([a.passed, b.passed, c.passed], [true, true, false]);
  assert.deepEqual([c.res.statusCode, c.res.body, c.res.headers['Retry-After']], [429, { error: 'too_many_concurrent' }, '2']);
  a.res.emit('finish'); a.res.emit('close');                                    // двойное событие не освобождает два места
  assert.equal(run().passed, true);
  assert.equal(run().passed, false);
  b.res.emit('close');                                                          // оборванное соединение тоже освобождает
  assert.equal(run().passed, true);
});

test('лимит в минуту — на IP: другой IP не блокируется', () => {
  const quota = apiQuota({ perMin: 1, maxConcurrent: 100 });
  const pass = ip => { const { req, res } = fake(ip); let ok = false; quota(req, res, () => { ok = true; }); res.emit('finish'); return ok; };
  assert.deepEqual([pass('1.1.1.1'), pass('1.1.1.1'), pass('2.2.2.2')], [true, false, true]);
});

test('лимит просмотра: больше 2000 отметок за вызов не читается — неполная страница с next_cursor, дальше по курсору', async () => {
  const { LIMITS } = require('../src/services/attendanceApiService');
  const service = require('../src/services/attendanceApiService');
  const teacher = await h.addTeacher({ hollihop_id: '201', full_name: 'Иванова Анна' });
  const n = LIMITS.MAX_SCAN + 50;
  const rows = Array.from({ length: n }, (_, i) => [h.uuid(), teacher, String(10000 + i), 'G', '2026-03-02', 1,
    JSON.stringify({ topic: 't', testTypeId: 132, students: [{ id: '1', status: i === n - 1 ? 'absent' : 'present' }] }), '[]', 'done']);
  await h.db.query('INSERT INTO submissions (idem_key, teacher_id, group_id, group_name, lesson_date, slot, payload, progress, status) VALUES ?', [rows]);
  // вызываем сервис напрямую — HTTP-лимит этого файла (3/мин) уже израсходован
  const q = { date_from: '2026-03-01', date_to: '2026-03-31', attendance: 'absent' };
  const p1 = await service.lessons(q);
  assert.deepEqual([p1.data.length, p1.page.has_more], [0, true]);
  const p2 = await service.lessons({ ...q, cursor: p1.page.next_cursor });
  assert.deepEqual([p2.data.length, p2.data[0].group_id, p2.page.next_cursor], [1, String(10000 + n - 1), null]);
});
