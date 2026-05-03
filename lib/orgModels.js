/**
 * Per-org model allowlist resolution.
 *
 * Single sanctioned read path for "what models can this org use, and which
 * one is the default?" Used by:
 *   - /api/me/models (chat picker hydration)
 *   - /api/diagnostic-chat (validation: refuse a model not in allowed[])
 *   - admin UI hydration via /api/organizations/[orgId]/models
 *
 * Resolution rules:
 *   1. If org has explicit allowed_models[] set → use that.
 *   2. Else if org has a customer key (BYO) → allow the entire active catalogue.
 *      Rationale: they're paying Anthropic directly, no reason for us to
 *      gatekeep model choice.
 *   3. Else (platform key) → fixed PLATFORM_ALLOWED_MODEL_IDS (Sonnet only).
 *      Rationale: prevents free-tier users from racking up Opus calls on
 *      our bill.
 *
 * Default model:
 *   - Use org.default_model if set AND it's in allowed[].
 *   - Else first item in allowed[].
 *   - Else SAFE_FALLBACK_MODEL_ID.
 */

import { getSupabaseHeaders, fetchWithTimeout, requireSupabase } from './api-helpers.js';
import {
  KNOWN_MODELS,
  PLATFORM_ALLOWED_MODEL_IDS,
  SAFE_FALLBACK_MODEL_ID,
  filterKnownModelIds,
  isKnownModel,
  publicCatalogue,
} from './agents/modelCatalogue.js';

/**
 * @param {object} args
 * @param {string|null} args.orgId
 * @param {boolean} args.hasCustomerKey - true if a customer Anthropic key is set for this org
 * @returns {Promise<{ allowed: string[], default: string, source: 'org'|'byo-default'|'platform' }>}
 */
export async function resolveAllowedModels({ orgId, hasCustomerKey }) {
  // No org membership → platform fallback
  if (!orgId) {
    return {
      allowed: [...PLATFORM_ALLOWED_MODEL_IDS],
      default: SAFE_FALLBACK_MODEL_ID,
      source: 'platform',
    };
  }

  const sb = requireSupabase();
  if (!sb) return { allowed: [...PLATFORM_ALLOWED_MODEL_IDS], default: SAFE_FALLBACK_MODEL_ID, source: 'platform' };

  let row = null;
  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/organizations?id=eq.${encodeURIComponent(orgId)}&select=allowed_models,default_model`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
      8_000,
    );
    if (resp.ok) {
      const rows = await resp.json();
      row = rows?.[0] || null;
    }
  } catch { /* fall through to defaults */ }

  // 1. Explicit org allowlist
  if (row?.allowed_models && Array.isArray(row.allowed_models) && row.allowed_models.length > 0) {
    const allowed = filterKnownModelIds(row.allowed_models);
    if (allowed.length === 0) {
      // Every id was unknown (catalogue churn). Fall back rather than locking the org out.
      return defaultForKey({ hasCustomerKey, source: 'platform' });
    }
    const def = (row.default_model && allowed.includes(row.default_model))
      ? row.default_model
      : allowed[0];
    return { allowed, default: def, source: 'org' };
  }

  // 2. BYO customer key, no explicit allowlist → full active Anthropic catalogue.
  // We exclude deprecated AND unsupported entries; OpenAI models live in the
  // catalogue for admin allowlist signalling but the chat can't actually call
  // them yet (see modelCatalogue.js header comment). Admins who want to offer
  // OpenAI must explicitly add the ids to allowed_models — at which point the
  // user picker still hides them via userPickableIds() until support ships.
  if (hasCustomerKey) {
    const allowed = KNOWN_MODELS
      .filter((m) => !m.deprecated && !m.unsupported && m.vendor === 'anthropic')
      .map((m) => m.id);
    const def = (row?.default_model && allowed.includes(row.default_model))
      ? row.default_model
      : SAFE_FALLBACK_MODEL_ID;
    return { allowed, default: def, source: 'byo-default' };
  }

  // 3. Platform fallback
  return defaultForKey({ hasCustomerKey: false, source: 'platform' });
}

function defaultForKey({ source }) {
  return {
    allowed: [...PLATFORM_ALLOWED_MODEL_IDS],
    default: SAFE_FALLBACK_MODEL_ID,
    source,
  };
}

/**
 * Persist an org's allowlist + default. Validates ids against the catalogue;
 * silently strips unknowns (so a deprecated id removal doesn't break a save).
 *
 * @returns {Promise<{ ok: true, allowed: string[], default: string|null } | { ok: false, error: string }>}
 */
export async function setOrgAllowedModels({ orgId, allowed, defaultModel }) {
  if (!orgId) return { ok: false, error: 'orgId required.' };
  const sb = requireSupabase();
  if (!sb) return { ok: false, error: 'Storage not configured.' };

  let cleanAllowed = null;
  if (allowed === null) {
    cleanAllowed = null;
  } else if (Array.isArray(allowed)) {
    cleanAllowed = filterKnownModelIds(allowed);
    if (cleanAllowed.length === 0) cleanAllowed = null;
  } else {
    return { ok: false, error: 'allowed must be an array of model ids or null.' };
  }

  let cleanDefault = null;
  if (defaultModel) {
    if (!isKnownModel(defaultModel)) {
      return { ok: false, error: `Unknown model id: ${defaultModel}` };
    }
    if (cleanAllowed && !cleanAllowed.includes(defaultModel)) {
      return { ok: false, error: 'default_model must be in allowed_models.' };
    }
    cleanDefault = defaultModel;
  }

  const resp = await fetchWithTimeout(
    `${sb.url}/rest/v1/organizations?id=eq.${encodeURIComponent(orgId)}`,
    {
      method: 'PATCH',
      headers: { ...getSupabaseHeaders(sb.key), 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowed_models: cleanAllowed, default_model: cleanDefault }),
    },
  );
  if (!resp.ok) return { ok: false, error: `PATCH failed (${resp.status}).` };
  return { ok: true, allowed: cleanAllowed, default: cleanDefault };
}

/**
 * Pretty catalogue + per-org marks for the admin UI. Returns every known
 * model with `allowed: bool` and `isDefault: bool` flags applied.
 */
export async function getOrgModelView({ orgId, hasCustomerKey }) {
  const resolved = await resolveAllowedModels({ orgId, hasCustomerKey });
  const allowedSet = new Set(resolved.allowed);
  return {
    catalogue: publicCatalogue().map((m) => ({
      ...m,
      allowed: allowedSet.has(m.id),
      isDefault: resolved.default === m.id,
    })),
    resolvedDefault: resolved.default,
    source: resolved.source,
  };
}
