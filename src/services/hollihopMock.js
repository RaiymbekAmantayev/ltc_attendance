// Демо-режим HollyHop (HH_MOCK=1): отвечает в формате API 2.0 тестовыми данными, записи копит в памяти.
// Нужен, чтобы разрабатывать и показывать кабинет без ключей и песочницы, и для автотестов.
const TEACHERS = [
  { Id: 101, LastName: 'Иванова', FirstName: 'Анна', Fired: false, Offices: [{ Name: 'Абая' }] },
  { Id: 102, LastName: 'Смит', FirstName: 'John', Fired: false, Offices: [{ Name: 'Хайвилл' }] },
  { Id: 103, LastName: 'Сатпаева', FirstName: 'Алия', Fired: false, Offices: [{ Name: 'Абая' }] },
  { Id: 104, LastName: 'Петров', FirstName: 'Игорь', Fired: true, Offices: [] },
];
const WEEKDAYS = { work: 31, odd: 21, even: 42 };            // Пн–Пт, Пн/Ср/Пт, Вт/Чт/Сб
const item = (weekdays, from, to, teacher) => ({
  Weekdays: weekdays, BeginTime: from, EndTime: to, TeacherIds: [teacher], Teacher: nameOf(teacher),
});
const nameOf = id => { const t = TEACHERS.find(x => x.Id === id); return `${t.LastName} ${t.FirstName}`; };

const EDUNITS = [
  { Id: 9001, Name: 'English Elementary A1', OfficeOrCompanyName: 'Абая', StudentsCount: 6, Vacancies: 4, Level: 'Elementary', Discipline: 'English', ScheduleItems: [item(WEEKDAYS.odd, '10:00', '11:30', 101)] },
  { Id: 9002, Name: 'English Pre-Intermediate B1', OfficeOrCompanyName: 'Хайвилл', StudentsCount: 8, Vacancies: 2, Level: 'Pre-Intermediate', Discipline: 'English', ScheduleItems: [item(WEEKDAYS.odd, '12:00', '13:30', 102)] },
  { Id: 9003, Name: 'IELTS Intensive', OfficeOrCompanyName: 'Абая', StudentsCount: 2, Vacancies: 8, Level: 'Upper-Intermediate', Discipline: 'IELTS', ScheduleItems: [item(WEEKDAYS.work, '15:00', '16:30', 101)] },
  { Id: 9004, Name: 'Русский для иностранцев', OfficeOrCompanyName: 'Хайвилл', StudentsCount: 11, Vacancies: -1, Level: 'Beginner', Discipline: 'Russian', ScheduleItems: [item(WEEKDAYS.even, '18:00', '19:30', 103)] },
  { Id: 9005, Name: 'Kids Starter', OfficeOrCompanyName: 'Абая', StudentsCount: 7, Vacancies: 3, Level: 'Starter', Discipline: 'English', ScheduleItems: [item(WEEKDAYS.work, '09:00', '10:00', 103)] },
];
const STUDENT_NAMES = ['Аян Сериков', 'Мира Ахметова', 'Тимур Бекенов', 'Дина Оспанова', 'Alex Brown', 'Лейла Нурпеисова',
  'Руслан Ким', 'Сабина Жумабаева', 'Данияр Тулеубеков', 'Emma Davis', 'Амина Касымова'];

// Учебная единица 31 — тестовая (как в песочнице HollyHop): занятия каждый день.
EDUNITS.push({ Id: 31, Name: 'TEST · Sandbox group', OfficeOrCompanyName: 'Абая', StudentsCount: 3, Vacancies: 5, Level: 'Test', Discipline: 'English', ScheduleItems: [item(127, '09:00', '10:00', 101)] });
const SKILLS_BY_TYPE = { 131: { 8: 45, 11: 5, 17: 5 }, 132: { 8: 45, 13: 5, 18: 5 } };   // набор навыков и максимумы каждого типа теста
const TEST_TYPES = [131, 132];

const state = { writes: [], tests: [], failures: [] };

/** Для тестов: следующий вызов метода завершится ошибкой {status, body}. */
const failNext = (method, failure) => state.failures.push({ method, ...failure });
const reset = () => { state.writes = []; state.tests = []; state.failures = []; };

const ok = body => ({ status: 200, body });

async function respond(method, payload) {
  const index = state.failures.findIndex(f => f.method === method);
  if (index >= 0) { const f = state.failures.splice(index, 1)[0]; return { status: f.status || 500, body: f.body ?? { Error: f.error || 'mock failure' }, headers: f.headers }; }

  switch (method) {
    case 'GetEdUnits': {
      let units = EDUNITS;
      if (payload.id) units = units.filter(u => String(u.Id) === String(payload.id));
      if (payload.teacherId) units = units.filter(u => u.ScheduleItems.some(i => i.TeacherIds.map(String).includes(String(payload.teacherId))));
      return ok({ EdUnits: units, Now: new Date().toISOString() });
    }
    case 'GetEdUnitStudents': {
      const unit = EDUNITS.find(u => String(u.Id) === String(payload.edUnitId));
      const count = unit ? unit.StudentsCount : 0;
      const rows = Array.from({ length: count }, (_, i) => ({
        StudentClientId: unit.Id * 100 + i + 1, StudentName: STUDENT_NAMES[i % STUDENT_NAMES.length],
      }));
      return ok({ EdUnitStudents: rows });
    }
    case 'GetTeachers':
      return ok({ Teachers: TEACHERS });
    case 'SetStudentPasses':
      state.writes.push(...(Array.isArray(payload) ? payload : [payload]));
      return ok({ Success: true });
    case 'AddEditEdUnitTestResult': {
      // Те же проверки, что у HollyHop: тип теста, полный набор навыков, баллы не выше максимума.
      if (!TEST_TYPES.includes(payload.testTypeId)) return { status: 400, body: { Error: 'Неизвестный тип теста' } };
      const SKILLS = SKILLS_BY_TYPE[payload.testTypeId];
      const ids = (payload.skills || []).map(k => k.skillId).sort((a, b) => a - b).join(',');
      if (ids !== Object.keys(SKILLS).join(',')) return { status: 400, body: { Error: 'Набор навыков не соответствует типу теста' } };
      if (payload.skills.some(k => !(k.score >= 0) || k.score > SKILLS[k.skillId])) return { status: 400, body: { Error: 'Баллы превышают максимум' } };
      if (!payload.edUnitId || !payload.studentClientId || !payload.date) return { status: 400, body: { Error: 'Не заполнены обязательные поля' } };
      state.tests.push(payload);
      return ok({ Success: true });
    }
    default:
      return { status: 404, body: { Error: 'unknown method ' + method } };
  }
}

module.exports = { respond, failNext, reset, state, EDUNITS, TEACHERS };
