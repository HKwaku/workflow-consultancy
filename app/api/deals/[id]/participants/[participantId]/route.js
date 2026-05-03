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

const VALID_ROLES = ['platform_company', 'portfolio_company', 'acquirer', 'target', 'self'];

/**
 * PATCH /api/deals/[id]/participants/[participantId]
 * Editor-only. Two distinct modes:
 *   1. Unlink a report:  { report_id: null }   (also clears participant status + completed_at)
 *   2. Edit metadata:    { role?, companyName?, participantEmail?, participantName? }
 *
 * Modes are mutually exclusive — pass one or the other, not both. The unlink
 * mode is used by the chat-side `propose_undo_last_action` flow; the metadata
 * mode is used by the workspace-modal participant editor.
 */
export async function PATCH(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id, participantId } = await params;
  if (!id || !participantId) return NextResponse.json({ error: 'Deal ID and participant ID required.' }, { status: 400 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  const wantsUnlink = body && Object.prototype.hasOwnProperty.call(body, 'report_id') && body.report_id === null;
  const metaKeys = ['role', 'companyName', 'participantEmail', 'participantName'];
  const hasMetaEdit = metaKeys.some((k) => Object.prototype.hasOwnProperty.call(body || {}, k));

  if (!wantsUnlink && !hasMetaEdit) {
    return NextResponse.json({ error: 'Pass either { report_id: null } or one of { role, companyName, participantEmail, participantName }.' }, { status: 400 });
  }
  if (wantsUnlink && hasMetaEdit) {
    return NextResponse.json({ error: 'Unlink and metadata edit are mutually exclusive — call separately.' }, { status: 400 });
  }

  const sbConfig = requireSupabase();
  if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const { url: supabaseUrl, key: supabaseKey } = sbConfig;

  const guard = await requireDealEditor({ dealId: id, email: auth.email, userId: auth.userId });
  if (guard.error) return NextResponse.json(guard.error, { status: guard.status });

  const verify = await fetchWithTimeout(
    `${supabaseUrl}/rest/v1/deal_participants?id=eq.${encodeURIComponent(participantId)}&deal_id=eq.${encodeURIComponent(id)}&select=id,report_id,role`,
    { method: 'GET', headers: getSupabaseHeaders(supabaseKey) },
  );
  const [row] = verify.ok ? await verify.json() : [];
  if (!row) return NextResponse.json({ error: 'Participant not found on this deal.' }, { status: 404 });

  if (wantsUnlink) {
    const previousReportId = row.report_id;
    const patchPart = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/deal_participants?id=eq.${encodeURIComponent(participantId)}`,
      {
        method: 'PATCH',
        headers: getSupabaseWriteHeaders(supabaseKey),
        body: JSON.stringify({ report_id: null, status: 'invited', completed_at: null }),
      },
    );
    if (!patchPart.ok) {
      logger.warn('Unlink participant report: Supabase error', { requestId: getRequestId(request), status: patchPart.status });
      return NextResponse.json({ error: 'Failed to unlink report.' }, { status: 502 });
    }
    if (previousReportId) {
      await fetchWithTimeout(
        `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${encodeURIComponent(previousReportId)}`,
        {
          method: 'PATCH',
          headers: getSupabaseWriteHeaders(supabaseKey),
          body: JSON.stringify({ deal_id: null, deal_role: null }),
        },
      ).catch(() => {});
    }
    return NextResponse.json({ success: true });
  }

  // Metadata edit branch
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(body, 'role')) {
    if (!VALID_ROLES.includes(body.role)) {
      return NextResponse.json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` }, { status: 400 });
    }
    patch.role = body.role;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'companyName')) {
    const c = String(body.companyName || '').trim();
    if (!c || c.length > 200) {
      return NextResponse.json({ error: 'companyName must be 1-200 chars.' }, { status: 400 });
    }
    patch.company_name = c;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'participantEmail')) {
    const raw = body.participantEmail;
    if (raw === null || raw === '') {
      patch.participant_email = null;
    } else {
      const e = String(raw).trim().toLowerCase();
      if (!isValidEmail(e)) return NextResponse.json({ error: 'Invalid participantEmail.' }, { status: 400 });
      patch.participant_email = e;
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'participantName')) {
    const n = body.participantName;
    patch.participant_name = n == null || n === '' ? null : String(n).trim();
  }

  const upd = await fetchWithTimeout(
    `${supabaseUrl}/rest/v1/deal_participants?id=eq.${encodeURIComponent(participantId)}`,
    {
      method: 'PATCH',
      headers: { ...getSupabaseWriteHeaders(supabaseKey), Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    },
  );
  if (!upd.ok) {
    logger.warn('Update participant: Supabase error', { requestId: getRequestId(request), status: upd.status });
    return NextResponse.json({ error: 'Failed to update participant.' }, { status: 502 });
  }
  const [updated] = await upd.json();
  return NextResponse.json({ success: true, participant: updated });
}
