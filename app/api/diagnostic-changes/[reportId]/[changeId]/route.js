/**
 * PATCH /api/diagnostic-changes/[reportId]/[changeId]
 *
 * Report-side state advance. Same shape as the deal version but auth
 * gates on diagnostic_reports.contact_email instead of deal editor.
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, fetchWithTimeout, requireSupabase,
  checkOrigin, isValidUUID, getRequestId,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { recordTransition } from '@/lib/changes/repo';
import { logger } from '@/lib/logger';

const ALLOWED_TRANSITIONS = new Set([
  'proposed', 'accepted', 'rejected', 'applied', 'live', 'measured', 'reverted',
]);

export async function PATCH(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { reportId, changeId } = await params;
  if (!reportId || typeof reportId !== 'string' || reportId.length > 64) {
    return NextResponse.json({ error: 'Valid report id required.' }, { status: 400 });
  }
  if (!isValidUUID(changeId)) return NextResponse.json({ error: 'Valid change id required.' }, { status: 400 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  const state = String(body?.state || '').trim();
  if (!ALLOWED_TRANSITIONS.has(state)) {
    return NextResponse.json({ error: `Invalid state. Must be one of: ${[...ALLOWED_TRANSITIONS].join(', ')}.` }, { status: 400 });
  }

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  // Ownership check + the change must actually belong to this report.
  // Belt-and-braces: RLS already enforces this; the explicit join here gives
  // us a clear 403 instead of an opaque "row not updated".
  const ownerResp = await fetchWithTimeout(
    `${sb.url}/rest/v1/changes?id=eq.${encodeURIComponent(changeId)}&process_id=eq.${encodeURIComponent(reportId)}&select=id&limit=1`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  const owners = ownerResp.ok ? await ownerResp.json() : [];
  if (!owners.length) return NextResponse.json({ error: 'Change not found on this process.' }, { status: 404 });

  const reportResp = await fetchWithTimeout(
    `${sb.url}/rest/v1/processes?id=eq.${encodeURIComponent(reportId)}&contact_email=ilike.${encodeURIComponent(auth.email.toLowerCase())}&select=id&limit=1`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  const owned = reportResp.ok ? await reportResp.json() : [];
  if (!owned.length) return NextResponse.json({ error: 'Not your report.' }, { status: 403 });

  const result = await recordTransition({ id: changeId, state, actor_email: auth.email });
  if (!result.ok) {
    logger.warn('Report-change PATCH failed', { requestId: getRequestId(request), changeId, state });
    return NextResponse.json({ error: 'Failed to update change.' }, { status: 502 });
  }
  return NextResponse.json({ ok: true, state });
}
