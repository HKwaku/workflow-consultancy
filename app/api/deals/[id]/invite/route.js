import { NextResponse } from 'next/server';
import { getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase, checkOrigin, getRequestId, isValidEmail } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { requireDealEditor } from '@/lib/dealAuth';
import { triggerWebhook } from '@/lib/triggerWebhook';
import { logger } from '@/lib/logger';

const VALID_ROLES = ['platform_company', 'portfolio_company', 'acquirer', 'target', 'self'];

function buildBaseUrl(request) {
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

/**
 * POST /api/deals/[id]/invite
 * Auth required (owner only).
 * Adds one participant to an existing deal and (optionally) sends the invite email.
 *
 * Body: { role, companyName, participantEmail?, participantName? }
 */
export async function POST(request, { params }) {
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

  const { role, companyName, participantEmail, participantName } = body;

  if (!role || !VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` }, { status: 400 });
  }
  if (!companyName || typeof companyName !== 'string' || companyName.trim().length === 0) {
    return NextResponse.json({ error: 'companyName is required.' }, { status: 400 });
  }
  if (participantEmail && !isValidEmail(participantEmail)) {
    return NextResponse.json({ error: 'Invalid participantEmail.' }, { status: 400 });
  }

  const sbConfig = requireSupabase();
  if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const { url: supabaseUrl, key: supabaseKey } = sbConfig;
  const baseUrl = buildBaseUrl(request);

  try {
    const guard = await requireDealEditor({ dealId: id, email: auth.email, userId: auth.userId });
    if (guard.error) return NextResponse.json(guard.error, { status: guard.status });
    const deal = guard.access.deal;
    if (deal.status === 'complete') return NextResponse.json({ error: 'Cannot add participants to a completed deal.' }, { status: 409 });

    // Count existing participants (cap at 50)
    const countResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/deal_participants?deal_id=eq.${id}&select=id`,
      { method: 'GET', headers: { ...getSupabaseHeaders(supabaseKey), Prefer: 'count=exact', Range: '0-0' } }
    );
    const contentRange = countResp.headers?.get('Content-Range') || '';
    const total = parseInt(contentRange.split('/')[1] || '0', 10);
    if (total >= 50) return NextResponse.json({ error: 'Maximum 50 participants per deal.' }, { status: 422 });

    // Insert participant
    const partResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/deal_participants`,
      {
        method: 'POST',
        headers: { ...getSupabaseWriteHeaders(supabaseKey), Prefer: 'return=representation' },
        body: JSON.stringify({
          deal_id: id,
          role,
          company_name: companyName.trim(),
          participant_email: participantEmail?.trim().toLowerCase() || null,
          participant_name: participantName?.trim() || null,
          invited_at: participantEmail ? new Date().toISOString() : null,
        }),
      }
    );

    if (!partResp.ok) {
      logger.warn('Add participant: Supabase error', { requestId: getRequestId(request), status: partResp.status });
      return NextResponse.json({ error: 'Failed to add participant.' }, { status: 502 });
    }

    const [participant] = await partResp.json();
    const inviteUrl = `${baseUrl}/process-audit?participant=${participant.invite_token}`;

    // Send invite email if email provided
    if (participantEmail) {
      triggerWebhook(
        {
          requestType: 'deal-invites',
          dealId: deal.id,
          dealCode: deal.deal_code,
          dealName: deal.name,
          dealType: deal.type,
          processName: deal.process_name,
          ownerEmail: auth.email,
          invites: [{
            participantId: participant.id,
            role: participant.role,
            companyName: participant.company_name,
            participantEmail: participant.participant_email,
            participantName: participant.participant_name,
            inviteUrl,
          }],
        },
        { envSuffix: 'DEAL_INVITE', requestId: getRequestId(request) }
      ).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      participant: {
        id: participant.id,
        role: participant.role,
        companyName: participant.company_name,
        participantEmail: participant.participant_email,
        participantName: participant.participant_name,
        status: participant.status,
        inviteUrl,
      },
    }, { status: 201 });
  } catch (err) {
    logger.error('Add participant error', { requestId: getRequestId(request), error: err.message });
    return NextResponse.json({ error: 'Failed to add participant.' }, { status: 500 });
  }
}
