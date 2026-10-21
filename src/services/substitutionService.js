const hollihop = require('./hollihopService');
const Substitution = require('../models/substitutionModel');
const Teacher = require('../models/teacherModel');

/** «9:00» → 540; без времени — null. */
const minutes = time => {
  const m = /^(\d{1,2}):(\d\d)/.exec(time || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const overlap = (a, b) => minutes(a.from) < minutes(b.to) && minutes(b.from) < minutes(a.to);

/**
 * Кто из преподавателей занят во время занятия группы в эту дату: { teacherId: [{groupId, group, time}] }.
 * Занят — своё занятие по расписанию HollyHop (в том числе эта же группа) или уже назначенная замена в другой группе, пересекающиеся по времени.
 * Преподаватели без HollyHop ID по расписанию не проверяются.
 */
exports.busyTeachers = async (groupId, date) => {
  const [schedule, subs, staff] = await Promise.all([hollihop.scheduleOnDate(date), Substitution.forDate(date), Teacher.findActive()]);
  const target = schedule.filter(x => x.groupId === String(groupId));
  const clashes = item => target.some(t => overlap(item, t));
  const byHollihopId = new Map(staff.filter(t => t.hollihop_id).map(t => [String(t.hollihop_id), t.id]));

  const busy = {};
  const add = (teacherId, item) => {
    const list = (busy[teacherId] ||= []);
    if (!list.some(x => x.groupId === item.groupId && x.time === `${item.from}–${item.to}`)) {
      list.push({ groupId: item.groupId, group: item.group, time: `${item.from}–${item.to}` });
    }
  };
  for (const item of schedule) {
    if (!clashes(item)) continue;
    for (const id of item.teacherIds) if (byHollihopId.has(id)) add(byHollihopId.get(id), item);
  }
  for (const s of subs) {
    if (String(s.group_id) === String(groupId)) continue;
    for (const item of schedule) if (item.groupId === String(s.group_id) && clashes(item)) add(s.substitute_id, item);
  }
  return busy;
};

/** Текст причины: «занят 10:00–11:30 · English Elementary A1». */
exports.busyText = list => 'занят ' + list.map(x => `${x.time} · ${x.group}`).join('; ');
