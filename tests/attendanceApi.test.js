// /attendance-api/v1 — API только для чтения для кабинета ученика и ботов-кураторов: контракт всех эндпоинтов.
global.__TEST_ENV__ = { ATTENDANCE_API_RATE_PER_MIN: '1000' };   // здесь много запросов; лимит — в attendanceApiLimits.test.js
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { todayIso, addDays } = require('../src/lib/date');

const KEY = { 'x-api-key': 'att-key' };
const today = todayIso();
const d = n => addDays(today, n);
let api, t1, t2, ids = {};

const GET = (path, headers = KEY) => api.request('GET', `/attendance-api/v1${path}`, { headers });
const daily132 = (hw, act, disc) => ({ 8: 45, 13: hw, 9: act, 10: disc });
const daily131 = (hw, act, disc) => ({ 8: 45, 11: hw, 9: act, 10: disc });

async function ins(name, teacher, gid, gname, branch, date, payload, slot = 1) {
  const [r] = await h.db.query(
    'INSERT INTO submissions (idem_key, teacher_id, group_id, group_name, branch, lesson_date, slot, payload, progress, status) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [h.uuid(), teacher, gid, gname, branch, date, slot, JSON.stringify(payload), '[]', 'done']);
  ids[name] = r.insertId;
}

before(async () => {
  await h.setupDb();
  t1 = await h.addTeacher({ telegram_id: 7001, hollihop_id: '201', full_name: 'Иванова Анна', branch: 'Абая', lang: 'ru' });
  t2 = await h.addTeacher({ telegram_id: 7002, hollihop_id: '202', full_name: 'Smith John', branch: 'Хайвилл', lang: 'en' });
  await h.addTeacher({ telegram_id: 7003, hollihop_id: null, full_name: 'Ахметов Директор', branch: 'Абая', role: 'director', active: 0 });
  api = await h.start();
  // S1/S2 — один урок группы 81 у местного и иностранного преподавателя; S2 — с доп. тестом Quick Test NEF.
  await ins('S1', t1, '81', 'G81', 'Абая', d(-3), { topic: 'Present Simple', homework: 'Ex 1-3', level: 'Elementary', testTypeId: 132, teacherId: 201, ktpTopicId: 7,
    students: [{ id: '801', name: 'Аня', status: 'present', skills: daily132(4, 5, 3) }, { id: '802', name: 'Боря', status: 'absent', skills: null }] });
  await ins('S2', t2, '81', 'G81', 'Абая', d(-3), { topic: 'Speaking club', homework: 'Essay', level: 'Elementary', testTypeId: 131, teacherId: 202,
    personal: { categoryId: 2, testTypeId: 2 },
    students: [{ id: '801', name: 'Аня', status: 'present', skills: daily131(5, 4, 5), personalSkills: { 3: 18, 4: 15, 5: 9 } }] }, 2);
  await ins('S3', t1, '82', 'G82', 'Хайвилл', d(-1), { topic: 'Past Simple', homework: 'WB p.5', level: 'Pre-Intermediate', testTypeId: 132, teacherId: 201,
    students: [{ id: '801', name: 'Аня', status: 'present', skills: daily132(3, 3, 4) }, { id: '803', name: 'Вика', status: 'present', skills: daily132(5, 5, 5) }] });
  await ins('S4', t1, '83', 'G83', 'Абая', d(-50), { topic: 'Old', homework: 'x', testTypeId: 132,
    students: [{ id: '804', status: 'present', skills: daily132(2, 2, 2) }] });                       // старая отметка без ФИО и уровня
  await ins('S5', t1, '83', 'G83', 'Абая', d(-100), { topic: 'Very old', homework: 'x', testTypeId: 132,
    students: [{ id: 805, name: 'Дана', status: 'absent' }] });                                    // id числом (как в старых отметках)
});
after(() => api.close());

/* ---------------- Доступ ---------------- */

test('auth: X-Api-Key и Bearer — 200; без ключа, ключ менторов, Basic админки, неверный — 401', async () => {
  assert.equal((await GET('/meta')).status, 200);
  assert.equal((await GET('/meta', { authorization: 'Bearer att-key' })).status, 200);
  for (const headers of [{}, { 'x-api-key': 'mentor-key' }, { 'x-api-key': 'wrong' }, { authorization: 'Basic ' + Buffer.from('admin:secret').toString('base64') }]) {
    const r = await GET('/lessons', headers);
    assert.deepEqual([r.status, r.json], [401, { error: 'unauthorized' }], JSON.stringify(headers));
  }
  // и наоборот: ключ этого API не открывает API менторов
  assert.equal((await api.request('GET', '/integration-api/absences?from=2026-09-01&to=2026-09-30', { headers: KEY })).status, 401);
});

test('только чтение: POST/PUT/DELETE — 405 read_only (с ключом), без ключа — 401', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const r = await api.request(method, '/attendance-api/v1/lessons', { headers: KEY, body: {} });
    assert.deepEqual([r.status, r.json], [405, { error: 'read_only' }], method);
  }
  assert.equal((await api.request('POST', '/attendance-api/v1/lessons', { body: {} })).status, 401);
  assert.equal((await GET('/nope')).status, 404);
});

test('заголовки: no-store (ПДн), X-RateLimit-Limit/Remaining', async () => {
  const r = await GET('/meta');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-ratelimit-limit'), '1000');
  assert.match(r.headers.get('x-ratelimit-remaining'), /^\d+$/);
});

/* ---------------- /meta ---------------- */

test('meta: шкалы, типы тестов с максимумами, недоступные поля и лимиты', async () => {
  const m = (await GET('/meta')).json;
  assert.deepEqual(m.daily_scores.scale, { min: 0, max: 5 });
  assert.deepEqual(m.attendance, ['present', 'absent']);
  const quick = m.test_categories.find(c => c.test_category_id === 2);
  assert.deepEqual([quick.name, quick.types[0].max_score], ['Quick Test NEF', 50]);
  assert.ok(m.not_available.recommendations);
  assert.deepEqual([m.limits.requests_per_minute_per_ip, m.limits.page_limit_max], [1000, 500]);
});

/* ---------------- /lessons ---------------- */

test('lessons: по умолчанию — последние 30 дней, одна запись = ученик × отметка, порядок стабильный', async () => {
  const r = await GET('/lessons');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.data.map(x => x.record_id), [`${ids.S1}:801`, `${ids.S1}:802`, `${ids.S2}:801`, `${ids.S3}:801`, `${ids.S3}:803`]);
  assert.deepEqual(r.json.page, { limit: 100, next_cursor: null, has_more: false });
});

test('lessons: поля записи — HollyHop ID, посещаемость, баллы ДЗ/активность/поведение, тема, ДЗ', async () => {
  const data = (await GET('/lessons')).json.data;
  const rec = data.find(x => x.record_id === `${ids.S1}:801`);
  assert.deepEqual(rec, {
    record_id: `${ids.S1}:801`, lesson_id: `81:${d(-3)}`, submission_id: String(ids.S1), date: d(-3),
    group_id: '81', hollyhop_edunit_id: '81', group_name: 'G81', branch: 'Абая', level: 'Elementary',
    teacher_id: String(t1), hollyhop_teacher_id: '201', teacher_fio: 'Иванова Анна', teacher_type: 'local',
    student_id: '801', hollyhop_client_id: '801', student_fio: 'Аня',
    attendance: 'present', absence_reason: null, homework: 4, activity: 5, behaviour: 3,
    homework_assignment: 'Ex 1-3', topic: 'Present Simple', ktp_topic_id: 7, comment: null, has_extra_test: false,
    updated_at: rec.updated_at,
  });
  assert.match(rec.updated_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  // отсутствующий — без баллов
  const absent = data.find(x => x.record_id === `${ids.S1}:802`);
  assert.deepEqual([absent.attendance, absent.homework, absent.activity, absent.behaviour], ['absent', null, null, null]);
  // иностранный преподаватель: тип 131, ДЗ — навык 11
  const foreign = data.find(x => x.record_id === `${ids.S2}:801`);
  assert.deepEqual([foreign.teacher_type, foreign.hollyhop_teacher_id, foreign.homework, foreign.activity, foreign.behaviour, foreign.has_extra_test],
    ['foreign', '202', 5, 4, 5, true]);
  assert.equal(foreign.lesson_id, rec.lesson_id);                                 // один урок — две отметки
});

test('lessons: фильтры hollyhop_client_id, group_id, teacher_id, hollyhop_teacher_id, branch, attendance, период', async () => {
  const recs = async q => (await GET(`/lessons?${q}`)).json.data.map(x => x.record_id);
  assert.deepEqual(await recs('hollyhop_client_id=801'), [`${ids.S1}:801`, `${ids.S2}:801`, `${ids.S3}:801`]);
  assert.deepEqual(await recs('group_id=82'), [`${ids.S3}:801`, `${ids.S3}:803`]);
  assert.deepEqual(await recs(`teacher_id=${t2}`), [`${ids.S2}:801`]);
  assert.deepEqual(await recs('hollyhop_teacher_id=202'), [`${ids.S2}:801`]);
  assert.deepEqual(await recs(`branch=${encodeURIComponent('Хайвилл')}`), [`${ids.S3}:801`, `${ids.S3}:803`]);
  assert.deepEqual(await recs('attendance=absent'), [`${ids.S1}:802`]);
  assert.deepEqual(await recs(`date_from=${d(-120)}&date_to=${d(-40)}`), [`${ids.S4}:804`, `${ids.S5}:805`]);
  assert.deepEqual(await recs(`date_from=${d(-120)}&date_to=${d(-40)}&hollyhop_client_id=805`), [`${ids.S5}:805`]);   // id числом в payload
  assert.deepEqual(await recs(`date_from=${d(-1)}&date_to=${d(-1)}`), [`${ids.S3}:801`, `${ids.S3}:803`]);
  const old = (await GET(`/lessons?date_from=${d(-60)}&date_to=${d(-40)}`)).json.data[0];
  assert.deepEqual([old.student_fio, old.level], [null, null]);                   // старая отметка: ФИО и уровня нет
});

test('lessons: курсор — limit=1 и limit=2 проходят все записи без пропусков и повторов', async () => {
  const all = (await GET(`/lessons?date_from=${d(-120)}&date_to=${today}`)).json.data.map(x => x.record_id);
  assert.equal(all.length, 7);
  for (const limit of [1, 2, 3]) {
    const seen = [];
    let cursor = '', pages = 0;
    do {
      const r = await GET(`/lessons?date_from=${d(-120)}&date_to=${today}&limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`);
      assert.equal(r.status, 200);
      assert.ok(r.json.data.length <= limit);
      seen.push(...r.json.data.map(x => x.record_id));
      assert.equal(r.json.page.has_more, r.json.page.next_cursor != null);
      cursor = r.json.page.next_cursor;
      assert.ok(++pages < 20);
    } while (cursor);
    assert.deepEqual(seen, all, `limit=${limit}`);
  }
});

test('lessons: updated_since — только отметки, созданные начиная с момента', async () => {
  await h.db.query("SET time_zone = '+00:00'");                                // как у пула приложения: метки времени — UTC
  await h.db.query("UPDATE submissions SET created_at = '2026-01-01 00:00:00' WHERE id IN (?)", [[ids.S1, ids.S2]]);
  try {
    const recs = async q => (await GET(`/lessons?${q}`)).json.data.map(x => x.record_id);
    assert.deepEqual(await recs('updated_since=2026-02-01T00:00:00Z'), [`${ids.S3}:801`, `${ids.S3}:803`, `${ids.S4}:804`, `${ids.S5}:805`].sort((a, b) => parseInt(a) - parseInt(b)));
    assert.deepEqual(await recs('updated_since=2026-01-01T05:00:00%2B05:00'), (await recs(`date_from=${d(-120)}`)));   // 05:00 +05 = 00:00 UTC — включительно
    assert.deepEqual(await recs('updated_since=2099-01-01'), []);
    const s1 = (await GET(`/lessons?updated_since=2025-12-31&group_id=81`)).json.data[0];
    assert.equal(s1.updated_at, '2026-01-01T00:00:00Z');
  } finally {
    await h.db.query('UPDATE submissions SET created_at = NOW() WHERE id IN (?)', [[ids.S1, ids.S2]]);
  }
});

test('lessons: неверные параметры → 400 bad_param с именем параметра', async () => {
  const cases = [
    ['limit=0', 'limit'], ['limit=501', 'limit'], ['limit=abc', 'limit'], ['date_from=2026-02-30', 'date_from'],
    [`date_from=${today}&date_to=${d(-1)}`, 'date_from'], ['cursor=!!!', 'cursor'], ['cursor=' + Buffer.from('x.y').toString('base64url'), 'cursor'],
    ['updated_since=2026-01-01T10:00:00', 'updated_since'], ['updated_since=вчера', 'updated_since'],
    ['hollyhop_client_id=abc', 'hollyhop_client_id'], ['group_id=1;DROP', 'group_id'], ['attendance=late', 'attendance'],
    ['limit=1&limit=2', 'limit'],
  ];
  for (const [q, param] of cases) {
    const r = await GET(`/lessons?${q}`);
    assert.deepEqual([r.status, r.json], [400, { error: 'bad_param', param }], q);
  }
  const long = await GET(`/lessons?date_from=${d(-400)}&date_to=${today}`);
  assert.deepEqual([long.status, long.json], [400, { error: 'period_too_long', maxDays: 366 }]);
});

/* ---------------- /tests ---------------- */

test('tests: доп. тесты с баллом, максимумом, процентом и навыками; фильтр по категории', async () => {
  const r = await GET('/tests');
  assert.equal(r.status, 200);
  assert.equal(r.json.data.length, 1);
  const t = r.json.data[0];
  assert.deepEqual({ ...t, updated_at: null }, {
    test_id: `${ids.S2}:801`, submission_id: String(ids.S2), date: d(-3),
    group_id: '81', hollyhop_edunit_id: '81', group_name: 'G81', branch: 'Абая', level: 'Elementary',
    teacher_id: String(t2), hollyhop_teacher_id: '202', teacher_fio: 'Smith John', teacher_type: 'foreign',
    student_id: '801', hollyhop_client_id: '801', student_fio: 'Аня',
    test_category_id: 2, test_type: 'Quick Test NEF', test_type_id: 2, test_name: 'Quick Test NEF',
    score: 42, max_score: 50, percent: 84,
    skills: [{ skill_id: 3, name: 'Grammar', score: 18, max: 20 }, { skill_id: 4, name: 'Vocabulary', score: 15, max: 20 }, { skill_id: 5, name: 'Pronunciation', score: 9, max: 10 }],
    updated_at: null,
  });
  assert.equal((await GET('/tests?test_category_id=1')).json.data.length, 0);
  assert.equal((await GET('/tests?test_category_id=2&hollyhop_client_id=801')).json.data.length, 1);
  assert.equal((await GET('/tests?hollyhop_client_id=803')).json.data.length, 0);
});

/* ---------------- /students ---------------- */

test('students: ученики окна (60 дней) с текущей группой, уровнем, преподавателем и статусом', async () => {
  const r = await GET('/students');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.data.map(s => s.student_id), ['801', '802', '803', '804']);   // Аня, Боря, Вика, без ФИО — в конце; 805 — вне окна
  assert.deepEqual(r.json.page, { limit: 100, offset: 0, total: 4, has_more: false });
  assert.deepEqual(r.json.window, { active_since: d(-60), to: today });
  const anya = r.json.data[0];
  assert.deepEqual([anya.hollyhop_client_id, anya.fio, anya.group_id, anya.group_name, anya.level, anya.branch, anya.teacher_id, anya.hollyhop_teacher_id, anya.teacher_fio, anya.status, anya.last_lesson_date],
    ['801', 'Аня', '82', 'G82', 'Pre-Intermediate', 'Хайвилл', String(t1), '201', 'Иванова Анна', 'active', d(-1)]);
  assert.deepEqual(anya.groups.map(g => g.group_id), ['82', '81']);
  assert.deepEqual(anya.groups[1].teachers.map(t => t.hollyhop_teacher_id).sort(), ['201', '202']);   // местный и иностранный
  const gena = r.json.data[3];
  assert.deepEqual([gena.fio, gena.status, gena.last_lesson_date], [null, 'inactive', d(-50)]);
});

test('students: фильтры, offset-пагинация, окно active_since', async () => {
  const sids = async q => (await GET(`/students?${q}`)).json.data.map(s => s.student_id);
  assert.deepEqual(await sids('status=inactive'), ['804']);
  assert.deepEqual(await sids('hollyhop_client_id=803'), ['803']);
  assert.deepEqual(await sids('group_id=81'), ['801', '802']);
  assert.deepEqual(await sids(`teacher_id=${t2}`), ['801']);
  assert.deepEqual(await sids(`branch=${encodeURIComponent('Хайвилл')}`), ['801', '803']);
  const p = (await GET('/students?limit=2&offset=2')).json;
  assert.deepEqual([p.data.map(s => s.student_id), p.page], [['803', '804'], { limit: 2, offset: 2, total: 4, has_more: false }]);
  assert.equal((await GET('/students?limit=2')).json.page.has_more, true);
  assert.ok((await sids(`active_since=${d(-120)}`)).includes('805'));
  for (const q of [`active_since=${d(-200)}`, `active_since=${d(1)}`, 'active_since=xx', 'status=gone', 'offset=-1']) {
    const r = await GET(`/students?${q}`);
    assert.equal(r.status, 400, q);
  }
});

/* ---------------- /groups ---------------- */

test('groups: группы окна с HollyHop EdUnit, преподавателями, числом учеников и уроков', async () => {
  const r = await GET('/groups');
  assert.deepEqual(r.json.data.map(g => g.group_id), ['81', '82', '83']);
  const g81 = r.json.data[0];
  assert.deepEqual([g81.hollyhop_edunit_id, g81.name, g81.level, g81.branch, g81.students_count, g81.lessons_count, g81.status, g81.schedule],
    ['81', 'G81', 'Elementary', 'Абая', 2, 1, 'active', null]);
  assert.deepEqual(g81.teachers.map(t => [t.hollyhop_teacher_id, t.type, t.lessons_count]).sort(), [['201', 'local', 1], ['202', 'foreign', 1]]);
  assert.equal(r.json.data[2].status, 'inactive');
  assert.deepEqual((await GET(`/groups?teacher_id=${t2}`)).json.data.map(g => g.group_id), ['81']);
  assert.deepEqual((await GET('/groups?status=active&branch=' + encodeURIComponent('Абая'))).json.data.map(g => g.group_id), ['81']);
});

/* ---------------- /teachers ---------------- */

test('teachers: справочник с HollyHop ID, типом, без Telegram ID; фильтры active и branch', async () => {
  const r = await GET('/teachers');
  assert.equal(r.json.page.total, 3);
  const anna = r.json.data.find(t => t.teacher_id === String(t1));
  assert.deepEqual(anna, { teacher_id: String(t1), hollyhop_teacher_id: '201', fio: 'Иванова Анна', branch: 'Абая', type: 'local', role: 'teacher', active: true });
  assert.ok(r.json.data.every(t => !('telegram_id' in t)));
  assert.deepEqual((await GET('/teachers?active=false')).json.data.map(t => t.fio), ['Ахметов Директор']);
  assert.deepEqual((await GET('/teachers?branch=' + encodeURIComponent('Хайвилл'))).json.data.map(t => t.hollyhop_teacher_id), ['202']);
  assert.equal((await GET('/teachers?active=maybe')).status, 400);
});
