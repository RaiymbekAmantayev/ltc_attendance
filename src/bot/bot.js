// Бот: отвечает на /start и /id (Telegram ID + кнопка мини-аппа). Long polling, без сторонних библиотек.
const { botToken, appUrl, telegramApiBase } = require('../config/env');

const isHttps = /^https:\/\//.test(appUrl);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const telegram = (method, body) =>
  fetch(`${telegramApiBase}/bot${botToken}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(r => r.json());

async function handleMessage(message) {
  if (!/^\/(start|id|help)\b/.test(message?.text || '')) return;
  const hint = isHttps
    ? 'Откройте кабинет кнопкой ниже. / Open the cabinet with the button below.'
    : 'В .env нужен APP_URL с https-адресом.';
  await telegram('sendMessage', {
    chat_id: message.chat.id,
    text: `Ваш Telegram ID / Your Telegram ID: ${message.from.id}\n\n${hint}`,
    reply_markup: isHttps ? { inline_keyboard: [[{ text: 'Открыть кабинет · Open', web_app: { url: appUrl } }]] } : undefined,
  });
}

/** Начальная настройка бота. Повторяется, пока Telegram недоступен. */
async function setup() {
  await telegram('deleteWebhook', {});
  if (isHttps) {
    await telegram('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Кабинет', web_app: { url: appUrl } } });
  }
  await telegram('setMyCommands', { commands: [
    { command: 'start', description: 'Открыть кабинет / Open cabinet' },
    { command: 'id', description: 'Мой Telegram ID / My Telegram ID' },
  ] });
  const me = await telegram('getMe', {});
  console.log('bot: запущен как @' + (me.result?.username || '?'));
}

exports.startBot = async () => {
  for (;;) {
    try { await setup(); break; }
    catch (error) {
      console.error('bot: нет связи с Telegram, повтор через 10 с —', error.cause?.code || error.message);
      await sleep(10000);
    }
  }

  let offset = 0;
  for (;;) {
    try {
      const { result = [] } = await telegram('getUpdates', { offset, timeout: 30, allowed_updates: ['message'] });
      for (const update of result) { offset = update.update_id + 1; await handleMessage(update.message); }
    } catch (error) {
      console.error('bot:', error.message);
      await sleep(3000);
    }
  }
};
