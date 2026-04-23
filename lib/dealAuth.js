import { getSupabaseHeaders, fetchWithTimeout, requireSupabase } from './api-helpers.js';

/**
 * Resolve a user's access level for a given deal.
 *
 * Access tiers:
 *   'owner'        - full control (including delete, collaborator management)
 *   'collaborator' - edit deal + participants + flows + analyses, no ownership change
 *   'participant'  - read-only, plus update own deal_participants row
 *   null           - no access
 *
 * Usage in route handlers:
 *   const access = await resolveDealAccess({ dealId, email });
 *   if (!access) return 403;
 *   if (access.mode === 'participant' && needsEdit) return 403;
 */
export async function resolveDealAccess({ dealId, email, userId }) {
  if (!dealId || !email) return null;
  const sb = requireSupabase();
  if (!sb) return null;
  const { url, key } = sb;

  // 1. Fetch the deal
  // Retry without `collaborator_emails` if the migration hasn't been run yet -
  // otherwise Supabase returns 400 and we'd 403 legitimate owners.
  const fullSelect = 'id,owner_email,owner_user_id,collaborator_emails,type,name,process_name,status,settings,deal_code,created_at,updated_at';
  const baseSelect = 'id,owner_email,owner_user_id,type,name,process_name,status,settings,deal_code,created_at,updated_at';
  let dealResp = await fetchWithTimeout(
    `${url}/rest/v1/deals?id=eq.${encodeURIComponent(dealId)}&select=${fullSelect}`,
    { method: 'GET', headers: getSupabaseHeaders(key) }
  );
  if (!dealResp.ok) {
    dealResp = await fetchWithTimeout(
      `${url}/rest/v1/deals?id=eq.${encodeURIComponent(dealId)}&select=${baseSelect}`,
      { method: 'GET', headers: getSupabaseHeaders(key) }
    );
    if (!dealResp.ok) return null;
  }
  const [deal] = await dealResp.json();
  if (!deal) return null;

  const lowerEmail = email.toLowerCase();
  const ownerMatch =
    (userId && deal.owner_user_id === userId) ||
    (deal.owner_email && deal.owner_email.toLowerCase() === lowerEmail);

  if (ownerMatch) {
    return { mode: 'owner', deal, canEdit: true, canManage: true, canDelete: true };
  }

  const collabEmails = Array.isArray(deal.collaborator_emails) ? deal.collaborator_emails : [];
  const isCollaborator = collabEmails.some((e) => typeof e === 'string' && e.toLowerCase() === lowerEmail);
  if (isCollaborator) {
    return { mode: 'collaborator', deal, canEdit: true, canManage: true, canDelete: false };
  }

  // 2. Participant check
  const partResp = await fetchWithTimeout(
    `${url}/rest/v1/deal_participants?deal_id=eq.${encodeURIComponent(dealId)}&participant_email=eq.${encodeURIComponent(lowerEmail)}&select=id,role,company_name`,
    { method: 'GET', headers: getSupabaseHeaders(key) }
  );
  const partRows = partResp.ok ? await partResp.json() : [];
  if (partRows.length) {
    return {
      mode: 'participant',
      deal,
      participantId: partRows[0].id,
      participantRole: partRows[0].role,
      participantCompany: partRows[0].company_name,
      canEdit: false,
      canManage: false,
      canDelete: false,
    };
  }

  return null;
}

/**
 * Shortcut guard for routes that require edit access (owner or collaborator).
 * Returns { access } on success or { error, status } on failure.
 */
export async function requireDealEditor({ dealId, email, userId }) {
  const access = await resolveDealAccess({ dealId, email, userId });
  if (!access) return { error: { error: 'Deal not found or access denied.' }, status: 404 };
  if (!access.canEdit) return { error: { error: 'Only the deal owner or a collaborator can do this.' }, status: 403 };
  return { access };
}

/**
 * Shortcut guard for routes that require owner-only access
 * (collaborator management, deletion, ownership changes).
 */
export async function requireDealOwner({ dealId, email, userId }) {
  const access = await resolveDealAccess({ dealId, email, userId });
  if (!access) return { error: { error: 'Deal not found or access denied.' }, status: 404 };
  if (access.mode !== 'owner') return { error: { error: 'Only the deal owner can do this.' }, status: 403 };
  return { access };
}
