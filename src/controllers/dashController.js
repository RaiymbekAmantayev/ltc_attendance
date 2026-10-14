// Разделы для директора и координатора (Мини-апп: Обзор · Группы · Преподаватели).
const hollihop = require('../services/hollihopService');
const stats = require('../services/statsService');
const lessons = require('../services/lessonService');
const Teacher = require('../models/teacherModel');
const Substitution = require('../models/substitutionModel');
const Audit = require('../models/auditModel');
const { AppError } = require('../middleware/errorHandler');
const { period } = require('../lib/date');

const range = req => period(req.query.from, req.query.to);
const dateOf = req => (lessons.isDate(req.query.date) ? req.query.date : lessons.todayIso());

exports.overview = async (req, res) => res.json(await stats.overview(range(req)));

// Расписание из HollyHop может быть временно недоступно — обзор от этого не должен падать.
exports.today = async (req, res) => {
  try { res.json(await stats.todayBoard(dateOf(req))); }
  catch (error) { res.json({ date: dateOf(req), error: error.code || 'hollihop_unavailable', expected: 0, marked: 0, pending: [] }); }
};

exports.groups = async (req, res) => res.json(await stats.groups(dateOf(req)));
exports.groupDetail = async (req, res) => res.json(await stats.groupDetail(req.params.id, range(req)));
exports.teachers = async (req, res) => res.json(await stats.teachers(range(req)));

exports.staff = async (req, res) => res.json((await Teacher.findActive())
  .filter(t => t.role === 'teacher' && t.hollihop_id).map(t => ({ id: t.id, name: t.full_name, branch: t.branch })));

exports.substitutions = async (req, res) => res.json(await Substitution.findRecent());

exports.addSubstitution = async (req, res) => {
  const { group_id, lesson_date, substitute_id } = req.body || {};
  if (!group_id || !lessons.isDate(lesson_date) || !substitute_id) throw new AppError(400, 'bad_request');
  const substitute = await Teacher.findById(substitute_id);
  if (!substitute || !substitute.active) throw new AppError(400, 'bad_teacher');
  await Substitution.create({ group_id, lesson_date, substitute_id });
  await Audit.log(substitute.id, 'substitution_add', group_id, lesson_date, {}, `tg:${req.teacher.telegram_id}`);
  res.json({ ok: 1 });
};

exports.removeSubstitution = async (req, res) => {
  const row = await Substitution.findById(req.params.id);
  if (row) {
    await Substitution.remove(row.id);
    await Audit.log(row.substitute_id, 'substitution_remove', row.group_id, row.lesson_date, {}, `tg:${req.teacher.telegram_id}`);
  }
  res.json({ ok: 1 });
};

exports.hollihopGroup = id => hollihop.groupById(id);
