// Запрос на исправление отметки: преподаватель просит → админка одобряет или отклоняет → у преподавателя открывается правка.
const Submission = require('../models/submissionModel');
const EditRequest = require('../models/editRequestModel');
const Audit = require('../models/auditModel');
const lessons = require('./lessonService');
const { AppError } = require('../middleware/errorHandler');
const { editWindowHours } = require('../config/env');
const bot = require('../bot/notify');

const view = r => r && ({
  id: r.id, status: r.status === 'approved' && !r.open ? 'expired' : r.status, reason: r.reason, note: r.admin_note || null,
  createdAt: r.created_at, expiresAt: r.status === 'approved' ? r.expires_at : null,
});

/** Состояние запроса по своей отметке урока (для экрана группы). */
exports.stateFor = async submissionKey => view(await EditRequest.latestFor(submissionKey));

exports.request = async (teacher, { groupId, date, reason }) => {
  if (!teacher.id) throw new AppError(403, 'forbidden');
  const text = String(reason || '').trim().slice(0, 1000);
  if (!groupId || !lessons.isDate(date)) throw new AppError(400, 'bad_request');
  if (text.length < 5) throw new AppError(422, 'reason_required');
  const row = await Submission.findByGroupAndDate(String(groupId), date, teacher.id);
  if (!row) throw new AppError(404, 'not_found');
  const last = await EditRequest.latestFor(row.idem_key);
  if (last && (last.status === 'pending' || last.open)) throw new AppError(409, 'request_exists');
  await EditRequest.create({ submissionKey: row.idem_key, teacherId: teacher.id, groupId: row.group_id, date, groupName: row.group_name, reason: text });
  await Audit.log(teacher.id, 'edit_request', row.group_id, date, { reason: text }, `teacher:${teacher.id}`);
  return exports.stateFor(row.idem_key);
};

exports.list = ({ status } = {}) => EditRequest.list({ status: ['pending', 'approved', 'rejected', 'used'].includes(status) ? status : null });

exports.decide = async (id, approve, note, actor = 'admin') => {
  const cleanNote = String(note || '').trim().slice(0, 500);
  if (!(await EditRequest.decide(Number(id), approve, cleanNote, editWindowHours))) throw new AppError(409, 'Запрос уже рассмотрен или не найден');
  const r = await EditRequest.byId(Number(id));
  await Audit.log(r.teacher_id, approve ? 'edit_approved' : 'edit_rejected', r.group_id, r.lesson_date, { request: r.id, note: cleanNote || null }, actor);
  if (r.telegram_id) {
    const what = `${r.group_name || r.group_id} · ${r.lesson_date}`;
    bot.notify(r.telegram_id, approve
      ? `✅ Correction request approved: ${what}.\nOpen the lesson in the cabinet and correct the submission (available for ${editWindowHours} h).${cleanNote ? `\nComment: ${cleanNote}` : ''}`
      : `❌ Correction request rejected: ${what}.${cleanNote ? `\nComment: ${cleanNote}` : ''}`);
  }
  return { ok: 1 };
};
