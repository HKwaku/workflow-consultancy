/**
 * Next.js instrumentation hook. Runs once per server boot, before any route.
 * Loads the runtime-appropriate Sentry config so server + edge errors are
 * captured. Browser init lives in sentry.client.config.js (loaded by Next).
 *
 * Skipped in dev: @sentry/nextjs ^9 pulls in 30+ OpenTelemetry
 * instrumentations (redis-4, mongodb, mysql, ioredis, pg, pino, ...) and
 * the bundled require-in-the-middle resolver crashes on Windows during
 * `next dev`. Sentry only matters in production (where it's actually
 * deployed and DSN is set), so dev short-circuits before touching OTel.
 * Override with FORCE_SENTRY=1 if you specifically need to debug it.
 */
export async function register() {
  if (!process.env.SENTRY_DSN) return;
  if (process.env.NODE_ENV !== 'production' && !process.env.FORCE_SENTRY) return;
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config.js');
  } else if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config.js');
  }
}
