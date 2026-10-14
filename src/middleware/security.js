// Защитные заголовки (по образцу server.py мини-аппов LTC), лимит запросов и лог без персональных данных.
const { rateLimitPerMin } = require('../config/env');

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://telegram.org",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'self'",
  'frame-ancestors https://web.telegram.org https://*.telegram.org https://telegram.org',
].join('; ');

exports.securityHeaders = (req, res, next) => {
  res.set({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  // Данные кабинета (ПДн) не кэшируем; статика — коротко.
  if (/^\/(api|admin-api)\b/.test(req.path)) res.set('Cache-Control', 'no-store');
  next();
};

/** Скользящее окно в памяти. hit() считает попытку, blocked() — превышен ли лимит. */
exports.limiter = ({ windowMs, max }) => {
  const hits = new Map();
  const fresh = key => {
    const now = Date.now();
    const list = (hits.get(key) || []).filter(t => now - t < windowMs);
    hits.set(key, list);
    return list;
  };
  setInterval(() => { for (const key of hits.keys()) if (!fresh(key).length) hits.delete(key); }, windowMs).unref();
  return {
    hit: key => { fresh(key).push(Date.now()); },
    blocked: key => fresh(key).length >= max,
  };
};

const apiLimit = exports.limiter({ windowMs: 60 * 1000, max: rateLimitPerMin });
exports.rateLimit = (req, res, next) => {
  if (apiLimit.blocked(req.ip)) return res.status(429).json({ error: 'rate_limited' });
  apiLimit.hit(req.ip);
  next();
};

/** Одна строка на запрос: метод, путь БЕЗ query (там может быть initData), код, время. */
exports.requestLog = (req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/assets') || req.path.startsWith('/vendor')) return;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - started}ms`);
  });
  next();
};
