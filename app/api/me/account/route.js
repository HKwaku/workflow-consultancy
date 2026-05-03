/**
 * /api/me/account
 *
 * GDPR Article 17 — Right to Erasure.
 *
 * GET    - returns current deletion status for the calling user.
 * DELETE - schedules deletion. Body must include { confirmation: 'DELETE MY ACCOUNT' }
 *          (case-sensitive). Idempotent: posting twice returns the existing
 *          pending request. The user has 30 days to cancel via POST below.
 * POST   - { action: 'cancel' } cancels a pending deletion.
 *
 * The actual data redaction happens via /api/cron/expunge-deleted-accounts
 * which runs daily and processes requests whose expunge_after has passed.
 *
 * Owned deals do NOT disappear when their owner deletes — collaborators
 * retain access. Ownership transfers to a platform-admin sentinel via the
 * cron's redaction step. We do this to honour the contract with everyone
 * who has visibility on the deal, not just the owner.
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import {
  getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase,
  checkOrigin, getRequestId,
} from '@/lib/api-helpers';
import { logger } from '@/lib/logger';
import { auditLog, requestContext } from '@/lib/auditLog';

export const maxDuration = 15;

const REQUIRED_CONFIRMATION = 'DELETE MY ACCOUNT';

export async function GET(request) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const sb = requireSupabase();
  const resp = await fetchWithTimeout(
    `${sb.url}/rest/v1/user_deletion_requests?user_id=eq.${auth.userId}&select=*&limit=1`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  const [row] = resp.ok ? await resp.json() : [];
  return NextResponse.json({
    deletionRequest: row || null,
    user: { id: auth.userId, email: auth.email },
  });
}

export async function DELETE(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  let body = null;
  try { body = await request.json(); } catch { /* allow empty for backwards compat tests */ }
  if (body?.confirmation !== REQUIRED_CONFIRMATION) {
    return NextResponse.json({
      error: `Confirmation mismatch. Send body { "confirmation": "${REQUIRED_CONFIRMATION}" } to proceed.`,
    }, { status: 400 });
  }

  const sb = requireSupabase();
  const reqId = getRequestId(request);

  // Insert request — UNIQUE on user_id, so a second DELETE returns the first.
  const insertResp = await fetchWithTimeout(
    `${sb.url}/rest/v1/user_deletion_requests?on_conflict=user_id`,
    {
      method: 'POST',
      headers: {
        ...getSupabaseWriteHeaders(sb.key),
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify({
        user_id: auth.userId,
        email_at_request: auth.email,
        status: 'pending',
        // expunge_after defaults to now() + 30 days at the DB layer
      }),
    },
  );
  if (!insertResp.ok) {
    const txt = await insertResp.text().catch(() => '');
    logger.error('Account deletion request failed to write', { requestId: reqId, userId: auth.userId, status: insertResp.status, body: txt.slice(0, 200) });
    return NextResponse.json({ error: 'Failed to schedule deletion.' }, { status: 502 });
  }
  const [row] = await insertResp.json();

  // Block further sign-ins by setting a banned_until far in the future.
  // Supabase Admin API: PATCH /auth/v1/admin/users/{id}.
  try {
    await fetchWithTimeout(
      `${sb.url}/auth/v1/admin/users/${auth.userId}`,
      {
        method: 'PUT',
        headers: { ...getSupabaseHeaders(sb.key), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ban_duration: '8760h' }),  // 365 days; cron will expunge before this anyway
      },
    );
  } catch (e) {
    logger.warn('Failed to ban auth user during deletion request (cron will still process)', { error: e.message, userId: auth.userId });
  }

  auditLog({
    action: 'gdpr.erasure_requested',
    actorEmail: auth.email, actorUserId: auth.userId,
    targetType: 'user', targetId: auth.userId,
    requestId: reqId,
    ...requestContext(request),
    details: { expunge_after: row.expunge_after },
  });

  logger.info('Account deletion scheduled', { requestId: reqId, userId: auth.userId, expunge_after: row.expunge_after });
  return NextResponse.json({
    ok: true,
    deletionRequest: row,
    message: `Account scheduled for deletion. You have until ${new Date(row.expunge_after).toLocaleDateString()} to cancel by signing in and clicking Cancel deletion.`,
  });
}

export async function POST(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  if (body?.action !== 'cancel') {
    return NextResponse.json({ error: "Only { action: 'cancel' } is supported here." }, { status: 400 });
  }

  const sb = requireSupabase();
  const resp = await fetchWithTimeout(
    `${sb.url}/rest/v1/user_deletion_requests?user_id=eq.${auth.userId}&status=eq.pending`,
    {
      method: 'PATCH',
      headers: { ...getSupabaseHeaders(sb.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled', cancelled_at: new Date().toISOString() }),
    },
  );
  if (!resp.ok) return NextResponse.json({ error: 'Failed to cancel.' }, { status: 502 });

  // Lift the ban.
  try {
    await fetchWithTimeout(
      `${sb.url}/auth/v1/admin/users/${auth.userId}`,
      {
        method: 'PUT',
        headers: { ...getSupabaseHeaders(sb.key), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ban_duration: 'none' }),
      },
    );
  } catch { /* surfacing this would require a second call; leave as logged */ }

  auditLog({
    action: 'gdpr.erasure_cancelled',
    actorEmail: auth.email, actorUserId: auth.userId,
    targetType: 'user', targetId: auth.userId,
    ...requestContext(request),
  });

  logger.info('Account deletion cancelled', { userId: auth.userId });
  return NextResponse.json({ ok: true });
}
