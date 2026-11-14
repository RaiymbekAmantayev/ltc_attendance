// Результаты тестов, которые после исправления отметки нужно удалить в HollyHop вручную (в API 2.0 нет метода удаления).
const { query } = require('../config/db');

exports.addMany = (conn, rows) => (rows.length ? conn.query(
  `INSERT INTO hh_cleanup (submission_key, teacher_id, group_id, lesson_date, group_name, student_id, student_name, kind, test_type_id, result_id, date_time)
   VALUES ?`, [rows.map(r => [r.submissionKey, r.teacherId, r.groupId, r.date, r.groupName || null, r.studentId, r.studentName || null,
    r.kind, r.testTypeId ?? null, r.resultId != null ? String(r.resultId) : null, r.dateTime || null])]) : null);

exports.list = ({ status } = {}) => query(
  `SELECT c.*, t.full_name FROM hh_cleanup c LEFT JOIN teachers t ON t.id = c.teacher_id
   ${status ? 'WHERE c.status = ?' : ''} ORDER BY (c.status = 'pending') DESC, c.id DESC LIMIT 1000`, status ? [status] : []);

exports.markDone = async id => (await query(
  "UPDATE hh_cleanup SET status = 'done', done_at = UTC_TIMESTAMP() WHERE id = ? AND status = 'pending'", [id])).affectedRows === 1;

exports.countPending = async () => Number((await query("SELECT COUNT(*) n FROM hh_cleanup WHERE status = 'pending'"))[0].n);
