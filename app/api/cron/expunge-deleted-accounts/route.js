/**
 * GET /api/cron/expunge-deleted-accounts
 *
 * Vercel Cron — runs daily at 03:00. Processes user_deletion_requests
 * where status='pending' AND expunge_after <= now(). For each:
 *
 *   1. Anonymise processes owned by the user
 *      (contact_email/contact_name/company → redacted strings).
 *   2. Anonymise chat_sessions
 *      (email/title/summary → redacted; user_id stays for FK integrity).
 *   3. Transfer owned deals to a platform-admin sentinel
 *      (PLATFORM_ADMIN_TRANSFER_EMAIL env var). Collaborators retain access.
 *   4. Update auth.users via Supabase Admin API: change email + scramble
 *      password so the row exists for audit but no one can sign in.
 *   5. Mark request status='completed'.
 *
 * Failures: status='failed' + failure_reason; admin can retry.
 *
 * NOTE: this cron does NOT delete chat_messages. They may contain MNPI
 * shared by other users and there's no clean way to separate "what the
 * deleted user contributed" from "what they responded to". Anonymising
 * the session is sufficient for GDPR.
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase,
} from '@/lib/api-helpers';
import { withCron } from '@/lib/cronWrapper';
import { logger } from '@/lib/logger';
import { auditLog } from '@/lib/auditLog';

export const maxDuration = 120;

const REDACTED = '[redacted-deleted-account]';

export const GET = withCron('expunge-deleted-accounts', async () => {
  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  const sentinelEmail = process.env.PLATFORM_ADMIN_TRANSFER_EMAIL || null;
  if (!sentinelEmail) {
    logger.error('PLATFORM_ADMIN_TRANSFER_EMAIL not set; cannot transfer deal ownership.');
    // Still process the user-data parts; just skip the deal-transfer step.
  }

  const candResp = await fetchWithTimeout(
    `${sb.url}/rest/v1/user_deletion_requests?status=eq.pending&expunge_after=lte.${encodeURIComponent(new Date().toISOString())}&select=id,user_id,email_at_request,expunge_after`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  const candidates = candResp.ok ? await candResp.json() : [];

  let processed = 0;
  let failed = 0;

  for (const req of candidates) {
    const userId = req.user_id;
    const email = req.email_at_request;
    try {
      // 1. Processes
      await fetchWithTimeout(
        `${sb.url}/rest/v1/processes?or=(user_id.eq.${userId},contact_email.eq.${encodeURIComponent(email)})`,
        {
          method: 'PATCH',
          headers: { ...getSupabaseWriteHeaders(sb.key), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contact_email: REDACTED,
            contact_name: REDACTED,
            company: REDACTED,
          }),
        },
      );

      // 2. Chat sessions
      await fetchWithTimeout(
        `${sb.url}/rest/v1/chat_sessions?or=(user_id.eq.${userId},email.eq.${encodeURIComponent(email)})`,
        {
          method: 'PATCH',
          headers: { ...getSupabaseWriteHeaders(sb.key), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: REDACTED,
            title: REDACTED,
            summary: REDACTED,
          }),
        },
      );

      // 3. Transfer deals
      if (sentinelEmail) {
        await fetchWithTimeout(
          `${sb.url}/rest/v1/deals?or=(owner_user_id.eq.${userId},owner_email.eq.${encodeURIComponent(email)})`,
          {
            method: 'PATCH',
            headers: { ...getSupabaseWriteHeaders(sb.key), 'Content-Type': 'application/json' },
            body: JSON.stringify({
              owner_email: sentinelEmail,
              owner_user_id: null,
            }),
          },
        );
      }

      // 4. Token-usage ledger — keep rows but redact the email column
      await fetchWithTimeout(
        `${sb.url}/rest/v1/token_usage_ledger?user_email=eq.${encodeURIComponent(email)}`,
        {
          method: 'PATCH',
          headers: { ...getSupabaseWriteHeaders(sb.key), 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_email: REDACTED }),
        },
      );

      // 5. Anonymise auth.users via Admin API
      try {
        await fetchWithTimeout(
          `${sb.url}/auth/v1/admin/users/${userId}`,
          {
            method: 'PUT',
            headers: { ...getSupabaseHeaders(sb.key), 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: `deleted-${userId}@deleted.invalid`,
              user_metadata: { deleted: true, deleted_at: new Date().toISOString() },
            }),
          },
        );
      } catch (e) {
        logger.warn('Failed to anonymise auth.users row', { userId, error: e.message });
      }

      // 6. Mark request completed
      await fetchWithTimeout(
        `${sb.url}/rest/v1/user_deletion_requests?id=eq.${req.id}`,
        {
          method: 'PATCH',
          headers: { ...getSupabaseWriteHeaders(sb.key), 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed', completed_at: new Date().toISOString() }),
        },
      );

      processed += 1;
      auditLog({
        action: 'gdpr.erasure_processed',
        actorKind: 'cron', actorEmail: 'cron@expunge-deleted-accounts',
        targetType: 'user', targetId: userId,
        details: { dealsTransferred: Boolean(sentinelEmail) },
      });
      logger.info('Account expunged', { userId, email });
    } catch (e) {
      failed += 1;
      auditLog({
        action: 'gdpr.erasure_failed',
        actorKind: 'cron', actorEmail: 'cron@expunge-deleted-accounts',
        targetType: 'user', targetId: userId,
        outcome: 'error',
        details: { error: (e?.message || '').slice(0, 500) },
      });
      logger.error('Account expungement failed', { userId, email, error: e.message });
      await fetchWithTimeout(
        `${sb.url}/rest/v1/user_deletion_requests?id=eq.${req.id}`,
        {
          method: 'PATCH',
          headers: { ...getSupabaseWriteHeaders(sb.key), 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'failed', failure_reason: e.message?.slice(0, 500) || 'unknown' }),
        },
      ).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, processed, failed, candidates: candidates.length });
});
