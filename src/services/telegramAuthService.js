const crypto = require('crypto');
const { botToken, initDataMaxAge } = require('../config/env');

/** Проверяет подпись initData от Telegram (HMAC-SHA256) и его свежесть. Возвращает пользователя или null. */
exports.verifyInitData = (rawInitData, token = botToken, maxAge = initDataMaxAge) => {
  if (!rawInitData || rawInitData.length > 4096) return null;
  const params = new URLSearchParams(rawInitData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

  if (expected.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(hash))) return null;
  const age = Date.now() / 1000 - Number(params.get('auth_date'));
  if (!(age <= maxAge) || age < -60) return null;           // просрочена или «из будущего»

  try { const user = JSON.parse(params.get('user')); return user && user.id ? user : null; } catch { return null; }
};
