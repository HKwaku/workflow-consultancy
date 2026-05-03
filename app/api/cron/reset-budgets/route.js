/**
 * GET /api/cron/reset-budgets
 *
 * Vercel Cron — runs daily; the SQL function is a no-op for orgs whose period
 * hasn't crossed a month boundary, so we can safely run more often than once
 * a month without risk of double-resets.
 *
 * Calls reset_monthly_budgets() which zeroes tokens_consumed_this_month and
 * clears budget_alerted_at_80pct for any org whose budget_period_started_at
 * is older than the start of the current month.
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase,
} from '@/lib/api-helpers';
import { withCron } from '@/lib/cronWrapper';
import { logger } from '@/lib/logger';

export const GET = withCron('reset-budgets', async () => {
  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  const resp = await fetchWithTimeout(
    `${sb.url}/rest/v1/rpc/reset_monthly_budgets`,
    {
      method: 'POST',
      headers: { ...getSupabaseWriteHeaders(sb.key), 'Content-Type': 'application/json' },
      body: '{}',
    },
  );
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    // Throwing here lets withCron capture to Sentry. Returning 502 used to
    // hide the failure in the success-rate dashboard.
    throw new Error(`reset_monthly_budgets RPC failed (${resp.status}): ${txt.slice(0, 200)}`);
  }
  const rowsReset = await resp.json();
  logger.info('Monthly budgets reset', { rowsReset });
  return NextResponse.json({ ok: true, rowsReset });
});
