/**
 * Browser-side Sentry init. Only runs when SENTRY_DSN (or NEXT_PUBLIC_SENTRY_DSN)
 * is set; otherwise the import is a no-op so dev builds stay fast.
 *
 * Sample rate notes:
 *  - tracesSampleRate 0.1 = 10% of transactions traced; tune up if you have
 *    low traffic and want richer perf data.
 *  - replaysOnErrorSampleRate 1.0 = capture replay for every error session
 *    so we can see what the user did before it broke.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV || 'development',
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0.0,
    // Drop noisy / non-actionable errors at the edge.
    ignoreErrors: [
      'AbortError',                 // user navigated away mid-request
      'NetworkError',
      'Failed to fetch',
      'Load failed',
      /ResizeObserver loop/,
    ],
  });
}
