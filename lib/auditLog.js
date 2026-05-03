/**
 * audit_log_event() RPC wrapper.
 *
 * Single sanctioned write path for the SOC 2 audit ledger. Two design rules:
 *
 *   1. NEVER throw. An audit-write failure must not break the request that
 *      triggered it — the request itself is the user-visible action; the
 *      audit row is best-effort observability for the auditor. Failures
 *      degrade to a logger.warn which still hits Sentry.
 *
 *   2. Fire-and-forget by default. We `void` the promise so callers don't
 *      have to await. Pass `await: true` if you specifically need ordering
 *      (rare — only when a downstream check reads audit_logs).
 *
 * Conventional action names (lower_snake_dotted):
 *   deal.read | deal.write | deal.export | deal.deleted
 *   member.invited | member.role_changed | member.entitlements_changed | member.removed
 *   org.budget_changed | org.allowlist_changed
 *   gdpr.erasure_requested | gdpr.erasure_cancelled | gdpr.erasure_processed | gdpr.erasure_failed
 *   key.set | key.rotated | key.revoked
 *   cron.* — handled by lib/cronWrapper.js via cron_run_open/close, not this helper
 *
 * Usage:
 *   import { auditLog } from '@/lib/auditLog';
 *   auditLog({
 *     action: 'deal.read',
 *     actorEmail: auth.email, actorUserId: auth.userId,
 *     dealId, requestId, outcome: 'success',
 *   });
 */

import { fetchWithTimeout, getSupabaseHeaders, requireSupabase } from './api-helpers.js';
import { logger } from './logger.js';

const ALLOWED_ACTOR_KINDS = new Set(['user', 'system', 'cron', 'worker', 'service_role']);
const ALLOWED_OUTCOMES   = new Set(['success', 'denied', 'error']);

/**
 * Insert an audit row. Returns a promise that resolves to the row id (or
 * null on failure). Never throws.
 */
export function auditLog(event = {}) {
  const promise = _emit(event);
  if (event.await) return promise;
  // Fire-and-forget — but still consume the rejection to avoid unhandled-promise warnings.
  promise.catch(() => {});
  return promise;
}

async function _emit(event) {
  try {
    const sb = requireSupabase();
    if (!sb) return null;

    const action = String(event.action || '').trim();
    if (!action) {
      logger.warn('auditLog called without action — dropping', { event });
      return null;
    }

    const actorKind = ALLOWED_ACTOR_KINDS.has(event.actorKind) ? event.actorKind : 'user';
    const outcome   = ALLOWED_OUTCOMES.has(event.outcome)      ? event.outcome   : 'success';

    const body = {
      p_action:          action,
      p_actor_user_id:   event.actorUserId   ?? null,
      p_actor_email:     event.actorEmail    ?? null,
      p_actor_kind:      actorKind,
      p_target_type:     event.targetType    ?? null,
      p_target_id:       event.targetId != null ? String(event.targetId) : null,
      p_organization_id: event.organizationId ?? null,
      p_deal_id:         event.dealId        ?? null,
      p_request_id:      event.requestId     ?? null,
      p_ip:              event.ip            ?? null,
      p_user_agent:      event.userAgent     ?? null,
      p_outcome:         outcome,
      p_details:         event.details ?? {},
    };

    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/rpc/audit_log_event`,
      {
        method: 'POST',
        headers: { ...getSupabaseHeaders(sb.key), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      5000,
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      logger.warn('audit_log_event RPC non-2xx', {
        action, status: resp.status, body: text.slice(0, 200),
      });
      return null;
    }

    const id = await resp.json().catch(() => null);
    return typeof id === 'string' ? id : null;
  } catch (e) {
    logger.warn('audit_log_event RPC threw', { action: event?.action, error: e?.message });
    return null;
  }
}

/**
 * Helper to extract IP / user agent from a Next.js Request without each call
 * site repeating the header dance.
 */
export function requestContext(request) {
  if (!request) return {};
  const headers = request.headers || new Headers();
  const get = (k) => (typeof headers.get === 'function' ? headers.get(k) : null);
  const fwd = get('x-forwarded-for') || '';
  const ip = fwd.split(',')[0].trim() || get('x-real-ip') || null;
  const userAgent = get('user-agent') || null;
  return { ip, userAgent };
}
