/**
 * Per-party document visibility helper.
 *
 * The RLS policy in migration-deal-doc-visibility-and-hash.sql is the
 * authoritative gate. This module exists for two app-layer needs:
 *
 *   1. canSeeDocument({ document, viewerRole, isEditor }) — used by the
 *      list endpoint for double-belt filtering before sending the JSON to
 *      the browser. RLS would catch a leak; this prevents a service-role
 *      query from over-returning when called outside an authenticated
 *      session (e.g. from cron).
 *
 *   2. visibilityOptionsForDealType(dealType) — drives the upload UI's
 *      dropdown. PE deals don't have an 'acquirer' role, so we don't show
 *      that option; M&A deals don't have 'portfolio_company', etc.
 *
 *   3. validateVisibilityForRole(visibility, dealType) — the upload route
 *      uses this to refuse 'acquirer_only' on a scaling deal, etc. Bad
 *      input would silently make the document invisible to everyone.
 */

export const VISIBILITY_VALUES = [
  'all_editors',
  'acquirer_only',
  'target_only',
  'seller_only',
  'portfolio_only',
  'owner_only',
];

const ROLE_TO_VISIBILITY = {
  acquirer:           'acquirer_only',
  target:             'target_only',
  seller:             'seller_only',
  portfolio_company:  'portfolio_only',
  platform_company:   'portfolio_only',
};

/** Map of which visibility values are sensible for which deal type. */
const ALLOWED_BY_DEAL_TYPE = {
  ma:         ['all_editors', 'acquirer_only', 'target_only', 'owner_only'],
  pe_rollup:  ['all_editors', 'portfolio_only', 'owner_only'],
  scaling:    ['all_editors', 'owner_only'],
};

const VISIBILITY_LABELS = {
  all_editors:    'All editors',
  acquirer_only:  'Acquirer only',
  target_only:    'Target only',
  seller_only:    'Seller only',
  portfolio_only: 'Portfolio companies only',
  owner_only:     'Owner only',
};

/**
 * Can `viewer` see `document`? Mirrors the RLS predicate in
 * migration-deal-doc-visibility-and-hash.sql.
 *
 * @param {object} args
 * @param {{visibility: string}} args.document
 * @param {string|null} args.viewerRole   - deal_participants.role for the viewer, or null if not a participant
 * @param {boolean} args.isOwner          - viewer is the deal owner
 * @param {boolean} args.isCollaborator   - viewer is in deal.collaborator_emails
 */
export function canSeeDocument({ document, viewerRole, isOwner, isCollaborator }) {
  if (!document) return false;
  const v = document.visibility || 'all_editors';

  // Owner sees everything.
  if (isOwner) return true;

  // owner_only: only the owner; we already returned false above implicitly
  // since isOwner === false here.
  if (v === 'owner_only') return false;

  // all_editors: any editor or any participant.
  if (v === 'all_editors') return isOwner || isCollaborator || !!viewerRole;

  // Role-scoped: viewer's participant role must match.
  const requiredVisibility = ROLE_TO_VISIBILITY[viewerRole];
  if (requiredVisibility && requiredVisibility === v) return true;

  // Collaborators (no participant role) get all_editors only — already
  // handled above. They do NOT see role-scoped docs.
  return false;
}

/**
 * The dropdown options for an upload form, given the deal's type. Returns
 * [{ value, label }, ...].
 */
export function visibilityOptionsForDealType(dealType) {
  const allowed = ALLOWED_BY_DEAL_TYPE[dealType] || ['all_editors', 'owner_only'];
  return allowed.map((v) => ({ value: v, label: VISIBILITY_LABELS[v] || v }));
}

/**
 * Reject visibility values that don't make sense for the deal type. e.g.
 * 'acquirer_only' on a PE roll-up deal — there's no acquirer role.
 *
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateVisibilityForDealType(visibility, dealType) {
  if (!VISIBILITY_VALUES.includes(visibility)) {
    return { ok: false, error: `Unknown visibility: ${visibility}` };
  }
  const allowed = ALLOWED_BY_DEAL_TYPE[dealType] || ['all_editors', 'owner_only'];
  if (!allowed.includes(visibility)) {
    return { ok: false, error: `Visibility "${visibility}" is not valid for deal type "${dealType}".` };
  }
  return { ok: true };
}

/** Display label, exported for the UI badge on each document row. */
export function visibilityLabel(visibility) {
  return VISIBILITY_LABELS[visibility] || visibility;
}
