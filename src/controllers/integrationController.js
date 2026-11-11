// Сервис менторов: забирает учеников с пропусками и присылает обратную связь по ним.
const exportService = require('../services/exportService');
const studentReports = require('../services/studentReportsService');
const AbsenceFeedback = require('../models/absenceFeedbackModel');
const Audit = require('../models/auditModel');
const { AppError } = require('../middleware/errorHandler');
const { isDate } = require('../lib/date');

const ACTOR = 'mentors';
const MAX_ITEMS = 1000;
const MAX_DAYS = 366;

/** Ученики с пропусками за период: GET ?from=YYYY-MM-DD&to=YYYY-MM-DD (необязательно — city, level, teacher). */
exports.absences = async (req, res) => {
  const { from, to } = req.query;
  exportService.period(from, to, MAX_DAYS);
  const filters = { city: String(req.query.city || ''), level: String(req.query.level || ''), teacher: String(req.query.teacher || '') };
  const all = (await studentReports.attendance(from, to, filters)).scopes[0];
  res.json({
    from, to, total: all.rows.length,
    students: all.rows.map(r => ({
      studentId: r.id, student: r.student, groups: r.groups, group: r.group,
      lessons: r.lessons, absent: r.absent, rate: r.rate, feedback: r.feedback,
    })),
  });
};

const text = (v, max) => (v == null || v === '' ? null : typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, max) || null : undefined);
// Дата обратной связи — только ISO 8601 с часовым поясом: без пояса время было бы прочитано по часам сервера.
const ISO_TZ = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d{1,9})?)?(Z|[+-]\d\d:?\d\d)$/i;
// Колонка таблицы → имя поля API (для errors[].field).
const TEXT_FIELDS = { student_name: 'student', group_names: 'groups', reason: 'reason', mentor: 'mentor' };

/** Одна запись обратной связи → строка таблицы, либо { error: поле }. */
function parseItem(x) {
  if (!x || typeof x !== 'object') return { error: 'item' };
  const studentId = String(x.studentId ?? '').trim();
  if (!/^\d{1,20}$/.test(studentId)) return { error: 'studentId' };
  const { from, to } = x.period || {};
  if (!isDate(from) || !isDate(to) || from > to) return { error: 'period' };
  const status = text(x.status, 64);
  if (!status) return { error: 'status' };
  const at = new Date(x.feedbackAt);
  if (typeof x.feedbackAt !== 'string' || !ISO_TZ.test(x.feedbackAt.trim()) || Number.isNaN(at.getTime())) return { error: 'feedbackAt' };
  const groups = Array.isArray(x.groups) ? x.groups.map(g => (g && typeof g === 'object' ? g.name : g)).filter(Boolean).join(', ') : x.groups;
  const row = {
    student_id: studentId, period_from: from, period_to: to, status,
    student_name: text(x.student, 255), group_names: text(groups, 1000), reason: text(x.reason, 1000), mentor: text(x.mentor, 255),
    lessons: x.lessons == null || x.lessons === '' ? null : Number(x.lessons),
    feedback_at: at.toISOString().slice(0, 19).replace('T', ' '),
  };
  for (const [f, field] of Object.entries(TEXT_FIELDS)) if (row[f] === undefined) return { error: field };
  if (row.lessons != null && !(Number.isInteger(row.lessons) && row.lessons >= 0)) return { error: 'lessons' };
  return { row };
}

/** Обратная связь: POST массив (или { items: [...] }). Всё или ничего: при ошибке в одной записи не сохраняется ни одна. */
exports.saveFeedback = async (req, res) => {
  const items = Array.isArray(req.body) ? req.body : req.body?.items;
  if (!Array.isArray(items) || !items.length) throw new AppError(400, 'items_required');
  if (items.length > MAX_ITEMS) throw new AppError(400, 'too_many_items', { max: MAX_ITEMS });
  const parsed = items.map(parseItem);
  const errors = parsed.map((p, index) => (p.error ? { index, field: p.error } : null)).filter(Boolean);
  if (errors.length) throw new AppError(400, 'bad_items', { errors });
  const rows = parsed.map(p => p.row);
  await AbsenceFeedback.upsert(rows);
  await Audit.log(null, 'absence_feedback', null, null, { count: rows.length, items: rows.slice(0, 50).map(r => [r.student_id, r.period_from, r.period_to, r.status, r.reason, r.feedback_at]) }, ACTOR);
  res.json({ ok: 1, saved: rows.length });
};
