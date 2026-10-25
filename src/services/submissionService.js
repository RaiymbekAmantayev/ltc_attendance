const hollihop = require('./hollihopService');
const lessons = require('./lessonService');
const Submission = require('../models/submissionModel');
const Audit = require('../models/auditModel');
const { AppError } = require('../middleware/errorHandler');
const { rules } = require('../config/env');
const testing = require('../config/testing');
const personalTests = require('../config/personalTests');
const Ktp = require('../models/ktpModel');

const UUID = /^[0-9a-f-]{36}$/i;
const MAX_ATTEMPTS = 8;                                  // после стольких неудач подряд — «нужно внимание»
const MAX_PER_LESSON = 2;                                // на урок не больше двух отметок, и только от разных преподавателей

/** Тип теста по языку преподавателя: Foreign (en) → 131, Local (ru) → 132. */
exports.testTypeFor = teacher => (teacher.lang === 'en' ? testing.testTypeIds.foreign : testing.testTypeIds.local);

/**
 * Баллы теста по навыкам. Пусто (навыки без значения по умолчанию не заполнены) = теста нет. Иначе нужен полный набор навыков (требование HollyHop):
 * навык 8 всегда 45, баллы от 0 до максимума навыка. test — 'daily' или 'personal' (для текста ошибки).
 */
function normalizeSkills(raw, studentId, config, test = 'daily') {
  const input = raw && typeof raw === 'object' ? raw : {};
  const filled = id => input[id] !== undefined && input[id] !== null && String(input[id]).trim() !== '';
  const needed = config.filter(k => k.default === undefined);       // навыки без значения по умолчанию
  if (!needed.some(k => filled(k.id))) return null;

  const skills = {};
  for (const k of config) {
    const value = k.fixed ? k.default : filled(k.id) ? Number(String(input[k.id]).replace(',', '.')) : k.default;
    if (value === undefined) throw new AppError(422, 'test_incomplete', { student: studentId, skill: k.id, test });
    if (!Number.isFinite(value)) throw new AppError(422, 'bad_score', { student: studentId, skill: k.id, test });
    if (value < 0 || value > k.max) throw new AppError(422, 'score_out_of_range', { student: studentId, skill: k.id, max: k.max, test });
    skills[k.id] = value;
  }
  return skills;
}

/** Проверка и приведение одной строки ученика. Бросает AppError(422) при нарушении правил ввода. */
function normalizeStudent(s, roster, typeId, topic, personal) {
  const id = String(s.id);
  if (!roster.has(id)) throw new AppError(400, 'unknown_student', { student: id });
  const status = s.status === 'absent' ? 'absent' : 'present';            // «опоздал» больше нет
  const comment = topic.slice(0, rules.commentMaxLen);                     // комментарий = тема урока (уходит в commentHtml)

  // Тесты и комментарий — только тем, кто был на уроке. Ежедневный тест обязателен, персональный — по желанию.
  if (status === 'absent') return { id, status, skills: null, personalSkills: null, comment };
  const skills = normalizeSkills(s.skills, id, testing.skillsFor(typeId));
  if (!skills) throw new AppError(422, 'test_required', { student: id });
  if (rules.commentRequired && !comment) throw new AppError(422, 'comment_required', { student: id });
  const personalSkills = personal ? normalizeSkills(s.personalSkills, id, personal.type.skills, 'personal') : null;
  return { id, status, skills, personalSkills, comment };
}

/** Выбранный персональный тест урока (не больше одного) или null. Бросает 422, если категории/типа нет. */
function pickPersonal(raw) {
  if (raw == null || raw === '' || (typeof raw === 'object' && raw.categoryId == null)) return null;
  const found = personalTests.find(raw.categoryId, raw.testTypeId);
  if (!found) throw new AppError(422, 'bad_personal_test');
  return found;
}

/** Время теста для HollyHop: дата урока + начало занятия по расписанию. */
const testDateTime = (date, group) => `${date}T${(/^\d{1,2}:\d\d/.exec(group.time || '') || ['00:00'])[0].padStart(5, '0')}:00`;

/** Принимает отметку: сохраняет у себя и отправляет в HollyHop. Повтор с тем же key безопасен (разд. 7.1 ТЗ). */
exports.save = async (teacher, { key, groupId, date, topic, ktpTopicId, students, personal: personalRaw }) => {
  if (!teacher.id) throw new AppError(403, 'forbidden');
  if (!UUID.test(key || '') || !lessons.isDate(date) || !groupId || !Array.isArray(students) || !students.length || students.length > 300) {
    throw new AppError(400, 'bad_request');
  }
  const group = await lessons.groupForTeacher(teacher, groupId, date);
  if (!group) throw new AppError(403, 'forbidden');

  const roster = new Map((await hollihop.students(groupId)).map(s => [s.id, s.name]));
  const unique = [...new Map(students.map(s => [String(s.id), s])).values()];
  const cleanTopic = String(topic || '').trim().slice(0, 500);
  const personal = pickPersonal(personalRaw);
  // Тема из КТП — для отчётов; если её успели удалить, отметку не блокируем (могла ждать в очереди телефона).
  const ktpTopic = Number(ktpTopicId) > 0 ? await Ktp.topicById(Number(ktpTopicId)) : null;
  const payload = {
    topic: cleanTopic,
    ktpTopicId: ktpTopic ? ktpTopic.id : null,
    level: group.level || '',                                              // для выгрузки тестов по уровням
    testTypeId: exports.testTypeFor(teacher),
    dateTime: testDateTime(date, group), teacherId: teacher.hollihop_id ? Number(teacher.hollihop_id) : null,
    personal: personal && {
      categoryId: personal.category.id, testTypeId: personal.type.id,
      dateTime: testDateTime(date, group), teacherId: teacher.hollihop_id ? Number(teacher.hollihop_id) : null,
    },
    students: unique.map(s => ({ ...normalizeStudent(s, roster, exports.testTypeFor(teacher), cleanTopic, personal), name: roster.get(String(s.id)) || null })),   // ФИО — для выгрузки
  };
  if (personal && !payload.students.some(s => s.personalSkills)) throw new AppError(422, 'personal_empty');

  // Своя отметка урока — одна, правка задним числом запрещена; второй комплект может прислать только другой преподаватель.
  const existing = await Submission.listByGroupAndDate(groupId, date);
  const mine = existing.find(r => r.teacher_id === teacher.id);
  if (mine) {
    if (mine.idem_key !== key) throw new AppError(409, 'already_saved');
    return exports.push(key);                                              // повтор того же нажатия
  }
  if (existing.length >= MAX_PER_LESSON) throw new AppError(409, 'lesson_full');

  try {
    await Submission.create({
      key, teacherId: teacher.id, groupId, groupName: group.name, branch: group.branch, date, slot: existing.length + 1, payload,
    });
    await Audit.log(teacher.id, 'save', groupId, date, {
      students: payload.students.length, substitution: !!group.substitution,
    }, `teacher:${teacher.id}`);
  } catch (error) {
    if (error.code !== 'ER_DUP_ENTRY') throw error;
    // Гонка: одновременно ушли это же нажатие, другое нажатие этого преподавателя или чужая отметка на тот же слот.
    const saved = await Submission.findByKey(key);
    if (!saved || saved.teacher_id !== teacher.id) {
      const now = await Submission.listByGroupAndDate(groupId, date);
      const full = !now.some(r => r.teacher_id === teacher.id) && now.length >= MAX_PER_LESSON;
      throw new AppError(409, full ? 'lesson_full' : 'already_saved');
    }
  }
  return exports.push(key);
};

const inFlight = new Set();                              // один процесс не шлёт одну отметку дважды одновременно

/** Отправляет в HollyHop только те шаги, которые ещё не выполнены. */
exports.push = async key => {
  const submission = await Submission.findByKey(key);
  if (!submission) throw new AppError(404, 'not_found');
  if (submission.status === 'done') return { status: 'done' };
  if (inFlight.has(key)) return { status: submission.status };
  inFlight.add(key);

  try {
    const payload = Submission.parse(submission.payload);
    const done = new Set(Submission.parse(submission.progress));
    const { group_id: groupId, lesson_date: date } = submission;

    const steps = [];
    if (payload.topic) steps.push(['topic', () => hollihop.writeTopic(groupId, date, payload.topic)]);
    for (const s of payload.students) {
      steps.push([`a:${s.id}`, () => hollihop.writeAttendance(groupId, date, s)]);
      if (s.skills && hollihop.testEnabledFor(groupId)) steps.push([`r:${s.id}`, () => hollihop.writeReport(groupId, date, s, payload)]);
      if (s.personalSkills && payload.personal && hollihop.testEnabledFor(groupId)) steps.push([`p:${s.id}`, () => hollihop.writePersonalTest(s, payload)]);
    }

    let status = 'done', lastError = null, fatal = false;
    for (const [stepKey, run] of steps) {
      if (done.has(stepKey)) continue;
      try {
        await run();
        done.add(stepKey);
      } catch (error) {
        lastError = error.message;
        status = 'partial';
        // Нет прав или HollyHop отклонил данные: повтор не поможет — нужен человек.
        if (error.code === 'NO_RIGHTS' || error.code === 'BAD_REQUEST') { fatal = true; status = 'attention'; break; }
      }
    }
    const failed = status !== 'done';
    if (failed && !fatal && submission.attempts + 1 >= MAX_ATTEMPTS) status = 'attention';

    await Submission.saveProgress(key, [...done], status, lastError, failed);
    if (status === 'done' && submission.status !== 'done') {
      await Audit.log(submission.teacher_id, 'synced', groupId, date, { steps: done.size }, 'system');
    } else if (status === 'attention') {
      await Audit.log(submission.teacher_id, 'attention', groupId, date, { error: lastError }, 'system');
    }
    return { status };
  } finally {
    inFlight.delete(key);
  }
};

exports.retry = async (key, actor = 'admin') => {
  await Submission.markForRetry(key);
  const result = await exports.push(key);
  const row = await Submission.findByKey(key);
  if (row) await Audit.log(row.teacher_id, 'retry', row.group_id, row.lesson_date, { result: result.status }, actor);
  return result;
};
