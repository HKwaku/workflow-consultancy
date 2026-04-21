import { NextResponse } from 'next/server';
import { getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase, checkOrigin, getRequestId } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

/**
 * PATCH /api/deals/[id]/participants
 * Owner only. Links an existing diagnostic report to a participant slot.
 * Body: { participantId: string, reportId: string }
 */
export async function PATCH(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Deal ID required.' }, { status: 400 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  const { participantId, reportId } = body;
  if (!participantId || typeof participantId !== 'string') return NextResponse.json({ error: 'participantId required.' }, { status: 400 });
  if (!reportId || typeof reportId !== 'string' || reportId.length > 64) return NextResponse.json({ error: 'reportId required.' }, { status: 400 });

  const sbConfig = requireSupabase();
  if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const { url: supabaseUrl, key: supabaseKey } = sbConfig;

  try {
    // Verify deal ownership
    const dealResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/deals?id=eq.${encodeURIComponent(id)}&select=id,owner_email,type`,
      { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
    );
    const [deal] = dealResp.ok ? await dealResp.json() : [];
    if (!deal) return NextResponse.json({ error: 'Deal not found.' }, { status: 404 });
    if (deal.owner_email !== auth.email) return NextResponse.json({ error: 'Only the deal owner can link reports.' }, { status: 403 });

    // Verify participant belongs to this deal
    const partResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/deal_participants?id=eq.${encodeURIComponent(participantId)}&deal_id=eq.${encodeURIComponent(id)}&select=id,role,status`,
      { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
    );
    const [participant] = partResp.ok ? await partResp.json() : [];
    if (!participant) return NextResponse.json({ error: 'Participant not found.' }, { status: 404 });

    const now = new Date().toISOString();

    // Update deal_participants
    const patchPartResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/deal_participants?id=eq.${encodeURIComponent(participantId)}`,
      {
        method: 'PATCH',
        headers: getSupabaseWriteHeaders(supabaseKey),
        body: JSON.stringify({ report_id: reportId, status: 'complete', completed_at: now }),
      }
    );
    if (!patchPartResp.ok) return NextResponse.json({ error: 'Failed to link participant.' }, { status: 502 });

    // Also tag the diagnostic report with this deal
    await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${encodeURIComponent(reportId)}`,
      {
        method: 'PATCH',
        headers: getSupabaseWriteHeaders(supabaseKey),
        body: JSON.stringify({ deal_id: id, deal_role: participant.role }),
      }
    ).catch(() => {}); // non-fatal

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error('Link participant report error', { requestId: getRequestId(request), error: err.message });
    return NextResponse.json({ error: 'Failed to link report.' }, { status: 500 });
  }
}
