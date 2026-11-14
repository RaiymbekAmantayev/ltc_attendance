// Запросы преподавателей на исправление своей отметки (одобряет админка).
const { query } = require('../config/db');

const SELECT = `SELECT r.*, t.full_name, t.telegram_id FROM edit_requests r LEFT JOIN teachers t ON t.id = r.teacher_id`;

exports.create = ({ submissionKey, teacherId, groupId, date, groupName, reason }) => query(
  `INSERT INTO edit_requests (submission_key, teacher_id, group_id, lesson_date, group_name, reason) VALUES (?,?,?,?,?,?)`,
  [submissionKey, teacherId, groupId, date, groupName || null, reason]);

exports.byId = async id => (await query(`${SELECT} WHERE r.id = ?`, [id]))[0] || null;

/** Последний запрос по отметке; active — ожидает решения или одобрен и ещё не истёк. */
exports.latestFor = async submissionKey => {
  const row = (await query(
    `SELECT r.*, (r.status = 'approved' AND r.expires_at > UTC_TIMESTAMP()) AS open
     FROM edit_requests r WHERE r.submission_key = ? ORDER BY r.id DESC LIMIT 1`, [submissionKey]))[0];
  return row ? { ...row, open: !!Number(row.open) } : null;
};

exports.list = ({ status } = {}) => query(
  `SELECT r.*, t.full_name, (r.status = 'approved' AND r.expires_at <= UTC_TIMESTAMP()) AS expired
   FROM edit_requests r LEFT JOIN teachers t ON t.id = r.teacher_id
   ${status ? 'WHERE r.status = ?' : ''} ORDER BY (r.status = 'pending') DESC, r.id DESC LIMIT 500`, status ? [status] : []);

/** Решение админки — только по запросу в статусе «ожидает». Возвращает true, если статус сменился. */
exports.decide = async (id, approve, note, hours) => (await query(
  `UPDATE edit_requests SET status = ?, admin_note = ?, decided_at = UTC_TIMESTAMP(),
     expires_at = IF(?, UTC_TIMESTAMP() + INTERVAL ? HOUR, NULL) WHERE id = ? AND status = 'pending'`,
  [approve ? 'approved' : 'rejected', note || null, approve ? 1 : 0, hours, id])).affectedRows === 1;

/** Захват одобрения под одно нажатие «Сохранить исправление» (в транзакции conn). */
exports.claim = async (conn, id, editKey) => (await conn.query(
  `UPDATE edit_requests SET status = 'used', used_at = UTC_TIMESTAMP(), edit_key = ?
   WHERE id = ? AND status = 'approved' AND expires_at > UTC_TIMESTAMP()`, [editKey, id]))[0].affectedRows === 1;

exports.findByEditKey = async editKey => (await query('SELECT * FROM edit_requests WHERE edit_key = ?', [editKey]))[0] || null;

exports.countPending = async () => Number((await query("SELECT COUNT(*) n FROM edit_requests WHERE status = 'pending'"))[0].n);
