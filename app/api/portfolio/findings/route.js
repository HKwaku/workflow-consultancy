/**
 * GET /api/portfolio/findings?q=...&tag=...&severity=...&category=...
 *
 * Cross-deal search across every deal the calling user can access. Returns
 * findings + the deal they belong to + the latest reviewer status, ranked
 * by severity × confidence within each deal.
 *
 * Use cases:
 *   • "show me every customer-concentration finding across my 30 deals"
 *   • portfolio-wide risk dashboard ("how many deal_breaker findings are open?")
 *   • partner walking into a portfolio review
 *
 * No service-role bypass: we resolve the user's accessible dealIds first
 * (same path as /api/deals), then scope the findings query by deal_id IN.
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, fetchWithTimeout, requireSupabase,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';

export const maxDuration = 15;

const SEV_WEIGHT = { critical: 5, high: 3, medium: 1, low: 0.3 };

export async function GET(request) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const sp = request.nextUrl.searchParams;
  const q        = (sp.get('q') || '').trim().toLowerCase();
  const tag      = sp.get('tag') || null;
  const severity = sp.get('severity') || null;
  const category = sp.get('category') || null;
  const limit    = Math.max(1, Math.min(Number(sp.get('limit') || 100), 500));

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  // 1. Resolve accessible deal ids (owner + collaborator + participant).
  //    Mirrors /api/deals's parallel triple but only selects id/name for
  //    payload shaping.
  const emailEnc = encodeURIComponent(auth.email);
  const [ownedResp, collabResp, partResp] = await Promise.all([
    fetchWithTimeout(
      `${sb.url}/rest/v1/deals?owner_email=eq.${emailEnc}&select=id,name,deal_code,type&limit=200`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    ),
    fetchWithTimeout(
      `${sb.url}/rest/v1/deals?collaborator_emails=cs.%7B${emailEnc}%7D&select=id,name,deal_code,type&limit=200`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    ),
    fetchWithTimeout(
      `${sb.url}/rest/v1/deal_participants?participant_email=eq.${emailEnc}&select=deal_id,deals(id,name,deal_code,type)&limit=200`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    ),
  ]);
  const dealById = new Map();
  for (const d of (ownedResp.ok ? await ownedResp.json() : [])) dealById.set(d.id, d);
  for (const d of (collabResp.ok ? await collabResp.json() : [])) if (!dealById.has(d.id)) dealById.set(d.id, d);
  for (const row of (partResp.ok ? await partResp.json() : [])) {
    const d = row.deals;
    if (d && !dealById.has(d.id)) dealById.set(d.id, d);
  }
  if (dealById.size === 0) return NextResponse.json({ findings: [], summary: { totalDeals: 0, totalFindings: 0 } });

  const dealIds = Array.from(dealById.keys());
  const idCsv = dealIds.map(encodeURIComponent).join(',');

  // 2. Build findings query with optional filters.
  let url = `${sb.url}/rest/v1/deal_findings?deal_id=in.(${idCsv})`
    + '&select=id,deal_id,analysis_id,finding_key,section,title,body,severity,confidence,category,tags,stale,created_at'
    + `&limit=${limit}`;
  if (tag) url += `&tags=cs.%7B${encodeURIComponent(tag)}%7D`;
  if (severity) url += `&severity=eq.${encodeURIComponent(severity)}`;
  if (category) url += `&category=eq.${encodeURIComponent(category)}`;

  const r = await fetchWithTimeout(url, { method: 'GET', headers: getSupabaseHeaders(sb.key) });
  if (!r.ok) return NextResponse.json({ error: 'Failed to load findings.' }, { status: 502 });
  let findings = await r.json();

  // 3. Free-text filter applied client-side after the row pull (PostgREST
  //    doesn't compose ts_query with `in.()` neatly here; cheap to filter
  //    in-memory at this volume).
  if (q) {
    findings = findings.filter((f) => {
      const hay = `${f.title || ''} ${f.body || ''} ${f.category || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }

  // 4. Drop body findings with section in {executiveSummary, keyFindings}
  //    so the portfolio view shows actual risks, not the meta-rows.
  findings = findings.filter((f) => f.section !== 'executiveSummary' && f.section !== 'keyFindings');

  // 5. Rank by severity × confidence; attach deal metadata.
  const ranked = findings
    .map((f) => ({
      ...f,
      deal: dealById.get(f.deal_id) || null,
      _weight: (SEV_WEIGHT[f.severity] ?? 1)
        * (typeof f.confidence === 'number' ? Math.max(0, Math.min(1, f.confidence)) : 0.3),
    }))
    .sort((a, b) => b._weight - a._weight);

  // 6. Summary tiles for the UI.
  const summary = {
    totalDeals: dealById.size,
    totalFindings: ranked.length,
    bySeverity: ranked.reduce((acc, f) => {
      acc[f.severity] = (acc[f.severity] || 0) + 1; return acc;
    }, { critical: 0, high: 0, medium: 0, low: 0 }),
    staleCount: ranked.filter((f) => f.stale).length,
  };

  return NextResponse.json({
    q, tag, severity, category,
    findings: ranked.map((f) => ({
      id: f.id, deal_id: f.deal_id, deal: f.deal,
      analysis_id: f.analysis_id, finding_key: f.finding_key,
      title: f.title, body: f.body,
      severity: f.severity, confidence: f.confidence,
      category: f.category, tags: f.tags || [], stale: !!f.stale,
      weight: Math.round(f._weight * 10) / 10,
    })),
    summary,
  });
}
