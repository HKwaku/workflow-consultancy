/**
 * Connector OAuth token helpers.
 *
 * Mirrors lib/customerKey.js: tokens live encrypted in Postgres, accessed
 * only via SECURITY DEFINER RPCs that decrypt with the Vault secret. The
 * raw token NEVER reaches the browser.
 *
 * Two responsibilities:
 *   1. resolveActiveToken({ orgId, provider }) — returns the current
 *      access token, refreshing via the provider's refresh-token flow if
 *      it's expired.
 *   2. setIntegrationTokens(...) / clearIntegration(...) — insert/rotate/
 *      revoke. Called from the OAuth callback route.
 *
 * Caching: per-process Map<integrationId, {token, expiresAt}> with a 60s
 * TTL. Avoids hammering the RPC on every API call within a single sync
 * batch. Invalidates on refresh + revoke.
 */

import {
  getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase,
} from '../api-helpers.js';
import { logger } from '../logger.js';
import { getProvider } from './index.js';

const TOKEN_CACHE_TTL_MS = 60_000;
const _tokenCache = new Map(); // integrationId -> { accessToken, expiresAt }

function cacheGet(integrationId) {
  const hit = _tokenCache.get(integrationId);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) { _tokenCache.delete(integrationId); return null; }
  return hit.accessToken;
}

function cacheSet(integrationId, accessToken, hardExpiresAt) {
  const expiresAt = Math.min(Date.now() + TOKEN_CACHE_TTL_MS, hardExpiresAt || (Date.now() + TOKEN_CACHE_TTL_MS));
  _tokenCache.set(integrationId, { accessToken, expiresAt });
}

export function invalidateTokenCache(integrationId) {
  if (integrationId) _tokenCache.delete(integrationId);
  else _tokenCache.clear();
}

/**
 * Resolve a usable access token for (org, provider). Refreshes via the
 * provider's refresh-token endpoint if the stored access token is within
 * 60s of expiry. Returns null if no integration exists or the refresh
 * fails (caller marks the binding `error`).
 *
 * @returns {Promise<{ integrationId, accessToken, metadata }|null>}
 */
export async function resolveActiveToken({ orgId, provider }) {
  if (!orgId || !provider) return null;
  const sb = requireSupabase();
  if (!sb) return null;

  const resp = await fetchWithTimeout(
    `${sb.url}/rest/v1/rpc/get_org_integration_tokens`,
    {
      method: 'POST',
      headers: { ...getSupabaseWriteHeaders(sb.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_org_id: orgId, p_provider: provider }),
    },
    8_000,
  );
  if (!resp.ok) {
    logger.warn('get_org_integration_tokens RPC failed', { orgId, provider, status: resp.status });
    return null;
  }
  const rows = await resp.json();
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row?.access_token || row.status !== 'active') return null;

  // Cache hit (within 60s of last refresh).
  const cached = cacheGet(row.integration_id);
  if (cached) {
    return { integrationId: row.integration_id, accessToken: cached, metadata: row.metadata || {} };
  }

  // Still valid?
  const expiresAt = row.token_expires_at ? new Date(row.token_expires_at).getTime() : null;
  if (!expiresAt || expiresAt > Date.now() + 60_000) {
    cacheSet(row.integration_id, row.access_token, expiresAt);
    return { integrationId: row.integration_id, accessToken: row.access_token, metadata: row.metadata || {} };
  }

  // Expired or near-expiry → refresh.
  if (!row.refresh_token) {
    await markIntegrationStatus(row.integration_id, 'expired', 'Access token expired and no refresh token stored.');
    return null;
  }
  const provDef = getProvider(provider);
  if (!provDef?.refreshToken) {
    return { integrationId: row.integration_id, accessToken: row.access_token, metadata: row.metadata || {} };
  }
  try {
    const refreshed = await provDef.refreshToken({ refreshToken: row.refresh_token });
    if (!refreshed?.access_token) throw new Error('refresh returned no access_token');
    const newExpiresAt = refreshed.expires_in
      ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
      : null;
    await fetchWithTimeout(
      `${sb.url}/rest/v1/rpc/rotate_org_integration_access_token`,
      {
        method: 'POST',
        headers: { ...getSupabaseWriteHeaders(sb.key), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p_integration_id: row.integration_id,
          p_access_token: refreshed.access_token,
          p_token_expires_at: newExpiresAt,
        }),
      },
      8_000,
    );
    invalidateTokenCache(row.integration_id);
    cacheSet(row.integration_id, refreshed.access_token, newExpiresAt ? new Date(newExpiresAt).getTime() : null);
    return { integrationId: row.integration_id, accessToken: refreshed.access_token, metadata: row.metadata || {} };
  } catch (e) {
    logger.warn('Connector token refresh failed', { provider, error: e.message });
    // Evict the cached token immediately so the next sync call doesn't
    // race against the failure window with a stale token. Without this,
    // a sync batch could process 4+ files on an expired token before
    // the cache TTL bumps.
    invalidateTokenCache(row.integration_id);
    await markIntegrationStatus(row.integration_id, 'error', `Refresh failed: ${e.message}`.slice(0, 500));
    return null;
  }
}

export async function setIntegrationTokens({
  orgId, provider, accountEmail, displayName,
  accessToken, refreshToken, tokenExpiresAt, scopes, metadata, actorEmail,
}) {
  const sb = requireSupabase();
  if (!sb) return { ok: false, error: 'Storage not configured.' };
  const resp = await fetchWithTimeout(
    `${sb.url}/rest/v1/rpc/set_org_integration_tokens`,
    {
      method: 'POST',
      headers: { ...getSupabaseWriteHeaders(sb.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_org_id: orgId,
        p_provider: provider,
        p_account_email: accountEmail || null,
        p_display_name: displayName || null,
        p_access_token: accessToken,
        p_refresh_token: refreshToken || null,
        p_token_expires_at: tokenExpiresAt || null,
        p_scopes: scopes || [],
        p_metadata: metadata || {},
        p_actor_email: actorEmail || null,
      }),
    },
  );
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    logger.error('set_org_integration_tokens RPC failed', { status: resp.status, body: txt.slice(0, 400) });
    // Surface the underlying cause so the user can act on it instead
    // of just seeing "Failed to persist tokens." Common cases:
    //   404 + 'Could not find the function ...' → RPC missing, run
    //     supabase/migration-deal-connectors.sql (or the integrations
    //     migration that creates set_org_integration_tokens).
    //   500 + 'function vault.create_secret does not exist' → Supabase
    //     Vault not enabled. Project Settings → Vault → Enable.
    //   500 + 'permission denied for ...' → service-role key wrong
    //     project, or table missing.
    let parsed;
    try { parsed = JSON.parse(txt); } catch {}
    const detail = parsed?.message || parsed?.hint || parsed?.details || txt.slice(0, 200) || `${resp.status}`;
    return { ok: false, error: `Failed to persist tokens: ${detail}` };
  }
  const integrationId = await resp.json();
  invalidateTokenCache(integrationId);
  return { ok: true, integrationId };
}

export async function markIntegrationStatus(integrationId, status, errorText) {
  const sb = requireSupabase();
  if (!sb) return;
  await fetchWithTimeout(
    `${sb.url}/rest/v1/org_integrations?id=eq.${integrationId}`,
    {
      method: 'PATCH',
      headers: getSupabaseWriteHeaders(sb.key),
      body: JSON.stringify({
        status,
        last_sync_error: errorText || null,
        updated_at: new Date().toISOString(),
      }),
    },
  );
  invalidateTokenCache(integrationId);
}
