/**
 * Customer-managed API key helper.
 *
 * The single sanctioned read path for org-owned BYO keys. All routes that
 * need to make a vendor call should go through here:
 *
 *   const { key, source } = await resolveActiveKey({ orgId, vendor: 'anthropic' });
 *   if (source === 'customer') { ... meter for observability only ... }
 *
 * Three responsibilities:
 *   1. Resolve the active key for an (org, vendor): customer key if set,
 *      else platform key from env. Surfaces a `source` flag so callers can
 *      decide whether to enforce token-budget caps (we only enforce on
 *      the platform key — customers pay Anthropic directly).
 *   2. Set / rotate / revoke a customer key, writing the audit row atomically
 *      via the set_customer_api_key RPC. Validates the key with a tiny test
 *      call before persisting so the admin UI can give instant feedback.
 *   3. Helpers for display: maskKey, daysUntilRotation, fingerprint computation.
 *
 * Security posture:
 *   - The raw key is NEVER returned to any client surface — only fingerprints.
 *   - Decrypted keys are never logged (Sentry, console). Helper functions
 *     deliberately don't accept logger args to keep the temptation away.
 *   - Per-process LRU cache of decrypted keys with a 60s TTL avoids hammering
 *     the RPC on every request, but invalidates on revoke/rotate.
 */

import { getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase } from './api-helpers.js';
import { logger } from './logger.js';
import { auditLog } from './auditLog.js';

// Mistral is included for the dataroom OCR pipeline (Mistral Document OCR
// is the default provider in lib/ai/ocr.js). Org admins set the key the
// same way they set Anthropic / Voyage / OpenAI — no env-only path.
export const SUPPORTED_VENDORS = ['anthropic', 'voyage', 'openai', 'mistral'];
const ROTATION_REMINDER_DAYS = 90;
const KEY_CACHE_TTL_MS = 60_000;

const _keyCache = new Map(); // `${orgId}:${vendor}` -> { key, fingerprint, expiresAt, source }

/* ── Display helpers ─────────────────────────────────────────────── */

/** Masked form for UI display: keep prefix + last 4. Safe to ship to browser. */
export function maskKey(raw) {
  if (typeof raw !== 'string' || raw.length < 12) return '***';
  return `${raw.slice(0, 7)}...${raw.slice(-4)}`;
}

export function fingerprintKey(raw) {
  // Identical algorithm to maskKey — admin UI needs the same string the audit
  // table records. (We could SHA the key, but plaintext-prefix is more useful
  // for debugging "wait, which key did I paste in?")
  return maskKey(raw);
}

export function daysUntilRotation(rotationDueAt) {
  if (!rotationDueAt) return null;
  const due = new Date(rotationDueAt).getTime();
  const days = Math.round((due - Date.now()) / (1000 * 60 * 60 * 24));
  return days;
}

/* ── Validation ──────────────────────────────────────────────────── */

/**
 * Make a 1-token Anthropic call to verify the key is live. Costs ~$0.000003.
 * Returns { valid: true } or { valid: false, reason }.
 */
export async function validateAnthropicKey(rawKey) {
  if (typeof rawKey !== 'string' || !rawKey.startsWith('sk-ant-')) {
    return { valid: false, reason: 'Key must start with sk-ant-' };
  }
  try {
    const resp = await fetchWithTimeout(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'x-api-key': rawKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ok' }],
        }),
      },
      15_000,
    );
    if (resp.ok) return { valid: true };
    const body = await resp.text().catch(() => '');
    if (resp.status === 401) return { valid: false, reason: 'Anthropic rejected the key (401).' };
    if (resp.status === 403) return { valid: false, reason: 'Anthropic forbidden — check workspace permissions.' };
    if (resp.status === 429) return { valid: false, reason: 'Rate-limited at validation time; key may be valid but try again in a minute.' };
    return { valid: false, reason: `Anthropic returned ${resp.status}: ${body.slice(0, 120)}` };
  } catch (e) {
    return { valid: false, reason: `Validation request failed: ${e.message}` };
  }
}

/**
 * Verify an OpenAI key with a free `GET /v1/models` lookup. No tokens
 * billed; just confirms auth + basic project access. Returns the same shape
 * as validateAnthropicKey so setCustomerKey can stay vendor-agnostic.
 *
 * Modern OpenAI keys carry a few prefixes — `sk-proj-...` for project keys,
 * `sk-svcacct-...` for service-account keys, plain `sk-...` for legacy user
 * keys. We accept any of those.
 */
export async function validateOpenAIKey(rawKey) {
  if (typeof rawKey !== 'string' || !rawKey.startsWith('sk-')) {
    return { valid: false, reason: 'Key must start with sk-' };
  }
  try {
    const resp = await fetchWithTimeout(
      'https://api.openai.com/v1/models',
      { method: 'GET', headers: { Authorization: `Bearer ${rawKey}` } },
      15_000,
    );
    if (resp.ok) return { valid: true };
    const body = await resp.text().catch(() => '');
    if (resp.status === 401) return { valid: false, reason: 'OpenAI rejected the key (401).' };
    if (resp.status === 403) return { valid: false, reason: 'OpenAI forbidden — check project / workspace scope.' };
    if (resp.status === 429) return { valid: false, reason: 'Rate-limited at validation time; key may be valid but try again in a minute.' };
    return { valid: false, reason: `OpenAI returned ${resp.status}: ${body.slice(0, 120)}` };
  } catch (e) {
    return { valid: false, reason: `Validation request failed: ${e.message}` };
  }
}

/* ── Read path ───────────────────────────────────────────────────── */

/**
 * Resolve the API key to use for an (org, vendor) call.
 * @returns {Promise<{ key: string|null, source: 'customer'|'platform'|'none', fingerprint?: string, keyId?: string, rotationDueAt?: string }>}
 */
export async function resolveActiveKey({ orgId, vendor }) {
  if (!SUPPORTED_VENDORS.includes(vendor)) {
    return { key: platformKeyFor(vendor), source: platformKeyFor(vendor) ? 'platform' : 'none' };
  }

  // Try customer key first.
  if (orgId) {
    const customer = await getCustomerKey({ orgId, vendor });
    if (customer?.key) return { ...customer, source: 'customer' };
  }

  // Fall back to platform key from env.
  const platform = platformKeyFor(vendor);
  return { key: platform, source: platform ? 'platform' : 'none' };
}

function platformKeyFor(vendor) {
  if (vendor === 'anthropic') return process.env.ANTHROPIC_API_KEY || null;
  if (vendor === 'voyage')    return process.env.VOYAGE_API_KEY || null;
  if (vendor === 'openai')    return process.env.OPENAI_API_KEY || null;
  if (vendor === 'mistral')   return process.env.MISTRAL_API_KEY || null;
  return null;
}

async function getCustomerKey({ orgId, vendor }) {
  const cacheKey = `${orgId}:${vendor}`;
  const cached = _keyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const sb = requireSupabase();
  if (!sb) return null;
  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/rpc/get_active_customer_api_key`,
      {
        method: 'POST',
        headers: { ...getSupabaseWriteHeaders(sb.key), 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_org_id: orgId, p_vendor: vendor }),
      },
      8_000,
    );
    if (!resp.ok) {
      logger.warn('get_active_customer_api_key RPC failed', { status: resp.status, orgId, vendor });
      return null;
    }
    const rows = await resp.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row?.raw_key) return null;
    const entry = {
      key: row.raw_key,
      fingerprint: row.fingerprint,
      keyId: row.key_id,
      rotationDueAt: row.rotation_due_at,
      expiresAt: Date.now() + KEY_CACHE_TTL_MS,
    };
    _keyCache.set(cacheKey, entry);
    return entry;
  } catch (e) {
    logger.warn('Customer-key resolution failed', { error: e.message, orgId, vendor });
    return null;
  }
}

/** Force-evict a cached key after rotate / revoke. */
export function invalidateKeyCache({ orgId, vendor }) {
  if (orgId && vendor) _keyCache.delete(`${orgId}:${vendor}`);
  else _keyCache.clear();
}

/* ── Write path ──────────────────────────────────────────────────── */

/**
 * Set or rotate the active key for an (org, vendor). Validates via a live
 * test call first (so the UI gets instant feedback). On success, encrypts
 * + stores via the set_customer_api_key RPC AND writes the audit row.
 *
 * @returns {Promise<{ ok: true, fingerprint, keyId, action: 'set'|'rotated' } | { ok: false, error }>}
 */
export async function setCustomerKey({
  orgId, vendor, rawKey, actorEmail, actorUserId, requestId, skipValidate = false,
}) {
  if (!orgId)  return { ok: false, error: 'orgId required.' };
  if (!SUPPORTED_VENDORS.includes(vendor)) return { ok: false, error: `Unsupported vendor: ${vendor}` };
  if (typeof rawKey !== 'string' || rawKey.length < 16) return { ok: false, error: 'Key looks invalid (too short).' };

  if (!skipValidate && vendor === 'anthropic') {
    const v = await validateAnthropicKey(rawKey);
    if (!v.valid) return { ok: false, error: v.reason };
  }
  if (!skipValidate && vendor === 'openai') {
    const v = await validateOpenAIKey(rawKey);
    if (!v.valid) return { ok: false, error: v.reason };
  }
  // Voyage / Mistral validate-on-first-use only — neither has a
  // free auth-check endpoint that's safe to hammer at paste time.

  const fingerprint = fingerprintKey(rawKey);
  const sb = requireSupabase();
  if (!sb) return { ok: false, error: 'Storage not configured.' };

  const resp = await fetchWithTimeout(
    `${sb.url}/rest/v1/rpc/set_customer_api_key`,
    {
      method: 'POST',
      headers: { ...getSupabaseWriteHeaders(sb.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_org_id: orgId,
        p_vendor: vendor,
        p_raw_key: rawKey,
        p_fingerprint: fingerprint,
        p_actor_email: actorEmail,
        p_actor_user_id: actorUserId || null,
        p_request_id: requestId || null,
      }),
    },
  );
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    logger.error('set_customer_api_key RPC failed', { status: resp.status, body: body.slice(0, 200), orgId, vendor });
    return { ok: false, error: 'Failed to store key. Check that MODEL_KEY_ENCRYPTION_SECRET is configured.' };
  }
  const keyId = await resp.json();
  invalidateKeyCache({ orgId, vendor });
  auditLog({
    action: 'key.set_or_rotated',
    actorEmail, actorUserId,
    organizationId: orgId,
    targetType: 'customer_api_key', targetId: keyId,
    requestId,
    details: { vendor, fingerprint },
  });
  return { ok: true, fingerprint, keyId, action: 'set_or_rotated' };
}

export async function revokeCustomerKey({ orgId, vendor, actorEmail, actorUserId, requestId }) {
  const sb = requireSupabase();
  if (!sb) return { ok: false, error: 'Storage not configured.' };
  const resp = await fetchWithTimeout(
    `${sb.url}/rest/v1/rpc/revoke_customer_api_key`,
    {
      method: 'POST',
      headers: { ...getSupabaseWriteHeaders(sb.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_org_id: orgId, p_vendor: vendor,
        p_actor_email: actorEmail, p_actor_user_id: actorUserId || null,
        p_request_id: requestId || null,
      }),
    },
  );
  if (!resp.ok) {
    return { ok: false, error: 'Revoke failed.' };
  }
  invalidateKeyCache({ orgId, vendor });
  auditLog({
    action: 'key.revoked',
    actorEmail, actorUserId,
    organizationId: orgId,
    targetType: 'customer_api_key',
    requestId,
    details: { vendor },
  });
  return { ok: true };
}

/* ── Read metadata for the admin UI (no decryption) ──────────────── */

export async function listKeysForOrg({ orgId }) {
  const sb = requireSupabase();
  if (!sb) return [];
  const url = `${sb.url}/rest/v1/customer_api_keys?organization_id=eq.${orgId}&select=id,vendor,key_fingerprint,status,last_validated_at,last_used_at,rotation_due_at,set_by_email,set_at,updated_at&order=set_at.desc`;
  const resp = await fetchWithTimeout(url, { method: 'GET', headers: getSupabaseHeaders(sb.key) });
  if (!resp.ok) return [];
  return await resp.json();
}

export async function listKeyAuditForOrg({ orgId, limit = 50 }) {
  const sb = requireSupabase();
  if (!sb) return [];
  const url = `${sb.url}/rest/v1/customer_api_key_audit?organization_id=eq.${orgId}&select=*&order=created_at.desc&limit=${Math.min(limit, 200)}`;
  const resp = await fetchWithTimeout(url, { method: 'GET', headers: getSupabaseHeaders(sb.key) });
  if (!resp.ok) return [];
  return await resp.json();
}

/* ── Custom error class ──────────────────────────────────────────── */

export class CustomerKeyError extends Error {
  constructor(message, { vendor, orgId, status = 402 } = {}) {
    super(message);
    this.name = 'CustomerKeyError';
    this.vendor = vendor;
    this.orgId = orgId;
    this.status = status;
  }
}
