/**
 * /api/organizations/[orgId]/budget
 *
 * Admin-only management of the org's monthly token budget.
 *
 * GET   - returns { monthly_token_budget, tokens_consumed_this_month, ... }
 * PATCH - body: { monthly_token_budget: number|null }. NULL = unlimited.
 *
 * The cost-guard cache in lib/costGuard.js doesn't need explicit
 * invalidation — the org row is read fresh on each preflightTokenBudget
 * call (no caching there). Future: add a _cache.delete after PATCH if/when
 * we add a budget cache.
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase,
  checkOrigin, getRequestId,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireOrgAdminOrPlatformAdmin } from '@/lib/orgAdmin';
import { logger } from '@/lib/logger';

export const maxDuration = 15;

const MAX_BUDGET = 1_000_000_000_000; // 1 trillion tokens — sanity limit; "unlimited" should use NULL

async function gate(request, orgId) {
  const auth = await requireAuth(request);
  if (auth.error) return { error: NextResponse.json(auth.error.body, { status: auth.error.status }) };
  const sb = getSupabaseAdmin();
  if (!sb) return { error: NextResponse.json({ error: 'Storage not configured.' }, { status: 503 }) };
  const g = await requireOrgAdminOrPlatformAdmin(sb, orgId, auth.userId, auth.email);
  if (g.error) return { error: NextResponse.json({ error: g.error }, { status: g.status }) };
  return { auth };
}

export async function GET(request, { params }) {
  const { orgId } = await params;
  const g = await gate(request, orgId);
  if (g.error) return g.error;

  const sb = requireSupabase();
  const resp = await fetchWithTimeout(
    `${sb.url}/rest/v1/organizations?id=eq.${orgId}&select=id,name,monthly_token_budget,tokens_consumed_this_month,budget_period_started_at,budget_alerted_at_80pct`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  if (!resp.ok) return NextResponse.json({ error: 'Failed to load budget.' }, { status: 502 });
  const [row] = await resp.json();
  if (!row) return NextResponse.json({ error: 'Org not found.' }, { status: 404 });
  return NextResponse.json({
    organizationId: row.id,
    name: row.name,
    monthlyTokenBudget: row.monthly_token_budget,
    tokensConsumedThisMonth: Number(row.tokens_consumed_this_month || 0),
    periodStartedAt: row.budget_period_started_at,
    alertedAt80pct: row.budget_alerted_at_80pct,
  });
}

export async function PATCH(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const { orgId } = await params;
  const g = await gate(request, orgId);
  if (g.error) return g.error;

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  const raw = body?.monthly_token_budget;

  let cleanBudget = null;
  if (raw === null) {
    cleanBudget = null;
  } else {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: 'monthly_token_budget must be a non-negative number, or null for unlimited.' }, { status: 400 });
    }
    if (n > MAX_BUDGET) {
      return NextResponse.json({ error: `monthly_token_budget must be ≤ ${MAX_BUDGET.toLocaleString()}.` }, { status: 400 });
    }
    cleanBudget = Math.floor(n);
  }

  const sb = requireSupabase();
  const reqId = getRequestId(request);
  const resp = await fetchWithTimeout(
    `${sb.url}/rest/v1/organizations?id=eq.${orgId}`,
    {
      method: 'PATCH',
      headers: { ...getSupabaseHeaders(sb.key), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        monthly_token_budget: cleanBudget,
        // Clear the 80% alert flag when changing budget so the next threshold
        // crossing fires a fresh notification.
        budget_alerted_at_80pct: null,
      }),
    },
  );
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    logger.error('budget PATCH failed', { orgId, requestId: reqId, status: resp.status, body: txt.slice(0, 200) });
    return NextResponse.json({ error: 'Failed to update budget.' }, { status: 502 });
  }
  return NextResponse.json({ ok: true, monthly_token_budget: cleanBudget });
}
