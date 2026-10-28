const hollihop = require('./hollihopService');
const Substitution = require('../models/substitutionModel');
const Submission = require('../models/submissionModel');
const { isDate, todayIso } = require('../lib/date');

exports.isDate = isDate;
exports.todayIso = todayIso;

/** Свои группы преподавателя + группы, где он назначен на замену в эту дату. */
async function groupsForTeacher(teacher, date) {
  const own = teacher.hollihop_id ? await hollihop.teacherGroups(teacher.hollihop_id, date) : [];
  const ownIds = new Set(own.map(g => g.id));
  const substituteIds = teacher.id ? await Substitution.groupIdsForTeacher(teacher.id, date) : [];
  const substitutes = (await Promise.all(substituteIds.filter(id => !ownIds.has(String(id))).map(hollihop.groupById)))
    .filter(Boolean).map(g => ({ ...g, substitution: true }));
  return [...own, ...substitutes];
}

exports.groupForTeacher = async (teacher, groupId, date) =>
  (await groupsForTeacher(teacher, date)).find(g => g.id === String(groupId)) || null;

exports.canAccessGroup = async (teacher, groupId, date) => !!(await exports.groupForTeacher(teacher, groupId, date));

/** Начало занятия в минутах («9:00–10:30» → 540); без времени — в конец списка. */
const startMinutes = time => {
  const m = /^(\d{1,2}):(\d\d)/.exec(time || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : Infinity;
};

/** Занятия дня по порядку — с утра до вечера. */
exports.lessonsWithStatus = async (teacher, date) => {
  const groups = (await groupsForTeacher(teacher, date)).sort((a, b) => startMinutes(a.time) - startMinutes(b.time));
  const [summary, counts] = await Promise.all([
    Submission.summaryByGroup(date, groups.map(g => g.id), teacher.id),
    // Число актуальных учеников; не достали состав — остаётся StudentsCount из HollyHop.
    Promise.all(groups.map(g => hollihop.students(g.id).then(list => list.length, () => g.students))),
  ]);
  return groups.map(({ hasLessonOnDate, teacherId, ...g }, i) => {
    const s = summary[g.id];
    return { ...g, students: counts[i], status: s?.status || 'none', done: s?.done ?? 0, total: s?.total ?? 0 };
  });
};
