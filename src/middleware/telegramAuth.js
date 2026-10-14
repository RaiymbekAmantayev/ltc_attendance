const { verifyInitData } = require('../services/telegramAuthService');
const Teacher = require('../models/teacherModel');
const { directorTelegramIds } = require('../config/env');

/**
 * Проверяет подпись Telegram и находит сотрудника в базе → req.teacher.
 * Директор из DIRECTOR_TG_IDS допускается и без записи в базе (роль director, без своих групп).
 */
module.exports = async (req, res, next) => {
  const user = verifyInitData(req.get('x-init-data') || '');
  if (!user) return res.status(401).json({ error: 'bad_init_data' });

  let teacher = await Teacher.findActiveByTelegramId(user.id);
  if (!teacher && directorTelegramIds.includes(String(user.id))) {
    teacher = {
      id: null, telegram_id: String(user.id), hollihop_id: null, role: 'director', lang: 'ru', active: 1,
      full_name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'Director',
    };
  }
  if (!teacher) return res.status(403).json({ error: 'not_registered' });

  req.teacher = teacher;
  next();
};
