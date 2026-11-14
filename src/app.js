const path = require('path');
const express = require('express');
const compression = require('compression');
const adminRoutes = require('./routes/adminRoutes');
const apiRoutes = require('./routes/apiRoutes');
const integrationRoutes = require('./routes/integrationRoutes');
const attendanceApiRoutes = require('./routes/attendanceApiRoutes');
const { errorHandler } = require('./middleware/errorHandler');
const { securityHeaders, rateLimit, requestLog } = require('./middleware/security');
const { pool } = require('./config/db');
const { trustProxy } = require('./config/env');

const app = express();
app.disable('x-powered-by');
if (trustProxy) app.set('trust proxy', 1);              // за cloudflared / nginx берём реальный IP

app.use(requestLog);
app.use(securityHeaders);
app.use(compression());                                  // gzip: список отметок и выгрузки — мегабайты JSON
app.use('/integration-api', rateLimit, express.json({ limit: '2mb' }), integrationRoutes);   // сервис менторов: свой лимит тела
app.use('/attendance-api/v1', attendanceApiRoutes);     // кабинет ученика / боты-кураторы: только чтение, своя квота
app.use(express.json({ limit: '300kb' }));

app.get('/healthz', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: 1 }); }
  catch { res.status(503).json({ ok: 0 }); }
});

app.use('/api', rateLimit, apiRoutes);
app.use(adminRoutes);
app.use(express.static(path.join(__dirname, '../public'), { maxAge: '1h', index: 'index.html' }));   // мини-апп

app.use((req, res) => res.status(404).json({ error: 'not_found' }));
app.use(errorHandler);
module.exports = app;
