/**
 * Cron handler wrapper. Couples to Next.js (uses NextResponse) so it lives
 * separately from lib/cronAuth.js — the auth helper is test-friendly without
 * pulling Next into the unit-test sandbox.
 *
 * Three responsibilities:
 *   1. CRON_SECRET check (delegates to isAuthorisedCron).
 *   2. cron_run_log open/close so SOC 2 evidence has cron history without
 *      depending on Vercel Cron logs (which expire). The handler can return
 *      a JSON body with `metrics` and we'll persist that to the row.
 *   3. Top-level try/catch so any throw flows through logger.error → Sentry.
 *      Without this, a cron that 500s every run is invisible until a
 *      customer notices.
 *
 * Usage:
 *   export const GET = withCron('reap-stuck-documents', async (request) => {
 *     // ... main logic; can throw ...
 *     return NextResponse.json({ ok: true, processed: 3 });
 *   });
 *
 * If the handler returns a NextResponse whose JSON body contains `metrics`,
 * `processed`, or other numeric fields, those are forwarded to the cron_run_log
 * row's `metrics` jsonb column for the auditor.
 */

import { NextResponse } from 'next/server';
import { isAuthorisedCron } from './cronAuth.js';
import { logger } from './logger.js';
import { fetchWithTimeout, getSupabaseHeaders, requireSupabase } from './api-helpers.js';

async function cronRunOpen(jobName, requestId) {
  try {
    const sb = requireSupabase();
    if (!sb) return null;
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/rpc/cron_run_open`,
      {
        method: 'POST',
        headers: { ...getSupabaseHeaders(sb.key), 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_job_name: jobName, p_request_id: requestId }),
      },
      5000,
    );
    if (!resp.ok) return null;
    const id = await resp.json().catch(() => null);
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

async function cronRunClose(id, status, metrics, errorMessage) {
  if (!id) return;
  try {
    const sb = requireSupabase();
    if (!sb) return;
    await fetchWithTimeout(
      `${sb.url}/rest/v1/rpc/cron_run_close`,
      {
        method: 'POST',
        headers: { ...getSupabaseHeaders(sb.key), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p_id: id,
          p_status: status,
          p_metrics: metrics || {},
          p_error_message: errorMessage || null,
        }),
      },
      5000,
    );
  } catch {
    // Don't let audit-write failure mask the cron's actual outcome.
  }
}

// Pull a metrics object from whatever the handler returned so SOC 2 evidence
// captures things like "processed N accounts" without each cron repeating
// the persistence boilerplate.
function extractMetrics(response) {
  try {
    if (!response || typeof response.clone !== 'function') return {};
    // Best-effort: peek at the body. NextResponse exposes .json() but consuming
    // it would prevent the original return from being read by Next. We clone.
    return null; // resolved by caller via parseBodyMetrics(); kept for type hint
  } catch {
    return {};
  }
}

async function parseBodyMetrics(response) {
  try {
    if (!response || typeof response.clone !== 'function') return {};
    const cloned = response.clone();
    const body = await cloned.json().catch(() => null);
    if (!body || typeof body !== 'object') return {};
    // Extract anything that looks like a counter or the explicit `metrics` field.
    const out = {};
    if (body.metrics && typeof body.metrics === 'object') Object.assign(out, body.metrics);
    for (const [k, v] of Object.entries(body)) {
      if (k === 'metrics') continue;
      if (typeof v === 'number') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function withCron(name, handler) {
  return async function cronWrapper(request, ctx) {
    if (!isAuthorisedCron(request)) {
      return NextResponse.json({ error: 'Unauthorised.' }, { status: 401 });
    }
    const requestId = request?.headers?.get?.('x-vercel-id')
      || request?.headers?.get?.('x-request-id')
      || null;
    const startedAt = Date.now();
    const runId = await cronRunOpen(name, requestId);

    try {
      const result = await handler(request, ctx);
      const metrics = await parseBodyMetrics(result);
      await cronRunClose(runId, 'success', metrics, null);
      logger.info(`cron:${name} completed`, { durationMs: Date.now() - startedAt, ...metrics });
      return result;
    } catch (err) {
      const message = err?.message || String(err);
      await cronRunClose(runId, 'failed', {}, message);
      // Sentry capture happens via logger.error's hook (lib/logger.js).
      logger.error(`cron:${name} failed`, {
        cron: name,
        durationMs: Date.now() - startedAt,
        error: err,
      });
      return NextResponse.json(
        { error: `cron:${name} failed`, message },
        { status: 500 },
      );
    }
  };
}

// extractMetrics is exported for tests that want to mock body-shape parsing.
export { extractMetrics };
