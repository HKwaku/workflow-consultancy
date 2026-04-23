import { NextResponse } from 'next/server';
import { getSupabaseHeaders, fetchWithTimeout, requireSupabase, checkOrigin, getRequestId } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

/**
 * GET /api/deals/resolve?participant=TOKEN
 * GET /api/deals/resolve?code=DEALCODE
 * GET /api/deals/resolve?flowId=UUID          (auth required)
 *
 * Pre-auth endpoint - resolves an invite token or deal code so the AuditGate
 * can pre-fill deal context before the user logs in. The flowId branch is
 * auth-gated and used by logged-in editors/participants who clicked "Open
 * flow" in the portal.
 *
 * Returns only what the landing page needs; never exposes other participant emails.
 */
export async function GET(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

  const token = request.nextUrl.searchParams.get('participant');
  const code = request.nextUrl.searchParams.get('code');
  const flowId = request.nextUrl.searchParams.get('flowId');

  // Extra per-code rate limit so deal codes can't be brute-force enumerated
  // by rotating IPs. Shares the same sliding window; keyed by the code itself.
  if (code && !token && !flowId) {
    const codeKey = `deal-code:${String(code || '').trim().toLowerCase()}`;
    const codeRl = await checkRateLimit(codeKey);
    if (!codeRl.allowed) {
      return NextResponse.json({ error: 'Too many lookups for this code.' }, { status: 429, headers: { 'Retry-After': String(codeRl.retryAfter || 60) } });
    }
  }

  if (!token && !code && !flowId) {
    return NextResponse.json({ error: 'Valid participant token, deal code, or flow id required.' }, { status: 400 });
  }

  const sbConfig = requireSupabase();
  if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const { url: supabaseUrl, key: supabaseKey } = sbConfig;

  // ── Flow-id lookup (auth required) ───────────────────────────────
  if (flowId) {
    if (typeof flowId !== 'string' || flowId.length < 8 || flowId.length > 64) {
      return NextResponse.json({ error: 'Invalid flow id.' }, { status: 400 });
    }
    const auth = await requireAuth(request);
    if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
    const callerLower = (auth.email || '').toLowerCase();

    try {
      const resp = await fetchWithTimeout(
        `${supabaseUrl}/rest/v1/deal_flows?id=eq.${encodeURIComponent(flowId)}&select=id,label,flow_kind,status,report_id,deal_participants(id,role,company_name,participant_name,participant_email,status),deals(id,deal_code,type,name,process_name,settings,status,owner_email,collaborator_emails)`,
        { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
      );
      if (!resp.ok) {
        logger.warn('Deal resolve by flowId: Supabase error', { requestId: getRequestId(request), status: resp.status });
        return NextResponse.json({ error: 'Failed to resolve flow.' }, { status: 502 });
      }
      const [flow] = await resp.json();
      if (!flow) return NextResponse.json({ error: 'Flow not found.' }, { status: 404 });

      const deal = flow.deals || null;
      const part = flow.deal_participants || null;
      if (!deal || !part) return NextResponse.json({ error: 'Flow context missing.' }, { status: 404 });
      if (deal.status === 'complete') return NextResponse.json({ error: 'This deal is already complete.' }, { status: 409 });
      if (flow.status === 'complete') return NextResponse.json({ error: 'This flow is already complete.' }, { status: 409 });

      const ownerLower = (deal.owner_email || '').toLowerCase();
      const collabLower = Array.isArray(deal.collaborator_emails)
        ? deal.collaborator_emails.map((e) => (typeof e === 'string' ? e.toLowerCase() : '')).filter(Boolean)
        : [];
      const partEmailLower = (part.participant_email || '').toLowerCase();
      const isAuthorized =
        callerLower === ownerLower ||
        collabLower.includes(callerLower) ||
        (!!partEmailLower && partEmailLower === callerLower);
      if (!isAuthorized) return NextResponse.json({ error: 'Not authorized for this flow.' }, { status: 403 });

      return NextResponse.json({
        flowId: flow.id,
        flowLabel: flow.label,
        flowKind: flow.flow_kind || null,
        flowStatus: flow.status,
        existingReportId: flow.report_id || null,
        participantId: part.id,
        role: part.role,
        companyName: part.company_name,
        participantName: part.participant_name || null,
        dealId: deal.id,
        dealCode: deal.deal_code,
        dealType: deal.type,
        dealName: deal.name,
        processName: deal.process_name || null,
        canonicalStart: deal.settings?.canonicalStart || null,
        canonicalEnd: deal.settings?.canonicalEnd || null,
      });
    } catch (err) {
      logger.error('Deal resolve by flowId error', { requestId: getRequestId(request), error: err.message });
      return NextResponse.json({ error: 'Failed to resolve flow.' }, { status: 500 });
    }
  }

  // ── Code-based lookup ────────────────────────────────────────────
  if (code && !token) {
    const trimmedCode = (code || '').trim();
    if (!/^[a-zA-Z0-9]{4,20}$/.test(trimmedCode)) {
      return NextResponse.json({ error: 'Invalid deal code format. Must be 4–20 alphanumeric characters.' }, { status: 400 });
    }

    try {
      const resp = await fetchWithTimeout(
        `${supabaseUrl}/rest/v1/deals?deal_code=eq.${encodeURIComponent(trimmedCode)}&select=id,deal_code,type,name,process_name,settings,status,owner_email`,
        { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
      );

      if (!resp.ok) {
        logger.warn('Deal resolve by code: Supabase error', { requestId: getRequestId(request), status: resp.status });
        return NextResponse.json({ error: 'Failed to look up deal.' }, { status: 502 });
      }

      let rows;
      try { rows = await resp.json(); } catch {
        return NextResponse.json({ error: 'Failed to parse response.' }, { status: 502 });
      }

      if (!rows || rows.length === 0) {
        return NextResponse.json({ error: 'Deal code not found.' }, { status: 404 });
      }

      const deal = rows[0];
      if (deal.status === 'complete') {
        return NextResponse.json({ error: 'This deal is already complete.' }, { status: 409 });
      }

      // Mask owner email: first 3 chars + @domain
      let ownerEmail = null;
      if (deal.owner_email) {
        const parts = deal.owner_email.split('@');
        ownerEmail = parts[0].slice(0, 3) + (parts[1] ? '@' + parts[1] : '');
      }

      return NextResponse.json({
        dealId: deal.id,
        dealCode: deal.deal_code,
        dealType: deal.type,
        dealName: deal.name,
        processName: deal.process_name || null,
        canonicalStart: deal.settings?.canonicalStart || null,
        canonicalEnd: deal.settings?.canonicalEnd || null,
        ownerEmail,
      });
    } catch (err) {
      logger.error('Deal resolve by code error', { requestId: getRequestId(request), error: err.message });
      return NextResponse.json({ error: 'Failed to look up deal.' }, { status: 500 });
    }
  }

  // ── Token-based lookup ───────────────────────────────────────────
  if (!token || typeof token !== 'string' || token.length < 10 || token.length > 64) {
    return NextResponse.json({ error: 'Valid participant token required.' }, { status: 400 });
  }

  try {
    // Fetch participant + deal in one join
    const resp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/deal_participants?invite_token=eq.${encodeURIComponent(token)}&select=id,role,company_name,participant_name,status,deal_id,deals(id,deal_code,type,name,process_name,settings,status)`,
      { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
    );

    if (!resp.ok) {
      logger.warn('Deal resolve: Supabase error', { requestId: getRequestId(request), status: resp.status });
      return NextResponse.json({ error: 'Failed to resolve invite.' }, { status: 502 });
    }

    let rows;
    try { rows = await resp.json(); } catch {
      return NextResponse.json({ error: 'Failed to parse response.' }, { status: 502 });
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json({ error: 'Invite not found or expired.' }, { status: 404 });
    }

    const p = rows[0];
    const deal = p.deals;

    if (!deal) return NextResponse.json({ error: 'Deal not found.' }, { status: 404 });
    if (deal.status === 'complete') return NextResponse.json({ error: 'This deal is already complete.' }, { status: 409 });
    if (p.status === 'complete') return NextResponse.json({ error: 'This invite has already been used.' }, { status: 409 });

    return NextResponse.json({
      participantId: p.id,
      role: p.role,
      companyName: p.company_name,
      participantName: p.participant_name || null,
      dealId: deal.id,
      dealCode: deal.deal_code,
      dealType: deal.type,
      dealName: deal.name,
      processName: deal.process_name || null,
      canonicalStart: deal.settings?.canonicalStart || null,
      canonicalEnd: deal.settings?.canonicalEnd || null,
    });
  } catch (err) {
    logger.error('Deal resolve error', { requestId: getRequestId(request), error: err.message });
    return NextResponse.json({ error: 'Failed to resolve invite.' }, { status: 500 });
  }
}
