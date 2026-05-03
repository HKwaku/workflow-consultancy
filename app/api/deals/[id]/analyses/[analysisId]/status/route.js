/**
 * GET /api/deals/[id]/analyses/[analysisId]/status
 *
 * Lightweight polling endpoint for the async analysis flow. The client
 * hits this every ~2 seconds until status is terminal.
 *
 * Returns:
 *   {
 *     analysis_id, status, progress_message,
 *     complete: boolean,        // true when status is 'complete'
 *     failed:   boolean,        // true when status is 'failed'
 *     error?:   string,         // populated when failed
 *     started_at, completed_at,
 *     estimated_tokens?
 *   }
 *
 * Cheap: single PK lookup + small column projection. No cache headers —
 * polling clients want fresh state every call.
 *
 * Access: any deal viewer (owner / collaborator / participant).
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, fetchWithTimeout, requireSupabase,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveDealAccess } from '@/lib/dealAuth';

export const maxDuration = 10;

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id: dealId, analysisId } = await params;
  if (!dealId || !analysisId) {
    return NextResponse.json({ error: 'Deal and analysis IDs required.' }, { status: 400 });
  }

  const access = await resolveDealAccess({ dealId, email: auth.email, userId: auth.userId });
  if (!access) return NextResponse.json({ error: 'Access denied.' }, { status: 403 });

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  const resp = await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_analyses?id=eq.${encodeURIComponent(analysisId)}&deal_id=eq.${encodeURIComponent(dealId)}` +
      `&select=id,status,progress_message,error,estimated_tokens,created_at,completed_at`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  if (!resp.ok) return NextResponse.json({ error: 'Failed to load status.' }, { status: 502 });
  const [row] = await resp.json();
  if (!row) return NextResponse.json({ error: 'Analysis not found.' }, { status: 404 });

  return NextResponse.json({
    analysis_id: row.id,
    status: row.status,
    progress_message: row.progress_message || null,
    complete: row.status === 'complete',
    failed:   row.status === 'failed',
    error: row.error || null,
    started_at:   row.created_at,
    completed_at: row.completed_at,
    estimated_tokens: row.estimated_tokens || null,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
