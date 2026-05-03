/**
 * Server-side Sentry init (Node runtime). Loaded via instrumentation.js when
 * Next.js boots a Node lambda. Edge runtime uses sentry.edge.config.js.
 */
import * as Sentry from '@sentry/nextjs';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: 0.1,
  });
}
