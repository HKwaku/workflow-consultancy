/**
 * Per-user trial allowance + budget mode resolution.
 *
 * The conversion funnel:
 *
 *   anonymous                 → capped by per-IP rate limit (existing)
 *   signed in, no org         → trial allowance (~50k tokens, one-shot, never resets)
 *   signed in, org, no BYO    → org `monthly_token_budget` (existing)
 *   signed in, org, BYO key   → unlimited (customer billed by Anthropic directly)
 *
 * Two responsibilities:
 *
 *   1. resolveBudgetMode({ email, userId })  — what bucket is this user in?
 *      Used by the chat / analyse / categorise paths to pre-flight + by the
 *      /api/me/budget endpoint to render the trial banner.
 *
 *   2. bumpUserTrialUsage({ userId, email, tokens }) — atomic increment
 *      called from recordTokenUsage when the user is in trial mode (no org
 *      billing path). Idempotency is the caller's job — see costGuard.js.
 *
 * Modes:
 *   { mode: 'trial',           remaining, granted }     — keep going
 *   { mode: 'trial_exhausted', granted }                — gate fires; UI prompts create-org
 *   { mode: 'org_byo',         orgId }                  — BYO key in scope; no preflight needed
 *   { mode: 'org_platform',    orgId, remaining, budget } — fall back to existing org preflight
 *   { mode: 'anonymous' }                               — no userId; no gate (rate-limit-only)
 */

import {
  getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase,
} from './api-helpers.js';
import { logger } from './logger.js';
import { getOrgIdForUser } from './costGuard.js';
import { resolveActiveKey } from './customerKey.js';

const TRIAL_DEFAULT_GRANTED = 50_000;

/**
 * Resolve which budget bucket the calling user falls into.
 *
 * Order of precedence:
 *   1. No userId → 'anonymous'
 *   2. Org membership exists →
 *        - if a customer Anthropic key is set: 'org_byo'
 *        - otherwise: 'org_platform' (with the existing monthly budget)
 *   3. Otherwise → 'trial' (or 'trial_exhausted' if the allowance is used up)
 */
export async function resolveBudgetMode({ email, userId }) {
  if (!userId) return { mode: 'anonymous' };

  // 1. Org-tier check first — once a user joins an org, the trial doesn't
  //    apply. Fast path returns when an org is found.
  const orgId = await getOrgIdForUser({ email, userId });
  if (orgId) {
    const { key, source } = await resolveActiveKey({ orgId, vendor: 'anthropic' });
    if (key && source === 'customer') {
      return { mode: 'org_byo', orgId };
    }
    // Falls back to org's platform budget — handled by the existing
    // preflightTokenBudget at the call site.
    return { mode: 'org_platform', orgId };
  }

  // 2. Trial-tier path. Lazy-create the row on first read via the RPC.
  const allowance = await getTrialAllowance({ userId, email });
  if (!allowance) {
    // Backend not reachable, RPC missing (migration not applied), or row
    // couldn't be created. The user IS signed in — don't lie and call
    // them anonymous (that would hide the widget entirely). Surface an
    // 'unknown' mode so the UI can show "Credits unavailable" and the
    // chat / analyse paths can still fail-open via rate-limit + org
    // budget.
    return { mode: 'unknown' };
  }
  const remaining = Math.max(0, allowance.granted_tokens - allowance.consumed_tokens);
  if (allowance.exhausted || remaining <= 0) {
    return { mode: 'trial_exhausted', granted: allowance.granted_tokens };
  }
  return { mode: 'trial', remaining, granted: allowance.granted_tokens };
}

async function getTrialAllowance({ userId, email }) {
  const sb = requireSupabase();
  if (!sb) return null;
  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/rpc/get_user_trial_allowance`,
      {
        method: 'POST',
        headers: { ...getSupabaseWriteHeaders(sb.key), 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_user_id: userId, p_email: email || '' }),
      },
      8_000,
    );
    if (!resp.ok) return null;
    const rows = await resp.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) return null;
    return {
      granted_tokens: Number(row.granted_tokens || TRIAL_DEFAULT_GRANTED),
      consumed_tokens: Number(row.consumed_tokens || 0),
      exhausted: Boolean(row.exhausted),
      granted_at: row.granted_at,
    };
  } catch (e) {
    logger.warn('get_user_trial_allowance failed', { error: e.message, userId });
    return null;
  }
}

/**
 * Pre-flight gate. Call BEFORE firing the LLM work. Returns:
 *   { allowed: true, mode, ... }   — proceed
 *   { allowed: false, reason, gateAction, message } — block
 *
 * Returns 'allowed: true' for anonymous + org_byo + org_platform (the
 * existing preflightTokenBudget handles the org_platform check at the
 * call site, so we don't double up here). Only `trial_exhausted` blocks.
 */
export async function requireBudgetClearance({ email, userId }) {
  const mode = await resolveBudgetMode({ email, userId });
  if (mode.mode === 'trial_exhausted') {
    return {
      allowed: false,
      mode: mode.mode,
      reason: 'trial_exhausted',
      gateAction: 'create_org',
      message: 'Your free trial allowance has been used. Create an organisation and paste your Anthropic API key in admin to continue.',
    };
  }
  return { allowed: true, ...mode };
}

/**
 * Atomic post-call usage bump for trial-mode users. Returns the new state
 * so callers can log / surface "you've just exhausted your trial" once.
 */
export async function bumpUserTrialUsage({ userId, email, tokens }) {
  if (!userId || !tokens || tokens <= 0) return null;
  const sb = requireSupabase();
  if (!sb) return null;
  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/rpc/bump_user_trial_usage`,
      {
        method: 'POST',
        headers: { ...getSupabaseWriteHeaders(sb.key), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p_user_id: userId,
          p_email: email || '',
          p_tokens: tokens,
        }),
      },
      8_000,
    );
    if (!resp.ok) return null;
    const rows = await resp.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) return null;
    return {
      consumed: Number(row.consumed),
      granted: Number(row.granted),
      exhausted: Boolean(row.exhausted),
      justExhausted: Boolean(row.just_exhausted),
    };
  } catch (e) {
    logger.warn('bump_user_trial_usage failed', { error: e.message, userId });
    return null;
  }
}

export { TRIAL_DEFAULT_GRANTED };
