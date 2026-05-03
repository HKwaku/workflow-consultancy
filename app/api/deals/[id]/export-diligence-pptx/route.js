/**
 * GET /api/deals/[id]/export-diligence-pptx?analysis_id=<uuid>
 *
 * Returns a .pptx of an approved diligence analysis. Editor-only because
 * the analysis itself is editor-only.
 *
 * Pipeline:
 *   1. Auth + deal-editor gate
 *   2. Fetch the analysis row (must be mode='diligence')
 *   3. Fetch reviews + apply applyReviewsToAnalysis with viewerMode='public'
 *      → only APPROVED findings make it into the deck
 *   4. Hand off to lib/exporters/dealDiligenceToPptx.js
 */

import {
  getSupabaseHeaders, fetchWithTimeout, requireSupabase,
  getRequestId, isValidUUID,
} from '@/lib/api-helpers';
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { requireDealEditor } from '@/lib/dealAuth';
import { applyReviewsToAnalysis } from '@/lib/deal-analysis/applyReviews';
import { loadHydratedAnalysis } from '@/lib/deal-analysis/findingsRepo';
import { buildDealDiligencePptx } from '@/lib/exporters/dealDiligenceToPptx';
import { logger } from '@/lib/logger';

export const maxDuration = 60;

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  const editor = await requireDealEditor({ dealId: id, email: auth.email, userId: auth.userId });
  if (editor.error) return NextResponse.json(editor.error, { status: editor.status });

  const sp = request.nextUrl.searchParams;
  const analysisId = sp.get('analysis_id');
  if (!analysisId || !isValidUUID(analysisId)) {
    return NextResponse.json({ error: 'analysis_id (uuid) required.' }, { status: 400 });
  }

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const reqId = getRequestId(request);

  // 1. Fetch analysis (must belong to this deal)
  const aResp = await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_analyses?id=eq.${encodeURIComponent(analysisId)}&deal_id=eq.${encodeURIComponent(id)}&select=id,mode,result,completed_at`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  if (!aResp.ok) return NextResponse.json({ error: 'Failed to load analysis.' }, { status: 502 });
  const [analysis] = await aResp.json();
  if (!analysis) return NextResponse.json({ error: 'Analysis not found.' }, { status: 404 });
  if (analysis.mode !== 'diligence') {
    return NextResponse.json({ error: 'Diligence export only available for mode="diligence" analyses.' }, { status: 400 });
  }

  // 2. Fetch reviews
  const rResp = await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_finding_reviews?analysis_id=eq.${encodeURIComponent(analysisId)}&select=*`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  const reviews = rResp.ok ? await rResp.json() : [];

  // 3. Hydrate findings from the relational table (deal_findings is the
  // canonical source; analysis.result JSONB is the raw model output).
  // Falls back to JSONB if the table is empty.
  let hydrated;
  try {
    hydrated = await loadHydratedAnalysis(analysis);
  } catch (e) {
    logger.warn('hydrate from deal_findings failed; falling back to JSONB', { analysisId, error: e.message });
    hydrated = analysis.result || {};
  }

  // 4. Filter to approved-only
  const filtered = applyReviewsToAnalysis(hydrated, reviews, 'public');

  // 4. Build PPTX
  let buf;
  try {
    buf = await buildDealDiligencePptx({
      dealName: editor.access?.deal?.name || 'Deal',
      completedAt: analysis.completed_at,
      result: filtered,
    });
  } catch (e) {
    logger.error('Diligence pptx export failed', { requestId: reqId, error: e.message, stack: e.stack });
    return NextResponse.json({ error: 'Failed to generate presentation.' }, { status: 500 });
  }

  const safeName = (editor.access?.deal?.name || 'deal').replace(/[^a-z0-9-]+/gi, '-').slice(0, 60);

  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${safeName}-diligence-memo.pptx"`,
      'Cache-Control': 'no-store',
    },
  });
}
