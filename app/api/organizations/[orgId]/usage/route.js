/**
 * GET /api/organizations/[orgId]/usage
 *
 * Aggregated usage analytics from token_usage_ledger for the admin UI.
 *
 * Query params:
 *   period:  '7d' | '30d' | '90d' | 'mtd'  (default 30d)
 *   groupBy: 'day' | 'surface' | 'vendor' | 'model'  (default day)
 *
 * Returns:
 *   {
 *     totals: { input_tokens, output_tokens, total_tokens, calls },
 *     budget: { monthly_token_budget, tokens_consumed_this_month, alerted_at_80pct },
 *     buckets: [{ key: '2026-04-01', input, output, total, calls }, ...]
 *   }
 *
 * Admin-only.
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSupabaseHeaders, fetchWithTimeout, requireSupabase } from '@/lib/api-helpers';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireOrgAdminOrPlatformAdmin } from '@/lib/orgAdmin';

function periodToInterval(p) {
  if (p === '7d')  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  if (p === '90d') return new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  if (p === 'mtd') { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); }
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
}

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { orgId } = await params;
  const adminSb = getSupabaseAdmin();
  if (!adminSb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const gate = await requireOrgAdminOrPlatformAdmin(adminSb, orgId, auth.userId, auth.email);
  if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const sp = request.nextUrl.searchParams;
  const period  = sp.get('period')  || '30d';
  const groupBy = sp.get('groupBy') || 'day';
  const since = periodToInterval(period).toISOString();

  const sb = requireSupabase();

  // Pull raw ledger rows for the window. For MVP we aggregate in JS — at
  // scale this should become a SQL view or a materialised aggregate.
  const url = `${sb.url}/rest/v1/token_usage_ledger`
    + `?organization_id=eq.${orgId}`
    + `&created_at=gte.${encodeURIComponent(since)}`
    + `&select=created_at,vendor,model,surface,input_tokens,output_tokens,total_tokens`
    + `&order=created_at.desc&limit=10000`;
  const resp = await fetchWithTimeout(url, { method: 'GET', headers: getSupabaseHeaders(sb.key) });
  const rows = resp.ok ? await resp.json() : [];

  const totals = { input_tokens: 0, output_tokens: 0, total_tokens: 0, calls: 0 };
  const buckets = new Map();

  for (const r of rows) {
    totals.input_tokens  += r.input_tokens  || 0;
    totals.output_tokens += r.output_tokens || 0;
    totals.total_tokens  += r.total_tokens  || 0;
    totals.calls += 1;

    let key;
    if (groupBy === 'day')     key = String(r.created_at).slice(0, 10);
    else if (groupBy === 'vendor')  key = r.vendor || 'unknown';
    else if (groupBy === 'surface') key = r.surface || 'unknown';
    else if (groupBy === 'model')   key = r.model || 'unknown';
    else key = 'all';

    const b = buckets.get(key) || { key, input: 0, output: 0, total: 0, calls: 0 };
    b.input  += r.input_tokens  || 0;
    b.output += r.output_tokens || 0;
    b.total  += r.total_tokens  || 0;
    b.calls  += 1;
    buckets.set(key, b);
  }

  // Pull org budget for the header.
  const orgResp = await fetchWithTimeout(
    `${sb.url}/rest/v1/organizations?id=eq.${orgId}&select=monthly_token_budget,tokens_consumed_this_month,budget_period_started_at,budget_alerted_at_80pct`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  const [org] = orgResp.ok ? await orgResp.json() : [];

  return NextResponse.json({
    period, groupBy, since,
    totals,
    budget: org ? {
      monthly_token_budget: org.monthly_token_budget,
      tokens_consumed_this_month: Number(org.tokens_consumed_this_month || 0),
      period_started_at: org.budget_period_started_at,
      alerted_at_80pct: org.budget_alerted_at_80pct,
    } : null,
    buckets: Array.from(buckets.values()).sort((a, b) => (groupBy === 'day' ? a.key.localeCompare(b.key) : b.total - a.total)),
  });
}
