global.__TEST_ENV__ = { TEST_REQUIRED: '1', COMMENT_REQUIRED: '1', COMMENT_MAX_LEN: '20' };
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let api;
before(async () => {
  await h.setupDb();
  await h.addTeacher({ telegram_id: 3001, hollihop_id: '101', full_name: 'Иванова' });
  api = await h.start();
});
after(() => api.close());

const save = (list, group = '9001', topic = '') => api.request('POST', '/api/lessons', { tg: 3001, body: { key: h.uuid(), groupId: group, date: h.WED, topic, students: list } });
const SK = { 13: 4, 9: 5, 10: 5 };

test('правила из разд. 5 ТЗ: тест и комментарий (= тема урока) обязательны только для присутствовавших', async () => {
  assert.equal((await save([{ id: '900101', status: 'present', comment: 'ok' }])).json.error, 'test_required');
  assert.equal((await save([{ id: '900101', status: 'present', skills: SK }])).json.error, 'comment_required');
  const absent = await save([{ id: '900101', status: 'absent', excused: false }]);
  assert.equal(absent.status, 200);                                                // пропустившему тест не нужен
});

test('комментарий (= тема урока) обрезается до COMMENT_MAX_LEN', async () => {
  const ok = await save([{ id: '900301', status: 'present', skills: SK }], '9003', 'x'.repeat(100));
  assert.equal(ok.status, 200);
  const view = await api.request('GET', `/api/groups/9003/students?date=${h.WED}`, { tg: 3001 });
  assert.equal(view.json.submitted.payload.students[0].comment.length, 20);
});
