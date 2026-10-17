const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let api, t1, t2;
const TG = { teacher: 1001, other: 1002, coord: 1003, director: 999, stranger: 5555 };

before(async () => {
  await h.setupDb();
  t1 = await h.addTeacher({ telegram_id: TG.teacher, hollihop_id: '101', full_name: 'Иванова Анна' });
  t2 = await h.addTeacher({ telegram_id: TG.other, hollihop_id: '102', full_name: 'Smith John', lang: 'en' });
  await h.addTeacher({ telegram_id: TG.coord, full_name: 'Координатор', role: 'coordinator' });
  api = await h.start();
});
after(() => api.close());
beforeEach(async () => { h.mock.reset(); await h.db.query('DELETE FROM submissions'); await h.db.query('DELETE FROM substitutions'); });

const students = async group => (await api.request('GET', `/api/groups/${group}/students?date=${h.WED}`, { tg: TG.teacher })).json.students;
const DAILY = { 13: 5, 9: 5, 10: 5 };                            // ежедневный тест обязателен для присутствовавших
const body = (key, group, list, extra = {}) => ({ key, groupId: group, date: h.WED, topic: 'Past Simple', students: list, ...extra });

test('initData: подделка, чужой токен, просрочка и незнакомый человек отклоняются', async () => {
  assert.equal((await api.request('GET', '/api/me')).status, 401);
  assert.equal((await api.request('GET', '/api/me', { tg: h.initData(TG.teacher, { tamper: true }) })).status, 401);
  assert.equal((await api.request('GET', '/api/me', { tg: h.initData(TG.teacher, { token: '1:OTHER' }) })).status, 401);
  assert.equal((await api.request('GET', '/api/me', { tg: h.initData(TG.teacher, { authDate: Math.floor(Date.now() / 1000) - 90000 }) })).status, 401);
  assert.equal((await api.request('GET', '/api/me', { tg: TG.stranger })).status, 403);
  const ok = await api.request('GET', '/api/me', { tg: TG.other });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.lang, 'en');                       // Foreign → английский (разд. 8 ТЗ)
});

test('преподаватель видит только свои группы на дату', async () => {
  const mine = (await api.request('GET', `/api/lessons?date=${h.WED}`, { tg: TG.teacher })).json;
  assert.deepEqual(mine.map(g => g.id).sort(), ['31', '9001', '9003']);   // 31 — тестовая группа песочницы
  const other = (await api.request('GET', `/api/lessons?date=${h.WED}`, { tg: TG.other })).json;
  assert.deepEqual(other.map(g => g.id), ['9002']);
  const foreign = await api.request('GET', `/api/groups/9002/students?date=${h.WED}`, { tg: TG.teacher });
  assert.equal(foreign.status, 403);
});

test('сохранение пишет посещаемость в HollyHop; повтор того же нажатия не дублирует', async () => {
  const list = (await students('9001')).map((s, i) => ({ id: s.id, status: i === 0 ? 'absent' : 'present', skills: i === 0 ? null : { 13: '5', 9: '4', 10: '4' }, comment: 'не используется' }));
  const key = h.uuid();
  const first = await api.request('POST', '/api/lessons', { tg: TG.teacher, body: body(key, '9001', list) });
  assert.equal(first.json.status, 'done');
  assert.equal(h.mock.state.writes.length, list.length);
  const absent = h.mock.state.writes.find(w => w.Pass);
  assert.equal(absent.Description, undefined);           // причины пропуска больше нет
  // тест: местный преподаватель → тип 132; навык 8 всегда 45; в комментарий уходит тема урока
  assert.equal(h.mock.state.tests.length, list.length - 1);   // всем, кроме пропустившего
  const test = h.mock.state.tests[0];
  assert.equal(test.testTypeId, 132);
  assert.equal(test.edUnitId, 9001);
  assert.deepEqual(test.skills, [{ skillId: 8, score: 45 }, { skillId: 13, score: 5 }, { skillId: 9, score: 4 }, { skillId: 10, score: 4 }]);
  assert.equal(test.commentHtml, 'Past Simple');

  const again = await api.request('POST', '/api/lessons', { tg: TG.teacher, body: body(key, '9001', list) });
  assert.equal(again.json.status, 'done');
  assert.equal(h.mock.state.writes.length, list.length, 'повтор не должен писать в HollyHop второй раз');
  const [{ n }] = (await h.db.query('SELECT COUNT(*) n FROM submissions'))[0];
  assert.equal(Number(n), 1);
});

test('правка задним числом запрещена: другое нажатие на то же занятие → 409', async () => {
  const list = (await students('9001')).map(s => ({ id: s.id, status: 'present', skills: DAILY }));
  await api.request('POST', '/api/lessons', { tg: TG.teacher, body: body(h.uuid(), '9001', list) });
  const edit = await api.request('POST', '/api/lessons', { tg: TG.teacher, body: body(h.uuid(), '9001', list) });
  assert.equal(edit.status, 409);
  const view = await api.request('GET', `/api/groups/9001/students?date=${h.WED}`, { tg: TG.teacher });
  assert.equal(view.json.submitted.payload.topic, 'Past Simple');
});

test('защита: чужая группа, ученик не из группы, плохие данные', async () => {
  const list = [{ id: '900101', status: 'present', skills: DAILY }];
  assert.equal((await api.request('POST', '/api/lessons', { tg: TG.teacher, body: body(h.uuid(), '9002', list) })).status, 403);
  assert.equal((await api.request('POST', '/api/lessons', { tg: TG.teacher, body: body(h.uuid(), '9001', [{ id: '777', status: 'present' }]) })).status, 400);
  assert.equal((await api.request('POST', '/api/lessons', { tg: TG.teacher, body: body('bad-key', '9001', list) })).status, 400);
  assert.equal((await api.request('POST', '/api/lessons', { tg: TG.teacher, body: body(h.uuid(), '9001', list, { date: '2026-02-31' }) })).status, 400);
  const nan = await api.request('POST', '/api/lessons', { tg: TG.teacher, body: body(h.uuid(), '9001', [{ id: '900101', status: 'present', skills: { 13: 'abc', 9: 3, 10: 3 } }]) });
  assert.equal(nan.status, 422);
  assert.equal(nan.json.error, 'bad_score');
  assert.equal((await api.request('POST', '/api/lessons', { tg: TG.coord, body: body(h.uuid(), '9001', list) })).status, 403);   // у координатора нет своих групп
});

test('сбой HollyHop → «частично», досылка пишет только недостающее и без дублей', async () => {
  const list = (await students('9001')).map(s => ({ id: s.id, status: 'present', skills: DAILY }));
  for (let i = 0; i < 5; i++) h.mock.failNext('SetStudentPasses', { status: 500 });   // исчерпать повторы первого ученика
  const key = h.uuid();
  const res = await api.request('POST', '/api/lessons', { tg: TG.teacher, body: body(key, '9001', list) });
  assert.equal(res.json.status, 'partial');
  assert.equal(h.mock.state.writes.length, list.length - 1);

  const sub = require('../src/services/submissionService');
  assert.equal((await sub.push(key)).status, 'done');
  assert.equal(h.mock.state.writes.length, list.length);
  const ids = h.mock.state.writes.map(w => w.StudentClientId);
  assert.equal(new Set(ids).size, ids.length, 'каждый ученик записан ровно один раз');

  const lessons = (await api.request('GET', `/api/lessons?date=${h.WED}`, { tg: TG.teacher })).json;
  const card = lessons.find(g => g.id === '9001');
  assert.equal(card.status, 'done');
  assert.equal(card.done, card.total);
});

test('нет прав на запись → «нужно внимание», без бесконечных повторов; админ может повторить', async () => {
  const list = (await students('9001')).map(s => ({ id: s.id, status: 'present', skills: DAILY }));
  h.mock.failNext('SetStudentPasses', { status: 403, body: { Error: 'Нет прав доступа' } });
  const key = h.uuid();
  const res = await api.request('POST', '/api/lessons', { tg: TG.teacher, body: body(key, '9001', list) });
  assert.equal(res.json.status, 'attention');
  const [row] = (await h.db.query('SELECT status, last_error FROM submissions WHERE idem_key=?', [key]))[0];
  assert.equal(row.status, 'attention');
  const { findRetryable } = require('../src/models/submissionModel');
  assert.equal((await findRetryable()).length, 0, 'воркер не должен долбить «attention»');

  const retry = await api.request('POST', `/api/admin-api/submissions/${key}/retry`.replace('/api/admin-api', '/admin-api'), { admin: true });
  assert.equal(retry.json.status, 'done');
});

test('замена на дату открывает группу заменяющему (вариант B) и фиксирует настоящего автора', async () => {
  const before = await api.request('GET', `/api/groups/9002/students?date=${h.WED}`, { tg: TG.teacher });
  assert.equal(before.status, 403);
  await api.request('POST', '/admin-api/substitutions', { admin: true, body: { group_id: '9002', lesson_date: h.WED, substitute_id: t1 } });
  const lessons = (await api.request('GET', `/api/lessons?date=${h.WED}`, { tg: TG.teacher })).json;
  assert.ok(lessons.find(g => g.id === '9002' && g.substitution));
  const list = (await api.request('GET', `/api/groups/9002/students?date=${h.WED}`, { tg: TG.teacher })).json.students.map(s => ({ id: s.id, status: 'present', skills: DAILY }));
  const saved = await api.request('POST', '/api/lessons', { tg: TG.teacher, body: body(h.uuid(), '9002', list) });
  assert.equal(saved.json.status, 'done');
  const [rows] = await h.db.query('SELECT teacher_id FROM submissions WHERE group_id="9002"');
  assert.equal(rows[0].teacher_id, t1);
});

test('аудит-лог пишет автора, а профиль считает месяц', async () => {
  const today = require('../src/lib/date').todayIso();
  const list = (await students('9001')).map(s => ({ id: s.id, status: 'late', skills: DAILY }));
  // для профиля нужна отметка «сегодняшнего» месяца: записываем напрямую
  await h.db.query(`INSERT INTO submissions (idem_key, teacher_id, group_id, lesson_date, payload, progress, status)
    VALUES (?,?,?,?,?,?,?)`, [h.uuid(), t1, '9001', today, JSON.stringify({ topic: '', students: list }), '[]', 'done']);
  const profile = (await api.request('GET', '/api/profile', { tg: TG.teacher })).json;
  assert.equal(profile.lessons, 1);
  assert.equal(profile.attendanceRate, 100);
  assert.equal(profile.checklist.done, 1);
  await api.request('POST', '/api/lessons', { tg: TG.teacher, body: body(h.uuid(), '9001', list) });
  const audit = (await api.request('GET', '/admin-api/audit', { admin: true })).json;
  assert.ok(audit.find(a => a.action === 'save' && a.actor === `teacher:${t1}`));
});
