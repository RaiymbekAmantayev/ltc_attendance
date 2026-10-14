/* Если telegram.org недоступен (блокировка сети) — берём локальную копию SDK. Внутри Telegram срабатывает основной скрипт. */
if (!window.Telegram || !window.Telegram.WebApp) document.write('<script src="/vendor/telegram-web-app.js"><\/script>');
