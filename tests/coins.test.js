// Коины: пользовательское поле «Коины» ученика в HollyHop (GetStudents → ExtraFields, запись — EditUserExtraFields).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let api;
const TG = { ru: 4201, en: 4202 };
const FINAL = { categoryId: 4, testTypeId: 4 };                  // Final Test: максимум 10+15+40+40+20+15+10 = 150
const finalScores = total => {                                   // раскладывает сумму по навыкам Final Test, не выше максимумов
  const max = { 1: 10, 2: 15, 3: 40, 4: 40, 5: 20, 6: 15, 7: 10 };
  return Object.fromEntries(Object.entries(max).map(([id, m]) => { const v = Math.min(m, total); total -= v; return [id, v]; }));
};

before(async () => {
  await h.setupDb();
  await h.addTeacher({ telegram_id: TG.ru, hollihop_id: '101', full_name: 'Local Teacher', lang: 'ru' });
  await h.addTeacher({ telegram_id: TG.en, hollihop_id: '102', full_name: 'Foreign Teacher', lang: 'en' });
  api = await h.start();
});
after(() => api.close());
beforeEach(async () => { h.mock.reset(); await h.db.query('DELETE FROM submissions'); });

const save = (tg, group, students, personal, topic = 'Unit 5') => api.request('POST', '/api/lessons',
  { tg, body: { key: h.uuid(), groupId: group, date: h.WED, topic, personal, students } });

test('тема урока обязательна при отправке результатов', async () => {
  const res = await save(TG.ru, '31', [{ id: '3101', status: 'present', skills: { 13: 4, 9: 5, 10: 5 } }], undefined, '  ');
  assert.equal(res.json.error, 'comment_required');
  assert.equal(h.mock.state.writes.length, 0);
});

test('ежедневный тест: (ДЗ + активность) × 2 прибавляется к текущему значению поля', async () => {
  h.mock.state.coins[3101] = '7';
  h.mock.state.extraFields[3101] = { 'Telegram': '@aian', 'Школа': '№ 25' };
  const res = await save(TG.ru, '31', [
    { id: '3101', status: 'present', skills: { 13: 4, 9: 5, 10: 1 } },        // (4 + 5) × 2 = 18, дисциплина не считается
    { id: '3102', status: 'present', skills: { 13: 0, 9: 0, 10: 5 } },        // 0 — поле не трогаем
    { id: '3103', status: 'absent' },
  ]);
  assert.equal(res.json.status, 'done', JSON.stringify(res.json));
  assert.deepEqual(h.mock.state.coins, { 3101: '25' });
  assert.deepEqual(h.mock.state.coinWrites, [{ studentClientId: 3101,
    fields: [{ name: 'Telegram', value: '@aian' }, { name: 'Школа', value: '№ 25' }, { name: 'Коины', value: '25' }] }]);
  assert.deepEqual(h.mock.state.extraFields[3101], { 'Telegram': '@aian', 'Школа': '№ 25' }, 'остальные поля ученика не стёрты');
});

test('иностранный преподаватель: Homework (11) + Engagement (9)', async () => {
  const roster = (await api.request('GET', `/api/groups/9002/students?date=${h.WED}`, { tg: TG.en })).json.students;
  const res = await save(TG.en, '9002', [{ id: roster[0].id, status: 'present', skills: { 11: 3.5, 9: 2, 10: 5 } }]);
  assert.equal(res.json.status, 'done', JSON.stringify(res.json));
  assert.equal(h.mock.state.coins[roster[0].id], '11');
});

test('Final Test: 60–80 % → +10, от 80 % → +20, ниже 60 % → 0 (плюс коины за ежедневный)', async () => {
  const daily = { 13: 0, 9: 0, 10: 5 };                                           // ежедневный даёт 0, чтобы видеть только Final Test
  const res = await save(TG.ru, '31', [
    { id: '3101', status: 'present', skills: daily, personalSkills: finalScores(89) },    // 59,3 %
    { id: '3102', status: 'present', skills: daily, personalSkills: finalScores(90) },    // 60 %
    { id: '3103', status: 'present', skills: { 13: 1, 9: 1, 10: 1 }, personalSkills: finalScores(120) },   // 80 % + (1 + 1) × 2
  ], FINAL);
  assert.equal(res.json.status, 'done', JSON.stringify(res.json));
  assert.deepEqual(h.mock.state.coins, { 3102: '10', 3103: '24' });
});

test('Progress Test, Revise&Check и File Test NEF — по тем же порогам; Entry test коинов не даёт', async () => {
  const daily = { 13: 0, 9: 0, 10: 0 };
  const one = async (personal, scores) => {
    h.mock.reset(); await h.db.query('DELETE FROM submissions');
    const res = await save(TG.ru, '31', [{ id: '3101', status: 'present', skills: daily, personalSkills: scores }], personal);
    assert.equal(res.json.status, 'done', JSON.stringify(res.json));
    return h.mock.state.coins[3101] ?? null;
  };
  // Progress Test: максимум 152 (с Attendance)
  assert.equal(await one({ categoryId: 1, testTypeId: 1 }, { 1: 10, 2: 15, 3: 40, 4: 40, 5: 20, 6: 15, 7: 10, 21: 2 }), '20');
  assert.equal(await one({ categoryId: 1, testTypeId: 1 }, { 1: 10, 2: 15, 3: 40, 4: 30, 5: 0, 6: 0, 7: 0, 21: 0 }), '10');    // 95/152 = 62,5 %
  // Revise&Check «Advanced»: максимум 63
  assert.equal(await one({ categoryId: 5, testTypeId: 6 }, { 1: 4, 2: 9, 3: 20, 4: 30 }), '20');
  assert.equal(await one({ categoryId: 5, testTypeId: 6 }, { 1: 4, 2: 9, 3: 20, 4: 4 }), null);                                // 37/63 = 58,7 %
  // File Test NEF «File 1»: максимум 105
  assert.equal(await one({ categoryId: 45, testTypeId: 137 }, { 1: 10, 2: 15, 3: 20, 4: 20, 5: 10, 6: 8, 7: 0, 16: 0 }), '10');   // 83/105 = 79 %
  assert.equal(await one({ categoryId: 45, testTypeId: 137 }, { 1: 10, 2: 15, 3: 20, 4: 20, 5: 10, 6: 9, 7: 0, 16: 0 }), '20');   // 84/105 = 80 %
  // Entry test — без коинов
  assert.equal(await one({ categoryId: 6, testTypeId: 111 }, { 3: 25, 4: 25 }), null);
});

test('сбой записи коинов → «частично», досылка начисляет один раз', async () => {
  for (let i = 0; i < 5; i++) h.mock.failNext('EditUserExtraFields', { status: 502 });
  const key = h.uuid();
  const res = await api.request('POST', '/api/lessons', { tg: TG.ru, body: { key, groupId: '31', date: h.WED, topic: 'Unit 5',
    students: [{ id: '3101', status: 'present', skills: { 13: 5, 9: 5, 10: 5 } }] } });
  assert.equal(res.json.status, 'partial');
  assert.deepEqual(h.mock.state.coins, {});
  assert.equal((await require('../src/services/submissionService').push(key)).status, 'done');
  assert.equal((await require('../src/services/submissionService').push(key)).status, 'done');
  assert.deepEqual(h.mock.state.coins, { 3101: '20' });
  assert.equal(h.mock.state.tests.length, 1);
});
