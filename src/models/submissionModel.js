const { query } = require('../config/db');
const coins = require('../config/coins');

exports.parse = v => (typeof v === 'string' ? JSON.parse(v) : v);

exports.create = ({ key, teacherId, groupId, groupName, branch, date, slot, payload }) => query(
  `INSERT INTO submissions (idem_key, teacher_id, group_id, group_name, branch, lesson_date, slot, payload, progress)
   VALUES (?,?,?,?,?,?,?,?,?)`,
  [key, teacherId, groupId, groupName || null, branch || null, date, slot, JSON.stringify(payload), '[]']);

exports.findByKey = async key =>
  (await query('SELECT * FROM submissions WHERE idem_key = ?', [key]))[0] || null;

/** Все отметки урока (не больше двух: от местного и от иностранного преподавателя) с языком автора. */
exports.listByGroupAndDate = (groupId, date) => query(
  `SELECT x.*, t.lang AS teacher_lang FROM submissions x JOIN teachers t ON t.id = x.teacher_id
   WHERE x.group_id = ? AND x.lesson_date = ? ORDER BY x.slot`, [groupId, date]);

/** Отметка урока, сделанная этим преподавателем. */
exports.findByGroupAndDate = async (groupId, date, teacherId) =>
  (await query('SELECT * FROM submissions WHERE group_id = ? AND lesson_date = ? AND teacher_id = ?', [groupId, date, teacherId]))[0] || null;

/** Статусы и прогресс отметок преподавателя по группам на дату: { groupId: {status, done, total} }. */
exports.summaryByGroup = async (date, groupIds, teacherId) => {
  if (!groupIds.length) return {};
  const rows = await query(
    'SELECT group_id, status, payload, progress FROM submissions WHERE lesson_date = ? AND group_id IN (?) AND teacher_id = ?',
    [date, groupIds, teacherId]);
  return Object.fromEntries(rows.map(r => {
    const { total, done } = exports.progressOf(r);
    return [r.group_id, { status: r.status, done, total }];
  }));
};

/** Сколько шагов записи нужно и сколько уже выполнено (для «записано 8 из 10»). */
exports.progressOf = row => {
  const payload = exports.parse(row.payload), progress = exports.parse(row.progress) || [];
  let total = payload.topic ? 1 : 0;
  for (const s of payload.students) {
    total += 1 + (s.skills ? 1 : 0) + (s.personalSkills && payload.personal ? 1 : 0);
    if (payload.coins && coins.forStudent(s, payload) > 0) total += 1;   // отметки до появления коинов — без этого шага
  }
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
            x.created_at, x.payload, x.progress, x.teacher_id, t.full_name, t.branch AS teacher_branch,
            t.lang AS teacher_lang, t.role AS teacher_role
     FROM submissions x JOIN teachers t ON t.id = x.teacher_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY x.lesson_date DESC, x.id DESC LIMIT 5000`, params);
};

/** Отметки за период для выгрузки тестов — страницами по id (без LIMIT 5000 у list): только нужные поля. */
exports.pageForTests = (from, to, afterId, limit) => query(
  `SELECT x.id, x.group_id, x.group_name, x.branch, x.lesson_date, x.teacher_id, x.payload, t.full_name
   FROM submissions x JOIN teachers t ON t.id = x.teacher_id
   WHERE x.lesson_date BETWEEN ? AND ? AND x.id > ? ORDER BY x.id LIMIT ?`, [from, to, afterId, limit]);

/**
 * Отметки для внешнего API (/attendance-api): страница по id начиная с fromId (включительно), с фильтрами.
 * f: { dateFrom, dateTo, branch, groupId, teacherId, hhTeacherId, createdSince ('YYYY-MM-DD HH:MM:SS' UTC), clientId }.
 * clientId — грубый отбор в БД (JSON_CONTAINS по payload.students[].id), точную проверку делает вызывающий.
 */
exports.pageForApi = (f, fromId, limit) => {
  const where = ['x.id >= ?'], params = [fromId];
  if (f.dateFrom)     { where.push('x.lesson_date >= ?'); params.push(f.dateFrom); }
  if (f.dateTo)       { where.push('x.lesson_date <= ?'); params.push(f.dateTo); }
  if (f.branch)       { where.push('x.branch = ?');       params.push(f.branch); }
  if (f.groupId)      { where.push('x.group_id = ?');     params.push(f.groupId); }
  if (f.teacherId)    { where.push('x.teacher_id = ?');   params.push(f.teacherId); }
  if (f.hhTeacherId)  { where.push('t.hollihop_id = ?');  params.push(f.hhTeacherId); }
  if (f.createdSince) { where.push('x.created_at >= ?');  params.push(f.createdSince); }
  if (f.clientId) {
    where.push("(JSON_CONTAINS(x.payload, JSON_OBJECT('id', ?), '$.students') OR JSON_CONTAINS(x.payload, JSON_OBJECT('id', ?), '$.students'))");
    params.push(String(f.clientId), Number(f.clientId));
  }
  return query(
    `SELECT x.id, x.group_id, x.group_name, x.branch, x.lesson_date, x.teacher_id, x.payload, x.created_at,
            t.full_name, t.hollihop_id, t.lang
     FROM submissions x JOIN teachers t ON t.id = x.teacher_id
     WHERE ${where.join(' AND ')} ORDER BY x.id LIMIT ?`, [...params, limit]);
};

exports.countByStatus = async (from, to) => {
  const rows = await query(
    'SELECT status, COUNT(*) n FROM submissions WHERE lesson_date BETWEEN ? AND ? GROUP BY status', [from, to]);
  return Object.fromEntries(rows.map(r => [r.status, Number(r.n)]));
};
