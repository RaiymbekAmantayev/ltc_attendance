const crypto = require('crypto');
const { admin } = require('../config/env');
const { limiter } = require('./security');

const digest = value => crypto.createHash('sha256').update(String(value)).digest();
const same = (a, b) => crypto.timingSafeEqual(digest(a), digest(b));

// Не более 10 неверных паролей за 15 минут с одного IP.
const failures = limiter({ windowMs: 15 * 60 * 1000, max: 10 });

/** Basic-auth. Без ADMIN_PASS в .env админка закрыта полностью. */
module.exports = (req, res, next) => {
  if (failures.blocked(req.ip)) return res.status(429).send('Too many attempts');
  const header = req.get('authorization') || '';
  const encoded = /^Basic /i.test(header) ? header.slice(6) : '';
  const [user = '', pass = ''] = Buffer.from(encoded, 'base64').toString().split(/:(.*)/s);
  if (admin.pass && same(user, admin.user) && same(pass, admin.pass)) return next();
  if (encoded) failures.hit(req.ip);
  res.set('WWW-Authenticate', 'Basic realm="LTC admin"').status(401).send('Auth required');
};
