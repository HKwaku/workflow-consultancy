import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { checkOrigin, getRequestId, isValidUUID, requireSupabase } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { requireOrgAdminOrPlatformAdmin, inviteOrLinkOrgMember } from '@/lib/orgAdmin';
import { mergeWithDefaults } from '@/lib/entitlements';

const InviteSchema = z.object({
  email: z.string().email().max(254),
  isOrgAdmin: z.boolean().optional(),
  entitlements: z.record(z.string(), z.boolean()).optional(),
});

export async function GET(request, { params }) {
  const { orgId } = await params;
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  if (!orgId || !isValidUUID(orgId)) {
    return NextResponse.json({ error: 'Valid organization id required.' }, { status: 400 });
  }

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const sbConfig = requireSupabase();
  if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  const supabase = createClient(sbConfig.url, sbConfig.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const gate = await requireOrgAdminOrPlatformAdmin(supabase, orgId, auth.userId, auth.email);
  if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const { data: rows, error } = await supabase
    .from('organization_members')
    .select('id, user_id, email, is_org_admin, entitlements, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true });

  if (error) {
    logger.error('org members list', { requestId: getRequestId(request), message: error.message });
    return NextResponse.json({ error: 'Failed to list members.' }, { status: 502 });
  }

  const members = (rows || []).map((r) => ({
    ...r,
    entitlements: mergeWithDefaults(r.entitlements),
  }));

  return NextResponse.json({ success: true, members });
}

export async function POST(request, { params }) {
  const { orgId } = await params;
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  if (!orgId || !isValidUUID(orgId)) {
    return NextResponse.json({ error: 'Valid organization id required.' }, { status: 400 });
  }

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const parsed = InviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.', details: parsed.error.flatten() }, { status: 400 });
  }

  const sbConfig = requireSupabase();
  if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  const supabase = createClient(sbConfig.url, sbConfig.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const gate = await requireOrgAdminOrPlatformAdmin(supabase, orgId, auth.userId, auth.email);
  if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3000';
  const redirectBaseUrl = `${proto}://${host}`;

  try {
    const { email, isOrgAdmin, entitlements } = parsed.data;
    const result = await inviteOrLinkOrgMember(supabase, {
      email,
      organizationId: orgId,
      isOrgAdmin: Boolean(isOrgAdmin),
      entitlements: entitlements || {},
      redirectBaseUrl,
    });
    const member = {
      ...result.member,
      entitlements: mergeWithDefaults(result.member.entitlements),
    };
    return NextResponse.json({
      success: true,
      member,
      invitedNewAuthUser: result.invitedNewAuthUser,
    });
  } catch (e) {
    const msg = e.message || 'Invite failed.';
    const status = msg.includes('already a member') ? 409 : 502;
    logger.warn('org invite', { requestId: getRequestId(request), message: msg });
    return NextResponse.json({ error: msg }, { status });
  }
}
