/**
 * Structured logger for production. Outputs JSON for log aggregation.
 * Include requestId in meta for correlation: logger.error('msg', { requestId, error: ... })
 */
const levels = { debug: 0, info: 1, warn: 2, error: 3 };
const minLevel = levels[process.env.LOG_LEVEL || 'info'] ?? 1;

function log(level, message, meta = {}) {
  if (levels[level] < minLevel) return;
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };
  const out = JSON.stringify(entry);
  if (level === 'error') console.error(out);
  else if (level === 'warn') console.warn(out);
  else console.log(out);
}

export const logger = {
  debug: (msg, meta) => log('debug', msg, meta),
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
};
