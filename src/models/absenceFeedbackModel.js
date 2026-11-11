const { query } = require('../config/db');

// Обратная связь сервиса менторов: ученик (HollyHop ID) + период → статус, причина, дата обратной связи.

const FIELDS = ['student_id', 'student_name', 'group_names', 'lessons', 'period_from', 'period_to', 'status', 'reason', 'mentor', 'feedback_at'];
const UPDATED = FIELDS.filter(f => !['student_id', 'period_from', 'period_to'].includes(f));

/** Записи за тот же (ученик, период) обновляются; более старая обратная связь новую не затирает.
 * feedback_at — последним в UPDATED: MySQL присваивает по порядку, и сравнения выше должны видеть старое значение. */
exports.upsert = rows => (rows.length ? query(
  `INSERT INTO absence_feedback (${FIELDS.join(', ')}) VALUES ?
   ON DUPLICATE KEY UPDATE ${UPDATED.map(f => `${f} = IF(VALUES(feedback_at) >= feedback_at, VALUES(${f}), ${f})`).join(', ')}`,
  [rows.map(r => FIELDS.map(f => r[f] ?? null))]) : null);

/** Последняя обратная связь по каждому ученику среди периодов, пересекающихся с [from, to]: student_id → запись. */
exports.latestFor = async (from, to) => {
  const rows = await query(
    `SELECT student_id, status, reason, mentor, feedback_at, period_from, period_to FROM absence_feedback
     WHERE period_from <= ? AND period_to >= ? ORDER BY feedback_at, id`, [to, from]);
  return new Map(rows.map(r => [r.student_id, r]));
};
