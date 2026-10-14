// API мини-аппа. Все маршруты защищены проверкой Telegram initData.
const router = require('express').Router();
const telegramAuth = require('../middleware/telegramAuth');
const requireRole = require('../middleware/requireRole');
const lessons = require('../controllers/lessonController');
const dash = require('../controllers/dashController');

router.use(telegramAuth);

// Преподаватель (и любая роль для собственного профиля)
router.get('/me', lessons.me);
router.get('/lessons', lessons.listLessons);
router.get('/groups/:id/students', lessons.groupStudents);
router.post('/lessons', lessons.saveLesson);
router.get('/profile', lessons.profile);

// Директор и координатор
const staff = requireRole('coordinator', 'director');
router.get('/dash/overview', staff, dash.overview);
router.get('/dash/today', staff, dash.today);
router.get('/dash/groups', staff, dash.groups);
router.get('/dash/groups/:id', staff, dash.groupDetail);
router.get('/dash/teachers', staff, dash.teachers);
router.get('/dash/staff', staff, dash.staff);
router.get('/dash/substitutions', staff, dash.substitutions);
router.post('/dash/substitutions', staff, dash.addSubstitution);
router.delete('/dash/substitutions/:id', staff, dash.removeSubstitution);

module.exports = router;
