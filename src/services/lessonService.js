const hollihop = require('./hollihopService');
const Substitution = require('../models/substitutionModel');
const Submission = require('../models/submissionModel');
const { withMainTeacher, slotOf, replacedName } = require('./substitutionService');
const { isDate, todayIso } = require('../lib/date');

exports.isDate = isDate;
exports.todayIso = todayIso;

/** Свои группы преподавателя + группы, где он назначен на замену в эту дату. */
async function groupsForTeacher(teacher, date) {
  const scheduled = teacher.hollihop_id ? await hollihop.teacherGroups(teacher.hollihop_id, date) : [];
  const ownIds = new Set(scheduled.map(g => g.id));
  // Урок, на который назначена замена, у заменяемого скрыт — отмечает заменяющий. Уже отмеченный им самим остаётся.
  const replaced = scheduled.length ? await Substitution.replacedGroupIds(teacher.hollihop_id, date) : [];
  const keep = await Promise.all(scheduled.map(async g => !replaced.includes(g.id) || !!(await Submission.findByGroupAndDate(g.id, date, teacher.id))));
  const own = scheduled.filter((_, i) => keep[i]);
  const subs = (teacher.id ? await Substitution.forTeacher(teacher.id, date) : []).filter(s => !ownIds.has(String(s.group_id)));
  const groups = await withMainTeacher((await Promise.all(subs.map(s => hollihop.groupById(s.group_id, date)))).filter(Boolean));
  // Время — слот заменяемого преподавателя (в группе с местным и иностранцем у каждого своё); replaces — кого заменяет.
  const substitutes = groups.map(g => {
    const s = subs.find(x => String(x.group_id) === g.id), slot = slotOf(g, s.replaced_hh_id);
    return { ...g, time: slot?.time || g.time, substitution: true, replaces: replacedName(g, s) || null };
  });
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
