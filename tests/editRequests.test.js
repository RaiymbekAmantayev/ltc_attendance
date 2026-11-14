// Исправление своей отметки: запрос преподавателя → одобрение в админке → правка (тесты в HollyHop — по Id, коины — разницей,
// убранные тесты — в список «удалить в HollyHop вручную», т. к. метода удаления в API нет).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let api;
const TG = 4201, OTHER = 4202;
const DAILY = { 13: 5, 9: 5, 10: 5 };                          // коины: (5 + 5) × 2 = 20
const LOW = { 13: 2, 9: 1, 10: 3 };                            // коины: (2 + 1) × 2 = 6
const PROGRESS = { 1: 10, 2: 15, 3: 40, 4: 40, 5: 20, 6: 15, 7: 10, 21: 2 };   // 100 % → +20 коинов

before(async () => {
  await h.setupDb();
  await h.addTeacher({ telegram_id: TG, hollihop_id: '101', full_name: 'Local Teacher', lang: 'ru' });
  await h.addTeacher({ telegram_id: OTHER, hollihop_id: '103', full_name: 'Other Teacher', lang: 'ru' });
  api = await h.start();
});
after(() => api.close());
beforeEach(async () => {
  h.mock.reset();
  for (const t of ['submissions', 'edit_requests', 'hh_cleanup']) await h.db.query(`DELETE FROM ${t}`);
});

const save = (students, personal = null) => api.request('POST', '/api/lessons',
  { tg: TG, body: { key: h.uuid(), groupId: '31', date: h.WED, topic: 'Unit 3', homework: 'Ex. 1', personal, students } });
const edit = (students, extra = {}, tg = TG) => api.request('POST', '/api/lessons/edit',
  { tg, body: { editKey: h.uuid(), groupId: '31', date: h.WED, topic: 'Unit 4', homework: 'Ex. 2', students, ...extra } });
const askEdit = (reason = 'Перепутал баллы у Аяна', tg = TG) => api.request('POST', '/api/lessons/edit-request',
  { tg, body: { groupId: '31', date: h.WED, reason } });
const requests = async () => (await api.request('GET', '/admin-api/edit-requests?status=', { admin: true })).json;
const approve = async () => {
  const { requests: list } = await requests();
  const r = list.find(x => x.status === 'pending');
  return api.request('POST', `/admin-api/edit-requests/${r.id}/approve`, { admin: true, body: { note: 'ок' } });
};
const groupState = async () => (await api.request('GET', `/api/groups/31/students?date=${h.WED}`, { tg: TG })).json.submitted;
const coinsOf = id => Number(h.mock.state.coins[id] || 0);

test('без одобрения правка запрещена; запрос — с причиной, один активный; отклонение видно преподавателю', async () => {
  assert.equal((await save([{ id: '3101', status: 'present', skills: DAILY }])).json.status, 'done');
  assert.equal((await edit([{ id: '3101', status: 'present', skills: LOW }])).json.error, 'edit_not_allowed');
  assert.equal((await askEdit('')).json.error, 'reason_required');
  assert.equal((await askEdit('нет отметки', OTHER)).json.error, 'not_found');   // чужую отметку не запросить

  const first = await askEdit();
  assert.equal(first.status, 200);
  assert.equal(first.json.status, 'pending');
  assert.equal((await askEdit()).json.error, 'request_exists');
  assert.equal((await edit([{ id: '3101', status: 'present', skills: LOW }])).json.error, 'edit_not_allowed');   // ещё не одобрен

  const { requests: list, pending } = await requests();
  assert.equal(pending, 1);
  const r = await api.request('POST', `/admin-api/edit-requests/${list[0].id}/reject`, { admin: true, body: { note: 'Это верные баллы' } });
  assert.equal(r.status, 200);
  assert.equal((await api.request('POST', `/admin-api/edit-requests/${list[0].id}/approve`, { admin: true })).status, 409);   // уже рассмотрен
  const st = await groupState();
  assert.equal(st.edit.status, 'rejected');
  assert.equal(st.edit.note, 'Это верные баллы');
  assert.equal((await askEdit('Всё же нужно исправить')).status, 200);   // после отказа можно спросить снова
});

test('одобрено: правка темы и баллов идёт в HollyHop правкой по Id, коины — разницей; второй раз без нового запроса нельзя', async () => {
  await save([
    { id: '3101', status: 'present', skills: DAILY },
    { id: '3102', status: 'absent' },
    { id: '3103', status: 'present', skills: DAILY },
  ]);
  const firstIds = h.mock.state.tests.map(t => t.studentClientId);
  assert.deepEqual(firstIds, [3101, 3103]);
  assert.equal(coinsOf(3101), 20);
  assert.equal(coinsOf(3103), 20);

  await askEdit();
  assert.equal((await approve()).status, 200);
  const st = await groupState();
  assert.equal(st.edit.status, 'approved');
  assert.ok(st.edit.expiresAt);

  const writesBefore = h.mock.state.writes.length;
  const res = await edit([
    { id: '3101', status: 'present', skills: LOW },        // баллы ниже
    { id: '3102', status: 'present', skills: DAILY },      // был отмечен пропуском
    { id: '3103', status: 'present', skills: DAILY },      // без изменений
  ]);
  assert.equal(res.json.status, 'done', JSON.stringify(res.json));

  // посещаемость перезаписана, 3102 — теперь «был»
  const writes = h.mock.state.writes.slice(writesBefore);
  assert.equal(writes.find(w => w.StudentClientId === 3102).Pass, false);
  // тесты 3101 и 3103 — правка по Id, у 3102 — новый результат
  assert.deepEqual(h.mock.state.edits.map(e => e.studentClientId).sort(), [3101, 3103]);
  assert.ok(h.mock.state.edits.every(e => e.id > 1000));
  const t3101 = h.mock.state.tests.find(t => t.studentClientId === 3101);
  assert.deepEqual(t3101.skills.find(k => k.skillId === 13), { skillId: 13, score: 2 });
  assert.equal(t3101.commentHtml, 'Unit 4<br>Дз/Hw: Ex. 2');
  assert.equal(h.mock.state.tests.filter(t => t.studentClientId === 3102).length, 1);
  assert.equal(h.mock.state.tests.length, 3, 'дублей результатов нет');
  // коины: 3101 — минус 14 (20 → 6), 3102 — +20, 3103 — без изменений
  assert.equal(coinsOf(3101), 6);
  assert.equal(coinsOf(3102), 20);
  assert.equal(coinsOf(3103), 20);

  const after = await groupState();
  assert.equal(after.revision, 1);
  assert.equal(after.edit.status, 'used');
  assert.equal(after.payload.topic, 'Unit 4');
  assert.equal((await edit([{ id: '3101', status: 'present', skills: DAILY }])).json.error, 'edit_not_allowed');

  const audit = (await api.request('GET', '/admin-api/audit?action=edit', { admin: true })).json;
  assert.equal(audit.length, 1);
});

test('повтор того же нажатия «Сохранить исправление» не правит дважды', async () => {
  await save([{ id: '3101', status: 'present', skills: DAILY }]);
  await askEdit(); await approve();
  const body = { editKey: h.uuid(), groupId: '31', date: h.WED, topic: 'Unit 4', homework: 'Ex. 2', students: [{ id: '3101', status: 'present', skills: LOW }] };
  assert.equal((await api.request('POST', '/api/lessons/edit', { tg: TG, body })).json.status, 'done');
  const edits = h.mock.state.edits.length;
  assert.equal((await api.request('POST', '/api/lessons/edit', { tg: TG, body })).json.status, 'done');
  assert.equal(h.mock.state.edits.length, edits);
  assert.equal(coinsOf(3101), 6);
});

test('удаление доп. теста и «был» → «пропуск»: результаты уходят в список ручного удаления с Id, коины списываются', async () => {
  await save([
    { id: '3101', status: 'present', skills: DAILY, personalSkills: PROGRESS },
    { id: '3102', status: 'present', skills: DAILY, personalSkills: PROGRESS },
  ], { categoryId: 1, testTypeId: 1 });
  assert.equal(coinsOf(3101), 40);                              // 20 за ежедневный + 20 за Progress Test
  const dailyId3102 = [...h.mock.state.results].find(([, r]) => r.studentClientId === 3102 && r.testTypeId === 132)[0];
  const personalIds = [...h.mock.state.results].filter(([, r]) => r.testTypeId === 1).map(([id]) => String(id)).sort();

  await askEdit('Доп. теста не было, Тимур отсутствовал'); await approve();
  const res = await edit([
    { id: '3101', status: 'present', skills: DAILY },
    { id: '3102', status: 'absent' },
  ], { personal: null });
  assert.equal(res.json.status, 'done', JSON.stringify(res.json));
  assert.equal(coinsOf(3101), 20);                              // за доп. тест списано
  assert.equal(coinsOf(3102), 0);                               // пропуск — коинов нет

  const { cleanup, cleanupPending } = await requests();
  assert.equal(cleanupPending, 3);
  assert.deepEqual(cleanup.filter(c => c.kind === 'personal').map(c => c.result_id).sort(), personalIds);
  assert.equal(cleanup.find(c => c.kind === 'daily').result_id, String(dailyId3102));
  assert.equal(cleanup.find(c => c.kind === 'daily').student_id, '3102');

  const done = await api.request('POST', `/admin-api/hh-cleanup/${cleanup[0].id}/done`, { admin: true });
  assert.equal(done.status, 200);
  assert.equal((await requests()).cleanupPending, 2);
  assert.equal((await api.request('POST', `/admin-api/hh-cleanup/${cleanup[0].id}/done`, { admin: true })).status, 409);
});

test('старая отметка без сохранённых Id: результат находится через GetPersonalTestResults и правится, а не дублируется', async () => {
  await save([{ id: '3101', status: 'present', skills: DAILY }]);
  await h.db.query('UPDATE submissions SET hh_results = NULL, coins_credited = NULL');   // как до появления правок
  await askEdit(); await approve();
  const res = await edit([{ id: '3101', status: 'present', skills: LOW }]);
  assert.equal(res.json.status, 'done', JSON.stringify(res.json));
  assert.equal(h.mock.state.edits.length, 1);
  assert.equal(h.mock.state.tests.length, 1);
  assert.equal(coinsOf(3101), 6);                               // начисленные 20 посчитаны по прежней отметке
});

test('смена типа доп. теста: старый — в ручное удаление, новый добавляется', async () => {
  await save([{ id: '3101', status: 'present', skills: DAILY, personalSkills: PROGRESS }], { categoryId: 1, testTypeId: 1 });
  await askEdit(); await approve();
  const QUICK = { 3: 20, 4: 20, 5: 10 };
  const res = await edit([{ id: '3101', status: 'present', skills: DAILY, personalSkills: QUICK }], { personal: { categoryId: 2, testTypeId: 2 } });
  assert.equal(res.json.status, 'done', JSON.stringify(res.json));
  assert.equal(h.mock.state.personal.filter(p => p.testTypeId === 2 && p.id == null).length, 1);
  const { cleanup } = await requests();
  assert.equal(cleanup.length, 1);
  assert.equal(cleanup[0].test_type_id, 1);
  assert.equal(coinsOf(3101), 40);                              // 100 % в обоих тестах — коины не меняются
});
