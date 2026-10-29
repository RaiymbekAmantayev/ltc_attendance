const hollihop = require('../services/hollihopService');
const submissions = require('../services/submissionService');
const lessons = require('../services/lessonService');
const stats = require('../services/statsService');
const substitutionService = require('../services/substitutionService');
const exportService = require('../services/exportService');
const Teacher = require('../models/teacherModel');
const Substitution = require('../models/substitutionModel');
const Submission = require('../models/submissionModel');
const Audit = require('../models/auditModel');
const config = require('../config/env');
const testing = require('../config/testing');
const personalTests = require('../config/personalTests');
const { AppError } = require('../middleware/errorHandler');
const { period } = require('../lib/date');

const ACTOR = 'admin';

// ── Обзор ──
exports.overview = async (req, res) => res.json(await stats.overview(period(req.query.from, req.query.to)));
exports.today = async (req, res) => {
  try { res.json(await stats.todayBoard()); }
  catch (error) { res.json({ error: error.code || 'hollihop_unavailable', expected: 0, marked: 0, pending: [] }); }
};
exports.teacherStats = async (req, res) => res.json(await stats.teachers(period(req.query.from, req.query.to)));

exports.config = (req, res) => res.json({
  rules: config.rules, testing, personalTests: personalTests.categories, timezone: config.timezone, auditRetentionDays: config.auditRetentionDays,
  lowFillThreshold: config.lowFillThreshold, mock: config.hollihop.mock, directors: config.directorTelegramIds.length,
});

// ── Преподаватели ──
exports.listTeachers = async (req, res) => res.json(await Teacher.findAll());

exports.saveTeacher = async (req, res) => {
  const body = req.body || {};
  const role = Teacher.ROLES.includes(body.role) ? body.role : 'teacher';
  if (role === 'teacher' && !String(body.hollihop_id || '').trim()) throw new AppError(400, 'Нужен HollyHop ID');
  if (role !== 'teacher' && !String(body.telegram_id || '').trim()) throw new AppError(400, 'Директору и координатору нужен Telegram ID');
  try {
    if (body.id) await Teacher.update(body.id, body);
    else await Teacher.create(body);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') throw new AppError(409, 'Такой Telegram ID или HollyHop ID уже есть');
    throw error;
  }
  await Audit.log(body.id || null, body.id ? 'teacher_update' : 'teacher_create', null, null,
    { name: body.full_name, role, active: body.active !== false }, ACTOR);
  res.json({ ok: 1 });
};

exports.importTeachers = async (req, res) => {
  const added = await Teacher.importFromHollihop(await hollihop.teachers());
  await Audit.log(null, 'teacher_import', null, null, { added }, ACTOR);
  res.json({ added });
};

// ── Замены ──
exports.listGroups = async (req, res) => {
  const date = lessons.isDate(req.query.date) ? req.query.date : lessons.todayIso();
  res.json((await hollihop.groupsOnDate(date)).map(({ id, name, branch, time }) => ({ id, name, branch, time })));
};
exports.listSubstitutions = async (req, res) => res.json(await Substitution.findRecent());

/** Кто занят во время занятия группы: { teacherId: [{groupId, group, time}] }. */
exports.busyTeachers = async (req, res) => {
  const { date, group } = req.query;
  if (!group || !lessons.isDate(date)) throw new AppError(400, 'Укажите группу и дату');
  res.json(await substitutionService.busyTeachers(group, date));
};

exports.addSubstitution = async (req, res) => {
  const { group_id, lesson_date, substitute_id } = req.body || {};
  if (!group_id || !lessons.isDate(lesson_date) || !substitute_id) throw new AppError(400, 'Заполните группу, дату и преподавателя');
  const busy = (await substitutionService.busyTeachers(group_id, lesson_date))[Number(substitute_id)];
  if (busy) throw new AppError(409, `Нельзя назначить: преподаватель ${substitutionService.busyText(busy)}`);
  await Substitution.create({ group_id, lesson_date, substitute_id });
  await Audit.log(substitute_id, 'substitution_add', group_id, lesson_date, {}, ACTOR);
  res.json({ ok: 1 });
};

exports.removeSubstitution = async (req, res) => {
  const row = await Substitution.findById(req.params.id);
  await Substitution.remove(req.params.id);
  if (row) await Audit.log(row.substitute_id, 'substitution_remove', row.group_id, row.lesson_date, {}, ACTOR);
  res.json({ ok: 1 });
};

// ── Выгрузка: расписание (HollyHop) и фактические отметки за период; ?format=xlsx — файл Excel ──
exports.exportReport = async (req, res) => {
  const { kind } = req.params, { from, to, format } = req.query;
  if (!exportService.KINDS[kind]) throw new AppError(404, 'Нет такой выгрузки');
  const report = await exportService[kind](from, to);
  if (format !== 'xlsx') return res.json(report);
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${exportService.fileName(report)}"`,
  });
  res.send(exportService.toXlsx(report));
};

// ── Отметки и аудит ──
exports.listSubmissions = async (req, res) => res.json(await Submission.list({
  date: lessons.isDate(req.query.date) ? req.query.date : null,
  from: lessons.isDate(req.query.from) ? req.query.from : null,
  to: lessons.isDate(req.query.to) ? req.query.to : null,
  status: ['pending', 'partial', 'attention', 'done'].includes(req.query.status) ? req.query.status : null,
}));

/** Id учеников в HollyHop по ClientId (?clientIds=1,2,3) — для карточки отметки. */
exports.studentIds = async (req, res) => {
  const ids = String(req.query.clientIds || '').split(',').filter(id => /^\d+$/.test(id));
  if (!ids.length || ids.length > 300) throw new AppError(400, 'bad_request');
  res.json(await hollihop.studentIds(ids));
};

exports.retrySubmission = async (req, res) => res.json(await submissions.retry(req.params.key, ACTOR));
exports.listAudit = async (req, res) => res.json(await Audit.latest({ action: req.query.action || null }));
