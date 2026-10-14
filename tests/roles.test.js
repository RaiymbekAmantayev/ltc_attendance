const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let api, t1;
const TG = { teacher: 2001, coord: 2002, director: 999 };

before(async () => {
  await h.setupDb();
  t1 = await h.addTeacher({ telegram_id: TG.teacher, hollihop_id: '101', full_name: 'Иванова Анна' });
  await h.addTeacher({ telegram_id: TG.coord, full_name: 'Координатор', role: 'coordinator' });
  api = await h.start();
});
after(() => api.close());

test('роли: преподаватель не видит разделы руководства, координатор и директор видят', async () => {
  for (const url of ['/api/dash/overview', '/api/dash/groups', '/api/dash/teachers']) {
    assert.equal((await api.request('GET', url, { tg: TG.teacher })).status, 403, url);
    assert.equal((await api.request('GET', url, { tg: TG.coord })).status, 200, url);
    assert.equal((await api.request('GET', url, { tg: TG.director })).status, 200, url);
  }
  const me = (await api.request('GET', '/api/me', { tg: TG.director })).json;
  assert.equal(me.role, 'director');                       // директор из DIRECTOR_TG_IDS без записи в базе
  assert.equal(me.canMark, false);
});

test('обзор и группы: структура данных', async () => {
  const today = require('../src/lib/date').todayIso();
  await h.db.query(`INSERT INTO submissions (idem_key, teacher_id, group_id, group_name, branch, lesson_date, payload, progress, status)
    VALUES (?,?,?,?,?,?,?,?,?)`, [h.uuid(), t1, '9001', 'English Elementary A1', 'Абая', today,
    JSON.stringify({ topic: 'x', students: [{ id: '900101', status: 'present', skills: { 8: 45, 13: 5, 18: 3 } }, { id: '900102', status: 'absent', excused: true }] }), '[]', 'partial']);
  const ov = (await api.request('GET', '/api/dash/overview', { tg: TG.director })).json;
  assert.equal(ov.kpi.lessons, 1);
  assert.equal(ov.kpi.attendanceRate, 50);
  assert.equal(ov.kpi.avgTest, 86.7);                      // (100% + 100% + 60%) / 3
  assert.equal(ov.kpi.testPassRate, 50);                   // из навыков с порогом: 11 (5≥4) прошёл, 17 (3<4) нет
  assert.equal(ov.statuses.partial, 1);
  assert.equal(ov.problems.length, 1);
  assert.ok(ov.byDay.length >= 1);

  const groups = (await api.request('GET', `/api/dash/groups?date=${h.WED}`, { tg: TG.coord })).json;
  const ielts = groups.find(g => g.id === '9003');
  assert.equal(ielts.lowFill, true);                       // 2 ученика < порога 3
  assert.equal(groups.find(g => g.id === '9004') ?? null, null, 'в среду группа Вт/Чт/Сб не идёт');

  const board = (await api.request('GET', '/api/dash/today', { tg: TG.coord })).json;
  assert.ok(Array.isArray(board.pending));

  const detail = (await api.request('GET', '/api/dash/groups/9001', { tg: TG.coord })).json;
  assert.equal(detail.students.length, 6);
  assert.equal(detail.students[0].lessons, 1);

  const teachers = (await api.request('GET', '/api/dash/teachers', { tg: TG.coord })).json;
  const ivanova = teachers.find(t => t.id === t1);
  assert.equal(ivanova.lessons, 1);
  assert.equal(ivanova.problems, 1);
});

test('координатор назначает замену из мини-аппа', async () => {
  const { json: staff } = await api.request('GET', '/api/dash/staff', { tg: TG.coord });
  assert.ok(staff.find(s => s.id === t1));
  const add = await api.request('POST', '/api/dash/substitutions', { tg: TG.coord, body: { group_id: '9002', lesson_date: h.WED, substitute_id: t1 } });
  assert.equal(add.status, 200);
  const list = (await api.request('GET', '/api/dash/substitutions', { tg: TG.coord })).json;
  assert.ok(list.find(s => s.group_id === '9002'));
  assert.equal((await api.request('POST', '/api/dash/substitutions', { tg: TG.coord, body: { group_id: '9002', lesson_date: 'bad', substitute_id: t1 } })).status, 400);
});
