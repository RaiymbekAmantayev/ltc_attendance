const hollihop = require('../services/hollihopService');
const lessons = require('../services/lessonService');
const submissions = require('../services/submissionService');
const editRequests = require('../services/editRequestService');
const stats = require('../services/statsService');
const Submission = require('../models/submissionModel');
const Ktp = require('../models/ktpModel');
const levels = require('../config/levels');
const { AppError } = require('../middleware/errorHandler');
const { rules, lowFillThreshold } = require('../config/env');
const testing = require('../config/testing');
const personalTests = require('../config/personalTests');
const translit = require('../lib/translit');

exports.me = (req, res) => res.json({
  name: req.teacher.full_name, lang: req.teacher.lang, role: req.teacher.role,
  canMark: !!req.teacher.id, rules, lowFillThreshold,
  testing: { typeId: submissions.testTypeFor(req.teacher), skills: testing.skillsFor(submissions.testTypeFor(req.teacher)) },
  personalTests: personalTests.categories,
});

exports.listLessons = async (req, res) => {
  const date = lessons.isDate(req.query.date) ? req.query.date : lessons.todayIso();
  res.json(await lessons.lessonsWithStatus(req.teacher, date));
};

exports.groupStudents = async (req, res) => {
  const { id } = req.params, { date } = req.query;
  if (!lessons.isDate(date)) throw new AppError(403, 'forbidden');
  const group = await lessons.groupForTeacher(req.teacher, id, date);
  const saved = req.teacher.id ? await Submission.findByGroupAndDate(id, date, req.teacher.id) : null;   // своя отметка; у второго преподавателя — своя
  if (!group && !saved) throw new AppError(403, 'forbidden');   // своя отметка видна всегда (например, из профиля, когда группы уже нет в расписании)

  const payload = saved ? Submission.parse(saved.payload) : null;
  const level = levels.normalize(group?.level || payload?.level || '');   // «Inter + (plus)» → Intermediate Plus
  const roster = await hollihop.students(id);
  // Ученики из своей отметки, которых уже нет в составе (выбыли), — чтобы их строку можно было исправить.
  if (payload) for (const s of payload.students) if (!roster.some(r => r.id === String(s.id))) roster.push({ id: String(s.id), name: s.name || String(s.id) });
  res.json({
    students: roster.map(s => req.teacher.lang === 'en' ? { ...s, name: translit(s.name) } : s),   // Foreign — ФИО латиницей
    submitted: saved ? { status: saved.status, payload, revision: saved.revision || 0, edit: await editRequests.stateFor(saved.idem_key) } : null,
    ktp: { level, categories: await Ktp.forLevel(level) },  // темы КТП уровня группы по категориям
  });
};

exports.saveLesson = async (req, res) => res.json(await submissions.save(req.teacher, req.body || {}));
exports.editLesson = async (req, res) => res.json(await submissions.edit(req.teacher, req.body || {}));
exports.requestEdit = async (req, res) => res.json(await editRequests.request(req.teacher, req.body || {}));

exports.profile = async (req, res) => res.json(await stats.profile(req.teacher));
