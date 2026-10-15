const { query } = require('../config/db');

exports.parse = v => (typeof v === 'string' ? JSON.parse(v) : v);

exports.create = ({ key, teacherId, groupId, groupName, branch, date, payload }) => query(
  `INSERT INTO submissions (idem_key, teacher_id, group_id, group_name, branch, lesson_date, payload, progress)
   VALUES (?,?,?,?,?,?,?,?)`,
  [key, teacherId, groupId, groupName || null, branch || null, date, JSON.stringify(payload), '[]']);

exports.findByKey = async key =>
  (await query('SELECT * FROM submissions WHERE idem_key = ?', [key]))[0] || null;

exports.findByGroupAndDate = async (groupId, date) =>
  (await query('SELECT * FROM submissions WHERE group_id = ? AND lesson_date = ?', [groupId, date]))[0] || null;

/** Статусы и прогресс по группам на дату: { groupId: {status, done, total} }. */
exports.summaryByGroup = async (date, groupIds) => {
  if (!groupIds.length) return {};
  const rows = await query(
    'SELECT group_id, status, payload, progress FROM submissions WHERE lesson_date = ? AND group_id IN (?)', [date, groupIds]);
  return Object.fromEntries(rows.map(r => {
    const { total, done } = exports.progressOf(r);
    return [r.group_id, { status: r.status, done, total }];
  }));
};

/** Сколько шагов записи нужно и сколько уже выполнено (для «записано 8 из 10»). */
exports.progressOf = row => {
  const payload = exports.parse(row.payload), progress = exports.parse(row.progress) || [];
  let total = payload.topic ? 1 : 0;
  for (const s of payload.students) total += 1 + (s.skills ? 1 : 0) + (s.personalSkills && payload.personal ? 1 : 0);
  return { total, done: Math.min(progress.length, total) };
};

exports.saveProgress = (key, progress, status, error, failed) => query(
  `UPDATE submissions SET progress = ?, status = ?, last_error = ?,
     attempts = IF(?, attempts + 1, 0) WHERE idem_key = ?`,
  [JSON.stringify(progress), status, error ? error.slice(0, 500) : null, failed ? 1 : 0, key]);

exports.markForRetry = key => query(
  "UPDATE submissions SET status = 'partial', attempts = 0 WHERE idem_key = ? AND status IN ('attention','partial')", [key]);

/** Что дослать: «частично» и зависшее «ожидает» (сервер упал между сохранением и отправкой). */
exports.findRetryable = (limit = 20) => query(
  `SELECT idem_key FROM submissions
   WHERE status = 'partial' OR (status = 'pending' AND created_at < NOW() - INTERVAL 2 MINUTE)
   ORDER BY id LIMIT ?`, [limit]);

exports.list = ({ date, status, from, to, teacherId } = {}) => {
  const where = [], params = [];
  if (date)      { where.push('x.lesson_date = ?');  params.push(date); }
  if (from)      { where.push('x.lesson_date >= ?'); params.push(from); }
  if (to)        { where.push('x.lesson_date <= ?'); params.push(to); }
  if (status)    { where.push('x.status = ?');       params.push(status); }
  if (teacherId) { where.push('x.teacher_id = ?');   params.push(teacherId); }
  return query(
    `SELECT x.idem_key, x.group_id, x.group_name, x.branch, x.lesson_date, x.status, x.last_error, x.attempts,
            x.created_at, x.payload, x.progress, x.teacher_id, t.full_name, t.branch AS teacher_branch
     FROM submissions x JOIN teachers t ON t.id = x.teacher_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY x.lesson_date DESC, x.id DESC LIMIT 5000`, params);
};

exports.countByStatus = async (from, to) => {
  const rows = await query(
    'SELECT status, COUNT(*) n FROM submissions WHERE lesson_date BETWEEN ? AND ? GROUP BY status', [from, to]);
  return Object.fromEntries(rows.map(r => [r.status, Number(r.n)]));
};
