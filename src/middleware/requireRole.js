const { AppError } = require('./errorHandler');

/** Пускает только перечисленные роли. Директор из DIRECTOR_TG_IDS имеет роль director. */
module.exports = (...roles) => (req, res, next) =>
  roles.includes(req.teacher?.role) ? next() : next(new AppError(403, 'forbidden'));
