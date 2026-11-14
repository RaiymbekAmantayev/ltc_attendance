// Внешний API только для чтения: данные отметок кабинета для кабинета ученика и ботов-кураторов LTC.
const service = require('../services/attendanceApiService');
const { attendanceApi } = require('../config/env');

exports.lessons = async (req, res) => res.json(await service.lessons(req.query));
exports.tests = async (req, res) => res.json(await service.tests(req.query));
exports.students = async (req, res) => res.json(await service.students(req.query));
exports.groups = async (req, res) => res.json(await service.groups(req.query));
exports.teachers = async (req, res) => res.json(await service.teachers(req.query));
exports.meta = (req, res) => res.json(service.meta(attendanceApi));
