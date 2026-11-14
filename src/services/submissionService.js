const hollihop = require('./hollihopService');
const lessons = require('./lessonService');
const Submission = require('../models/submissionModel');
const Audit = require('../models/auditModel');
const { AppError } = require('../middleware/errorHandler');
const { rules } = require('../config/env');
const testing = require('../config/testing');
const personalTests = require('../config/personalTests');
const coins = require('../config/coins');
const Ktp = require('../models/ktpModel');
const EditRequest = require('../models/editRequestModel');
const HhCleanup = require('../models/hhCleanupModel');
const { pool } = require('../config/db');
const lessonUnits = require('./lessonUnitsService');

const UUID = /^[0-9a-f-]{36}$/i;
const MAX_ATTEMPTS = 8;                                  // после стольких неудач подряд — «нужно внимание»
// На урок — одна отметка от местного (ru) и одна от иностранного (en) преподавателя. Слот закреплён за языком,
// поэтому uq_lesson_slot не пускает вторую отметку того же языка даже при одновременной отправке.
const SLOT_BY_LANG = { ru: 1, en: 2 };
const langOf = teacher => (teacher.lang === 'en' ? 'en' : 'ru');

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

/** Типы доп. теста для поиска в HollyHop: фактический тип (Final Test 1 → 4) и старые номера. */
const personalTypeIds = p => {
  const found = p && personalTests.find(p.categoryId, p.testTypeId);
  return [...new Set([found?.type.id ?? Number(p.testTypeId), ...(found?.type.legacyIds || []), Number(p.testTypeId)])];
};

/** Время теста для HollyHop: дата урока + начало занятия по расписанию. */
const testDateTime = (date, group) => `${date}T${(/^\d{1,2}:\d\d/.exec(group.time || '') || ['00:00'])[0].padStart(5, '0')}:00`;

/** Принимает отметку: сохраняет у себя и отправляет в HollyHop. Повтор с тем же key безопасен (разд. 7.1 ТЗ). */
exports.save = async (teacher, { key, groupId, date, topic, homework, ktpTopicId, students, personal: personalRaw }) => {
  if (!teacher.id) throw new AppError(403, 'forbidden');
  if (!UUID.test(key || '') || !lessons.isDate(date) || !groupId || !Array.isArray(students) || !students.length || students.length > 300) {
    throw new AppError(400, 'bad_request');
  }
  const group = await lessons.groupForTeacher(teacher, groupId, date);
  if (!group) throw new AppError(403, 'forbidden');

  const roster = new Map((await hollihop.students(groupId)).map(s => [s.id, s.name]));
  const unique = [...new Map(students.map(s => [String(s.id), s])).values()];
  const cleanTopic = String(topic || '').trim().slice(0, 500);
  const cleanHomework = String(homework || '').trim().slice(0, rules.homeworkMaxLen);
  if (rules.homeworkRequired && !cleanHomework) throw new AppError(422, 'homework_required');
  const personal = pickPersonal(personalRaw);
  // Тема из КТП — для отчётов; если её успели удалить, отметку не блокируем (могла ждать в очереди телефона).
  const ktpTopic = Number(ktpTopicId) > 0 ? await Ktp.topicById(Number(ktpTopicId)) : null;
  const payload = {
    topic: cleanTopic,
    homework: cleanHomework,                                               // в HollyHop — под темой: «Дз/Hw: …»
    ktpTopicId: ktpTopic ? ktpTopic.id : null,
    level: group.level || '',                                              // для выгрузки тестов по уровням
    minutes: lessonUnits.minutesOfTime(group.time),                        // длительность: от 90 минут урок считается за два
    testTypeId: exports.testTypeFor(teacher),
    coins: true,                                                           // начислять коины (старые отметки — без них)
    dateTime: testDateTime(date, group), teacherId: teacher.hollihop_id ? Number(teacher.hollihop_id) : null,
    personal: personal && {
      categoryId: personal.category.id, testTypeId: personal.type.id,
      dateTime: testDateTime(date, group), teacherId: teacher.hollihop_id ? Number(teacher.hollihop_id) : null,
    },
    students: unique.map(s => ({ ...normalizeStudent(s, roster, exports.testTypeFor(teacher), cleanTopic, personal), name: roster.get(String(s.id)) || null })),   // ФИО — для выгрузки
  };
  if (personal && !payload.students.some(s => s.personalSkills)) throw new AppError(422, 'personal_empty');

  // Своя отметка урока — одна, правка задним числом запрещена; второй комплект может прислать только преподаватель другого типа.
  const existing = await Submission.listByGroupAndDate(groupId, date);
  const mine = existing.find(r => r.teacher_id === teacher.id);
  if (mine) {
    if (mine.idem_key !== key) throw new AppError(409, 'already_saved');
    return exports.push(key);                                              // повтор того же нажатия
  }
  const lang = langOf(teacher);
  if (existing.some(r => r.teacher_lang === lang)) throw new AppError(409, 'lesson_lang_taken');
  // Старые отметки занимали слоты по порядку: если «свой» слот уже занят отметкой другого типа — берём свободный.
  const slot = [SLOT_BY_LANG[lang], 3 - SLOT_BY_LANG[lang]].find(n => !existing.some(r => r.slot === n));
  if (!slot) throw new AppError(409, 'lesson_full');

  try {
    await Submission.create({
      key, teacherId: teacher.id, groupId, groupName: group.name, branch: group.branch, date, slot, payload,
    });
    await Audit.log(teacher.id, 'save', groupId, date, {
      students: payload.students.length, substitution: !!group.substitution,
    }, `teacher:${teacher.id}`);
  } catch (error) {
    if (error.code !== 'ER_DUP_ENTRY') throw error;
    // Гонка: одновременно ушли это же нажатие, другое нажатие этого преподавателя или отметка другого преподавателя того же типа.
    const saved = await Submission.findByKey(key);
    if (!saved || saved.teacher_id !== teacher.id) {
      const now = await Submission.listByGroupAndDate(groupId, date);
      if (now.some(r => r.teacher_id === teacher.id)) throw new AppError(409, 'already_saved');
      throw new AppError(409, now.some(r => r.teacher_lang === lang) ? 'lesson_lang_taken' : 'lesson_full');
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

    // Id результатов тестов в HollyHop: есть Id — правим его; null — записан раньше, Id ищем (старые отметки); нет ключа — добавляем.
    const results = { ...(Submission.parse(submission.hh_results) || {}) };
    const credited = { ...(Submission.parse(submission.coins_credited) || {}) };
    const testStep = (stepKey, write, lookup) => async () => {
      let id = results[stepKey];
      if (id === null) id = await hollihop.findPersonalResult({ ...lookup(), exclude: Object.values(results).filter(v => v != null) });
      const body = await write(id ?? null);
      if (body && !body.local) results[stepKey] = body.Id ?? id ?? results[stepKey] ?? undefined;
    };
    const lookupOf = (s, dateTime, testTypeIds, teacherId) => () => ({ clientId: s.id, dateTime, testTypeIds, teacherId });

    const steps = [];
    if (payload.topic) steps.push(['topic', () => hollihop.writeTopic(groupId, date, payload.topic)]);
    for (const s of payload.students) {
      steps.push([`a:${s.id}`, () => hollihop.writeAttendance(groupId, date, s)]);
      if (s.skills && hollihop.testEnabledFor(groupId)) {
        steps.push([`r:${s.id}`, testStep(`r:${s.id}`, id => hollihop.writeReport(groupId, date, s, payload, id),
          lookupOf(s, payload.dateTime || `${date}T00:00:00`, [payload.testTypeId], payload.teacherId))]);
      }
      if (s.personalSkills && payload.personal && hollihop.testEnabledFor(groupId)) {
        steps.push([`p:${s.id}`, testStep(`p:${s.id}`, id => hollihop.writePersonalTest(s, payload, id),
          lookupOf(s, payload.personal.dateTime, personalTypeIds(payload.personal), payload.personal.teacherId))]);
      }
      // Коины — последним шагом ученика и только после записи его тестов; после успеха не повторяется, поэтому дважды не начисляются.
      // После исправления начисляется разница с уже начисленным (может быть отрицательной).
      const earned = payload.coins && hollihop.testEnabledFor(groupId) ? coins.forStudent(s, payload) : 0;
      const already = Number(credited[s.id]) || 0;
      const tests = steps.map(([k]) => k).filter(k => k === `r:${s.id}` || k === `p:${s.id}`);
      if (earned > 0 || already) {
        steps.push([`c:${s.id}`, async () => {
          const diff = Math.round((earned - already) * 100) / 100;
          if (diff) await hollihop.addCoins(s.id, diff);
          credited[s.id] = earned;
        }, tests]);
      }
    }

    let status = 'done', lastError = null, fatal = false;
    for (const [stepKey, run, after = []] of steps) {
      if (done.has(stepKey)) continue;
      if (after.some(k => !done.has(k))) { status = 'partial'; continue; }   // тест ученика не записался — коины при досылке
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

    await Submission.saveProgress(key, [...done], status, lastError, failed, results, credited);
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

/* ---------------- Исправление своей отметки по одобренному запросу ---------------- */

/**
 * Правка отметки преподавателем после одобрения в админке. Тело — как у save (тема, ДЗ, КТП, доп. тест, ученики) + editKey.
 * Ученики, которых нет в теле, остаются как были. Тесты в HollyHop правятся по Id; тесты, которых больше нет
 * (ученик стал «пропуск», доп. тест убран или сменён), удалить через API нельзя — они уходят в список hh_cleanup для админки.
 */
exports.edit = async (teacher, { editKey, groupId, date, topic, homework, ktpTopicId, students, personal: personalRaw }) => {
  if (!teacher.id) throw new AppError(403, 'forbidden');
  if (!UUID.test(editKey || '') || !lessons.isDate(date) || !groupId || !Array.isArray(students) || !students.length || students.length > 300) {
    throw new AppError(400, 'bad_request');
  }
  const row = await Submission.findByGroupAndDate(String(groupId), date, teacher.id);
  if (!row) throw new AppError(404, 'not_found');
  const used = await EditRequest.findByEditKey(editKey);
  if (used) {                                                              // повтор того же нажатия
    if (used.submission_key !== row.idem_key) throw new AppError(409, 'edit_not_allowed');
    return exports.push(row.idem_key);
  }
  const request = await EditRequest.latestFor(row.idem_key);
  if (!request?.open) throw new AppError(403, 'edit_not_allowed');
  if (inFlight.has(row.idem_key)) throw new AppError(409, 'busy');

  const old = Submission.parse(row.payload);
  const oldById = new Map(old.students.map(s => [String(s.id), s]));
  // Состав: прежние ученики отметки + вся группа в HollyHop, включая выбывших (отметка может быть задним числом).
  const roster = new Map((await hollihop.allStudents(groupId)).map(s => [s.id, s.name]));
  for (const s of old.students) if (!roster.has(String(s.id))) roster.set(String(s.id), s.name || null);

  const cleanTopic = String(topic || '').trim().slice(0, 500);
  const cleanHomework = String(homework || '').trim().slice(0, rules.homeworkMaxLen);
  if (rules.homeworkRequired && !cleanHomework) throw new AppError(422, 'homework_required');
  const personal = pickPersonal(personalRaw);
  const ktpTopic = Number(ktpTopicId) > 0 ? await Ktp.topicById(Number(ktpTopicId)) : null;
  // Тот же доп. тест (с учётом старых номеров типа) — результат правится по Id; другой — старый уходит в hh_cleanup, новый добавляется.
  const samePersonal = !!(old.personal && personal && personalTypeIds(old.personal)[0] === personal.type.id);
  const typeId = old.testTypeId || exports.testTypeFor(teacher);           // тип ежедневного теста — как в исходной отметке
  const dateTime = old.dateTime || `${date}T00:00:00`;
  const teacherHhId = old.teacherId ?? (teacher.hollihop_id ? Number(teacher.hollihop_id) : null);
  const given = [...new Map(students.map(s => [String(s.id), s])).values()]
    .map(s => ({ ...normalizeStudent(s, roster, typeId, cleanTopic, personal), name: roster.get(String(s.id)) || oldById.get(String(s.id))?.name || null }));
  const givenIds = new Set(given.map(s => s.id));
  const payload = {
    ...old,
    topic: cleanTopic, homework: cleanHomework, ktpTopicId: ktpTopic ? ktpTopic.id : null,
    personal: personal && { categoryId: personal.category.id, testTypeId: personal.type.id, dateTime: old.personal?.dateTime || dateTime, teacherId: teacherHhId },
    students: [...given, ...old.students.filter(s => !givenIds.has(String(s.id))).map(s => (!s.personalSkills || samePersonal ? s : { ...s, personalSkills: null }))],
  };
  if (personal && !payload.students.some(s => s.personalSkills)) throw new AppError(422, 'personal_empty');

  // Что уже лежит в HollyHop: шаги из progress. Записанным тестам без сохранённого Id ставим null — Id найдём при отправке.
  const done = new Set(Submission.parse(row.progress) || []);
  const results = { ...(Submission.parse(row.hh_results) || {}) };
  for (const k of done) if (/^[rp]:/.test(k) && !(k in results)) results[k] = null;
  // Коины: сколько уже начислено. Старые отметки не хранят сумму — считаем по прежнему payload.
  const credited = { ...(Submission.parse(row.coins_credited) || {}) };
  for (const s of old.students) if (!(s.id in credited) && done.has(`c:${s.id}`)) credited[s.id] = coins.forStudent(s, old);

  const cleanup = [];
  const drop = async (stepKey, s, kind, testTypeIds, dt, tid) => {
    if (!(stepKey in results)) return;                                     // в HollyHop не записывался — удалять нечего
    let resultId = results[stepKey];
    if (resultId == null) {
      resultId = await hollihop.findPersonalResult({ clientId: s.id, dateTime: dt, testTypeIds, teacherId: tid,
        exclude: Object.values(results).filter(v => v != null) }).catch(() => null);
    }
    delete results[stepKey];
    cleanup.push({ submissionKey: row.idem_key, teacherId: teacher.id, groupId: row.group_id, date, groupName: row.group_name,
      studentId: s.id, studentName: s.name, kind, testTypeId: testTypeIds[0], resultId, dateTime: dt });
  };
  for (const s of old.students) {
    const now = payload.students.find(x => String(x.id) === String(s.id));
    if (s.skills && !now?.skills) await drop(`r:${s.id}`, s, 'daily', [old.testTypeId], dateTime, old.teacherId);
    if (s.personalSkills && old.personal && (!samePersonal || !now?.personalSkills)) {
      await drop(`p:${s.id}`, s, 'personal', personalTypeIds(old.personal), old.personal.dateTime, old.personal.teacherId);
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (!(await EditRequest.claim(conn, request.id, editKey))) { await conn.rollback(); throw new AppError(403, 'edit_not_allowed'); }
    await Submission.applyEdit(row.idem_key, { payload, results, credited }, conn);
    await HhCleanup.addMany(conn, cleanup);
    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally { conn.release(); }

  await Audit.log(teacher.id, 'edit', row.group_id, date, {
    request: request.id, before: old, after: payload, cleanup: cleanup.length,
  }, `teacher:${teacher.id}`);
  return exports.push(row.idem_key);
};
