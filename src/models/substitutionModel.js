const { query } = require('../config/db');

// replaced_hh_id — HollyHop ID преподавателя, которого заменяют (в группе может быть два слота: местный и иностранец).
// NULL — старые замены на всю группу.

/** Замены преподавателя на дату: [{group_id, replaced_hh_id}]. */
exports.forTeacher = (teacherId, date) =>
  query('SELECT group_id, replaced_hh_id FROM substitutions WHERE substitute_id = ? AND lesson_date = ?', [teacherId, date]);

/** Группы, где преподавателя (HollyHop ID) в эту дату заменяют. */
exports.replacedGroupIds = async (hollihopId, date) =>
  (await query('SELECT group_id FROM substitutions WHERE replaced_hh_id = ? AND lesson_date = ?', [String(hollihopId), date]))
    .map(r => String(r.group_id));

/** Слот уже заменён (тот же урок и тот же заменяемый) — вторую замену на него не ставим. */
exports.slotTaken = async (groupId, date, replacedHhId) => !!replacedHhId && !!(await query(
  'SELECT 1 FROM substitutions WHERE group_id = ? AND lesson_date = ? AND replaced_hh_id = ? LIMIT 1',
  [String(groupId), date, String(replacedHhId)])).length;

exports.groupIdsForTeacher =async (teacherId, date) => (await exports.forTeacher(teacherId, date)).map(r => r.group_id);

exports.findRecent = () => query(
  `SELECT s.*, t.full_name FROM substitutions s JOIN teachers t ON t.id = s.substitute_id
   WHERE lesson_date >= CURDATE() - INTERVAL 7 DAY ORDER BY lesson_date DESC, s.id DESC`);

exports.forDate = date => query(
  `SELECT s.group_id, s.substitute_id, s.replaced_hh_id, t.full_name FROM substitutions s JOIN teachers t ON t.id = s.substitute_id
   WHERE lesson_date = ?`, [date]);

exports.create = ({ group_id, lesson_date, substitute_id, replaced_hh_id = null }) =>
  query('INSERT IGNORE INTO substitutions (group_id, lesson_date, substitute_id, replaced_hh_id) VALUES (?,?,?,?)',
    [group_id, lesson_date, substitute_id, replaced_hh_id || null]);

exports.remove = id => query('DELETE FROM substitutions WHERE id = ?', [id]);
exports.findById = async id => (await query('SELECT * FROM substitutions WHERE id = ?', [id]))[0] || null;
