// Общая обвязка тестов: отдельная база ltc_test, демо-режим HollyHop, подписанный initData.
const crypto = require('crypto');
const path = require('path');
const { execFileSync } = require('child_process');

const DB_URL = process.env.TEST_DATABASE_URL || 'mysql://root:@127.0.0.1:3306/ltc_test';
Object.assign(process.env, {
  BOT_TOKEN: '123456:TEST-TOKEN', DATABASE_URL: DB_URL, HH_MOCK: '1', ADMIN_USER: 'admin', ADMIN_PASS: 'secret',
  DIRECTOR_TG_IDS: '999', HH_RETRY_BASE_MS: '1', HH_CACHE_TTL_MS: '0', APP_TZ: 'Asia/Almaty',
  ...(global.__TEST_ENV__ || {}),
});

const mysql = require('mysql2/promise');
const mock = require('../src/services/hollihopMock');

exports.mock = mock;
exports.WED = '2026-10-14';                              // среда: «нечётные» группы (Пн/Ср/Пт) и «будни»
exports.TUE = '2026-10-13';

exports.setupDb = async () => {
  execFileSync('node', [path.join(__dirname, '../scripts/init-db.js')], { env: process.env, stdio: 'pipe' });
  const url = new URL(DB_URL);
  const db = await mysql.createConnection({ uri: DB_URL });
  await db.query('SET FOREIGN_KEY_CHECKS=0');
  for (const t of ['audit_log', 'submissions', 'substitutions', 'teachers', 'ktp_topics', 'ktp_categories']) await db.query(`TRUNCATE ${t}`);
  await db.query('SET FOREIGN_KEY_CHECKS=1');
  exports.db = db;
  return db;
};

exports.addTeacher = async (fields) => {
  const row = { telegram_id: null, hollihop_id: null, full_name: 'T', branch: 'Абая', lang: 'ru', role: 'teacher', active: 1, ...fields };
  const [r] = await exports.db.query(
    'INSERT INTO teachers (telegram_id, hollihop_id, full_name, branch, lang, role, active) VALUES (?,?,?,?,?,?,?)',
    [row.telegram_id, row.hollihop_id, row.full_name, row.branch, row.lang, row.role, row.active]);
  return r.insertId;
};

/** Подписанный initData, как его присылает Telegram. */
exports.initData = (userId, { authDate = Math.floor(Date.now() / 1000), token = process.env.BOT_TOKEN, tamper = false } = {}) => {
  const params = new URLSearchParams({ auth_date: String(authDate), query_id: 'AAH', user: JSON.stringify({ id: userId, first_name: 'Test' }) });
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(check).digest('hex'));
  if (tamper) params.set('user', JSON.stringify({ id: userId + 1 }));
  return params.toString();
};

exports.start = async () => {
  const app = require('../src/app');
  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, url, { tg, admin, body, headers = {} } = {}) => {
    const h = { 'Content-Type': 'application/json', ...headers };
    if (tg != null) h['x-init-data'] = typeof tg === 'string' ? tg : exports.initData(tg);
    if (admin) h.authorization = 'Basic ' + Buffer.from(admin === true ? 'admin:secret' : admin).toString('base64');
    const res = await fetch(base + url, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    let json = null; const text = await res.text();
    try { json = JSON.parse(text); } catch { /* не JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  const close = async () => { await new Promise(r => server.close(r)); await require('../src/config/db').pool.end(); await exports.db.end(); };
  return { request, close, base };
};

exports.uuid = () => crypto.randomUUID();
