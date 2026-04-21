import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { checkOrigin, getRequestId, isValidUUID, requireSupabase } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { requireOrgAdminOrPlatformAdmin } from '@/lib/orgAdmin';
import { mergeWithDefaults, sanitizeEntitlements } from '@/lib/entitlements';

const PatchSchema = z.object({
  isOrgAdmin: z.boolean().optional(),
  entitlements: z.record(z.string(), z.boolean()).optional(),
});

export async function PATCH(request, { params }) {
  const { orgId, userId: targetUserId } = await params;

  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  if (!orgId || !isValidUUID(orgId) || !targetUserId || !isValidUUID(targetUserId)) {
    return NextResponse.json({ error: 'Valid organization and user id required.' }, { status: 400 });
  }

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.', details: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.isOrgAdmin === undefined && parsed.data.entitlements === undefined) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  }

  const sbConfig = requireSupabase();
  if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  const supabase = createClient(sbConfig.url, sbConfig.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const gate = await requireOrgAdminOrPlatformAdmin(supabase, orgId, auth.userId, auth.email);
  if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const { data: target, error: findErr } = await supabase
    .from('organization_members')
    .select('id, user_id, email, is_org_admin, entitlements')
    .eq('organization_id', orgId)
    .eq('user_id', targetUserId)
    .maybeSingle();

  if (findErr || !target) {
    return NextResponse.json({ error: 'Member not found.' }, { status: 404 });
  }

  const nextAdmin = parsed.data.isOrgAdmin !== undefined ? parsed.data.isOrgAdmin : target.is_org_admin;
  if (target.is_org_admin && !nextAdmin) {
    const { count, error: cntErr } = await supabase
      .from('organization_members')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('is_org_admin', true);

    if (cntErr) {
      logger.error('org admin count', { requestId: getRequestId(request), message: cntErr.message });
      return NextResponse.json({ error: 'Failed to validate admins.' }, { status: 502 });
    }
    if ((count || 0) <= 1) {
      return NextResponse.json({ error: 'Cannot remove the last organization admin.' }, { status: 400 });
    }
  }

  const patch = { updated_at: new Date().toISOString() };
  if (parsed.data.isOrgAdmin !== undefined) patch.is_org_admin = parsed.data.isOrgAdmin;

  if (parsed.data.entitlements !== undefined) {
    const merged = mergeWithDefaults({
      ...mergeWithDefaults(target.entitlements),
      ...parsed.data.entitlements,
    });
    patch.entitlements = sanitizeEntitlements(merged);
  }

  const { data: updated, error: upErr } = await supabase
    .from('organization_members')
    .update(patch)
    .eq('id', target.id)
    .select('id, user_id, email, is_org_admin, entitlements, created_at, updated_at')
    .single();

  if (upErr) {
    logger.error('org member patch', { requestId: getRequestId(request), message: upErr.message });
    return NextResponse.json({ error: 'Failed to update member.' }, { status: 502 });
  }

  return NextResponse.json({
    success: true,
    member: { ...updated, entitlements: mergeWithDefaults(updated.entitlements) },
  });
}
