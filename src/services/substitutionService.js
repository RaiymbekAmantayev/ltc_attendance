const hollihop = require('./hollihopService');
const Substitution = require('../models/substitutionModel');
const Teacher = require('../models/teacherModel');

/** «9:00» → 540; без времени — null. */
const minutes = time => {
  const m = /^(\d{1,2}):(\d\d)/.exec(time || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const overlap = (a, b) => minutes(a.from) < minutes(b.to) && minutes(b.from) < minutes(a.to);

/** Строки расписания, которые закрывает замена: слот заменяемого преподавателя; без него (старые замены) — вся группа. */
const coveredItems = (schedule, groupId, replacedHhId) => {
  const group = schedule.filter(x => x.groupId === String(groupId));
  const own = replacedHhId ? group.filter(x => x.teacherIds.includes(String(replacedHhId))) : [];
  return own.length ? own : group;
};

/**
 * Кто из преподавателей занят во время замены: { teacherId: [{groupId, group, time}] }.
 * Время замены — слот заменяемого (replacedHhId), иначе всё занятие группы в эту дату.
 * Занят — своё занятие по расписанию HollyHop или уже назначенная замена, пересекающиеся по времени.
 * Преподаватели без HollyHop ID по расписанию не проверяются.
 */
exports.busyTeachers = async (groupId, date, replacedHhId = null) => {
  const [schedule, subs, staff] = await Promise.all([hollihop.scheduleOnDate(date), Substitution.forDate(date), Teacher.findActive()]);
  const target = coveredItems(schedule, groupId, replacedHhId);
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
    // та же замена (переназначение) — не занятость
    if (String(s.group_id) === String(groupId) && (!s.replaced_hh_id || !replacedHhId || String(s.replaced_hh_id) === String(replacedHhId))) continue;
    for (const item of coveredItems(schedule, s.group_id, s.replaced_hh_id)) if (clashes(item)) add(s.substitute_id, item);
  }
  return busy;
};

/** Слот заменяемого в группе: {teacherId, teacher, time} или null. */
exports.slotOf = (group, replacedHhId) =>
  (replacedHhId && group?.slots?.find(s => s.teacherId === String(replacedHhId))) || null;

/** Кто ведёт группу с учётом замен: в слоте заменяемого — заменяющий; старая замена без слота — на всю группу. */
exports.teacherLine = (group, subs) => {
  if (!subs.length) return group.teacher;
  if (subs.some(s => !exports.slotOf(group, s.replaced_hh_id))) return subs.map(s => s.full_name).join(', ');
  return group.slots.map(slot => subs.find(s => String(s.replaced_hh_id) === slot.teacherId)?.full_name || slot.teacher).join(', ');
};

/** Кого заменяют: ФИО из слота, иначе — основной преподаватель группы. */
exports.replacedName = (group, s) => exports.slotOf(group, s.replaced_hh_id)?.teacher || group?.teacher || '';

/** Группы с ФИО основного преподавателя: из расписания HollyHop, иначе — из реестра по HollyHop ID. */
exports.withMainTeacher = async groups => {
  const missing = groups.some(g => !g.teacher && g.teacherId);
  const byHollihopId = missing
    ? new Map((await Teacher.findAll()).filter(t => t.hollihop_id).map(t => [String(t.hollihop_id), t.full_name])) : new Map();
  return groups.map(g => ({ ...g, teacher: g.teacher || byHollihopId.get(g.teacherId) || '' }));
};

/** Последние замены с группой из HollyHop: название, филиал, уровень, кого заменяют (replaces) и время его слота (time). */
exports.recent = async () => {
  const subs = await Substitution.findRecent();
  const keyOf = s => `${s.group_id}|${String(s.lesson_date).slice(0, 10)}`;
  const keys = [...new Set(subs.map(keyOf))], found = [];
  for (let i = 0; i < keys.length; i += 4) {
    found.push(...await Promise.all(keys.slice(i, i + 4).map(k => {
      const [id, date] = k.split('|');
      return hollihop.groupById(id, date).then(g => g && { ...g, key: k }, () => null);
    })));
  }
  const groups = new Map((await exports.withMainTeacher(found.filter(Boolean))).map(g => [g.key, g]));
  return subs.map(s => {
    const g = groups.get(keyOf(s)), slot = exports.slotOf(g, s.replaced_hh_id);
    return { ...s, group_name: g?.name || null, branch: g?.branch || '', level: g?.level || '',
      replaces: exports.replacedName(g, s), time: slot?.time || g?.time || '' };
  });
};

/** Текст причины: «занят 10:00–11:30 · English Elementary A1». */
exports.busyText = list => 'занят ' + list.map(x => `${x.time} · ${x.group}`).join('; ');
