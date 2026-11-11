// API для сервиса менторов (/integration-api, ключ INTEGRATION_KEY):
// GET  /absences         — ученики с пропусками за период (как «Ученики с пропусками» в админке, по всем преподавателям);
// POST /absence-feedback — обратная связь менторов: статус, причина, дата.
const express = require('express');
const integrationAuth = require('../middleware/integrationAuth');
const c = require('../controllers/integrationController');

const router = express.Router();
router.use(integrationAuth);
router.get('/absences', c.absences);
router.post('/absence-feedback', c.saveFeedback);

module.exports = router;
