const path = require('path');
const express = require('express');
const adminRoutes = require('./routes/adminRoutes');
const apiRoutes = require('./routes/apiRoutes');
const { errorHandler } = require('./middleware/errorHandler');
const { securityHeaders, rateLimit, requestLog } = require('./middleware/security');
const { pool } = require('./config/db');
const { trustProxy } = require('./config/env');

const app = express();
app.disable('x-powered-by');
if (trustProxy) app.set('trust proxy', 1);              // за cloudflared / nginx берём реальный IP

app.use(requestLog);
app.use(securityHeaders);
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
