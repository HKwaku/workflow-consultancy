/**
 * Fine-grained entitlements per organization member (organization_members.entitlements).
 * Org-wide admin is is_org_admin on the row.
 */

export const ENTITLEMENT_KEYS = {
  COST_ANALYST: 'cost_analyst',
  PORTAL: 'portal',
  DEALS: 'deals',
  ANALYTICS: 'analytics',
};

const KNOWN = new Set(Object.values(ENTITLEMENT_KEYS));

export function sanitizeEntitlements(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!KNOWN.has(k)) continue;
    out[k] = Boolean(v);
  }
  return out;
}

export function defaultEntitlements() {
  return {
    [ENTITLEMENT_KEYS.COST_ANALYST]: false,
    [ENTITLEMENT_KEYS.PORTAL]: true,
    [ENTITLEMENT_KEYS.DEALS]: false,
    [ENTITLEMENT_KEYS.ANALYTICS]: false,
  };
}

export function mergeWithDefaults(entitlements) {
  return { ...defaultEntitlements(), ...sanitizeEntitlements(entitlements) };
}

export function hasEntitlement(entitlements, key) {
  if (!entitlements || typeof entitlements !== 'object') return false;
  return Boolean(entitlements[key]);
}
