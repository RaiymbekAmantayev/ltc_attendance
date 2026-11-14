// Сводки для обзора, групп, преподавателей и профиля. Источники: наши отметки (MySQL) и HollyHop (группы, ученики).
const hollihop = require('./hollihopService');
const Submission = require('../models/submissionModel');
const Substitution = require('../models/substitutionModel');
const Teacher = require('../models/teacherModel');
const substitutionService = require('./substitutionService');
const lessonUnits = require('./lessonUnitsService');
const { lowFillThreshold } = require('../config/env');
const { todayIso, addDays, localDayOf, monthStart } = require('../lib/date');

const testing = require('../config/testing');
const personalTests = require('../config/personalTests');

/** Отметки города (по филиалу отметки); city пусто — все. */
const inCity = async (rows, city) => {
  if (!city) return rows;
  const cityOf = await hollihop.cityResolver();
  return rows.filter(r => cityOf(r.branch) === city);
};

/**
 * Доп. (персональные) тесты учеников, без ежедневного: сколько всего и сколько ≥80% от максимума;
 * byCategory — то же по каждой категории (Progress Test, Final Test, …) в порядке справочника.
 */
function personalTestsOf(rows) {
  const total = { count: 0, good: 0 };
  const byId = new Map(personalTests.categories.map(c => [c.id, { id: c.id, name: c.name, count: 0, good: 0 }]));
  for (const row of rows) {
    const p = Submission.parse(row.payload);
    const found = p.personal && personalTests.find(p.personal.categoryId, p.personal.testTypeId);
    if (!found) continue;
    const max = found.type.skills.reduce((a, k) => a + k.max, 0);
    const cat = byId.get(found.category.id);
    for (const s of p.students) {
      if (!s.personalSkills || !max) continue;
      const good = Object.values(s.personalSkills).reduce((a, v) => a + Number(v || 0), 0) / max >= 0.8 ? 1 : 0;
      total.count++; total.good += good;
      cat.count++; cat.good += good;
    }
  }
  return {
    ...total, rate: pct(total.good, total.count),
    byCategory: [...byId.values()].map(c => ({ ...c, rate: pct(c.good, c.count) })),
  };
}

/** Результат теста ученика, % от максимума: среднее по навыкам. */
const studentTestPct = (skills, typeId) => {
  const list = testing.skillsFor(typeId).map(k => (Number(skills[k.id]) / k.max) * 100);
  return list.reduce((a, b) => a + b, 0) / list.length;
};

/** Статус ученика: «опоздал» из старых отметок → «был». */
const statusOf = s => (s.status === 'absent' ? 'absent' : 'present');

const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : null);

/** Счётчики посещаемости по списку отметок. Старые отметки «опоздал» считаются присутствием. */
function attendanceOf(rows) {
  const c = { present: 0, absent: 0, tested: 0, pctSum: 0, passChecks: 0, passed: 0 };
  for (const row of rows) {
    const payload = Submission.parse(row.payload);
    for (const s of payload.students) {
      c[statusOf(s)]++;
      if (s.skills) {
        c.tested++; c.pctSum += studentTestPct(s.skills, payload.testTypeId);
        for (const k of testing.skillsFor(payload.testTypeId)) if (k.pass != null) { c.passChecks++; if (Number(s.skills[k.id]) >= k.pass) c.passed++; }
      }
    }
  }
  const total = c.present + c.absent;
  return {
    students: total, present: c.present, absent: c.absent,
    rate: pct(c.present, total),
    tests: c.tested,
    avgTest: c.tested ? Math.round((c.pctSum / c.tested) * 10) / 10 : null,
    testPassRate: pct(c.passed, c.passChecks),
  };
}

/** Отметили ли в день урока (разд. 14 ТЗ, «дисциплина»). */
const onTime = row => localDayOf(row.created_at) === row.lesson_date;

const statusCounts = rows => rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});

/** Группировка отметок по ключу с итогами. */
function groupBy(rows, keyOf) {
  const map = new Map();
  for (const row of rows) {
    const key = keyOf(row) || '—';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

/* ---------------- Обзор ---------------- */

exports.overview = async ({ from, to, city }) => {
  const rows = await inCity(await Submission.list({ from, to }), city);
  let teachers = await Teacher.findActive();
  if (city) { const cityOf = await hollihop.cityResolver(); teachers = teachers.filter(t => cityOf(t.branch) === city); }
  const att = attendanceOf(rows);
  const counts = statusCounts(rows);

  const byDay = [];
  for (let day = from, guard = 0; day <= to && guard < 93; day = addDays(day, 1), guard++) {
    byDay.push({ date: day, count: rows.filter(r => r.lesson_date === day).length });
  }
  const byBranch = [...groupBy(rows, r => r.branch || r.teacher_branch)].map(([branch, list]) => ({
    branch, lessons: list.length, attendance: attendanceOf(list).rate,
  })).sort((a, b) => b.lessons - a.lessons);

  return {
    period: { from, to },
    kpi: {
      lessons: rows.length,
      lessonsMarked: new Set(rows.map(r => `${r.group_id}:${r.lesson_date}`)).size,   // уроков (группа + дата): на урок бывает две отметки
      students: att.students,
      attendanceRate: att.rate,
      avgTest: att.avgTest,
      testPassRate: att.testPassRate,
      personalTests: personalTestsOf(rows),                               // доп. тесты: всего и ≥80%
      onTimeRate: pct(rows.filter(onTime).length, rows.length),
      syncedRate: pct(counts.done || 0, rows.length),
      activeTeachers: teachers.filter(t => t.role === 'teacher' && t.hollihop_id).length,
      teachersWorking: new Set(rows.map(r => r.teacher_id)).size,
    },
    statuses: { done: counts.done || 0, pending: counts.pending || 0, partial: counts.partial || 0, attention: counts.attention || 0 },
    attendance: att,
    byDay,
    byBranch,
    problems: rows.filter(r => r.status !== 'done').slice(0, 50).map(r => ({
      key: r.idem_key, date: r.lesson_date, group: r.group_name || r.group_id, teacher: r.full_name,
      status: r.status, error: r.last_error,
    })),
  };
};

/**
 * Занятия без отметки за период: уроки по расписанию HollyHop (до сегодня включительно) минус уроки с отметкой.
 * Урок — группа + дата; city — только группы города.
 */
exports.unmarked = async ({ from, to, city }) => {
  const end = to < todayIso() ? to : todayIso();
  if (from > end) return { expected: 0, marked: 0, unmarked: 0 };
  const [lessons, rows] = await Promise.all([hollihop.lessonsInRange(from, end), Submission.list({ from, to: end })]);
  const expected = new Set(lessons.filter(l => !city || l.city === city).map(l => `${l.groupId}:${l.date}`));
  const marked = new Set(rows.map(r => `${r.group_id}:${r.lesson_date}`));
  let unmarked = 0;
  for (const key of expected) if (!marked.has(key)) unmarked++;
  return { expected: expected.size, marked: expected.size - unmarked, unmarked };
};

/** Замены дня по группам: group_id → [замена]. */
const groupSubs = subs => {
  const by = new Map();
  for (const s of subs) { const k = String(s.group_id); if (!by.has(k)) by.set(k, []); by.get(k).push(s); }
  return by;
};

/** Кто сегодня ещё не отметил занятие: расписание из HollyHop минус наши отметки; city — только группы города. */
exports.todayBoard = async (date = todayIso(), city = '') => {
  const [all, rows, subs] = await Promise.all([hollihop.groupsOnDate(date), Submission.list({ date }), Substitution.forDate(date)]);
  const groups = city ? all.filter(g => g.city === city) : all;
  const marked = new Map(rows.map(r => [r.group_id, r]));
  const subBy = groupSubs(subs);
  const pending = groups.filter(g => !marked.has(g.id)).map(g => {
    const list = subBy.get(g.id) || [];
    return { id: g.id, name: g.name, branch: g.branch, time: g.time, teacher: substitutionService.teacherLine(g, list), substitution: list.length > 0 };
  });
  return { date, expected: groups.length, marked: groups.length - pending.length, pending };
};

/* ---------------- Группы ---------------- */

exports.groups = async date => {
  const [groups, summary, subs] = await Promise.all([
    hollihop.groupsOnDate(date).then(substitutionService.withMainTeacher), Submission.list({ date }), Substitution.forDate(date),
  ]);
  const byGroup = new Map(summary.map(r => [r.group_id, r]));
  const subBy = groupSubs(subs);
  return groups.map(g => {
    const sub = byGroup.get(g.id), list = subBy.get(g.id) || [];
    return {
      ...g,
      lowFill: g.students != null && g.students < lowFillThreshold,
      overfull: g.vacancies != null && g.vacancies < 0,
      status: sub?.status || 'none',
      // у слота — кто его заменяет (null — свободен для замены)
      slots: (g.slots || []).map(slot => ({ ...slot, substitute: list.find(s => String(s.replaced_hh_id) === slot.teacherId)?.full_name || null })),
      substitute: list.map(s => s.full_name).join(', ') || null,
      replaces: list.map(s => substitutionService.replacedName(g, s)).filter(Boolean).join(', ') || null,   // кого заменяют
    };
  });
};

/** Карточка группы: состав из HollyHop + посещаемость по нашим отметкам. */
exports.groupDetail = async (groupId, { from, to }) => {
  const [group, roster, rows] = await Promise.all([
    hollihop.groupById(groupId), hollihop.students(groupId), Submission.list({ from, to }),
  ]);
  const own = rows.filter(r => r.group_id === String(groupId));
  const perStudent = new Map();
  for (const row of own) {
    const payload = Submission.parse(row.payload);
    for (const s of payload.students) {
      const x = perStudent.get(s.id) || { present: 0, absent: 0, pctSum: 0, tested: 0 };
      x[statusOf(s)]++;
      if (s.skills) { x.pctSum += studentTestPct(s.skills, payload.testTypeId); x.tested++; }
      perStudent.set(s.id, x);
    }
  }
  return {
    group,
    lessons: own.length,
    attendance: attendanceOf(own).rate,
    topics: own.filter(r => Submission.parse(r.payload).topic).slice(0, 10)
      .map(r => ({ date: r.lesson_date, topic: Submission.parse(r.payload).topic })),
    students: roster.map(st => {
      const x = perStudent.get(st.id) || { present: 0, absent: 0, pctSum: 0, tested: 0 };
      const total = x.present + x.absent;
      return { ...st, lessons: total, absent: x.absent, rate: pct(x.present, total), avgTest: x.tested ? Math.round((x.pctSum / x.tested) * 10) / 10 : null };
    }),
  };
};

/* ---------------- Преподаватели ---------------- */

exports.teachers = async ({ from, to, city }) => {
  const [staff, all] = await Promise.all([Teacher.findAll(), Submission.list({ from, to })]);
  const rows = await inCity(all, city);
  const byTeacher = groupBy(rows, r => r.teacher_id);
  const cityOf = city ? await hollihop.cityResolver() : null;
  const unitsOf = await lessonUnits.forSubmissions(rows);               // занятие от 90 минут — два урока
  const ofCity = t => !city || cityOf(t.branch) === city;               // город преподавателя — по его филиалу в HollyHop
  return staff.filter(t => (t.role === 'teacher' && ofCity(t)) || byTeacher.has(t.id)).map(t => {
    const list = byTeacher.get(t.id) || [];
    const counts = statusCounts(list);
    const att = attendanceOf(list);
    return {
      id: t.id, name: t.full_name, branch: t.branch, lang: t.lang, active: !!t.active, hasTelegram: !!t.telegram_id,
      lessons: list.reduce((n, r) => n + unitsOf(r), 0),
      students: att.students,
      attendance: att.rate,
      onTime: pct(list.filter(onTime).length, list.length),
      done: counts.done || 0,
      problems: (counts.partial || 0) + (counts.attention || 0),
      last: list[0]?.lesson_date || null,
    };
  }).sort((a, b) => b.lessons - a.lessons || String(a.name).localeCompare(String(b.name), 'ru'));
};

/* ---------------- Профиль ---------------- */

exports.profile = async teacher => {
  const today = todayIso();
  const from = monthStart(today);
  const rows = teacher.id ? await Submission.list({ from, to: today, teacherId: teacher.id }) : [];
  const counts = statusCounts(rows);
  const att = attendanceOf(rows);
  const unitsOf = await lessonUnits.forSubmissions(rows);               // занятие от 90 минут — два урока
  return {
    month: from.slice(0, 7),
    lessons: rows.reduce((n, r) => n + unitsOf(r), 0),
    students: att.students,
    attendanceRate: att.rate,
    avgTest: att.avgTest,
    onTimeRate: pct(rows.filter(onTime).length, rows.length),
    checklist: {
      done: counts.done || 0, pending: counts.pending || 0, partial: counts.partial || 0, attention: counts.attention || 0,
    },
    recent: rows.slice(0, 10).map(r => ({
      date: r.lesson_date, groupId: r.group_id, group: r.group_name || r.group_id, status: r.status, onTime: onTime(r),
      students: Submission.parse(r.payload).students.length,
    })),
  };
};

exports._attendanceOf = attendanceOf;
