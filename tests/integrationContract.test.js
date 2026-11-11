// API сервиса менторов: контракт по документации «API LTC для сервиса менторов» — все кейсы GET /absences и POST /absence-feedback.
global.__TEST_ENV__ = { RATE_LIMIT_PER_MIN: '1000' };   // здесь много запросов; лимит проверяет integrationLimits.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

const KEY = { 'x-api-key': 'mentor-key' };
const P = { from: '2026-09-01', to: '2026-09-30' };
const range = `from=${P.from}&to=${P.to}`;
let api, cities = [];

const GET = (q, opts = { headers: KEY }) => api.request('GET', `/integration-api/absences?${q}`, opts);
const POST = (body, headers = KEY) => api.request('POST', '/integration-api/absence-feedback', { headers, body });
const rawPost = (body, headers = {}) => fetch(api.base + '/integration-api/absence-feedback', { method: 'POST', headers: { 'x-api-key': 'mentor-key', ...headers }, body })
  .then(async r => ({ status: r.status, json: JSON.parse(await r.text() || 'null') }));
const fbCount = async () => Number((await h.db.query('SELECT COUNT(*) n FROM absence_feedback'))[0][0].n);
const fbRow = async (id, p = P) => (await h.db.query('SELECT * FROM absence_feedback WHERE student_id=? AND period_from=? AND period_to=?', [id, p.from, p.to]))[0][0];
const item = (o = {}) => ({ studentId: '801', student: 'Аня', groups: 'G81', lessons: 2, period: P, status: 'contacted', reason: 'болела', mentor: 'М1', feedbackAt: '2026-10-02T10:00:00Z', ...o });
const reset = () => h.db.query('TRUNCATE absence_feedback');
const feedbackOf = async (id, q = range) => (await GET(q)).json.students.find(s => s.studentId === id).feedback;

before(async () => {
  await h.setupDb();
  const t1 = await h.addTeacher({ telegram_id: 7001, hollihop_id: '201', full_name: 'Иванова Анна', branch: 'Абая' });
  const t2 = await h.addTeacher({ telegram_id: 7002, hollihop_id: '202', full_name: 'Смит Джон', branch: 'Хайвилл' });
  api = await h.start();
  const R = (id, end) => ({ StudentClientId: id, BeginDate: '2026-01-01', ...(end ? { EndDate: end } : {}) });
  // 801 — в двух группах; 803 — выбыл (EndDate в прошлом); 804 — без пропусков в сентябре; 805 — у второго преподавателя
  h.mock.state.rosters['81'] = [R(801), R(803, '2026-02-01'), R(804), R(806)];
  h.mock.state.rosters['82'] = [R(801)];
  h.mock.state.rosters['9002'] = [R(805)];
  const ins = (teacher, gid, gname, date, students) => h.db.query(
    'INSERT INTO submissions (idem_key, teacher_id, group_id, group_name, lesson_date, slot, payload, progress, status) VALUES (?,?,?,?,?,?,?,?,?)',
    [h.uuid(), teacher, gid, gname, date, 1, JSON.stringify({ topic: 'x', testTypeId: 132, students }), '[]', 'done']);
  await ins(t1, '81', 'G81', '2026-09-07', [{ id: '801', name: 'Аня', status: 'absent' }, { id: '803', name: 'Вика', status: 'absent' }, { id: '804', name: 'Гена', status: 'present' }, { id: '806', name: 'Борис', status: 'absent' }]);
  await ins(t1, '81', 'G81', '2026-09-09', [{ id: '801', name: 'Аня', status: 'present' }, { id: '804', name: 'Гена', status: 'present' }, { id: '806', name: 'Борис', status: 'present' }]);
  await ins(t1, '82', 'G82', '2026-09-08', [{ id: '801', name: 'Аня', status: 'absent' }]);
  await ins(t2, '9002', 'English Pre-Intermediate B1', '2026-09-10', [{ id: '805', name: 'Ян', status: 'absent' }]);
  await ins(t1, '81', 'G81', '2026-10-07', [{ id: '804', name: 'Гена', status: 'absent' }]);   // вне сентября
  const opts = (await api.request('GET', `/admin-api/export/tests?${range}`, { admin: true })).json;
  cities = opts?.filters?.cities || opts?.options?.cities || [];
});
after(() => api.close());

/* ---------------- Авторизация ---------------- */

test('auth: X-Api-Key и Bearer (любой регистр) — 200; без ключа, неверный, Basic админки, пустой Bearer — 401 unauthorized', async () => {
  assert.equal((await GET(range, { headers: KEY })).status, 200);
  assert.equal((await GET(range, { headers: { authorization: 'Bearer mentor-key' } })).status, 200);
  assert.equal((await GET(range, { headers: { authorization: 'bearer mentor-key' } })).status, 200);
  for (const opts of [{}, { headers: { 'x-api-key': 'wrong' } }, { admin: true }, { headers: { authorization: 'Bearer ' } }, { headers: { authorization: 'mentor-key' } }]) {
    const r = await GET(range, opts);
    assert.deepEqual([r.status, r.json], [401, { error: 'unauthorized' }], JSON.stringify(opts));
  }
  assert.equal((await POST([item()], {})).status, 401);
});

/* ---------------- GET /absences ---------------- */

test('GET: формат ответа (from, to, total, students[] с полями ученика)', async () => {
  const r = await GET(range);
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.from, r.json.to, r.json.total], [P.from, P.to, r.json.students.length]);
  for (const s of r.json.students) {
    assert.deepEqual(Object.keys(s).sort(), ['absent', 'feedback', 'group', 'groups', 'lessons', 'rate', 'student', 'studentId']);
    assert.match(s.studentId, /^\d+$/);
    assert.ok(s.groups.every(g => typeof g.id === 'string' && typeof g.name === 'string'));
    assert.equal(s.group, s.groups.map(g => g.name).join(', '));
    assert.ok(s.absent >= 1 && s.absent <= s.lessons && s.rate > 0 && s.rate <= 1);
  }
});

test('GET: одна строка на ученика по всем группам; выбывшие и без пропусков не попадают; сортировка по ФИО', async () => {
  const { students } = (await GET(range)).json;
  assert.deepEqual(students.map(s => s.studentId), ['801', '806', '805']);    // Аня, Борис, Ян
  assert.deepEqual(students[0].groups, [{ id: '81', name: 'G81' }, { id: '82', name: 'G82' }]);
  assert.deepEqual([students[0].lessons, students[0].absent], [3, 2]);
  assert.ok(Math.abs(students[0].rate - 2 / 3) < 0.001);
});

test('GET: обе границы периода включительно; урок вне периода не учитывается', async () => {
  assert.deepEqual((await GET('from=2026-09-07&to=2026-09-07')).json.students.map(s => s.studentId), ['801', '806']);
  assert.deepEqual((await GET('from=2026-10-07&to=2026-10-07')).json.students.map(s => s.studentId), ['804']);
  assert.deepEqual((await GET('from=2026-09-11&to=2026-09-30')).json, { from: '2026-09-11', to: '2026-09-30', total: 0, students: [] });
});

test('GET: фильтры teacher, level, city', async () => {
  const [[t1]] = await h.db.query('SELECT id FROM teachers WHERE hollihop_id=201');
  assert.deepEqual((await GET(`${range}&teacher=${t1.id}`)).json.students.map(s => s.studentId), ['801', '806']);
  assert.equal((await GET(`${range}&teacher=999999`)).json.total, 0);
  assert.deepEqual((await GET(`${range}&level=Pre-Intermediate`)).json.students.map(s => s.studentId), ['805']);
  assert.equal((await GET(`${range}&level=${encodeURIComponent('Нет такого')}`)).json.total, 0);
  assert.equal((await GET(`${range}&city=${encodeURIComponent('Нет такого города')}`)).json.total, 0);
  if (cities.length) {
    const sum = (await Promise.all(cities.map(c => GET(`${range}&city=${encodeURIComponent(c)}`)))).reduce((n, r) => n + r.json.total, 0);
    assert.ok(sum >= 3, `сумма по городам ${cities} = ${sum}`);
  }
});

test('GET: неверный период — 400 с текстом ошибки; 366 дней — можно, 367 — нет', async () => {
  for (const q of ['', `from=${P.from}`, `to=${P.to}`, 'from=2026-09-31&to=2026-10-01', 'from=2026-02-30&to=2026-03-01', 'from=01.09.2026&to=30.09.2026',
    'from=2026-9-1&to=2026-9-30', 'from=2026-10-01&to=2026-09-01', 'from=2025-01-01&to=2026-01-02', 'from=2026-09-01&to=2026-09-30T00:00']) {
    const r = await GET(q);
    assert.equal(r.status, 400, q);
    assert.equal(typeof r.json.error, 'string', q);
  }
  assert.equal((await GET('from=2025-01-01&to=2026-01-01')).status, 200);
  assert.equal((await GET('from=2024-01-01&to=2024-12-31')).status, 200);
  assert.notEqual((await GET(`from=${P.from}&from=2026-09-02&to=${P.to}`)).status, 500, 'повтор параметра не роняет сервер');
});

/* ---------------- POST /absence-feedback: тело ---------------- */

test('POST: массив и { items } принимаются; ответ { ok:1, saved:N }', async () => {
  await reset();
  assert.deepEqual(Object.values(await POST([item()])).slice(0, 2), [200, { ok: 1, saved: 1 }]);
  const r = await POST({ items: [item({ studentId: '806' }), item({ studentId: '805' })] });
  assert.deepEqual([r.status, r.json], [200, { ok: 1, saved: 2 }]);
  assert.equal(await fbCount(), 3);
});

test('POST: items_required, bad_json, без Content-Type JSON — 400, ничего не сохраняется', async () => {
  await reset();
  for (const body of [[], {}, { items: [] }, { items: 'x' }, { foo: [item()] }]) {
    assert.deepEqual([(await POST(body)).status, (await POST(body)).json?.error], [400, 'items_required'], JSON.stringify(body));
  }
  for (const raw of ['"str"', '42', 'null']) assert.equal((await rawPost(raw, { 'content-type': 'application/json' })).status, 400, raw);
  assert.deepEqual(Object.values(await rawPost('{"items": [', { 'content-type': 'application/json' })), [400, { error: 'bad_json' }]);
  assert.deepEqual((await rawPost(JSON.stringify([item()]), { 'content-type': 'text/plain' })).json?.error, 'items_required');
  assert.equal((await rawPost(JSON.stringify([item()]))).status, 400);
  assert.equal(await fbCount(), 0);
});

test('POST: ровно 1000 записей — 200; 1001 — 400 too_many_items; тело больше 2 МБ — 413 too_large', async () => {
  await reset();
  const many = n => Array.from({ length: n }, (_, i) => item({ studentId: String(100000 + i) }));
  assert.deepEqual(Object.values(await POST(many(1000))).slice(0, 2), [200, { ok: 1, saved: 1000 }]);
  const r = await POST(many(1001));
  assert.deepEqual([r.status, r.json.error], [400, 'too_many_items']);
  assert.equal(await fbCount(), 1000);
  assert.deepEqual(Object.values(await POST([item({ reason: 'x'.repeat(2.1 * 1024 * 1024) })])).slice(0, 2), [413, { error: 'too_large' }]);
});

/* ---------------- POST: валидация записей ---------------- */

test('POST: bad_items — всё или ничего; index с нуля; field — первое неверное поле записи', async () => {
  await reset();
  const cases = [
    [item({ studentId: undefined }), 'studentId'], [item({ studentId: 'abc' }), 'studentId'], [item({ studentId: '12-3' }), 'studentId'],
    [item({ studentId: '' }), 'studentId'], [item({ studentId: '1'.repeat(21) }), 'studentId'], [item({ studentId: null }), 'studentId'],
    [item({ period: undefined }), 'period'], [item({ period: { from: P.from } }), 'period'], [item({ period: { from: '2026-09-30', to: '2026-09-01' } }), 'period'],
    [item({ period: { from: '2026-02-30', to: '2026-03-01' } }), 'period'], [item({ period: { from: '2026/09/01', to: '2026/09/30' } }), 'period'],
    [item({ status: undefined }), 'status'], [item({ status: '' }), 'status'], [item({ status: '   ' }), 'status'], [item({ status: { a: 1 } }), 'status'],
    [item({ feedbackAt: undefined }), 'feedbackAt'], [item({ feedbackAt: 'вчера' }), 'feedbackAt'], [item({ feedbackAt: 1700000000000 }), 'feedbackAt'],
    [item({ lessons: -1 }), 'lessons'], [item({ lessons: 2.5 }), 'lessons'], [item({ lessons: 'много' }), 'lessons'],
    [item({ studentId: 'x', status: '' }), 'studentId'], [null, 'item'], ['строка', 'item'],
  ];
  const r = await POST([item(), ...cases.map(c => c[0])]);
  assert.deepEqual([r.status, r.json.error], [400, 'bad_items']);
  assert.deepEqual(r.json.errors, cases.map(([, field], i) => ({ index: i + 1, field })));
  assert.equal(await fbCount(), 0);
});

test('POST: текстовое поле не строкой — bad_items с именем поля API (student, groups, reason, mentor)', async () => {
  const r = await POST([item({ student: { x: 1 } }), item({ groups: { x: 1 } }), item({ reason: ['a'] }), item({ mentor: true })]);
  assert.equal(r.status, 400);
  assert.deepEqual(r.json.errors.map(e => e.field), ['student', 'groups', 'reason', 'mentor']);
});

test('POST: feedbackAt — только ISO 8601 с часовым поясом', async () => {
  for (const at of ['2026-12-02T10:00:00', '2026-12-02', '12/02/2026', 'Dec 2, 2026', '0', '2026-12-02 10:00:00Z', '2026-13-02T10:00:00Z']) {
    const r = await POST([item({ feedbackAt: at })]);
    assert.deepEqual([r.status, r.json.errors], [400, [{ index: 0, field: 'feedbackAt' }]], at);
  }
  for (const at of ['2026-12-02T10:00:00Z', '2026-12-02T10:00Z', '2026-12-02T10:00:00.123Z', '2026-12-02T15:00:00+05:00', '2026-12-02T15:00:00+0500', '2026-12-02t10:00:00z']) {
    assert.equal((await POST([item({ feedbackAt: at })])).status, 200, at);
  }
});

test('POST: допустимые варианты — studentId числом и с пробелами, lessons "3"/null/0, groups массивом строк или объектов', async () => {
  await reset();
  const r = await POST([item({ studentId: 801, lessons: 0 }), item({ studentId: ' 806 ', lessons: '3' }),
    item({ studentId: '805', lessons: null, groups: [{ id: '9002', name: 'B1' }, { id: '1', name: 'C' }] }), item({ studentId: '807', groups: ['A', 'B'] })]);
  assert.deepEqual([r.status, r.json], [200, { ok: 1, saved: 4 }]);
  assert.equal((await fbRow('806')).lessons, 3);
  assert.equal((await fbRow('805')).group_names, 'B1, C');
  assert.equal((await fbRow('807')).group_names, 'A, B');
});

test('POST: длинный текст обрезается, не отклоняется (status 64, reason 1000, mentor/student 255, groups 1000)', async () => {
  await reset();
  assert.equal((await POST([item({ status: 's'.repeat(100), reason: 'r'.repeat(1500), mentor: 'm'.repeat(300), student: 'ф'.repeat(300), groups: 'g'.repeat(1200) })])).status, 200);
  const row = await fbRow('801');
  assert.deepEqual([row.status.length, row.reason.length, row.mentor.length, row.student_name.length, row.group_names.length], [64, 1000, 255, 255, 1000]);
});

test('POST: время с часовым поясом отдаётся в UTC, миллисекунды отбрасываются', async () => {
  await reset();
  await POST([item({ feedbackAt: '2026-12-02T15:00:00+05:00' }), item({ studentId: '806', feedbackAt: '2026-12-02T10:00:00.789Z' })]);
  assert.equal((await feedbackOf('801')).feedbackAt, '2026-12-02T10:00:00Z');
  assert.equal((await feedbackOf('806')).feedbackAt, '2026-12-02T10:00:00Z');
});

/* ---------------- Правила обновления ---------------- */

test('обновление: повтор безопасен; побеждает свежая feedbackAt; более старая — 200 без изменений', async () => {
  await reset();
  assert.equal((await POST([item()])).status, 200);
  assert.equal((await POST([item()])).status, 200);
  await POST([item({ status: 'resolved', feedbackAt: '2026-10-05T10:00:00Z' })]);
  assert.deepEqual(Object.values(await POST([item({ status: 'old', reason: 'старое', feedbackAt: '2026-10-01T10:00:00Z' })])).slice(0, 2), [200, { ok: 1, saved: 1 }]);
  const row = await fbRow('801');
  assert.deepEqual([row.status, row.reason], ['resolved', 'болела']);
  assert.equal(await fbCount(), 1);
});

test('обновление: равная feedbackAt перезаписывает; порядок записей в одном запросе не важен', async () => {
  await reset();
  await POST([item({ status: 'a' })]);
  await POST([item({ status: 'b' })]);
  assert.equal((await fbRow('801')).status, 'b');
  await POST([item({ status: 'new', feedbackAt: '2026-11-01T00:00:00Z' }), item({ status: 'older', feedbackAt: '2026-10-20T00:00:00Z' })]);
  assert.equal((await fbRow('801')).status, 'new');
  assert.equal(await fbCount(), 1);
});

test('обновление: не переданные поля становятся пустыми', async () => {
  await reset();
  await POST([item()]);
  await POST([{ studentId: '801', period: P, status: 'x', feedbackAt: '2026-10-09T00:00:00Z' }]);
  const row = await fbRow('801');
  assert.deepEqual([row.reason, row.mentor, row.student_name, row.group_names, row.lessons], [null, null, null, null, null]);
});

test('обновление: другой период — новая запись; в выгрузке — самая свежая среди пересекающихся', async () => {
  await reset();
  await POST([item({ status: 'sep', feedbackAt: '2026-10-02T00:00:00Z' })]);
  await POST([item({ period: { from: '2026-09-15', to: '2026-10-15' }, status: 'mid', feedbackAt: '2026-10-20T00:00:00Z' })]);
  await POST([item({ period: { from: '2026-08-01', to: '2026-08-31' }, status: 'aug', feedbackAt: '2026-12-01T00:00:00Z' })]);
  await POST([item({ period: { from: '2026-10-01', to: '2026-10-31' }, status: 'oct', feedbackAt: '2026-12-01T00:00:00Z' })]);
  assert.equal(await fbCount(), 4);
  assert.deepEqual(await feedbackOf('801'), { status: 'mid', reason: 'болела', mentor: 'М1', period: { from: '2026-09-15', to: '2026-10-15' }, feedbackAt: '2026-10-20T00:00:00Z' });
  assert.equal((await feedbackOf('801', 'from=2026-09-07&to=2026-09-08')).status, 'sep');
  assert.equal(await feedbackOf('806'), null);
});

test('обратная связь видна в админке и пишется в аудит от «mentors»', async () => {
  await reset();
  await POST([item({ status: 'audit-check' })]);
  const admin = (await api.request('GET', `/admin-api/export/tests?${range}`, { admin: true })).json.attendance.scopes[0].rows.find(r => r.id === '801');
  assert.equal(admin.feedback.status, 'audit-check');
  const [rows] = await h.db.query("SELECT * FROM audit_log WHERE action='absence_feedback' ORDER BY id DESC LIMIT 1");
  assert.ok(rows.length && JSON.stringify(rows[0]).includes('mentors'));
});

test('неизвестные пути и методы /integration-api — 404/405', async () => {
  for (const [m, u] of [['GET', '/integration-api/absence-feedback'], ['POST', '/integration-api/absences'], ['GET', '/integration-api/nope']]) {
    const r = await api.request(m, u, { headers: KEY, body: m === 'POST' ? [] : undefined });
    assert.ok([404, 405].includes(r.status), `${m} ${u} → ${r.status}`);
  }
});
