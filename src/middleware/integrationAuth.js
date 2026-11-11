const crypto = require('crypto');
const { integrationKey } = require('../config/env');
const { limiter } = require('./security');

const digest = value => crypto.createHash('sha256').update(String(value)).digest();
const failures = limiter({ windowMs: 15 * 60 * 1000, max: 10 });

/** Ключ сервиса менторов: заголовок X-Api-Key или Authorization: Bearer. Без INTEGRATION_KEY в .env — закрыто. */
module.exports = (req, res, next) => {
  if (failures.blocked(req.ip)) return res.status(429).json({ error: 'too_many_attempts' });
  const bearer = /^Bearer /i.test(req.get('authorization') || '') ? req.get('authorization').slice(7).trim() : '';
  const key = req.get('x-api-key') || bearer;
  if (integrationKey && key && crypto.timingSafeEqual(digest(key), digest(integrationKey))) return next();
  if (key) failures.hit(req.ip);
  res.status(401).json({ error: 'unauthorized' });
};
