import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, fetchWithTimeout, requireSupabase,
  checkOrigin, getRequestId,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { resolveDealAccess } from '@/lib/dealAuth';
import { logger } from '@/lib/logger';

/**
 * GET /api/deals/[id]/analyses
 * Owner/collaborator/participant read. Lists historical analysis runs for a
 * deal (most recent first). Returns metadata + a short summary string; the
 * full `result` blob is available via the detail endpoint.
 */
export async function GET(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id: dealId } = await params;
  if (!dealId) return NextResponse.json({ error: 'Deal ID required.' }, { status: 400 });

  const access = await resolveDealAccess({ dealId, email: auth.email, userId: auth.userId });
  if (!access) return NextResponse.json({ error: 'Access denied.' }, { status: 403 });

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  try {
    // Project `result->>summary` server-side as a separate column
    // (`summary`) so we don't pull the entire result JSONB across the
    // wire just to truncate one field. For deals with many completed
    // analyses (~50 KB results × 50 rows) this is the difference
    // between a multi-MB response and a few KB.
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/deal_analyses?deal_id=eq.${encodeURIComponent(dealId)}&select=id,mode,name,status,source_flow_ids,source_report_ids,error,created_by_email,created_at,completed_at,summary:result->>summary&order=created_at.desc&limit=50`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) }
    );
    // Table may not exist pre-migration - return an empty list rather than 500.
    if (!resp.ok) {
      logger.warn('deal_analyses list returned non-OK', { status: resp.status, dealId });
      return NextResponse.json({ analyses: [] });
    }
    const rows = await resp.json();

    const analyses = (rows || []).map((r) => ({
      id: r.id,
      mode: r.mode,
      name: r.name,
      status: r.status,
      sourceFlowCount: Array.isArray(r.source_flow_ids) ? r.source_flow_ids.length : 0,
      sourceReportCount: Array.isArray(r.source_report_ids) ? r.source_report_ids.length : 0,
      summary: r.summary ? String(r.summary).slice(0, 280) : null,
      error: r.error || null,
      createdByEmail: access.canManage ? r.created_by_email : undefined,
      createdAt: r.created_at,
      completedAt: r.completed_at,
    }));

    return NextResponse.json({ analyses }, {
      headers: { 'Cache-Control': 'private, max-age=5, stale-while-revalidate=30' },
    });
  } catch (err) {
    logger.error('List deal analyses error', { requestId: getRequestId(request), error: err.message });
    return NextResponse.json({ error: 'Failed to list analyses.' }, { status: 500 });
  }
}
