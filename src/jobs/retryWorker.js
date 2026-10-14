const Submission = require('../models/submissionModel');
const Audit = require('../models/auditModel');
const submissions = require('../services/submissionService');
const { auditRetentionDays } = require('../config/env');

let lastPurge = 0;

/** Раз в минуту: дошлёт частично записанные отметки; раз в сутки чистит старый аудит-лог. */
exports.startRetryWorker = () => {
  const timer = setInterval(async () => {
    try {
      for (const { idem_key } of await Submission.findRetryable()) await submissions.push(idem_key);
      if (Date.now() - lastPurge > 24 * 3600 * 1000) { await Audit.purgeOlderThan(auditRetentionDays); lastPurge = Date.now(); }
    } catch (error) {
      console.error('worker:', error.message);
    }
  }, 60 * 1000);
  return timer;
};
