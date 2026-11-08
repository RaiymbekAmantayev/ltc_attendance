// Выгрузка админки: расписание из HollyHop и фактические отметки по дням, листы Иностранные/Местные, файл Excel.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const h = require('./helpers');

let api, local, foreign;
const MON = '2026-10-12', SUN = '2026-10-18';           // неделя с h.WED
const get = url => api.request('GET', url, { admin: true });

before(async () => {
  await h.setupDb();
  local = await h.addTeacher({ telegram_id: 6001, hollihop_id: '101', full_name: 'Иванова Анна', lang: 'ru' });
  foreign = await h.addTeacher({ telegram_id: 6002, hollihop_id: '102', full_name: 'Smith John', lang: 'en' });
  api = await h.start();
});
after(() => api.close());

/** Файлы zip-архива: имя → текст (разбор только того, что пишет наш генератор). */
function unzip(buf) {
  const files = {};
  for (let i = 0; buf.readUInt32LE(i) === 0x04034b50;) {
    const size = buf.readUInt32LE(i + 18), nameLen = buf.readUInt16LE(i + 26);
    const name = buf.toString('utf8', i + 30, i + 30 + nameLen), start = i + 30 + nameLen;
    files[name] = zlib.inflateRawSync(buf.subarray(start, start + size)).toString('utf8');
    i = start + size;
  }
  return files;
}

test('расписание: уроки по группам по дням, ак. часы, листы по ФИО (латиница / кириллица)', async () => {
  const rep = (await get(`/admin-api/export/schedule?from=${MON}&to=${SUN}`)).json;
  assert.equal(rep.days.length, 7);
  assert.deepEqual(rep.sheets.map(s => s.key), ['foreign', 'local']);
  const [ivanova, satpaeva] = rep.sheets.find(s => s.key === 'local').rows;
  // 31 — каждый день 09:00–10:00, 9001 — Пн/Ср/Пт 10:00–11:30, 9003 — будни 15:00–16:30; занятие от 90 минут — два урока
  assert.equal(ivanova.name, 'Иванова Анна');
  assert.equal(ivanova.position, 'преподаватель');
  assert.equal(ivanova.counts[MON], 5); assert.equal(ivanova.counts['2026-10-13'], 3); assert.equal(ivanova.counts[SUN], 1);
  assert.equal(ivanova.lessons, 23);                     // 7·1 + 3·2 + 5·2
  assert.equal(ivanova.hours, 25.33);                     // (7·60 + 3·90 + 5·90) / 45
  assert.deepEqual(rep.sheets.find(s => s.key === 'foreign').rows.map(r => [r.name, r.lessons]), [['Smith John', 6]]);
  assert.deepEqual([satpaeva.name, satpaeva.lessons], ['Сатпаева Алия', 11]);   // 9004 — 3·2, 9005 (60 мин) — 5·1; нет в реестре: имя из GetTeachers, лист — по кириллице
  const { sheetOf } = require('../src/services/exportService');
  assert.deepEqual(['Udochukwu John Kennedy', 'Әлия Қасымова', 'Smith Джон'].map(sheetOf), ['foreign', 'local', 'local']);
});

test('дни занятий из HollyHop (queryDays) важнее строк расписания', () => {
  const { _lessonsFromEdUnits: lessons } = require('../src/services/hollihopService');
  const unit = { Id: 1, Name: 'G', ScheduleItems: [{ Id: 7, Weekdays: 127, BeginTime: '10:00', EndTime: '11:30', TeacherIds: [5] }],
    Days: [{ Date: '2026-10-13T00:00:00', ScheduleItemIds: [7] }, { Date: '2026-11-01', ScheduleItemIds: [7] }] };
  assert.deepEqual(lessons([unit], MON, SUN).map(l => [l.date, l.teacherIds, l.minutes]), [['2026-10-13', ['5'], 90]]);
  const bounded = { Id: 2, Name: 'B', ScheduleItems: [{ Id: 8, Weekdays: 127, BeginTime: '9:00', EndTime: '9:45', BeginDate: '2026-10-16 ', EndDate: '2026-10-17', TeacherIds: [6] }] };
  assert.deepEqual(lessons([bounded], MON, SUN).map(l => [l.date, l.minutes]), [['2026-10-16', 45], ['2026-10-17', 45]]);
});

test('фактические отметки: кто отметил — по дням; Excel с двумя строками шапки и формулами', async () => {
  const roster = (await api.request('GET', `/api/groups/9001/students?date=${h.WED}`, { tg: 6001 })).json.students;
  const saved = await api.request('POST', '/api/lessons', { tg: 6001, body: { key: h.uuid(), groupId: '9001', date: h.WED, topic: 'Unit 1', homework: 'Ex. 1',
    students: roster.map(s => ({ id: s.id, status: 'present', skills: { 13: 5, 9: 5, 10: 5 } })) } });
  assert.equal(saved.json.status, 'done');
  const rep = (await get(`/admin-api/export/submissions?from=${MON}&to=${SUN}`)).json;
  assert.deepEqual(rep.sheets.map(s => s.key), ['foreign', 'local']);
  assert.deepEqual(rep.sheets[1].rows.map(r => [r.name, r.counts[h.WED], r.lessons]), [['Иванова Анна', 2, 2]]);   // 9001 идёт 90 минут — два урока

  const file = await fetch(`${api.base}/admin-api/export/schedule?from=${MON}&to=${SUN}&format=xlsx`, { headers: { authorization: 'Basic ' + Buffer.from('admin:secret').toString('base64') } });
  assert.match(file.headers.get('content-type'), /spreadsheetml/);
  assert.match(file.headers.get('content-disposition'), /LTC_schedule_2026-10-12_2026-10-18\.xlsx/);
  const files = unzip(Buffer.from(await file.arrayBuffer()));
  assert.match(files['xl/workbook.xml'], /name="Иностранные".*name="Местные"/);
  assert.doesNotMatch(files['xl/workbook.xml'], /Не в реестре/);
  const local = files['xl/worksheets/sheet2.xml'];
  assert.match(local, /№ п\/п.*ФИО.*Должность.*Числа месяца.*академ\.часы/s);
  assert.match(local, />12\.10<.*>18\.10</s);
  assert.match(local, /<mergeCell ref="D1:J1"\/>/);
  assert.match(local, /<f>IF\(L3=&quot;&quot;,&quot;&quot;,K3\*L3\)<\/f>/);  // ЗП = ак. часы × ставка
  assert.match(local, /<f>SUM\(D3:D4\)<\/f>/);

  const subFile = unzip(Buffer.from(await (await fetch(`${api.base}/admin-api/export/submissions?from=${MON}&to=${SUN}&format=xlsx`,
    { headers: { authorization: 'Basic ' + Buffer.from('admin:secret').toString('base64') } })).arrayBuffer()));
  assert.match(subFile['xl/worksheets/sheet2.xml'], /Итого уроков.*>12<.*>18</s);
});

test('выгрузка: период проверяется, неизвестный вид — 404', async () => {
  assert.equal((await get('/admin-api/export/schedule?from=2026-01-01&to=2026-05-01')).status, 400);
  assert.equal((await get(`/admin-api/export/schedule?from=${SUN}&to=${MON}`)).status, 400);
  assert.equal((await get(`/admin-api/export/other?from=${MON}&to=${SUN}`)).status, 404);
});

test('тесты учеников: доп. тест по навыкам с % и сводкой по уровням, средние Daily test; ФИО старых отметок — из HollyHop', async () => {
  const roster = (await api.request('GET', `/api/groups/9003/students?date=${h.WED}`, { tg: 6001 })).json.students;
  const full = { 1: 10, 2: 15, 3: 40, 4: 40, 5: 20, 6: 15, 7: 10, 21: 2 };              // максимум Progress Test — 152
  const weak = { 1: 0, 2: 5, 3: 20, 4: 20, 5: 10, 6: 5, 7: 5, 21: 1 };                 // 66 из 152
  const saved = await api.request('POST', '/api/lessons', { tg: 6001, body: { key: h.uuid(), groupId: '9003', date: h.WED, topic: 'Unit 1', homework: 'Ex. 1',
    personal: { categoryId: 1, testTypeId: 1 },
    students: roster.map((s, i) => ({ id: s.id, status: 'present', skills: { 13: 5, 9: 4, 10: 3 }, personalSkills: i ? weak : full })) } });
  assert.equal(saved.json.status, 'done');
  // Старая отметка — без ФИО и уровня в payload.
  await h.db.query(`INSERT INTO submissions (idem_key, teacher_id, group_id, group_name, lesson_date, slot, payload, progress, status)
    VALUES (?,?,?,?,?,?,?,?,?)`, [h.uuid(), foreign, '9002', 'English Pre-Intermediate B1', h.WED, 1,
    JSON.stringify({ topic: '', testTypeId: 131, students: [{ id: '900201', status: 'present', skills: { 8: 45, 11: 4, 9: 4, 10: 4 } }] }), '[]', 'done']);

  const rep = (await get(`/admin-api/export/tests?from=${MON}&to=${SUN}`)).json;
  const progress = rep.sheets.find(s => s.key === 'p1');
  assert.equal(progress.name, 'Progress Test');
  assert.deepEqual(progress.rows.map(r => [r.student, r.level, r.total, r.max, r.pct]),
    [[roster[0].name, 'Upper Intermediate', 152, 152, 1], [roster[1].name, 'Upper Intermediate', 66, 152, 0.4342]].sort((a, b) => a[0].localeCompare(b[0], 'ru')));
  assert.deepEqual(rep.summary, [{ key: 'p1', name: 'Progress Test', levels: [{ level: 'Upper Intermediate', count: 2, good: 1, mid: 0, bad: 1 }] }]);

  const daily = rep.sheets.find(s => s.key === 'daily');
  const old = daily.rows.find(r => r.group === 'English Pre-Intermediate B1');
  assert.deepEqual([old.student, old.level, old.scores, old.pct], ['Аян Сериков', 'Pre-Intermediate', { hw: 4, eng: 4, disc: 4 }, 0.8]);
  assert.ok(daily.rows.some(r => r.group === 'IELTS Intensive' && r.lessons === 1 && r.total === 12));
  assert.equal((await get('/admin-api/export/tests?from=2026-01-01&to=2026-05-01')).status, 200);   // тестам — период до года

  const files = unzip(Buffer.from(await (await fetch(`${api.base}/admin-api/export/tests?from=${MON}&to=${SUN}&format=xlsx`,
    { headers: { authorization: 'Basic ' + Buffer.from('admin:secret').toString('base64') } })).arrayBuffer()));
  assert.match(files['xl/workbook.xml'], /name="Отчет".*name="Progress Test".*name="Daily test"/);
  assert.match(files['xl/worksheets/sheet1.xml'], /Количество сдавших.*Upper Intermediate.*<f>SUM\(B\d+:B\d+\)<\/f>/s);
  assert.match(files['xl/worksheets/sheet2.xml'], /Listening.*Результат теста, %/s);
  assert.match(files['xl/worksheets/sheet2.xml'], /s="6"><v>1<\/v>/);                    // 100% — зелёный
});

test('тесты → по преподавателям и посещаемость: средний % в своём диапазоне, критерии пропусков по преподавателю и по всем', async () => {
  const insert = (teacher, group, date, slot, students, extra = {}) => h.db.query(
    `INSERT INTO submissions (idem_key, teacher_id, group_id, group_name, lesson_date, slot, payload, progress, status) VALUES (?,?,?,?,?,?,?,?,?)`,
    [h.uuid(), teacher, group, `G${group}`, date, slot, JSON.stringify({ topic: 'x', testTypeId: 132, students, ...extra }), '[]', 'done']);
  const st = (id, name, status, hw = 5) => ({ id, name, status, ...(status === 'present' ? { skills: { 8: 45, 13: hw, 9: hw, 10: hw } } : {}) });
  h.mock.state.rosters['1'] = ['1', '2', '3'].map(id => ({ StudentClientId: Number(id), BeginDate: '2026-01-01' }));   // все трое сейчас в группе
  // Иванова, группа 1: Аня — 5/5 и 4/5 (90%), Боря — 1 пропуск из 2 и 70% (+ доп. тест 66/152 → в среднем 57%), Вика — 3/5 (60%).
  await insert(local, '1', '2026-09-07', 1, [st('1', 'Аня', 'present'), st('2', 'Боря', 'absent'), st('3', 'Вика', 'present', 3)]);
  await insert(local, '1', '2026-09-09', 1, [st('1', 'Аня', 'present', 4), { ...st('2', 'Боря', 'present', 3.5),
    personalSkills: { 1: 0, 2: 5, 3: 20, 4: 20, 5: 10, 6: 5, 7: 5, 21: 1 } }, st('3', 'Вика', 'absent')], { personal: { categoryId: 1, testTypeId: 1 } });
  // Smith отметил тот же урок вторым: у него у Ани пропуск; в «все» урок считается один раз — по первой отметке.
  await insert(foreign, '1', '2026-09-09', 2, [st('1', 'Аня', 'absent'), st('3', 'Вика', 'absent')]);
  const range = 'from=2026-09-01&to=2026-09-20';

  const res = (await get(`/admin-api/export/tests?${range}`)).json;
  const ivanova = res.byTeacher.find(t => t.id === String(local));
  assert.deepEqual(ivanova.rows.map(r => [r.student, r.results, r.pct, r.band]),
    [['Аня', 2, 0.9, 'good'], ['Боря', 2, 0.5671, 'bad'], ['Вика', 1, 0.6, 'bad']]);
  assert.equal(res.byTeacher.find(t => t.id === String(foreign)), undefined, 'без тестов преподавателя нет в списке');

  const [all, ...teachers] = res.attendance.scopes;
  assert.equal(all.id, 'all');
  assert.deepEqual(all.counts, { one: 2, two: 0, p15: 2, p30: 2, p50: 2 });   // Боря и Вика — по 1 из 2; Ане пропуск Smith не засчитан
  assert.deepEqual(all.rows.map(r => [r.student, r.lessons, r.absent, r.rate]), [['Боря', 2, 1, 0.5], ['Вика', 2, 1, 0.5]]);
  const smith = teachers.find(t => t.id === String(foreign));
  assert.deepEqual([smith.students, smith.counts.one, smith.counts.p50], [2, 2, 2]);

  const auth = { headers: { authorization: 'Basic ' + Buffer.from('admin:secret').toString('base64') } };
  const xlsxOf = async url => unzip(Buffer.from(await (await fetch(`${api.base}/admin-api/export/${url}&format=xlsx`, auth)).arrayBuffer()));
  const resFile = await xlsxOf(`tests?${range}&resultsTeacher=${local}`);
  assert.match(resFile['xl/workbook.xml'], /name="Отчет".*name="Progress Test".*name="Daily test".*name="По преподавателям"/);
  const byTeacher = resFile['xl/worksheets/sheet4.xml'];
  assert.match(byTeacher, /01\.09\.2026 — 20\.09\.2026 · Иванова Анна.*ФИО ученика.*≥80%.*70–79%.*&lt;70%.*Аня.*s="6"><v>0\.9<\/v>.*<f>COUNT\(B4:B6\)<\/f>/s);
  assert.doesNotMatch(byTeacher, /Smith/);
  assert.match((await xlsxOf(`tests?${range}`))['xl/worksheets/sheet4.xml'], /Иванова Анна.*Аня/s, 'без преподавателя — все');
  const attFile = await xlsxOf(`tests?${range}&attendanceTeacher=all`);
  assert.match(attFile['xl/workbook.xml'], /name="По преподавателям".*name="Посещаемость".*name="Пропуски учеников"/);
  assert.match(attFile['xl/worksheets/sheet5.xml'], /Все преподаватели.*Критерий.*Кол-во.*1 пропуск.*2 пропуска.*≥15% пропусков.*≥30% пропусков.*≥50% пропусков/s);
  assert.match(attFile['xl/worksheets/sheet6.xml'], /Боря.*G1.*Вика/s);
  assert.match((await xlsxOf(`tests?${range}&attendanceTeacher=${foreign}`))['xl/worksheets/sheet5.xml'], /Smith John/);

  // Фильтры: преподаватель, город, уровень — на всех вкладках; варианты фильтров — за весь период.
  assert.deepEqual(res.options.teachers.map(t => t.name), ['Иванова Анна', 'Smith John']);
  assert.deepEqual([res.options.cities, res.options.levels], [['—'], ['—']]);           // без филиала и уровня в отметке и в HollyHop
  const onlySmith = (await get(`/admin-api/export/tests?${range}&teacher=${foreign}`)).json;
  assert.deepEqual([onlySmith.byTeacher, onlySmith.sheets.length, onlySmith.filters.teacher], [[], 0, String(foreign)]);
  assert.deepEqual([onlySmith.attendance.scopes[0].students, onlySmith.attendance.scopes[0].counts.one], [2, 2]);   // Аня и Вика — по пропуску у Smith
  const abaya = (await get(`/admin-api/export/tests?${range}&city=${encodeURIComponent('Алматы')}`)).json;
  assert.deepEqual([abaya.byTeacher.length, abaya.attendance.scopes[0].students, abaya.options.teachers.length], [0, 0, 2]);
  assert.equal((await get(`/admin-api/export/tests?${range}&level=${encodeURIComponent('—')}`)).json.byTeacher.length, 1);
});

test('посещаемость: только текущие группы ученика (GetEdUnitStudents), уроки всех групп ученика — одной строкой', async () => {
  const insert = (group, date, students) => h.db.query(
    `INSERT INTO submissions (idem_key, teacher_id, group_id, group_name, lesson_date, slot, payload, progress, status) VALUES (?,?,?,?,?,?,?,?,?)`,
    [h.uuid(), local, group, `G${group}`, date, 1, JSON.stringify({ topic: 'x', testTypeId: 132, students }), '[]', 'done']);
  const st = (id, name, status) => ({ id, name, status });
  const now = { BeginDate: '2026-01-01' }, gone = { BeginDate: '2026-01-01', EndDate: '2026-09-15' };
  // Группа 71 — Гуля и Даня учатся сейчас; группа 72 — Гуля учится, Даня ушёл (EndDate прошла); группа 73 — Ерлан без BeginDate.
  h.mock.state.rosters['71'] = [{ StudentClientId: 701, ...now }, { StudentClientId: 702, ...now }];
  h.mock.state.rosters['72'] = [{ StudentClientId: 701, ...now }, { StudentClientId: 702, ...gone }];
  h.mock.state.rosters['73'] = [{ StudentClientId: 703 }];
  await insert('71', '2026-10-05', [st('701', 'Гуля', 'absent'), st('702', 'Даня', 'present')]);
  await insert('72', '2026-10-06', [st('701', 'Гуля', 'present'), st('702', 'Даня', 'absent')]);
  await insert('73', '2026-10-07', [st('703', 'Ерлан', 'absent')]);
  // Группу 71 переименовали в HollyHop: в старой отметке прежнее название — в отчёте одна группа с последним названием.
  await h.db.query(`UPDATE submissions SET group_name = 'G71 old' WHERE group_id = '71'`);
  await insert('71', '2026-10-08', [st('701', 'Гуля', 'present')]);

  const all = (await get('/admin-api/export/tests?from=2026-10-05&to=2026-10-11')).json.attendance.scopes[0];
  assert.equal(all.students, 2);                                                   // Ерлан не в составе — не считается
  assert.deepEqual(all.rows.map(r => [r.student, r.group, r.lessons, r.absent, r.rate]), [['Гуля', 'G71, G72', 3, 1, 0.3333]]);   // пропуск Дани в старой группе не засчитан
  assert.deepEqual(all.counts, { one: 1, two: 0, p15: 1, p30: 1, p50: 0 });
});
