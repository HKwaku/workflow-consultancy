/**
 * operatingModel/auth — resolve a request to a (model, isAdmin) tuple.
 *
 * Two helpers:
 *
 *   resolveModelAccess({ modelId, email, userId })
 *     → { ok, model, isAdmin } when the caller is an org member of the
 *       model's parent org, otherwise → { error, status }.
 *     A non-admin reader gets ok=true + isAdmin=false. An outsider gets
 *       a 404 (not 403) so model existence isn't leaked.
 *
 *   resolveDefaultModelForUser({ email, userId })
 *     → { modelId, organizationId, isAdmin } when the user belongs to
 *       an org that has a default operating model.
 *     → { modelId: null, reason } otherwise. Reasons: 'no_org' (user
 *       has no org membership) | 'no_default_model' (org exists but
 *       has no default — shouldn't happen post-migration-37).
 *
 * Both helpers use service-role reads. Defence in depth: every API
 * route also runs requireAuth before calling these.
 */

import { getSupabaseHeaders, fetchWithTimeout, requireSupabase } from '../api-helpers.js';
import { logger } from '../logger.js';

export async function resolveModelAccess({ modelId, email, userId }) {
  if (!modelId) return { error: 'modelId required', status: 400 };
  const sb = requireSupabase();
  if (!sb) return { error: 'Storage not configured', status: 503 };

  try {
    // Single round-trip: load the model and join organization_members
    // for the caller. PostgREST embed: members:organization_members(...).
    // We filter the embedded membership down to this user via inner join
    // semantics (use a separate query if PostgREST embed doesn't filter).
    const headers = getSupabaseHeaders(sb.key);
    const modelResp = await fetchWithTimeout(
      `${sb.url}/rest/v1/operating_models?id=eq.${encodeURIComponent(modelId)}` +
        `&select=id,organization_id,name,kind,parent_model_id,status,description,settings,created_by_email,created_at,updated_at` +
        `&limit=1`,
      { method: 'GET', headers },
    );
    if (!modelResp.ok) return { error: 'Failed to load model', status: 502 };
    const [model] = await modelResp.json();
    if (!model) return { error: 'Model not found', status: 404 };

    // Membership lookup — filter by user_id OR email (case-insensitive).
    const filters = [];
    if (userId) filters.push(`user_id.eq.${encodeURIComponent(userId)}`);
    if (email)  filters.push(`email.eq.${encodeURIComponent(email.toLowerCase())}`);
    if (!filters.length) return { error: 'Model not found', status: 404 };

    const memberResp = await fetchWithTimeout(
      `${sb.url}/rest/v1/organization_members?organization_id=eq.${encodeURIComponent(model.organization_id)}` +
        `&or=(${filters.join(',')})&select=is_org_admin&limit=1`,
      { method: 'GET', headers },
    );
    const [member] = memberResp.ok ? await memberResp.json() : [];
    // Outsiders get 404, not 403 — so model existence isn't leaked.
    if (!member) return { error: 'Model not found', status: 404 };

    return { ok: true, model, isAdmin: !!member.is_org_admin };
  } catch (e) {
    logger.error('resolveModelAccess failed', { modelId, error: e.message });
    return { error: 'Lookup failed', status: 502 };
  }
}

export async function resolveDefaultModelForUser({ email, userId }) {
  const sb = requireSupabase();
  if (!sb) return { modelId: null, reason: 'storage_unconfigured' };

  try {
    const filters = [];
    if (userId) filters.push(`user_id.eq.${encodeURIComponent(userId)}`);
    if (email)  filters.push(`email.eq.${encodeURIComponent(email.toLowerCase())}`);
    if (!filters.length) return { modelId: null, reason: 'no_identity' };

    // Members → org → default model (the original query, unchanged so
    // it cannot regress if migration 41 hasn't run yet).
    const headers = getSupabaseHeaders(sb.key);
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/organization_members?or=(${filters.join(',')})` +
        `&select=is_org_admin,organization:organization_id(id,default_operating_model_id)` +
        `&limit=1`,
      { method: 'GET', headers },
    );
    if (!resp.ok) return { modelId: null, reason: 'lookup_failed' };
    const [row] = await resp.json();
    if (!row) return { modelId: null, reason: 'no_org' };
    const orgId = row.organization?.id;
    const defaultModelId = row.organization?.default_operating_model_id || null;

    // The member's active model, as a SEPARATE best-effort query. If the
    // column doesn't exist yet (migration 41 not applied) this select
    // 400s and we silently fall back to the org default — the whole
    // workspace must not break on a not-yet-migrated DB.
    let activeModelId = defaultModelId;
    try {
      const pr = await fetchWithTimeout(
        `${sb.url}/rest/v1/organization_members?or=(${filters.join(',')})` +
          `&select=preferred:preferred_operating_model_id(id,organization_id)&limit=1`,
        { method: 'GET', headers },
      );
      if (pr.ok) {
        const [prow] = await pr.json();
        if (prow?.preferred && prow.preferred.organization_id === orgId) {
          activeModelId = prow.preferred.id; // valid + same-org → use it
        }
      }
    } catch { /* pre-migration / lookup hiccup → keep the default */ }

    if (!activeModelId) return { modelId: null, organizationId: orgId, reason: 'no_default_model' };
    return {
      modelId: activeModelId,
      organizationId: orgId,
      isAdmin: !!row.is_org_admin,
      defaultModelId,
      isDefault: activeModelId === defaultModelId,
    };
  } catch (e) {
    logger.error('resolveDefaultModelForUser failed', { error: e.message });
    return { modelId: null, reason: 'error' };
  }
}
