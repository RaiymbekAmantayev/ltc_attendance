// Админка: страница /admin и её API /admin-api (Basic-auth).
const path = require('path');
const express = require('express');
const adminAuth = require('../middleware/adminAuth');
const c = require('../controllers/adminController');
const ktp = require('../controllers/ktpController');

const router = express.Router();
const API = '/admin-api';

router.use(['/admin', API], adminAuth);
router.use('/admin', express.static(path.join(__dirname, '../../admin')));

router.get(API + '/config', c.config);
router.get(API + '/overview', c.overview);
router.get(API + '/today', c.today);
router.get(API + '/teacher-stats', c.teacherStats);

router.get(API + '/teachers', c.listTeachers);
router.post(API + '/teachers', c.saveTeacher);
router.post(API + '/teachers/import', c.importTeachers);

router.get(API + '/groups', c.listGroups);
router.get(API + '/substitutions', c.listSubstitutions);
router.post(API + '/substitutions', c.addSubstitution);
router.delete(API + '/substitutions/:id', c.removeSubstitution);

router.get(API + '/submissions', c.listSubmissions);
router.post(API + '/submissions/:key/retry', c.retrySubmission);
router.get(API + '/audit', c.listAudit);

router.get(API + '/ktp/levels', ktp.levels);
router.get(API + '/ktp/categories', ktp.listCategories);
router.post(API + '/ktp/categories', ktp.saveCategory);
router.delete(API + '/ktp/categories/:id', ktp.removeCategory);
router.get(API + '/ktp/topics', ktp.listTopics);
router.post(API + '/ktp/topics', ktp.saveTopic);
router.post(API + '/ktp/topics/import', ktp.importTopics);
router.delete(API + '/ktp/topics/:id', ktp.removeTopic);

module.exports = router;
