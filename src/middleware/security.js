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
  if (/^\/(api|admin-api|attendance-api)\b/.test(req.path)) res.set('Cache-Control', 'no-store');
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
    count: key => fresh(key).length,
    /** Через сколько мс освободится место в окне (0 — уже свободно). */
    resetIn: key => { const list = fresh(key); return list.length < max ? 0 : Math.max(0, windowMs - (Date.now() - list[list.length - max])); },
  };
};

/**
 * Квота внешнего API: perMin запросов в минуту с IP и не больше maxConcurrent запросов одновременно на весь API.
 * Заголовки X-RateLimit-Limit / X-RateLimit-Remaining; при превышении — 429 с Retry-After (секунды).
 */
exports.apiQuota = ({ perMin, maxConcurrent }) => {
  const window = exports.limiter({ windowMs: 60 * 1000, max: perMin });
  let inFlight = 0;
  return (req, res, next) => {
    res.set('X-RateLimit-Limit', String(perMin));
    if (window.blocked(req.ip)) {
      res.set({ 'Retry-After': String(Math.max(1, Math.ceil(window.resetIn(req.ip) / 1000))), 'X-RateLimit-Remaining': '0' });
      return res.status(429).json({ error: 'rate_limited' });
    }
    window.hit(req.ip);
    res.set('X-RateLimit-Remaining', String(Math.max(0, perMin - window.count(req.ip))));
    if (inFlight >= maxConcurrent) {
      res.set('Retry-After', '2');
      return res.status(429).json({ error: 'too_many_concurrent' });
    }
    inFlight++;
    let done = false;
    const release = () => { if (!done) { done = true; inFlight--; } };
    res.on('finish', release);
    res.on('close', release);
    next();
  };
};

/** Доступ только с перечисленных IP (пустой список — с любого). */
exports.ipAllowlist = ips => (req, res, next) => (!ips.length || ips.includes(req.ip) || ips.includes(String(req.ip).replace(/^::ffff:/, ''))
  ? next() : res.status(403).json({ error: 'ip_not_allowed' }));

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
