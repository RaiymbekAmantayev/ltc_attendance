// КТП (календарно-тематический план): категории и темы по уровням.
const { query } = require('../config/db');

/** Колонки темы в порядке таблицы КТП (так же идёт вставка из Excel в админке). */
const FIELDS = ['num', 'week', 'day', 'lesson', 'teacher', 'section', 'sb_page', 'title', 'role', 'grammar', 'vocabulary', 'homework', 'test_control'];
const MAX = { week: 32, day: 32, lesson: 32, teacher: 100, section: 255, sb_page: 50, title: 500, role: 255, grammar: 500, vocabulary: 500, homework: 1000, test_control: 500 };

const clean = (v, max) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));
const toInt = v => (/^\s*\d+\s*$/.test(String(v ?? '')) ? Number(v) : null);

exports.FIELDS = FIELDS;

/** Приводит тему к строке таблицы (без category_id и level). */
exports.toRow = f => FIELDS.map(k => (k === 'num' ? toInt(f.num) : clean(f[k], MAX[k])));

const ORDER = 'ORDER BY t.num IS NULL, t.num, t.id';

// ── Категории ──
exports.categories = () => query(
  `SELECT c.id, c.name, c.sort, COUNT(t.id) topics FROM ktp_categories c
   LEFT JOIN ktp_topics t ON t.category_id = c.id GROUP BY c.id ORDER BY c.sort, c.id`);
exports.categoryById = async id => (await query('SELECT * FROM ktp_categories WHERE id = ?', [id]))[0] || null;
exports.createCategory = async name => {
  const [{ next }] = await query('SELECT COALESCE(MAX(sort), 0) + 1 next FROM ktp_categories');
  return query('INSERT INTO ktp_categories (name, sort) VALUES (?, ?)', [name, next]);
};
exports.renameCategory = (id, name) => query('UPDATE ktp_categories SET name = ? WHERE id = ?', [name, id]);
exports.removeCategory = id => query('DELETE FROM ktp_categories WHERE id = ?', [id]);

// ── Темы ──
exports.topics = ({ categoryId, level } = {}) => {
  const where = [], params = [];
  if (categoryId) { where.push('t.category_id = ?'); params.push(categoryId); }
  if (level)      { where.push('t.level = ?');       params.push(level); }
  return query(`SELECT t.* FROM ktp_topics t ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ${ORDER}`, params);
};
exports.topicById = async id => (await query('SELECT * FROM ktp_topics WHERE id = ?', [id]))[0] || null;

exports.createTopics = (categoryId, level, list) => query(
  `INSERT INTO ktp_topics (category_id, level, ${FIELDS.join(', ')}) VALUES ?`,
  [list.map(f => [categoryId, level, ...exports.toRow(f)])]);

exports.updateTopic = (id, categoryId, level, fields) => query(
  `UPDATE ktp_topics SET category_id = ?, level = ?, ${FIELDS.map(k => k + ' = ?').join(', ')} WHERE id = ?`,
  [categoryId, level, ...exports.toRow(fields), id]);

exports.removeTopic = id => query('DELETE FROM ktp_topics WHERE id = ?', [id]);
exports.removeTopics = (categoryId, level) => query('DELETE FROM ktp_topics WHERE category_id = ? AND level = ?', [categoryId, level]);

/** Для преподавателя: темы уровня, сгруппированные по категориям (пустые категории не возвращаются). */
exports.forLevel = async level => {
  if (!level) return [];
  const rows = await query(
    `SELECT t.*, c.name category_name FROM ktp_topics t JOIN ktp_categories c ON c.id = t.category_id
     WHERE t.level = ? ORDER BY c.sort, c.id, t.num IS NULL, t.num, t.id`, [level]);
  const byCategory = new Map();
  for (const r of rows) {
    if (!byCategory.has(r.category_id)) byCategory.set(r.category_id, { id: r.category_id, name: r.category_name, topics: [] });
    const { category_id, category_name, level: _, ...topic } = r;
    byCategory.get(r.category_id).topics.push(topic);
  }
  return [...byCategory.values()];
};
