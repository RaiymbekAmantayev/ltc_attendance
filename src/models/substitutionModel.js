const { query } = require('../config/db');

exports.groupIdsForTeacher = async (teacherId, date) =>
  (await query('SELECT group_id FROM substitutions WHERE substitute_id = ? AND lesson_date = ?', [teacherId, date]))
    .map(r => r.group_id);

exports.findRecent = () => query(
  `SELECT s.*, t.full_name FROM substitutions s JOIN teachers t ON t.id = s.substitute_id
   WHERE lesson_date >= CURDATE() - INTERVAL 7 DAY ORDER BY lesson_date DESC, s.id DESC`);

exports.forDate = date => query(
  `SELECT s.group_id, s.substitute_id, t.full_name FROM substitutions s JOIN teachers t ON t.id = s.substitute_id
   WHERE lesson_date = ?`, [date]);

exports.create = ({ group_id, lesson_date, substitute_id }) =>
  query('INSERT IGNORE INTO substitutions (group_id, lesson_date, substitute_id) VALUES (?,?,?)',
    [group_id, lesson_date, substitute_id]);

exports.remove = id => query('DELETE FROM substitutions WHERE id = ?', [id]);
exports.findById = async id => (await query('SELECT * FROM substitutions WHERE id = ?', [id]))[0] || null;
