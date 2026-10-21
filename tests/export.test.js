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
  // 31 — каждый день 09:00–10:00, 9001 — Пн/Ср/Пт 10:00–11:30, 9003 — будни 15:00–16:30
  assert.equal(ivanova.name, 'Иванова Анна');
  assert.equal(ivanova.position, 'преподаватель');
  assert.equal(ivanova.counts[MON], 3); assert.equal(ivanova.counts['2026-10-13'], 2); assert.equal(ivanova.counts[SUN], 1);
  assert.equal(ivanova.lessons, 15);
  assert.equal(ivanova.hours, 25.33);                     // (7·60 + 3·90 + 5·90) / 45
  assert.deepEqual(rep.sheets.find(s => s.key === 'foreign').rows.map(r => [r.name, r.lessons]), [['Smith John', 3]]);
  assert.deepEqual([satpaeva.name, satpaeva.lessons], ['Сатпаева Алия', 8]);   // нет в реестре: имя из GetTeachers, лист — по кириллице
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
  const saved = await api.request('POST', '/api/lessons', { tg: 6001, body: { key: h.uuid(), groupId: '9001', date: h.WED, topic: '',
    students: roster.map(s => ({ id: s.id, status: 'present', skills: { 13: 5, 9: 5, 10: 5 } })) } });
  assert.equal(saved.json.status, 'done');
  const rep = (await get(`/admin-api/export/submissions?from=${MON}&to=${SUN}`)).json;
  assert.deepEqual(rep.sheets.map(s => s.key), ['foreign', 'local']);
  assert.deepEqual(rep.sheets[1].rows.map(r => [r.name, r.counts[h.WED], r.lessons]), [['Иванова Анна', 1, 1]]);

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
