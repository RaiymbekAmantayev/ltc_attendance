// API для кабинета ученика и ботов-кураторов LTC (/attendance-api/v1, ключ ATTENDANCE_API_KEY), только чтение.
// Документация — docs/attendance-api.md. Порядок защиты: IP-allowlist → квота (запросы/мин и одновременные) → ключ.
const express = require('express');
const { keyAuth } = require('../middleware/integrationAuth');
const { apiQuota, ipAllowlist } = require('../middleware/security');
const { attendanceApi } = require('../config/env');
const c = require('../controllers/attendanceApiController');

const router = express.Router();
router.use(ipAllowlist(attendanceApi.ips));
router.use(apiQuota({ perMin: attendanceApi.ratePerMin, maxConcurrent: attendanceApi.maxConcurrent }));
router.use(keyAuth(attendanceApi.key));
router.use((req, res, next) => (req.method === 'GET' || req.method === 'HEAD' ? next() : res.status(405).set('Allow', 'GET').json({ error: 'read_only' })));

router.get('/meta', c.meta);
router.get('/students', c.students);
router.get('/teachers', c.teachers);
router.get('/groups', c.groups);
router.get('/lessons', c.lessons);
router.get('/tests', c.tests);

module.exports = router;
