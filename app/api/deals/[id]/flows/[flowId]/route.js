import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout,
  requireSupabase, checkOrigin, getRequestId,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { requireDealEditor } from '@/lib/dealAuth';
import { logger } from '@/lib/logger';

/**
 * PATCH /api/deals/[id]/flows/[flowId]
 * Owner or collaborator updates flow label / kind / report_id / status.
 * Body: { label?, flowKind?, reportId?, status? }
 */
export async function PATCH(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id: dealId, flowId } = await params;
  if (!dealId || !flowId) return NextResponse.json({ error: 'IDs required.' }, { status: 400 });

  const guard = await requireDealEditor({ dealId, email: auth.email, userId: auth.userId });
  if (guard.error) return NextResponse.json(guard.error, { status: guard.status });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  const update = {};
  if (typeof body.label === 'string' && body.label.trim()) update.label = body.label.trim().slice(0, 200);
  if (typeof body.flowKind === 'string') update.flow_kind = body.flowKind.trim().slice(0, 100) || null;
  if (typeof body.reportId === 'string' && body.reportId.trim()) update.report_id = body.reportId.trim();
  if (body.status && ['draft', 'in_progress', 'complete'].includes(body.status)) update.status = body.status;
  if (Object.keys(update).length === 0) return NextResponse.json({ error: 'No valid fields.' }, { status: 400 });

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/deal_flows?id=eq.${encodeURIComponent(flowId)}&deal_id=eq.${encodeURIComponent(dealId)}`,
      { method: 'PATCH', headers: getSupabaseWriteHeaders(sb.key), body: JSON.stringify(update) }
    );
    if (!resp.ok) return NextResponse.json({ error: 'Failed to update flow.' }, { status: 502 });
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error('Update deal flow error', { requestId: getRequestId(request), error: err.message });
    return NextResponse.json({ error: 'Failed to update flow.' }, { status: 500 });
  }
}

/**
 * DELETE /api/deals/[id]/flows/[flowId]
 * Owner or collaborator removes a flow slot. Does NOT delete the linked
 * diagnostic_reports row - that stays so the flow artefact survives and
 * can be re-linked later.
 */
export async function DELETE(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id: dealId, flowId } = await params;
  if (!dealId || !flowId) return NextResponse.json({ error: 'IDs required.' }, { status: 400 });

  const guard = await requireDealEditor({ dealId, email: auth.email, userId: auth.userId });
  if (guard.error) return NextResponse.json(guard.error, { status: guard.status });

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/deal_flows?id=eq.${encodeURIComponent(flowId)}&deal_id=eq.${encodeURIComponent(dealId)}`,
      { method: 'DELETE', headers: getSupabaseHeaders(sb.key) }
    );
    if (!resp.ok) return NextResponse.json({ error: 'Failed to delete flow.' }, { status: 502 });
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error('Delete deal flow error', { requestId: getRequestId(request), error: err.message });
    return NextResponse.json({ error: 'Failed to delete flow.' }, { status: 500 });
  }
}
