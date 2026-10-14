const { pool, query } = require('../config/db');

const ROLES = ['teacher', 'coordinator', 'director'];
const clean = v => (v == null || String(v).trim() === '' ? null : String(v).trim());

const toRow = f => [
  clean(f.telegram_id) ? String(f.telegram_id).replace(/\D/g, '') || null : null,
  clean(f.hollihop_id),
  clean(f.full_name),
  clean(f.branch),
  f.lang === 'en' ? 'en' : 'ru',
  ROLES.includes(f.role) ? f.role : 'teacher',
  f.active === false || f.active === 0 || f.active === '0' ? 0 : 1,
];

exports.ROLES = ROLES;

exports.findActiveByTelegramId = async telegramId =>
  (await query('SELECT * FROM teachers WHERE telegram_id = ? AND active = 1', [telegramId]))[0] || null;

exports.findById = async id => (await query('SELECT * FROM teachers WHERE id = ?', [id]))[0] || null;
exports.findAll = () => query('SELECT * FROM teachers ORDER BY full_name');
exports.findActive = () => query('SELECT * FROM teachers WHERE active = 1 ORDER BY full_name');

exports.create = fields => query(
  'INSERT INTO teachers (telegram_id, hollihop_id, full_name, branch, lang, role, active) VALUES (?,?,?,?,?,?,?)',
  toRow(fields));

exports.update = (id, fields) => query(
  'UPDATE teachers SET telegram_id=?, hollihop_id=?, full_name=?, branch=?, lang=?, role=?, active=? WHERE id=?',
  [...toRow(fields), id]);

/** Добавляет преподавателей из HollyHop (неактивными). Возвращает число новых. */
exports.importFromHollihop = async list => {
  let added = 0;
  for (const t of list) {
    const [result] = await pool.query(
      `INSERT INTO teachers (hollihop_id, full_name, branch, active) VALUES (?,?,?,0)
       ON DUPLICATE KEY UPDATE full_name = VALUES(full_name)`, [t.id, t.name, t.branch]);
    if (result.affectedRows === 1) added++;
  }
  return added;
};
