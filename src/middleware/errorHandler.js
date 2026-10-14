class AppError extends Error {
  /** status — HTTP-код, message — машинный код ошибки для клиента, extra — дополнительные поля ответа. */
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

// Express 5 сам передаёт сюда отклонённые промисы из async-обработчиков.
const errorHandler = (error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof AppError) return res.status(error.status).json({ error: error.message, ...error.extra });
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' });
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
  console.error(`${req.method} ${req.path}:`, error);
  res.status(500).json({ error: 'server' });
};

module.exports = { AppError, errorHandler };
