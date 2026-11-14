const crypto = require('crypto');
const { integrationKey } = require('../config/env');
const { limiter } = require('./security');

const digest = value => crypto.createHash('sha256').update(String(value)).digest();

/**
 * Проверка ключа: заголовок X-Api-Key или Authorization: Bearer. Пустой expected — закрыто для всех.
 * После 10 неверных ключей за 15 минут IP блокируется (429 too_many_attempts). У каждого API — свой счётчик.
 */
const keyAuth = expected => {
  const failures = limiter({ windowMs: 15 * 60 * 1000, max: 10 });
  return (req, res, next) => {
    if (failures.blocked(req.ip)) return res.status(429).json({ error: 'too_many_attempts' });
    const bearer = /^Bearer /i.test(req.get('authorization') || '') ? req.get('authorization').slice(7).trim() : '';
    const key = req.get('x-api-key') || bearer;
    if (expected && key && crypto.timingSafeEqual(digest(key), digest(expected))) return next();
    if (key) failures.hit(req.ip);
    res.status(401).json({ error: 'unauthorized' });
  };
};

/** Ключ сервиса менторов (INTEGRATION_KEY). */
module.exports = keyAuth(integrationKey);
module.exports.keyAuth = keyAuth;
