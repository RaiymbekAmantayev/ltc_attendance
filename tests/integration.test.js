// API сервиса менторов: выгрузка учеников с пропусками и приём обратной связи.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let api, teacher;
const KEY = { 'x-api-key': 'mentor-key' };
const range = 'from=2026-09-01&to=2026-09-30';
const period = { from: '2026-09-01', to: '2026-09-30' };

before(async () => {
  await h.setupDb();
  teacher = await h.addTeacher({ telegram_id: 7001, hollihop_id: '201', full_name: 'Иванова Анна' });
  api = await h.start();
  h.mock.state.rosters['81'] = [{ StudentClientId: 801, BeginDate: '2026-01-01' }, { StudentClientId: 802, BeginDate: '2026-01-01' }];
  const insert = (date, students) => h.db.query(
    `INSERT INTO submissions (idem_key, teacher_id, group_id, group_name, lesson_date, slot, payload, progress, status) VALUES (?,?,?,?,?,?,?,?,?)`,
    [h.uuid(), teacher, '81', 'G81', date, 1, JSON.stringify({ topic: 'x', testTypeId: 132, students }), '[]', 'done']);
  await insert('2026-09-07', [{ id: '801', name: 'Аня', status: 'absent' }, { id: '802', name: 'Боря', status: 'present' }]);
  await insert('2026-09-09', [{ id: '801', name: 'Аня', status: 'present' }, { id: '802', name: 'Боря', status: 'present' }]);
});
after(() => api.close());

test('без ключа или с неверным ключом — 401; админский Basic не подходит', async () => {
  assert.equal((await api.request('GET', `/integration-api/absences?${range}`)).status, 401);
  assert.equal((await api.request('GET', `/integration-api/absences?${range}`, { headers: { 'x-api-key': 'wrong' } })).status, 401);
  assert.equal((await api.request('GET', `/integration-api/absences?${range}`, { admin: true })).status, 401);
  assert.equal((await api.request('GET', `/integration-api/absences?${range}`, { headers: { authorization: 'Bearer mentor-key' } })).status, 200);
});

test('выгрузка: ученики с пропусками с HollyHop ID и группами; период обязателен', async () => {
  const res = await api.request('GET', `/integration-api/absences?${range}`, { headers: KEY });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.students, [{
    studentId: '801', student: 'Аня', groups: [{ id: '81', name: 'G81' }], group: 'G81', lessons: 2, absent: 1, rate: 0.5, feedback: null,
  }]);
  assert.equal((await api.request('GET', '/integration-api/absences', { headers: KEY })).status, 400);
});

test('обратная связь: сохраняется, обновляется по (ученик, период), видна в выгрузке и в админке', async () => {
  const item = { studentId: '801', student: 'Аня', groups: 'G81', lessons: 2, period, status: 'contacted', reason: 'болела', mentor: 'Ментор 1', feedbackAt: '2026-10-02T10:00:00Z' };
  let res = await api.request('POST', '/integration-api/absence-feedback', { headers: KEY, body: [item] });
  assert.deepEqual([res.status, res.json], [200, { ok: 1, saved: 1 }]);
  // Повтор за тот же период — обновление; более старая обратная связь новую не затирает.
  await api.request('POST', '/integration-api/absence-feedback', { headers: KEY, body: { items: [{ ...item, status: 'resolved', feedbackAt: '2026-10-05T10:00:00Z' }] } });
  await api.request('POST', '/integration-api/absence-feedback', { headers: KEY, body: [{ ...item, status: 'old', feedbackAt: '2026-10-01T10:00:00Z' }] });
  const [[{ n }]] = await h.db.query('SELECT COUNT(*) n FROM absence_feedback');
  assert.equal(Number(n), 1);

  const fb = (await api.request('GET', `/integration-api/absences?${range}`, { headers: KEY })).json.students[0].feedback;
  assert.deepEqual(fb, { status: 'resolved', reason: 'болела', mentor: 'Ментор 1', period, feedbackAt: '2026-10-05T10:00:00Z' });
  const admin = (await api.request('GET', `/admin-api/export/tests?${range}`, { admin: true })).json.attendance.scopes[0].rows[0];
  assert.equal(admin.feedback.status, 'resolved');
});

test('обратная связь: неверные записи — 400 с указанием поля, ничего не сохраняется', async () => {
  await h.db.query('TRUNCATE absence_feedback');
  const ok = { studentId: '802', period, status: 'new', feedbackAt: '2026-10-02T10:00:00Z' };
  const res = await api.request('POST', '/integration-api/absence-feedback', { headers: KEY, body: [ok,
    { ...ok, studentId: 'abc' }, { ...ok, period: { from: '2026-09-30', to: '2026-09-01' } }, { ...ok, status: '' }, { ...ok, feedbackAt: 'вчера' }] });
  assert.equal(res.status, 400);
  assert.deepEqual(res.json.errors, [{ index: 1, field: 'studentId' }, { index: 2, field: 'period' }, { index: 3, field: 'status' }, { index: 4, field: 'feedbackAt' }]);
  const [[{ n }]] = await h.db.query('SELECT COUNT(*) n FROM absence_feedback');
  assert.equal(Number(n), 0);
  assert.equal((await api.request('POST', '/integration-api/absence-feedback', { headers: KEY, body: [] })).status, 400);
});
