/**
 * GET /api/health
 *
 * Synthetic-monitor target. Vendor uptime monitors (Better Stack / Statuspage /
 * Pingdom) hit this every 1-5 minutes; the response shape is contract.
 *
 * Stable shape:
 *   {
 *     ok: boolean,                              // overall — drives 200 vs 503
 *     timestamp: ISO string,
 *     version: git SHA when on Vercel,
 *     checks: {
 *       database:  'ok' | 'fail' | 'not-configured',
 *       anthropic: 'ok' | 'not-configured',     // env presence only — we don't burn a token to test
 *       sentry:    'ok' | 'not-configured',
 *       inngest:   'ok' | 'not-configured',
 *       voyage:    'ok' | 'not-configured',
 *     },
 *     latencyMs: { database: number },
 *   }
 *
 * Health rules:
 *   - `database: fail` OR `database: not-configured`  → ok=false (503)
 *   - everything else missing → ok=true (degraded, see notes below)
 *
 * The Anthropic / Voyage checks are env-presence only on purpose. A live
 * call would (a) cost real tokens on every monitor poll and (b) couple our
 * uptime to the vendor's uptime — we'd flap whenever Anthropic has a
 * minor blip. Vendor health belongs in their own status page, not ours.
 *
 * Sub-200ms target. The DB check is a `SELECT 1` against PostgREST root —
 * lightest possible round-trip.
 */

import { NextResponse } from 'next/server';
import { requireSupabase, getRequestId, fetchWithTimeout, getSupabaseHeaders } from '@/lib/api-helpers';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export const maxDuration = 10;

async function checkDatabase(sb) {
  if (!sb) return { status: 'not-configured', latencyMs: null };
  const started = Date.now();
  try {
    // PostgREST root returns 200 with a service description. Cheapest
    // possible reachability test that proves auth + connectivity.
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
      3000,
    );
    const latencyMs = Date.now() - started;
    return { status: resp.ok ? 'ok' : 'fail', latencyMs, httpStatus: resp.ok ? undefined : resp.status };
  } catch (e) {
    return { status: 'fail', latencyMs: Date.now() - started, error: e.message };
  }
}

export async function GET(request) {
  // Rate-limit so a misbehaving monitor can't DoS us. 60 req/min is well
  // above any reasonable poll cadence (1/min from one vendor = 60/h).
  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } },
    );
  }

  const requestId = getRequestId(request);
  const sb = requireSupabase();

  const dbCheck = await checkDatabase(sb);

  // Inngest function registration check. We can introspect the registry
  // directly (importing the serve handler triggers function registration
  // as a side-effect) so a misconfigured INNGEST_SIGNING_KEY can't leave
  // the cron silently no-op'd. Reports the count of registered functions;
  // ops can compare against the expected baseline.
  let inngestStatus;
  let registeredFunctions = null;
  if (!(process.env.INNGEST_EVENT_KEY || process.env.INNGEST_DEV)) {
    inngestStatus = 'not-configured';
  } else {
    try {
      const [{ processDealDocument }, { runDealAnalysis }, { syncConnectorBinding }] = await Promise.all([
        import('@/lib/inngest/functions/processDealDocument'),
        import('@/lib/inngest/functions/runDealAnalysis'),
        import('@/lib/inngest/functions/syncConnectorBinding'),
      ]);
      registeredFunctions = [processDealDocument, runDealAnalysis, syncConnectorBinding]
        .filter((f) => typeof f === 'object' && (f.id || f.opts?.id))
        .map((f) => f.id || f.opts?.id || 'unknown');
      inngestStatus = registeredFunctions.length > 0 ? 'ok' : 'fail';
    } catch (e) {
      inngestStatus = 'fail';
      logger.warn('Inngest registry probe failed', { requestId, error: e.message });
    }
  }

  const checks = {
    database:  dbCheck.status,
    anthropic: process.env.ANTHROPIC_API_KEY ? 'ok' : 'not-configured',
    sentry:    process.env.SENTRY_DSN        ? 'ok' : 'not-configured',
    inngest:   inngestStatus,
    voyage:    process.env.VOYAGE_API_KEY    ? 'ok' : 'not-configured',
    mistral:   process.env.MISTRAL_API_KEY   ? 'ok' : 'not-configured',
  };

  // Only the database check breaks `ok`. Optional vendors degrade silently
  // (the app handles their absence; a missing Voyage key just disables
  // semantic search, not the whole app).
  const ok = dbCheck.status === 'ok';

  const body = {
    ok,
    timestamp: new Date().toISOString(),
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'dev',
    checks,
    latencyMs: { database: dbCheck.latencyMs },
    ...(registeredFunctions ? { inngestFunctions: registeredFunctions } : {}),
  };

  if (!ok) {
    logger.error('Health check unhealthy', {
      requestId, checks, dbCheck,
      // tagged so Sentry can group cleanly
      health_failure: true,
    });
  }

  return NextResponse.json(body, {
    status: ok ? 200 : 503,
    headers: {
      // Vendors rely on freshness — never let a CDN cache this.
      'Cache-Control': 'no-store, must-revalidate',
    },
  });
}
