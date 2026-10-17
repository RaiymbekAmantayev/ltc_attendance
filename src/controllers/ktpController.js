// Админка: КТП — категории и темы по уровням.
const Ktp = require('../models/ktpModel');
const Audit = require('../models/auditModel');
const levels = require('../config/levels');
const { AppError } = require('../middleware/errorHandler');

const ACTOR = 'admin';
const MAX_IMPORT = 2000;

const categoryName = body => {
  const name = String(body?.name || '').trim().slice(0, 100);
  if (!name) throw new AppError(400, 'Введите название категории');
  return name;
};

/** Категория и уровень темы: категория должна существовать, уровень — из списка КТП. */
async function target(body) {
  const category = await Ktp.categoryById(Number(body.category_id));
  if (!category) throw new AppError(400, 'Выберите категорию');
  const level = levels.LEVELS.includes(body.level) ? body.level : null;
  if (!level) throw new AppError(400, 'Выберите уровень');
  return { category, level };
}

const duplicate = error => {
  if (error.code === 'ER_DUP_ENTRY') throw new AppError(409, 'Категория с таким названием уже есть');
  throw error;
};

exports.levels = (req, res) => res.json(levels.LEVELS);

// ── Категории ──
exports.listCategories = async (req, res) => res.json(await Ktp.categories());

exports.saveCategory = async (req, res) => {
  const body = req.body || {}, name = categoryName(body);
  if (body.id) {
    const before = await Ktp.categoryById(Number(body.id));
    if (!before) throw new AppError(404, 'Категория не найдена');
    await Ktp.renameCategory(before.id, name).catch(duplicate);
    await Audit.log(null, 'ktp_category_rename', null, null, { id: before.id, from: before.name, to: name }, ACTOR);
  } else {
    await Ktp.createCategory(name).catch(duplicate);
    await Audit.log(null, 'ktp_category_add', null, null, { name }, ACTOR);
  }
  res.json({ ok: 1 });
};

exports.removeCategory = async (req, res) => {
  const category = await Ktp.categoryById(Number(req.params.id));
  if (!category) return res.json({ ok: 1 });
  if ((await Ktp.topics({ categoryId: category.id })).length) throw new AppError(409, 'В категории есть темы — сначала удалите их');
  await Ktp.removeCategory(category.id);
  await Audit.log(null, 'ktp_category_remove', null, null, { name: category.name }, ACTOR);
  res.json({ ok: 1 });
};

// ── Темы ──
exports.listTopics = async (req, res) => res.json(await Ktp.topics({
  categoryId: Number(req.query.category) || null,
  level: levels.LEVELS.includes(req.query.level) ? req.query.level : null,
}));

exports.saveTopic = async (req, res) => {
  const body = req.body || {}, { category, level } = await target(body);
  if (!String(body.title || '').trim()) throw new AppError(400, 'Заполните «Тема / раздел книги»');
  if (body.id) {
    if (!(await Ktp.topicById(Number(body.id)))) throw new AppError(404, 'Тема не найдена');
    await Ktp.updateTopic(Number(body.id), category.id, level, body);
  } else {
    await Ktp.createTopics(category.id, level, [body]);
  }
  await Audit.log(null, body.id ? 'ktp_topic_update' : 'ktp_topic_add', null, null,
    { category: category.name, level, title: String(body.title).trim().slice(0, 100) }, ACTOR);
  res.json({ ok: 1 });
};

exports.removeTopic = async (req, res) => {
  const topic = await Ktp.topicById(Number(req.params.id));
  if (topic) {
    await Ktp.removeTopic(topic.id);
    await Audit.log(null, 'ktp_topic_remove', null, null, { level: topic.level, title: topic.title.slice(0, 100) }, ACTOR);
  }
  res.json({ ok: 1 });
};

/** Вставка строк из Excel: rows — массивы ячеек в порядке колонок КТП. replace = заменить темы этой категории и уровня. */
exports.importTopics = async (req, res) => {
  const body = req.body || {}, { category, level } = await target(body);
  const rows = Array.isArray(body.rows) ? body.rows.filter(Array.isArray) : [];
  const list = rows.map(cells => Object.fromEntries(Ktp.FIELDS.map((k, i) => [k, cells[i]])))
    .filter(f => String(f.title ?? '').trim());
  if (!list.length) throw new AppError(400, 'Нет строк с заполненной колонкой «Тема / раздел книги»');
  if (list.length > MAX_IMPORT) throw new AppError(400, `Не больше ${MAX_IMPORT} строк за раз`);
  if (body.replace) await Ktp.removeTopics(category.id, level);
  await Ktp.createTopics(category.id, level, list);
  await Audit.log(null, 'ktp_import', null, null, { category: category.name, level, added: list.length, replace: !!body.replace }, ACTOR);
  res.json({ added: list.length });
};
