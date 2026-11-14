const hollihop = require('../services/hollihopService');
const submissions = require('../services/submissionService');
const editRequests = require('../services/editRequestService');
const HhCleanup = require('../models/hhCleanupModel');
const EditRequest = require('../models/editRequestModel');
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
const cityOf = req => String(req.query.city || '');                 // фильтр Обзора по городу; пусто — все
exports.overview = async (req, res) => res.json(await stats.overview({ ...period(req.query.from, req.query.to), city: cityOf(req) }));
/** Занятия без отметки за период — отдельным запросом: расписание из HollyHop грузится несколько секунд. */
exports.unmarked = async (req, res) => {
  try { res.json(await stats.unmarked({ ...period(req.query.from, req.query.to), city: cityOf(req) })); }
  catch (error) { res.json({ error: error.code || 'hollihop_unavailable' }); }
};
exports.today = async (req, res) => {
  try { res.json(await stats.todayBoard(undefined, cityOf(req))); }
  catch (error) { res.json({ error: error.code || 'hollihop_unavailable', expected: 0, marked: 0, pending: [] }); }
};
exports.teacherStats = async (req, res) => res.json(await stats.teachers({ ...period(req.query.from, req.query.to), city: cityOf(req) }));

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
  const [all, subs] = await Promise.all([hollihop.groupsOnDate(date).then(substitutionService.withMainTeacher), Substitution.forDate(date)]);
  // slots — преподаватели группы в этот день со своим временем: замену назначают на одного из них.
  // Уже заменённый слот не предлагаем, пока замену не уберут; группа, где заменены все, пропадает из списка.
  const taken = new Set(subs.filter(s => s.replaced_hh_id).map(s => `${s.group_id}|${s.replaced_hh_id}`));
  const groups = all.map(g => ({ ...g, slots: (g.slots || []).filter(s => !taken.has(`${g.id}|${s.teacherId}`)) }))
    .filter((g, i) => g.slots.length || !all[i].slots?.length);
  res.json(groups.map(({ id, name, branch, city, time, level, teacher, slots }) => ({ id, name, branch, city, time, level, teacher, slots })));
};
exports.listSubstitutions = async (req, res) => res.json(await substitutionService.recent());

/** Кто занят во время замены (teacher — HollyHop ID заменяемого; без него — всё занятие группы): { teacherId: [{groupId, group, time}] }. */
exports.busyTeachers = async (req, res) => {
  const { date, group, teacher } = req.query;
  if (!group || !lessons.isDate(date)) throw new AppError(400, 'Укажите группу и дату');
  res.json(await substitutionService.busyTeachers(group, date, teacher || null));
};

exports.addSubstitution = async (req, res) => {
  const { group_id, lesson_date, substitute_id, replaced_hh_id = null } = req.body || {};
  if (!group_id || !lessons.isDate(lesson_date) || !substitute_id) throw new AppError(400, 'Заполните группу, дату и преподавателя');
  if (await Substitution.slotTaken(group_id, lesson_date, replaced_hh_id)) throw new AppError(409, 'На этот урок замена уже назначена — сначала уберите её');
  const busy = (await substitutionService.busyTeachers(group_id, lesson_date, replaced_hh_id))[Number(substitute_id)];
  if (busy) throw new AppError(409, `Нельзя назначить: преподаватель ${substitutionService.busyText(busy)}`);
  await Substitution.create({ group_id, lesson_date, substitute_id, replaced_hh_id });
  await Audit.log(substitute_id, 'substitution_add', group_id, lesson_date, { replaced_hh_id }, ACTOR);
  res.json({ ok: 1 });
};

exports.removeSubstitution = async (req, res) => {
  const row = await Substitution.findById(req.params.id);
  await Substitution.remove(req.params.id);
  if (row) await Audit.log(row.substitute_id, 'substitution_remove', row.group_id, row.lesson_date, {}, ACTOR);
  res.json({ ok: 1 });
};

// ── Выгрузка: расписание (HollyHop), отметки, тесты и отчёты по ученикам за период; ?format=xlsx — файл Excel (&teacher= — преподаватель) ──
exports.exportReport = async (req, res) => {
  const { kind } = req.params, { from, to, format, resultsTeacher, attendanceTeacher } = req.query;
  if (!exportService.KINDS[kind]) throw new AppError(404, 'Нет такой выгрузки');
  const report = await exportService[kind](from, to, req.query);
  if (format !== 'xlsx') return res.json(report);
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${exportService.fileName(report)}"`,
  });
  res.send(exportService.toXlsx(report, { resultsTeacher, attendanceTeacher }));
};

// ── Отметки и аудит ──
/** Отметки за период; city — город филиала отметки (для фильтра). */
exports.listSubmissions = async (req, res) => {
  const [rows, cityOf] = await Promise.all([Submission.list({
    date: lessons.isDate(req.query.date) ? req.query.date : null,
    from: lessons.isDate(req.query.from) ? req.query.from : null,
    to: lessons.isDate(req.query.to) ? req.query.to : null,
    status: ['pending', 'partial', 'attention', 'done'].includes(req.query.status) ? req.query.status : null,
  }), hollihop.cityResolver()]);
  res.json(rows.map(r => ({ ...r, city: cityOf(r.branch) })));
};

/** Id учеников в HollyHop по ClientId (?clientIds=1,2,3) — для карточки отметки. */
exports.studentIds = async (req, res) => {
  const ids = String(req.query.clientIds || '').split(',').filter(id => /^\d+$/.test(id));
  if (!ids.length || ids.length > 300) throw new AppError(400, 'bad_request');
  res.json(await hollihop.studentIds(ids));
};

/** ФИО учеников группы по ClientId (?groupId=1), включая выбывших, — для старых отметок без сохранённого ФИО. */
exports.studentNames = async (req, res) => {
  const groupId = String(req.query.groupId || '');
  if (!/^\d+$/.test(groupId)) throw new AppError(400, 'bad_request');
  res.json(Object.fromEntries((await hollihop.allStudents(groupId)).map(s => [s.id, s.name])));
};

exports.retrySubmission = async (req, res) => res.json(await submissions.retry(req.params.key, ACTOR));
exports.listAudit = async (req, res) => res.json(await Audit.latest({ action: req.query.action || null }));

// ── Исправления отметок: запросы преподавателей и тесты, которые надо удалить в HollyHop вручную ──
exports.listEditRequests = async (req, res) => {
  const [requests, cleanup, pending, cleanupPending] = await Promise.all([
    editRequests.list({ status: req.query.status }), HhCleanup.list({ status: req.query.cleanup === 'all' ? null : 'pending' }),
    EditRequest.countPending(), HhCleanup.countPending()]);
  res.json({ requests: requests.map(r => ({ ...r, expired: !!Number(r.expired) })), cleanup, pending, cleanupPending, windowHours: config.editWindowHours });
};
exports.approveEditRequest = async (req, res) => res.json(await editRequests.decide(req.params.id, true, req.body?.note, ACTOR));
exports.rejectEditRequest = async (req, res) => res.json(await editRequests.decide(req.params.id, false, req.body?.note, ACTOR));
exports.cleanupDone = async (req, res) => {
  if (!(await HhCleanup.markDone(Number(req.params.id)))) throw new AppError(409, 'Уже отмечено или не найдено');
  await Audit.log(null, 'hh_cleanup_done', null, null, { id: Number(req.params.id) }, ACTOR);
  res.json({ ok: 1 });
};
