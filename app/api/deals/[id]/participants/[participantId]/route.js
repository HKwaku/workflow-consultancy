import { NextResponse } from 'next/server';
import { getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase, checkOrigin, getRequestId } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { requireDealEditor } from '@/lib/dealAuth';
import { logger } from '@/lib/logger';

/**
 * DELETE /api/deals/[id]/participants/[participantId]
 * Owner or collaborator. Removes a company from the deal.
 * Cascades to deal_flows (ON DELETE CASCADE). Linked diagnostic_reports
 * survive - they're only unlinked from the deal via deal_flows.
 */
export async function DELETE(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id, participantId } = await params;
  if (!id || !participantId) return NextResponse.json({ error: 'Deal ID and participant ID required.' }, { status: 400 });

  const sbConfig = requireSupabase();
  if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const { url: supabaseUrl, key: supabaseKey } = sbConfig;

  try {
    const guard = await requireDealEditor({ dealId: id, email: auth.email, userId: auth.userId });
    if (guard.error) return NextResponse.json(guard.error, { status: guard.status });

    const verify = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/deal_participants?id=eq.${encodeURIComponent(participantId)}&deal_id=eq.${encodeURIComponent(id)}&select=id`,
      { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
    );
    const [row] = verify.ok ? await verify.json() : [];
    if (!row) return NextResponse.json({ error: 'Participant not found on this deal.' }, { status: 404 });

    const delResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/deal_participants?id=eq.${encodeURIComponent(participantId)}`,
      { method: 'DELETE', headers: getSupabaseWriteHeaders(supabaseKey) }
    );
    if (!delResp.ok && delResp.status !== 204) {
      return NextResponse.json({ error: 'Failed to remove company.' }, { status: 502 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error('Delete deal participant error', { requestId: getRequestId(request), error: err.message });
    return NextResponse.json({ error: 'Failed to remove company.' }, { status: 500 });
  }
}
