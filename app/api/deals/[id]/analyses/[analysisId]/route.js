import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout,
  requireSupabase, checkOrigin, getRequestId,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { resolveDealAccess } from '@/lib/dealAuth';
import { logger } from '@/lib/logger';

/**
 * GET /api/deals/[id]/analyses/[analysisId]
 * Returns the full analysis row including the result blob. Readable by
 * owner, collaborator, and participants of the deal.
 */
export async function GET(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id: dealId, analysisId } = await params;
  if (!dealId || !analysisId) return NextResponse.json({ error: 'Deal and analysis IDs required.' }, { status: 400 });

  const access = await resolveDealAccess({ dealId, email: auth.email, userId: auth.userId });
  if (!access) return NextResponse.json({ error: 'Access denied.' }, { status: 403 });

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/deal_analyses?id=eq.${encodeURIComponent(analysisId)}&deal_id=eq.${encodeURIComponent(dealId)}&select=*`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) }
    );
    if (!resp.ok) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    const [row] = await resp.json();
    if (!row) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

    return NextResponse.json({
      analysis: {
        id: row.id,
        dealId: row.deal_id,
        mode: row.mode,
        name: row.name,
        sourceFlowIds: row.source_flow_ids || [],
        sourceReportIds: row.source_report_ids || [],
        status: row.status,
        result: row.result || null,
        error: row.error || null,
        createdByEmail: access.canManage ? row.created_by_email : undefined,
        createdAt: row.created_at,
        completedAt: row.completed_at,
      },
    });
  } catch (err) {
    logger.error('Get deal analysis error', { requestId: getRequestId(request), error: err.message });
    return NextResponse.json({ error: 'Failed to load analysis.' }, { status: 500 });
  }
}

/**
 * DELETE /api/deals/[id]/analyses/[analysisId]
 * Editor-only (owner or collaborator). Removes an analysis from history.
 */
export async function DELETE(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id: dealId, analysisId } = await params;
  if (!dealId || !analysisId) return NextResponse.json({ error: 'Deal and analysis IDs required.' }, { status: 400 });

  const access = await resolveDealAccess({ dealId, email: auth.email, userId: auth.userId });
  if (!access) return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
  if (!access.canEdit) return NextResponse.json({ error: 'Only the deal owner or a collaborator can delete analyses.' }, { status: 403 });

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/deal_analyses?id=eq.${encodeURIComponent(analysisId)}&deal_id=eq.${encodeURIComponent(dealId)}`,
      { method: 'DELETE', headers: getSupabaseWriteHeaders(sb.key) }
    );
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      logger.warn('deal_analyses delete failed', { status: resp.status, body: txt.slice(0, 200) });
      return NextResponse.json({ error: 'Failed to delete analysis.' }, { status: 502 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error('Delete deal analysis error', { requestId: getRequestId(request), error: err.message });
    return NextResponse.json({ error: 'Failed to delete analysis.' }, { status: 500 });
  }
}
