const { query } = require('../config/db');

/** actor — кто совершил действие: преподаватель (teacherId) либо строка вроде 'admin' / 'tg:123'. */
exports.log = (teacherId, action, groupId, date, detail = {}, actor = null) => query(
  'INSERT INTO audit_log (teacher_id, actor, action, group_id, lesson_date, detail) VALUES (?,?,?,?,?,?)',
  [teacherId, actor, action, groupId || null, date || null, JSON.stringify(detail)]);

exports.latest = ({ limit = 300, action } = {}) => query(
  `SELECT a.*, t.full_name FROM audit_log a LEFT JOIN teachers t ON t.id = a.teacher_id
   ${action ? 'WHERE a.action = ?' : ''} ORDER BY a.id DESC LIMIT ?`, action ? [action, limit] : [limit]);

exports.purgeOlderThan = days =>
  query('DELETE FROM audit_log WHERE created_at < NOW() - INTERVAL ? DAY', [days]);
