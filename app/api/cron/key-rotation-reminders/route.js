/**
 * GET /api/cron/key-rotation-reminders
 *
 * Vercel Cron — runs daily. For every active customer key whose
 * rotation_due_at falls within the next 14 days AND for which we haven't
 * already sent a reminder this rotation period, write a
 * 'rotation_reminder_sent' audit row. The admin UI surfaces overdue / soon
 * indicators directly on the key list — this cron exists so we have an
 * auditable signal of "we told them" and can hook a future email/Slack send.
 *
 * Idempotent: runs without sending duplicates because we check for an
 * existing reminder audit row inside the current rotation period.
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase,
} from '@/lib/api-helpers';
import { withCron } from '@/lib/cronWrapper';
import { logger } from '@/lib/logger';

const REMIND_WITHIN_DAYS = 14;

export const GET = withCron('key-rotation-reminders', async () => {
  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  const cutoff = new Date(Date.now() + REMIND_WITHIN_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Find candidates: active keys with rotation_due_at within window
  const candResp = await fetchWithTimeout(
    `${sb.url}/rest/v1/customer_api_keys?status=eq.active&rotation_due_at=lte.${encodeURIComponent(cutoff)}&select=id,organization_id,vendor,key_fingerprint,set_at,rotation_due_at,set_by_email`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  const candidates = candResp.ok ? await candResp.json() : [];

  let reminded = 0;
  let skipped  = 0;

  for (const k of candidates) {
    // Skip if a reminder has already been sent since this key was set.
    const auditResp = await fetchWithTimeout(
      `${sb.url}/rest/v1/customer_api_key_audit?organization_id=eq.${k.organization_id}&vendor=eq.${k.vendor}&action=eq.rotation_reminder_sent&created_at=gte.${encodeURIComponent(k.set_at)}&select=id&limit=1`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    );
    const existing = auditResp.ok ? await auditResp.json() : [];
    if (existing.length > 0) { skipped += 1; continue; }

    await fetchWithTimeout(
      `${sb.url}/rest/v1/rpc/audit_customer_key_event`,
      {
        method: 'POST',
        headers: { ...getSupabaseWriteHeaders(sb.key), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p_org_id: k.organization_id,
          p_vendor: k.vendor,
          p_action: 'rotation_reminder_sent',
          p_actor_email: 'system',
          p_actor_user_id: null,
          p_request_id: 'cron:key-rotation-reminders',
          p_details: { fingerprint: k.key_fingerprint, rotation_due_at: k.rotation_due_at, set_by: k.set_by_email },
        }),
      },
    );
    reminded += 1;
    // TODO: hook outbound email / Slack here once we have a notification surface.
  }

  logger.info('Key rotation reminder cron complete', { reminded, skipped, candidates: candidates.length });
  return NextResponse.json({ ok: true, reminded, skipped, candidates: candidates.length });
});
