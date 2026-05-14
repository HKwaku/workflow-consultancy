import { NextResponse } from 'next/server';
import { getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase, checkOrigin, getRequestId, isValidEmail } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { requireDealEditor } from '@/lib/dealAuth';
import { triggerWebhook } from '@/lib/triggerWebhook';
import { logger } from '@/lib/logger';
import { recordTransition } from '@/lib/changes/repo';

const VALID_ROLES = ['platform_company', 'portfolio_company', 'acquirer', 'target', 'self'];

/**
 * POST /api/deals/[id]/participants
 * Editor-only. Adds a participant to an existing deal.
 * Body: { role, companyName, participantEmail?, participantName?, invite?: boolean }
 *
 * If `invite` is truthy and participantEmail is set, fires a deal-invites
 * webhook so the existing email pipeline notifies the new participant.
 * Returns the new row plus a fully-built inviteUrl the caller can copy.
 */
export async function POST(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Deal ID required.' }, { status: 400 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  const role = String(body?.role || '').trim();
  const companyName = String(body?.companyName || '').trim();
  const participantEmail = body?.participantEmail ? String(body.participantEmail).trim().toLowerCase() : null;
  const participantName = body?.participantName ? String(body.participantName).trim() : null;
  const sendInvite = Boolean(body?.invite);

  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` }, { status: 400 });
  }
  if (!companyName || companyName.length > 200) {
    return NextResponse.json({ error: 'companyName required (max 200 chars).' }, { status: 400 });
  }
  if (participantEmail && !isValidEmail(participantEmail)) {
    return NextResponse.json({ error: 'Invalid participantEmail.' }, { status: 400 });
  }

  const sbConfig = requireSupabase();
  if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const { url: supabaseUrl, key: supabaseKey } = sbConfig;

  const guard = await requireDealEditor({ dealId: id, email: auth.email, userId: auth.userId });
  if (guard.error) return NextResponse.json(guard.error, { status: guard.status });

  const insertResp = await fetchWithTimeout(
    `${supabaseUrl}/rest/v1/deal_participants`,
    {
      method: 'POST',
      headers: { ...getSupabaseWriteHeaders(supabaseKey), Prefer: 'return=representation' },
      body: JSON.stringify({
        deal_id: id,
        role,
        company_name: companyName,
        participant_email: participantEmail,
        participant_name: participantName,
        invited_at: participantEmail ? new Date().toISOString() : null,
      }),
    },
  );
  if (!insertResp.ok) {
    const errText = await insertResp.text().catch(() => '');
    logger.warn('Add participant: Supabase error', { requestId: getRequestId(request), status: insertResp.status, body: errText.slice(0, 200) });
    return NextResponse.json({ error: 'Failed to add participant.' }, { status: 502 });
  }
  const [participant] = await insertResp.json();

  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3000';
  const inviteUrl = `${proto}://${host}/workspace/map?participant=${participant.invite_token}`;

  if (sendInvite && participantEmail) {
    triggerWebhook({
      requestType: 'deal-invites',
      dealId: id,
      participants: [{
        participantId: participant.id,
        role: participant.role,
        companyName: participant.company_name,
        participantEmail: participant.participant_email,
        participantName: participant.participant_name,
        inviteUrl,
      }],
    }).catch(() => {});
  }

  // Chat-staged proposal? Flip the proposed change to applied.
  if (typeof body?.change_id === 'string' && body.change_id) {
    recordTransition({ id: body.change_id, state: 'applied', actor_email: auth.email })
      .catch((e) => logger.warn('Change transition (invite participant) failed', { requestId: getRequestId(request), message: e.message }));
  }

  return NextResponse.json({ success: true, participant: { ...participant, inviteUrl } });
}

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
    const guard = await requireDealEditor({ dealId: id, email: auth.email, userId: auth.userId });
    if (guard.error) return NextResponse.json(guard.error, { status: guard.status });

    // Verify participant belongs to this deal
    const partResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/deal_participants?id=eq.${encodeURIComponent(participantId)}&deal_id=eq.${encodeURIComponent(id)}&select=id,role,status`,
      { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
    );
    const [participant] = partResp.ok ? await partResp.json() : [];
    if (!participant) return NextResponse.json({ error: 'Participant not found.' }, { status: 404 });

    // Living-workspace contract: linking a process to a participant does
    // NOT flip the participant to status='complete' or write a completed_at
    // timestamp. There is no terminal "the participant is done" state — the
    // owner is now actively mapping on the canvas. We attach process_id and
    // leave the lifecycle status (invited / in_progress) untouched so the
    // normal mapping-in-progress UX continues. send-diagnostic-report's
    // linkParticipantToProcess uses the same contract; this admin path now
    // matches.
    const patchPartResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/deal_participants?id=eq.${encodeURIComponent(participantId)}`,
      {
        method: 'PATCH',
        headers: getSupabaseWriteHeaders(supabaseKey),
        body: JSON.stringify({ process_id: reportId }),
      }
    );
    if (!patchPartResp.ok) return NextResponse.json({ error: 'Failed to link participant.' }, { status: 502 });

    // Also tag the process with this deal. Living-workspace migration:
    // table renamed, deal_role column dropped.
    await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/processes?id=eq.${encodeURIComponent(reportId)}`,
      {
        method: 'PATCH',
        headers: getSupabaseWriteHeaders(supabaseKey),
        body: JSON.stringify({ deal_id: id }),
      }
    ).catch(() => {}); // non-fatal

    if (typeof body?.change_id === 'string' && body.change_id) {
      recordTransition({ id: body.change_id, state: 'applied', actor_email: auth.email })
        .catch((e) => logger.warn('Change transition (link participant) failed', { requestId: getRequestId(request), message: e.message }));
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error('Link participant report error', { requestId: getRequestId(request), error: err.message });
    return NextResponse.json({ error: 'Failed to link report.' }, { status: 500 });
  }
}
