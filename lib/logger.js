/**
 * Structured logger for production. Outputs JSON for log aggregation.
 * Include requestId in meta for correlation: logger.error('msg', { requestId, error: ... })
 *
 * When SENTRY_DSN is set, every logger.error() ALSO captures to Sentry with
 * the meta object as context. Sentry is loaded lazily so dev / CI without
 * the dep installed still works (the require is wrapped in try/catch).
 */
const levels = { debug: 0, info: 1, warn: 2, error: 3 };
const minLevel = levels[process.env.LOG_LEVEL || 'info'] ?? 1;

let _sentry = null;
let _sentryAttempted = false;

function getSentry() {
  if (_sentryAttempted) return _sentry;
  _sentryAttempted = true;
  if (!process.env.SENTRY_DSN) return null;
  try {
    // Dynamic require so envs without @sentry/nextjs installed still boot.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _sentry = require('@sentry/nextjs');
  } catch {
    _sentry = null;
  }
  return _sentry;
}

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

  // Capture errors to Sentry. We treat `meta.error` (string OR Error) as the
  // primary exception payload; everything else becomes context.
  if (level === 'error') {
    const sentry = getSentry();
    if (sentry) {
      try {
        const errPayload = meta?.error;
        const exception = errPayload instanceof Error
          ? errPayload
          : new Error(typeof errPayload === 'string' ? errPayload : message);
        sentry.captureException(exception, {
          tags: meta?.requestId ? { requestId: meta.requestId } : undefined,
          extra: { message, ...meta },
        });
      } catch { /* never let logging break the app */ }
    }
  }
}

export const logger = {
  debug: (msg, meta) => log('debug', msg, meta),
  info:  (msg, meta) => log('info',  msg, meta),
  warn:  (msg, meta) => log('warn',  msg, meta),
  error: (msg, meta) => log('error', msg, meta),
};
