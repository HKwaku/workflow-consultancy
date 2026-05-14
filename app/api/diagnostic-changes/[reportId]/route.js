/**
 * GET /api/diagnostic-changes/[reportId]
 *
 * Report-side mirror of /api/deals/[id]/changes. Returns the changes
 * timeline for a single diagnostic report (one row per redesign change,
 * plus any future report-scoped propose_* additions).
 *
 * Auth: contact_email ownership of the report (same gate the rest of
 * the diagnostic-* routes use). Service-role read after auth gate.
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, fetchWithTimeout, requireSupabase,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { loadChanges } from '@/lib/changes/repo';

export const maxDuration = 10;

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { reportId } = await params;
  if (!reportId || typeof reportId !== 'string' || reportId.length > 64) {
    return NextResponse.json({ error: 'Valid report id required.' }, { status: 400 });
  }

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  // Ownership check via contact_email — same pattern as get-diagnostic.
  const ownerResp = await fetchWithTimeout(
    `${sb.url}/rest/v1/processes?id=eq.${encodeURIComponent(reportId)}&contact_email=ilike.${encodeURIComponent(auth.email.toLowerCase())}&select=id&limit=1`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  if (!ownerResp.ok) return NextResponse.json({ error: 'Failed to verify report ownership.' }, { status: 502 });
  const rows = await ownerResp.json();
  if (!rows.length) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });

  const sp = request.nextUrl.searchParams;
  const limit = Math.max(10, Math.min(Number(sp.get('limit') || 200), 500));

  const changes = await loadChanges({ reportId, limit });
  return NextResponse.json({ changes });
}
