import { createClient } from '@supabase/supabase-js';
import { isValidEmail } from '@/lib/api-helpers';
import { mergeWithDefaults, sanitizeEntitlements } from '@/lib/entitlements';

function parseEmailList(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw.split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function isPlatformAdminEmail(email) {
  const e = (email || '').trim().toLowerCase();
  if (!e) return false;
  const allow = parseEmailList(process.env.PLATFORM_ADMIN_EMAILS || '');
  return allow.includes(e);
}

async function attachOrganizations(supabase, members) {
  if (!members?.length) return [];
  const orgIds = [...new Set(members.map((m) => m.organization_id))];
  const { data: orgs, error: orgErr } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .in('id', orgIds);
  if (orgErr) throw new Error(orgErr.message);
  const byId = Object.fromEntries((orgs || []).map((o) => [o.id, o]));
  return members.map((m) => ({
    ...m,
    entitlements: mergeWithDefaults(m.entitlements),
    organization: byId[m.organization_id] || null,
  }));
}

export async function userHasEntitlement(supabase, userId, key) {
  if (!userId || !key) return false;
  const { data, error } = await supabase
    .from('organization_members')
    .select('entitlements')
    .eq('user_id', userId);
  if (error) return false;
  return (data || []).some((row) => Boolean(row?.entitlements?.[key]));
}

export async function fetchMembershipsForUser(supabase, userId) {
  const { data, error } = await supabase
    .from('organization_members')
    .select('id, organization_id, user_id, email, is_org_admin, entitlements, created_at')
    .eq('user_id', userId);

  if (error) throw new Error(error.message);
  return attachOrganizations(supabase, data || []);
}

export async function getMembership(supabase, orgId, userId) {
  const { data, error } = await supabase
    .from('organization_members')
    .select('id, organization_id, user_id, email, is_org_admin, entitlements, created_at')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

export async function requireOrgAdmin(supabase, orgId, userId) {
  const member = await getMembership(supabase, orgId, userId);
  if (!member) return { error: 'Not a member of this organization.', status: 403 };
  if (!member.is_org_admin) return { error: 'Organization admin access required.', status: 403 };
  return { member };
}

export async function requireOrgAdminOrPlatformAdmin(supabase, orgId, userId, userEmail) {
  if (isPlatformAdminEmail(userEmail)) {
    const { data: org, error } = await supabase.from('organizations').select('id').eq('id', orgId).maybeSingle();
    if (error) return { error: 'Failed to verify organization.', status: 502 };
    if (!org) return { error: 'Organization not found.', status: 404 };
    return { member: { is_org_admin: true, organization_id: orgId, user_id: userId } };
  }
  return requireOrgAdmin(supabase, orgId, userId);
}

export async function inviteOrLinkOrgMember(supabase, opts) {
  const email = (opts.email || '').trim().toLowerCase();
  if (!isValidEmail(email)) throw new Error('Invalid email.');

  const ent = mergeWithDefaults(opts.entitlements || {});

  const { data: uidRow, error: rpcErr } = await supabase.rpc('get_user_id_by_email', { p_email: email });
  if (rpcErr) throw new Error(rpcErr.message);

  let userId = uidRow || null;

  if (!userId) {
    const redirectTo = `${opts.redirectBaseUrl.replace(/\/$/, '')}/portal`;
    const { data: inviteData, error: invErr } = await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { organization_id: opts.organizationId },
    });
    if (invErr) throw new Error(invErr.message || 'Invite failed.');
    userId = inviteData?.user?.id;
    if (!userId) throw new Error('Invite did not return a user id.');
  }

  const { data: inserted, error: insErr } = await supabase
    .from('organization_members')
    .insert({
      organization_id: opts.organizationId,
      user_id: userId,
      email,
      is_org_admin: Boolean(opts.isOrgAdmin),
      entitlements: sanitizeEntitlements(ent),
      updated_at: new Date().toISOString(),
    })
    .select('id, organization_id, user_id, email, is_org_admin, entitlements, created_at')
    .single();

  if (insErr) {
    if (insErr.code === '23505') throw new Error('This user is already a member of the organization.');
    throw new Error(insErr.message);
  }

  return { member: inserted, invitedNewAuthUser: !uidRow };
}
