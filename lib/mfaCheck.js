/**
 * MFA enforcement helpers (SOC 2 / Item 5).
 *
 * Supabase Auth tracks per-user TOTP factors. To support SOC 2 CC6.2 we need:
 *   - A query that says "for org X, which members have MFA enabled?" so admins
 *     can chase the laggards.
 *   - A snapshot we can roll up monthly into the evidence-collection script.
 *
 * The hard part is that GoTrue stores MFA factors on auth.users (not
 * organization_members). We resolve members → user IDs first, then fetch
 * factors via the Admin API (one round-trip per member; small orgs are fine).
 *
 * NB: this module reads MFA state. It does not enforce anything at login —
 * Supabase enforces via auth assurance levels (AAL2 vs AAL1). To enforce
 * AAL2 you set `auth.mfa.enroll`/`auth.mfa.challenge` on the client and
 * either gate features in the app or set `aal2 = required` on the project.
 *
 * What this module returns is the *evidence* an auditor will sample.
 */

import { createClient } from '@supabase/supabase-js';
import { requireSupabase } from './api-helpers.js';

/** Minimum factor verification status we count as "MFA enabled". */
const VERIFIED_STATUS = 'verified';

let _adminClient = null;

function getAdminClient() {
  if (_adminClient) return _adminClient;
  const sb = requireSupabase();
  if (!sb) return null;
  _adminClient = createClient(sb.url, sb.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return _adminClient;
}

/**
 * Inspect a single user's MFA factors via the Admin API.
 * Returns { enabled, factorCount, factors: [{ id, type, status, createdAt }] }.
 *
 * Returns enabled:false on any error (including user-not-found) so callers
 * can render "no MFA" without crashing the report. Errors are surfaced via
 * the returned `error` field for logging/alerting.
 */
export async function getUserMfaStatus(userId) {
  if (!userId) return { enabled: false, factorCount: 0, factors: [], error: 'missing userId' };
  const admin = getAdminClient();
  if (!admin) return { enabled: false, factorCount: 0, factors: [], error: 'admin client unavailable' };

  try {
    const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
    if (error) return { enabled: false, factorCount: 0, factors: [], error: error.message };
    const factors = (data?.factors || []).map((f) => ({
      id: f.id,
      type: f.factor_type || f.type || 'unknown',
      status: f.status,
      createdAt: f.created_at || null,
    }));
    const verified = factors.filter((f) => f.status === VERIFIED_STATUS);
    return {
      enabled: verified.length > 0,
      factorCount: factors.length,
      verifiedCount: verified.length,
      factors,
    };
  } catch (e) {
    return { enabled: false, factorCount: 0, factors: [], error: e?.message || 'mfa lookup failed' };
  }
}

/**
 * MFA status report for every member of an organization.
 *
 *   { orgId, generatedAt, totalMembers, mfaEnabled, mfaDisabled,
 *     enforcementRate, members: [{ userId, email, isOrgAdmin, mfa }] }
 *
 * `enforcementRate` is a 0..1 number suitable for display ("87%") or
 * threshold checks (">= 1.0 means full enforcement").
 *
 * Caller is responsible for org-admin / platform-admin gating before invoking.
 * We don't gate here so this is also reusable from the evidence-collection
 * script (which runs as service role with no request).
 */
export async function getOrgMfaReport(orgId) {
  if (!orgId) return null;
  const admin = getAdminClient();
  if (!admin) return null;

  const { data: members, error } = await admin
    .from('organization_members')
    .select('user_id, email, is_org_admin')
    .eq('organization_id', orgId);

  if (error) {
    return { orgId, error: error.message, generatedAt: new Date().toISOString(), members: [] };
  }

  const rows = await Promise.all(
    (members || []).map(async (m) => ({
      userId: m.user_id,
      email: m.email,
      isOrgAdmin: Boolean(m.is_org_admin),
      mfa: await getUserMfaStatus(m.user_id),
    })),
  );

  const enabled = rows.filter((r) => r.mfa.enabled).length;
  const disabled = rows.length - enabled;
  const rate = rows.length === 0 ? 1 : enabled / rows.length;

  return {
    orgId,
    generatedAt: new Date().toISOString(),
    totalMembers: rows.length,
    mfaEnabled: enabled,
    mfaDisabled: disabled,
    enforcementRate: Number(rate.toFixed(4)),
    fullyEnforced: rate >= 1,
    members: rows,
  };
}

/**
 * Snapshot every organization's MFA status. Used by the evidence script.
 * Limit/offset paging in case we ever cross a few hundred orgs.
 */
export async function getAllOrgsMfaReport({ limit = 500, offset = 0 } = {}) {
  const admin = getAdminClient();
  if (!admin) return null;

  const { data: orgs, error } = await admin
    .from('organizations')
    .select('id, name, slug')
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) return { error: error.message, generatedAt: new Date().toISOString(), orgs: [] };

  const reports = [];
  for (const org of orgs || []) {
    const report = await getOrgMfaReport(org.id);
    reports.push({ ...org, ...report });
  }

  const enforcedCount = reports.filter((r) => r.fullyEnforced).length;
  return {
    generatedAt: new Date().toISOString(),
    orgCount: reports.length,
    fullyEnforcedCount: enforcedCount,
    fullyEnforcedRate: reports.length === 0 ? 1 : Number((enforcedCount / reports.length).toFixed(4)),
    orgs: reports,
  };
}
