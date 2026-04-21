import { NextResponse } from 'next/server';
import { getSupabaseHeaders, fetchWithTimeout, requireSupabase, checkOrigin, getRequestId } from '@/lib/api-helpers';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

/**
 * GET /api/deals/resolve?participant=TOKEN
 * GET /api/deals/resolve?code=DEALCODE
 *
 * Pre-auth endpoint — resolves an invite token or deal code so the AuditGate
 * can pre-fill deal context before the user logs in.
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

  if (!token && !code) {
    return NextResponse.json({ error: 'Valid participant token or deal code required.' }, { status: 400 });
  }

  const sbConfig = requireSupabase();
  if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const { url: supabaseUrl, key: supabaseKey } = sbConfig;

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
