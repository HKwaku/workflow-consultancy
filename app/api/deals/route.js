import { NextResponse } from 'next/server';
import { getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase, checkOrigin, getRequestId, isValidEmail } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { triggerWebhook } from '@/lib/triggerWebhook';
import { logger } from '@/lib/logger';

const MAX_PAYLOAD_BYTES = 512 * 1024;

const VALID_TYPES = ['pe_rollup', 'ma', 'scaling'];
const VALID_ROLES = ['platform_company', 'portfolio_company', 'acquirer', 'target', 'self'];

function buildBaseUrl(request) {
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

/**
 * POST /api/deals
 * Auth required. Creates a deal and its initial participants.
 *
 * Body: {
 *   type: 'pe_rollup' | 'ma' | 'scaling',
 *   name: string,
 *   processName?: string,
 *   participants: [{ role, companyName, participantEmail?, participantName? }]
 * }
 */
export async function POST(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

  const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
  if (contentLength > MAX_PAYLOAD_BYTES) return NextResponse.json({ error: 'Request body too large.' }, { status: 413 });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  const { type, name, processName, canonicalStart, canonicalEnd, participants } = body;

  if (!type || !VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` }, { status: 400 });
  }
  if (!name || typeof name !== 'string' || name.trim().length === 0 || name.length > 200) {
    return NextResponse.json({ error: 'name is required (max 200 chars).' }, { status: 400 });
  }
  if (!Array.isArray(participants) || participants.length === 0) {
    return NextResponse.json({ error: 'At least one participant is required.' }, { status: 400 });
  }
  if (participants.length > 50) {
    return NextResponse.json({ error: 'Maximum 50 participants per deal.' }, { status: 400 });
  }
  for (const p of participants) {
    if (!p.role || !VALID_ROLES.includes(p.role)) {
      return NextResponse.json({ error: `Each participant needs a valid role: ${VALID_ROLES.join(', ')}` }, { status: 400 });
    }
    if (!p.companyName || typeof p.companyName !== 'string' || p.companyName.trim().length === 0) {
      return NextResponse.json({ error: 'Each participant needs a companyName.' }, { status: 400 });
    }
    if (p.participantEmail && !isValidEmail(p.participantEmail)) {
      return NextResponse.json({ error: `Invalid email for participant: ${p.companyName}` }, { status: 400 });
    }
  }

  const sbConfig = requireSupabase();
  if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const { url: supabaseUrl, key: supabaseKey } = sbConfig;
  const baseUrl = buildBaseUrl(request);

  try {
    // 1. Create the deal
    const dealResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/deals`,
      {
        method: 'POST',
        headers: { ...getSupabaseWriteHeaders(supabaseKey), Prefer: 'return=representation' },
        body: JSON.stringify({
          type,
          name: name.trim(),
          process_name: processName?.trim() || null,
          owner_email: auth.email,
          owner_user_id: auth.userId || null,
          status: 'collecting',
          settings: {
            ...(canonicalStart?.trim() ? { canonicalStart: canonicalStart.trim() } : {}),
            ...(canonicalEnd?.trim() ? { canonicalEnd: canonicalEnd.trim() } : {}),
          },
        }),
      }
    );

    if (!dealResp.ok) {
      const errText = await dealResp.text().catch(() => '');
      logger.warn('Create deal: Supabase error', { requestId: getRequestId(request), status: dealResp.status, body: errText });
      return NextResponse.json({ error: 'Failed to create deal.' }, { status: 502 });
    }

    const [deal] = await dealResp.json();

    // 2. Insert participants
    const participantRows = participants.map((p) => ({
      deal_id: deal.id,
      role: p.role,
      company_name: p.companyName.trim(),
      participant_email: p.participantEmail?.trim().toLowerCase() || null,
      participant_name: p.participantName?.trim() || null,
      invited_at: p.participantEmail ? new Date().toISOString() : null,
    }));

    const partResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/deal_participants`,
      {
        method: 'POST',
        headers: { ...getSupabaseWriteHeaders(supabaseKey), Prefer: 'return=representation' },
        body: JSON.stringify(participantRows),
      }
    );

    if (!partResp.ok) {
      logger.warn('Create deal participants: Supabase error', { requestId: getRequestId(request), status: partResp.status });
      // Roll back deal
      await fetchWithTimeout(`${supabaseUrl}/rest/v1/deals?id=eq.${deal.id}`, { method: 'DELETE', headers: getSupabaseHeaders(supabaseKey) }).catch(() => {});
      return NextResponse.json({ error: 'Failed to create participants.' }, { status: 502 });
    }

    const createdParticipants = await partResp.json();

    // 3. Attach invite links and trigger invite emails for participants with emails
    const participantsWithLinks = createdParticipants.map((p) => ({
      ...p,
      inviteUrl: `${baseUrl}/process-audit?participant=${p.invite_token}`,
    }));

    const toInvite = participantsWithLinks.filter((p) => p.participant_email);
    if (toInvite.length > 0) {
      triggerWebhook(
        {
          requestType: 'deal-invites',
          dealId: deal.id,
          dealCode: deal.deal_code,
          dealName: deal.name,
          dealType: deal.type,
          processName: deal.process_name,
          ownerEmail: auth.email,
          invites: toInvite.map((p) => ({
            participantId: p.id,
            role: p.role,
            companyName: p.company_name,
            participantEmail: p.participant_email,
            participantName: p.participant_name,
            inviteUrl: p.inviteUrl,
          })),
        },
        { envSuffix: 'DEAL_INVITE', requestId: getRequestId(request) }
      ).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      deal: {
        id: deal.id,
        dealCode: deal.deal_code,
        type: deal.type,
        name: deal.name,
        processName: deal.process_name,
        canonicalStart: deal.settings?.canonicalStart || null,
        canonicalEnd: deal.settings?.canonicalEnd || null,
        status: deal.status,
        createdAt: deal.created_at,
      },
      participants: participantsWithLinks.map((p) => ({
        id: p.id,
        role: p.role,
        companyName: p.company_name,
        participantEmail: p.participant_email,
        participantName: p.participant_name,
        status: p.status,
        inviteUrl: p.inviteUrl,
      })),
    }, { status: 201 });
  } catch (err) {
    logger.error('Create deal error', { requestId: getRequestId(request), error: err.message });
    return NextResponse.json({ error: 'Failed to create deal.' }, { status: 500 });
  }
}

/**
 * GET /api/deals
 * Auth required. Lists deals owned by or participated in by the authenticated user.
 */
export async function GET(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const sbConfig = requireSupabase();
  if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const { url: supabaseUrl, key: supabaseKey } = sbConfig;

  try {
    // Fetch deals where owner, plus participant-linked deals
    const [ownedResp, participantResp] = await Promise.all([
      fetchWithTimeout(
        `${supabaseUrl}/rest/v1/deals?owner_email=eq.${encodeURIComponent(auth.email)}&select=id,deal_code,type,name,process_name,status,created_at,updated_at&order=created_at.desc&limit=100`,
        { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
      ),
      fetchWithTimeout(
        `${supabaseUrl}/rest/v1/deal_participants?participant_email=eq.${encodeURIComponent(auth.email)}&select=deal_id,role,company_name,status,deals(id,deal_code,type,name,process_name,status,created_at,updated_at)&limit=100`,
        { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
      ),
    ]);

    const owned = ownedResp.ok ? await ownedResp.json() : [];
    const participantRows = participantResp.ok ? await participantResp.json() : [];

    // Merge, deduplicate by id
    const seen = new Set();
    const deals = [];

    for (const d of owned) {
      if (!seen.has(d.id)) { seen.add(d.id); deals.push({ ...d, ownerRole: 'owner' }); }
    }
    for (const row of participantRows) {
      const d = row.deals;
      if (d && !seen.has(d.id)) {
        seen.add(d.id);
        deals.push({ ...d, ownerRole: row.role, participantCompany: row.company_name });
      }
    }

    deals.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

    return NextResponse.json({ deals });
  } catch (err) {
    logger.error('List deals error', { requestId: getRequestId(request), error: err.message });
    return NextResponse.json({ error: 'Failed to list deals.' }, { status: 500 });
  }
}
