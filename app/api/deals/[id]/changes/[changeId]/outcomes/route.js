/**
 * POST /api/deals/[id]/changes/[changeId]/outcomes
 *
 * Append a measured outcome to a change. Editor-only. Body shape mirrors
 * lib/changes/repo.recordOutcome():
 *
 *   { metric, unit?, value_before?, value_after?, source, notes? }
 *
 * Source must be one of: 'process_instance' | 'report_rerun' | 'manual' |
 * 'inferred_from_doc' | 'agent'.
 *
 * The repo helper opportunistically flips the parent change to `measured`
 * after a successful insert, so the timeline UI sees the state change on
 * the next refresh — and we return the inserted row so the client can
 * splice it into local state without a round-trip.
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase,
  checkOrigin, isValidUUID, getRequestId,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { requireDealEditor } from '@/lib/dealAuth';
import { recordOutcome } from '@/lib/changes/repo';
import { logger } from '@/lib/logger';

const VALID_SOURCES = new Set(['process_instance', 'report_rerun', 'manual', 'inferred_from_doc', 'agent']);

export async function POST(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id, changeId } = await params;
  if (!isValidUUID(id))       return NextResponse.json({ error: 'Valid deal id required.' }, { status: 400 });
  if (!isValidUUID(changeId)) return NextResponse.json({ error: 'Valid change id required.' }, { status: 400 });

  const editor = await requireDealEditor({ dealId: id, email: auth.email, userId: auth.userId });
  if (editor.error) return NextResponse.json(editor.error, { status: editor.status });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  const metric = String(body?.metric || '').trim();
  if (!metric) return NextResponse.json({ error: 'metric required.' }, { status: 400 });
  if (metric.length > 80) return NextResponse.json({ error: 'metric must be ≤ 80 chars.' }, { status: 400 });

  const source = String(body?.source || '').trim();
  if (!VALID_SOURCES.has(source)) {
    return NextResponse.json({ error: `source must be one of: ${[...VALID_SOURCES].join(', ')}.` }, { status: 400 });
  }

  // Verify the change belongs to this deal — defence in depth alongside RLS.
  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const ownerResp = await fetchWithTimeout(
    `${sb.url}/rest/v1/changes?id=eq.${encodeURIComponent(changeId)}&deal_id=eq.${encodeURIComponent(id)}&select=id&limit=1`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  const owned = ownerResp.ok ? await ownerResp.json() : [];
  if (!owned.length) return NextResponse.json({ error: 'Change not found on this deal.' }, { status: 404 });

  const result = await recordOutcome({
    change_id: changeId,
    metric,
    unit: body?.unit ? String(body.unit).slice(0, 20) : null,
    value_before: body?.value_before == null ? null : Number(body.value_before),
    value_after:  body?.value_after  == null ? null : Number(body.value_after),
    source,
    source_ref: body?.source_ref || null,
    notes: body?.notes ? String(body.notes).slice(0, 2000) : null,
  });
  if (!result.ok) {
    logger.warn('Outcome insert failed', { requestId: getRequestId(request), changeId });
    return NextResponse.json({ error: 'Failed to save outcome.' }, { status: 502 });
  }

  // Return the freshly-inserted row so the client can render it without a
  // refetch. Use service-role read scoped to this change_id.
  const fetchResp = await fetchWithTimeout(
    `${sb.url}/rest/v1/change_outcomes?change_id=eq.${encodeURIComponent(changeId)}&select=id,metric,unit,value_before,value_after,delta,source,measured_at&order=measured_at.desc&limit=1`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  const [outcome] = fetchResp.ok ? await fetchResp.json() : [];
  return NextResponse.json({ ok: true, outcome: outcome || null });
}
