/**
 * Cost-guard helpers for token-budget enforcement.
 *
 * Two entry points:
 *
 *   preflightTokenBudget({ orgId, estimatedTokens })
 *     - Call BEFORE running an LLM job that you can estimate up-front.
 *     - Cheap read (no write); returns { allowed, reason, budget, consumed, projected }.
 *     - Use to short-circuit obvious over-budget runs (e.g. a 5k-page diligence
 *       on an org that's at 95% budget) so we don't burn the input tokens before failing.
 *
 *   recordTokenUsage({ orgId, vendor, model, surface, refId, inputTokens, outputTokens, userEmail })
 *     - Call AFTER each LLM call; appends to token_usage_ledger AND atomically
 *       bumps organizations.tokens_consumed_this_month via the bump_token_usage RPC.
 *     - If the increment would exceed budget, the RPC raises 'token_budget_exceeded'
 *       and we return { allowed: false, reason }.
 *     - Soft-warn at 80% by setting organizations.budget_alerted_at_80pct (debounced).
 *
 * Soft-fail design: if the org has no budget configured (NULL) or the call has
 * no orgId (anonymous user), we record usage in the ledger and return { allowed: true }.
 * Spend is still observable; only enforcement is skipped.
 */

import { getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase } from './api-helpers.js';
import { logger } from './logger.js';

const SOFT_WARN_PCT = 0.80;

/**
 * Look up an org's budget without writing anything.
 * @returns {Promise<{ orgId, budget: bigint|null, consumed: bigint, periodStartedAt: string }>}
 */
export async function getOrgBudgetState(orgId) {
  const sb = requireSupabase();
  if (!sb || !orgId) return null;
  const resp = await fetchWithTimeout(
    `${sb.url}/rest/v1/organizations?id=eq.${encodeURIComponent(orgId)}&select=id,monthly_token_budget,tokens_consumed_this_month,budget_period_started_at,budget_alerted_at_80pct`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  if (!resp.ok) return null;
  const [row] = await resp.json();
  if (!row) return null;
  return {
    orgId: row.id,
    budget: row.monthly_token_budget,
    consumed: Number(row.tokens_consumed_this_month || 0),
    periodStartedAt: row.budget_period_started_at,
    alertedAt80pct: row.budget_alerted_at_80pct,
  };
}

/**
 * Pre-flight check. Cheap; safe to call on every analysis kickoff.
 */
export async function preflightTokenBudget({ orgId, estimatedTokens = 0 }) {
  if (!orgId) return { allowed: true, reason: 'no_org' };
  const state = await getOrgBudgetState(orgId);
  if (!state) return { allowed: true, reason: 'no_org_state' };
  if (state.budget == null) return { allowed: true, reason: 'unlimited', state };

  const projected = state.consumed + estimatedTokens;
  if (projected > state.budget) {
    return {
      allowed: false,
      reason: 'over_budget',
      budget: state.budget,
      consumed: state.consumed,
      projected,
    };
  }
  return { allowed: true, state, projected };
}

/**
 * Record actual usage after a call. Idempotent on the ledger insert is NOT
 * guaranteed — caller is responsible for not double-recording.
 */
export async function recordTokenUsage({
  orgId, vendor, model, surface, refId, inputTokens = 0, outputTokens = 0,
  userEmail, userId,
}) {
  const total = (inputTokens || 0) + (outputTokens || 0);
  if (total <= 0) return { allowed: true, reason: 'zero_tokens' };

  const sb = requireSupabase();
  if (!sb) return { allowed: true, reason: 'no_supabase' };

  // 1. Append to ledger (always, even when no org — so anonymous spend is visible).
  try {
    await fetchWithTimeout(
      `${sb.url}/rest/v1/token_usage_ledger`,
      {
        method: 'POST',
        headers: { ...getSupabaseWriteHeaders(sb.key), Prefer: 'return=minimal' },
        body: JSON.stringify({
          organization_id: orgId || null,
          user_email: userEmail || null,
          vendor, model: model || null, surface,
          ref_id: refId || null,
          input_tokens: inputTokens || 0,
          output_tokens: outputTokens || 0,
          total_tokens: total,
        }),
      },
    );
  } catch (e) {
    logger.warn('Token ledger insert failed', { error: e.message, surface, refId });
  }

  // 2. Atomic bump on the org row. Only enforce when we have an org.
  // For signed-in users with no org we bump the per-user trial allowance
  // instead — done lazily here to avoid a circular import at module load.
  if (!orgId) {
    if (userId) {
      try {
        const { bumpUserTrialUsage } = await import('./trialBudget.js');
        const trial = await bumpUserTrialUsage({ userId, email: userEmail, tokens: total });
        if (trial?.justExhausted) {
          logger.info('User just exhausted trial allowance', { userId, surface, total, granted: trial.granted });
        }
        return { allowed: !trial?.exhausted, reason: trial?.exhausted ? 'trial_exhausted' : 'trial_ok', total, trial };
      } catch (e) {
        logger.warn('Trial usage bump failed', { error: e.message, userId, surface });
        return { allowed: true, reason: 'trial_bump_failed' };
      }
    }
    return { allowed: true, reason: 'no_org' };
  }

  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/rpc/bump_token_usage`,
      {
        method: 'POST',
        headers: { ...getSupabaseWriteHeaders(sb.key), 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_org_id: orgId, p_tokens: total }),
      },
    );
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      // Postgres raised our exception — the org is over budget AFTER this call.
      if (body.includes('token_budget_exceeded')) {
        logger.warn('Token budget exceeded mid-flight', { orgId, surface, refId, total });
        return { allowed: false, reason: 'over_budget', total };
      }
      logger.warn('bump_token_usage failed', { status: resp.status, body: body.slice(0, 200) });
      return { allowed: true, reason: 'bump_failed' };  // never block on infra failure
    }

    const newTotal = Number(await resp.json());
    // Soft-warn at 80% (debounced via budget_alerted_at_80pct).
    const state = await getOrgBudgetState(orgId);
    if (state?.budget && !state.alertedAt80pct && newTotal >= state.budget * SOFT_WARN_PCT) {
      await fetchWithTimeout(
        `${sb.url}/rest/v1/organizations?id=eq.${orgId}`,
        {
          method: 'PATCH',
          headers: getSupabaseWriteHeaders(sb.key),
          body: JSON.stringify({ budget_alerted_at_80pct: new Date().toISOString() }),
        },
      ).catch(() => {});
      logger.warn('Org token budget at 80%', { orgId, consumed: newTotal, budget: state.budget });
    }
    return { allowed: true, total, newTotal };
  } catch (e) {
    logger.error('recordTokenUsage failed', { error: e.message, orgId, surface });
    return { allowed: true, reason: 'error_soft_pass' };
  }
}

/**
 * Resolve the org id for the calling user from organization_members.
 * Returns null if the user belongs to no org. Multi-org users get the
 * first row (good enough for MVP — billing-per-org-selector is a follow-up).
 */
export async function getOrgIdForUser({ email, userId }) {
  if (!email && !userId) return null;
  const sb = requireSupabase();
  if (!sb) return null;
  // PostgREST `or=(...)` uses DOT separators between column and operator
  // (column.op.value), NOT the equals form used at the top level
  // (?column=op.value). The wrong form silently returns 200 with no rows.
  // See: https://postgrest.org/en/stable/api.html#logical-operators
  const filters = [];
  if (userId) filters.push(`user_id.eq.${encodeURIComponent(userId)}`);
  if (email)  filters.push(`email.eq.${encodeURIComponent(email.toLowerCase())}`);
  const url = `${sb.url}/rest/v1/organization_members?or=(${filters.join(',')})&select=organization_id&limit=1`;
  const resp = await fetchWithTimeout(url, { method: 'GET', headers: getSupabaseHeaders(sb.key) });
  if (!resp.ok) return null;
  const [row] = await resp.json();
  return row?.organization_id || null;
}
