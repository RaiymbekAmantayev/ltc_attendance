// Уведомления сотрудникам в Telegram от имени бота. Без ожидания и без ошибок наружу: уведомление не должно ломать действие.
const { botToken, telegramApiBase } = require('../config/env');

exports.notify = (chatId, text) => {
  if (!chatId || process.env.NODE_TEST_CONTEXT || process.env.BOT_NOTIFY === '0') return;   // в автотестах не шлём
  fetch(`${telegramApiBase}/bot${botToken}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: String(chatId), text }),
    signal: AbortSignal.timeout(10000),
  }).then(r => r.json()).then(r => { if (!r.ok) console.warn('bot notify:', r.description); })
    .catch(error => console.warn('bot notify:', error.message));
};
