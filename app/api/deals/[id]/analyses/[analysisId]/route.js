import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout,
  requireSupabase, checkOrigin, getRequestId,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { resolveDealAccess } from '@/lib/dealAuth';
import { loadHydratedAnalysis } from '@/lib/deal-analysis/findingsRepo';
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

    // Hydrate findings from the relational deal_findings table. Falls back
    // to the JSONB result if the table is empty (legacy rows pre-backfill).
    // The hydrator overwrites finding-bearing fields and preserves
    // narrative fields (summary, proposedProcess, phasing, etc.).
    let hydratedResult;
    try {
      hydratedResult = await loadHydratedAnalysis(row);
    } catch (e) {
      logger.warn('hydrate from deal_findings failed; falling back to JSONB', { analysisId, error: e.message });
      hydratedResult = row.result || null;
    }

    return NextResponse.json({
      analysis: {
        id: row.id,
        dealId: row.deal_id,
        mode: row.mode,
        name: row.name,
        sourceFlowIds: row.source_flow_ids || [],
        sourceReportIds: row.source_report_ids || [],
        status: row.status,
        result: hydratedResult,
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
 * PATCH /api/deals/[id]/analyses/[analysisId]
 * Editor-only. Currently supports renaming via { name }. Names are
 * trimmed, capped at 120 chars, and stored on deal_analyses.name.
 */
export async function PATCH(request, { params }) {
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
  if (!access.canEdit) return NextResponse.json({ error: 'Only the deal owner or a collaborator can rename analyses.' }, { status: 403 });

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'JSON body required.' }, { status: 400 }); }

  const update = {};
  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    const raw = body.name;
    if (raw === null || raw === '') update.name = null;
    else if (typeof raw !== 'string') return NextResponse.json({ error: '`name` must be a string.' }, { status: 400 });
    else update.name = raw.trim().slice(0, 120);
  }
  // Allow manual edits to the analysis result. Stored back into the
  // result JSONB so subsequent reads see the override directly. Size-
  // capped at 256 KB to prevent abuse.
  if (Object.prototype.hasOwnProperty.call(body, 'result')) {
    const raw = body.result;
    if (raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) {
      return NextResponse.json({ error: '`result` must be an object or null.' }, { status: 400 });
    }
    let serialised;
    try { serialised = JSON.stringify(raw); } catch { return NextResponse.json({ error: '`result` is not serialisable.' }, { status: 400 }); }
    if (serialised && serialised.length > 256 * 1024) {
      return NextResponse.json({ error: '`result` exceeds 256 KB.' }, { status: 413 });
    }
    update.result = raw;
  }
  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'No supported fields in body.' }, { status: 400 });

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/deal_analyses?id=eq.${encodeURIComponent(analysisId)}&deal_id=eq.${encodeURIComponent(dealId)}`,
      {
        method: 'PATCH',
        headers: { ...getSupabaseWriteHeaders(sb.key), 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      },
    );
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      logger.warn('deal_analyses rename failed', { status: resp.status, body: txt.slice(0, 200) });
      return NextResponse.json({ error: 'Failed to update analysis.' }, { status: 502 });
    }
    return NextResponse.json({ success: true, updated: Object.keys(update) });
  } catch (err) {
    logger.error('Patch deal analysis error', { requestId: getRequestId(request), error: err.message });
    return NextResponse.json({ error: 'Failed to update analysis.' }, { status: 500 });
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
