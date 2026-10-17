const hollihop = require('../services/hollihopService');
const lessons = require('../services/lessonService');
const submissions = require('../services/submissionService');
const stats = require('../services/statsService');
const Submission = require('../models/submissionModel');
const Ktp = require('../models/ktpModel');
const levels = require('../config/levels');
const { AppError } = require('../middleware/errorHandler');
const { rules, lowFillThreshold } = require('../config/env');
const testing = require('../config/testing');
const personalTests = require('../config/personalTests');

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
  const group = lessons.isDate(date) && await lessons.groupForTeacher(req.teacher, id, date);
  if (!group) throw new AppError(403, 'forbidden');

  const saved = await Submission.findByGroupAndDate(id, date);
  const level = levels.normalize(group.level);              // «Inter + (plus)» → Intermediate Plus
  res.json({
    students: await hollihop.students(id),
    submitted: saved ? { status: saved.status, payload: Submission.parse(saved.payload) } : null,
    ktp: { level, categories: await Ktp.forLevel(level) },  // темы КТП уровня группы по категориям
  });
};

exports.saveLesson = async (req, res) => res.json(await submissions.save(req.teacher, req.body || {}));

exports.profile = async (req, res) => res.json(await stats.profile(req.teacher));
