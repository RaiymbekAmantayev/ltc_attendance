// Сколько уроков засчитывать: занятие от 90 минут — за два (выгрузки «Расписание» и «Фактические отметки», кабинет преподавателя).
const hollihop = require('./hollihopService');
const Submission = require('../models/submissionModel');

const DOUBLE_FROM_MIN = 90;

/** Уроков за занятие такой длительности; длительность неизвестна — один. */
const unitsOf = minutes => (Number(minutes) >= DOUBLE_FROM_MIN ? 2 : 1);
exports.unitsOf = unitsOf;

/** Длительность по времени группы: «10:00–11:30» → 90; не разобрали — null. */
exports.minutesOfTime = time => {
  const m = /^(\d{1,2}):(\d\d)\s*[–-]\s*(\d{1,2}):(\d\d)/.exec(time || '');
  if (!m) return null;
  const minutes = (Number(m[3]) * 60 + Number(m[4])) - (Number(m[1]) * 60 + Number(m[2]));
  return minutes > 0 ? minutes : null;
};

/**
 * Функция «отметка → сколько уроков». Длительность хранится в отметке (payload.minutes);
 * у старых отметок — из расписания HollyHop за тот день: самое длинное занятие группы, не сумма — у группы бывает
 * два занятия по 45 минут у местного и иностранного преподавателя, это по уроку каждому. HollyHop недоступен — по одному уроку.
 */
exports.forSubmissions = async rows => {
  const minutesOf = r => Submission.parse(r.payload).minutes;
  const old = rows.filter(r => minutesOf(r) == null);
  const scheduled = new Map();                           // группа:дата → минут по расписанию
  if (old.length) {
    const dates = old.map(r => r.lesson_date).sort();
    try {
      for (const l of await hollihop.lessonsInRange(dates[0], dates[dates.length - 1])) {
        const key = `${l.groupId}:${l.date}`;
        scheduled.set(key, Math.max(scheduled.get(key) || 0, l.minutes));
      }
    } catch (error) { console.warn('длительность старых отметок: расписание HollyHop не получено —', error.message); }
  }
  return r => unitsOf(minutesOf(r) ?? scheduled.get(`${r.group_id}:${r.lesson_date}`));
};
