/**
 * GET /api/deals/[id]/scorecard
 *
 * Returns a one-page deal scorecard auto-filled from the most recent
 * completed analysis: thesis, key risks, mitigants, recommended action,
 * risk score breakdown, doc coverage. Read-only — the scorecard is the
 * thing partners paste into investment memos and IC decks.
 *
 * No DB writes; the scorecard is regenerated on each call so it always
 * reflects the current findings + reviews. Cheap because everything we
 * need lives in deal_findings + deal_finding_reviews + deal_documents
 * with no LLM call required.
 *
 * Open to anyone with deal access (visibility-filtered for participants).
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, fetchWithTimeout, requireSupabase, isValidUUID,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveDealAccess } from '@/lib/dealAuth';
import { canSeeDocument } from '@/lib/dealDocumentVisibility';

export const maxDuration = 15;

const SEV_WEIGHT = { critical: 5, high: 3, medium: 1, low: 0.3 };

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Valid deal id required.' }, { status: 400 });

  const access = await resolveDealAccess({ dealId: id, email: auth.email, userId: auth.userId });
  if (!access) return NextResponse.json({ error: 'Deal not found or access denied.' }, { status: 404 });

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  const [dealResp, latestAnalysisResp, docsResp] = await Promise.all([
    fetchWithTimeout(
      `${sb.url}/rest/v1/deals?id=eq.${id}&select=id,name,deal_code,type,status,owner_email,created_at`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    ),
    fetchWithTimeout(
      `${sb.url}/rest/v1/deal_analyses?deal_id=eq.${id}&status=eq.complete&order=completed_at.desc&limit=1&select=id,mode,completed_at,auto_triggered`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    ),
    fetchWithTimeout(
      `${sb.url}/rest/v1/deal_documents?deal_id=eq.${id}&select=id,filename,category,status,visibility,source_party`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    ),
  ]);

  const [deal] = dealResp.ok ? await dealResp.json() : [];
  if (!deal) return NextResponse.json({ error: 'Deal not found.' }, { status: 404 });

  const [latest] = latestAnalysisResp.ok ? await latestAnalysisResp.json() : [];
  const allDocs = docsResp.ok ? await docsResp.json() : [];

  // Visibility-filter docs the same way the doc list does.
  const isOwner = access.mode === 'owner';
  const isCollaborator = access.mode === 'collaborator';
  const viewerRole = access.participantRole || null;
  const visibleDocs = allDocs.filter((d) =>
    canSeeDocument({ document: d, viewerRole, isOwner, isCollaborator }),
  );

  // No analysis yet → return scorecard skeleton with doc-only coverage so
  // the UI can show the empty state without a separate code path.
  if (!latest) {
    return NextResponse.json({
      deal,
      analysis: null,
      thesis: null,
      keyRisks: [],
      mitigants: [],
      recommendedAction: null,
      riskScore: 0,
      severityCounts: { critical: 0, high: 0, medium: 0, low: 0 },
      coverage: docCoverage(visibleDocs),
    });
  }

  // Pull findings for the latest analysis + reviewer overrides so the
  // scorecard reflects what reviewers actually said, not what the model
  // first proposed. We also pull `evidence` so we can drop findings whose
  // citations point at documents the viewer can't see (per-document
  // visibility — participants only see their slice).
  const [findingsResp, reviewsResp] = await Promise.all([
    fetchWithTimeout(
      `${sb.url}/rest/v1/deal_findings?analysis_id=eq.${latest.id}&select=finding_key,section,order_index,title,body,severity,confidence,category,recommendations,evidence&order=order_index.asc`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    ),
    fetchWithTimeout(
      `${sb.url}/rest/v1/deal_finding_reviews?analysis_id=eq.${latest.id}&select=finding_key,status,edited_title,edited_body,reviewer_note`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    ),
  ]);
  const findings = findingsResp.ok ? await findingsResp.json() : [];
  const reviews = reviewsResp.ok ? await reviewsResp.json() : [];
  const reviewByKey = new Map(reviews.map((r) => [r.finding_key, r]));

  // Per-doc visibility: a finding citing only docs the viewer can't see
  // shouldn't surface in their scorecard. Editors see everything; the
  // filter only narrows for participants. Findings with no document
  // evidence (e.g. process-step citations) are kept regardless — they're
  // visible to anyone with deal access.
  const visibleDocIds = new Set(visibleDocs.map((d) => d.id));
  const findingHasVisibleEvidence = (f) => {
    if (isOwner || isCollaborator) return true;
    const ev = Array.isArray(f.evidence) ? f.evidence : [];
    if (ev.length === 0) return true;
    const docRefs = ev
      .map((e) => e?.document_id || e?.ref?.document_id)
      .filter(Boolean);
    if (docRefs.length === 0) return true; // non-document evidence (process step, chat turn)
    return docRefs.some((id) => visibleDocIds.has(id));
  };

  // Drop rejected findings — they're explicitly "we looked, this isn't
  // real." Keep approved + needs_revision + pending so the scorecard
  // mirrors the in-progress reviewer view. Apply visibility filter so
  // participants only see findings whose evidence they can verify.
  const live = findings.filter((f) => {
    const r = reviewByKey.get(f.finding_key);
    if (r && r.status === 'rejected') return false;
    return findingHasVisibleEvidence(f);
  });

  // Section split: exec summary becomes the thesis, key takeaways become
  // the headline risks, recommendations from each finding become mitigants.
  const exec = live.find((f) => f.section === 'executiveSummary') || null;
  const keyTakeaways = live.filter((f) => f.section === 'keyFindings');
  const body = live.filter((f) => f.section !== 'executiveSummary' && f.section !== 'keyFindings');

  const overrideText = (f, field) => {
    const r = reviewByKey.get(f.finding_key);
    return (r && r[`edited_${field}`]) || f[field] || '';
  };

  // Top 5 risks by sev × confidence — the IC summary doesn't need 30 lines.
  const ranked = body
    .map((f) => ({
      ...f,
      // Findings without explicit confidence are weighted as low (0.3) so
      // they don't punch above their weight in the top-5 risk ranking. The
      // ingestion path defaults to 0.5; treating null/non-numeric as 0.3
      // means "we couldn't tell" sits below "the model said 50%".
      _weight: (SEV_WEIGHT[f.severity] ?? 1)
        * (typeof f.confidence === 'number'
            ? Math.max(0, Math.min(1, f.confidence))
            : 0.3),
      _title: overrideText(f, 'title'),
      _body:  overrideText(f, 'body'),
    }))
    .sort((a, b) => b._weight - a._weight);
  const topRisks = ranked.slice(0, 5).map((f) => ({
    finding_key: f.finding_key,
    title: f._title,
    severity: f.severity,
    confidence: f.confidence,
    category: f.category,
    weight: Math.round(f._weight * 10) / 10,
  }));

  // Mitigants = recommendations across the top-N findings. Keep the
  // mapping back to the parent so the UI can deep-link.
  const mitigants = [];
  for (const f of ranked.slice(0, 8)) {
    const recs = Array.isArray(f.recommendations) ? f.recommendations : [];
    for (const r of recs) {
      mitigants.push({ finding_key: f.finding_key, finding_title: f._title, action: r });
    }
  }

  const severityCounts = body.reduce((acc, f) => {
    const s = f.severity || 'medium';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, { critical: 0, high: 0, medium: 0, low: 0 });

  const riskScore = Math.round(ranked.reduce((s, f) => s + f._weight, 0) * 10) / 10;

  // Recommended action: simple rule based on the top severity bucket and
  // reviewer engagement. Cheap and explainable; the partner overrides if
  // they disagree. We deliberately don't ask the LLM for this — it's a
  // judgement call that should sit with the human.
  let recommendedAction;
  if (severityCounts.critical > 0)        recommendedAction = 'Re-trade or walk — critical issues unresolved.';
  else if (severityCounts.high >= 3)      recommendedAction = 'Negotiate price or escrow against the high-severity findings.';
  else if (severityCounts.high >= 1)      recommendedAction = 'Proceed with conditions — close the high-severity items first.';
  else if (severityCounts.medium >= 5)    recommendedAction = 'Proceed; address medium-severity items in the 100-day plan.';
  else                                    recommendedAction = 'Proceed with confidence — no material red flags surfaced.';

  return NextResponse.json({
    deal,
    analysis: latest,
    thesis: exec ? { title: overrideText(exec, 'title'), body: overrideText(exec, 'body') } : null,
    keyTakeaways: keyTakeaways.map((f) => ({
      finding_key: f.finding_key,
      title: overrideText(f, 'title'),
      body:  overrideText(f, 'body'),
    })),
    keyRisks: topRisks,
    mitigants,
    recommendedAction,
    riskScore,
    severityCounts,
    coverage: docCoverage(visibleDocs),
  });
}

/** Coverage summary for the scorecard footer — what's in the data room. */
function docCoverage(docs) {
  const byCategory = new Map();
  let ready = 0; let stored = 0; let pending = 0; let failed = 0;
  for (const d of docs) {
    const c = d.category || 'Uncategorised';
    byCategory.set(c, (byCategory.get(c) || 0) + 1);
    if (d.status === 'ready') ready += 1;
    else if (d.status === 'stored') stored += 1;
    else if (d.status === 'failed') failed += 1;
    else pending += 1;
  }
  return {
    total: docs.length,
    ready, stored, pending, failed,
    byCategory: Array.from(byCategory.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
  };
}
