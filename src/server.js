const { port, hollihop } = require('./config/env');
const app = require('./app');
const { pool } = require('./config/db');
const { startBot } = require('./bot/bot');
const { startRetryWorker } = require('./jobs/retryWorker');

const server = app.listen(port, () => console.log(`LTC cabinet on :${port}${hollihop.mock ? ' (HH_MOCK: демо-режим HollyHop)' : ''}`));
if (process.env.BOT_DISABLED === '1') console.log('bot: отключён (BOT_DISABLED=1)');
else startBot().catch(error => console.error('bot:', error));
const worker = startRetryWorker();

// Аккуратная остановка: дать завершиться запросам и закрыть соединения с БД.
const shutdown = () => { clearInterval(worker); server.close(() => pool.end().finally(() => process.exit(0))); setTimeout(() => process.exit(0), 8000).unref(); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
