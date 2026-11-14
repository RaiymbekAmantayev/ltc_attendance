require('dotenv').config();

const env = process.env;
const flag = (name, def = false) => (env[name] == null || env[name] === '' ? def : /^(1|true|yes|on)$/i.test(env[name]));
const num = (name, def = null) => (env[name] == null || env[name] === '' || Number.isNaN(Number(env[name])) ? def : Number(env[name]));
const list = name => String(env[name] || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);

const mock = flag('HH_MOCK');
const required = ['BOT_TOKEN', 'DATABASE_URL', ...(mock ? [] : ['HH_DOMAIN', 'HH_AUTHKEY'])];
const missing = required.filter(name => !env[name]);
if (missing.length) {
  console.error('Не заданы переменные в .env: ' + missing.join(', '));
  process.exit(1);
}

module.exports = {
  port: num('PORT', 3000),
  host: env.HOST || undefined,                                         // на сервере 127.0.0.1 — наружу только через Caddy
  botToken: env.BOT_TOKEN,
  appUrl: env.APP_URL || '',
  telegramApiBase: (env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/$/, ''),
  databaseUrl: env.DATABASE_URL,
  timezone: env.APP_TZ || 'Asia/Almaty',
  hollihop: {
    mock,
    domain: String(env.HH_DOMAIN || '').split('#')[0].trim(),   // на случай комментария в строке
    authKey: String(env.HH_AUTHKEY || '').trim(),
  },
  auditRetentionDays: num('AUDIT_RETENTION_DAYS', 365),
  admin: { user: env.ADMIN_USER || 'admin', pass: env.ADMIN_PASS || '' },
  integrationKey: String(env.INTEGRATION_KEY || '').trim(),           // ключ сервиса менторов (/integration-api); пусто — закрыто
  attendanceApi: {                                                     // /attendance-api/v1 — чтение данных кабинета (кабинет ученика, боты-кураторы)
    key: String(env.ATTENDANCE_API_KEY || '').trim(),                  // пусто — API закрыт
    ratePerMin: num('ATTENDANCE_API_RATE_PER_MIN', 60),                // запросов в минуту с одного IP
    maxConcurrent: num('ATTENDANCE_API_MAX_CONCURRENT', 3),            // одновременных запросов на весь API (защита БД)
    ips: list('ATTENDANCE_API_IPS'),                                   // IP-allowlist; пусто — без ограничения по IP
  },
  directorTelegramIds: list('DIRECTOR_TG_IDS'),
  rules: {
    testRequired: true,                                                // ежедневный тест обязателен всегда (TEST_REQUIRED больше не читается)
    commentRequired: true,                                             // тема урока обязательна всегда (COMMENT_REQUIRED больше не читается)
    commentMaxLen: num('COMMENT_MAX_LEN', 500),
    homeworkRequired: true,                                            // домашнее задание обязательно: в HollyHop — строкой «Дз/Hw:» под темой
    homeworkMaxLen: 500,
  },
  lowFillThreshold: num('LOW_FILL_THRESHOLD', 3),
  initDataMaxAge: num('INITDATA_MAX_AGE', 86400),
  rateLimitPerMin: num('RATE_LIMIT_PER_MIN', 120),
  trustProxy: flag('TRUST_PROXY', true),
};
