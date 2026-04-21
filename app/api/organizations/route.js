import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { checkOrigin, getRequestId, requireSupabase } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { isPlatformAdminEmail, fetchMembershipsForUser } from '@/lib/orgAdmin';

const CreateOrgSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/).optional().nullable(),
});

function slugifyName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72) || 'org';
}

export async function GET(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const sbConfig = requireSupabase();
  if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  const supabase = createClient(sbConfig.url, sbConfig.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const memberships = await fetchMembershipsForUser(supabase, auth.userId);
    const platformAdmin = isPlatformAdminEmail(auth.email);

    let allOrgs = null;
    if (platformAdmin) {
      const { data: orgRows, error: orgErr } = await supabase
        .from('organizations')
        .select('id, name, slug, created_at')
        .order('created_at', { ascending: false });
      if (orgErr) {
        logger.warn('organizations list all failed', { requestId: getRequestId(request), message: orgErr.message });
      } else {
        allOrgs = orgRows || [];
      }
    }

    return NextResponse.json({
      success: true,
      memberships,
      platformAdmin,
      ...(allOrgs && { organizations: allOrgs }),
    });
  } catch (e) {
    const msg = e.message || '';
    if (/relation|does not exist|42P01/i.test(msg)) {
      return NextResponse.json({
        success: true,
        memberships: [],
        platformAdmin: isPlatformAdminEmail(auth.email),
        migrationRequired: true,
      });
    }
    logger.error('GET /api/organizations', { requestId: getRequestId(request), error: e.message });
    return NextResponse.json({ error: 'Failed to load organizations.' }, { status: 502 });
  }
}

export async function POST(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  if (!isPlatformAdminEmail(auth.email)) {
    return NextResponse.json({ error: 'Only platform administrators can create organizations.' }, { status: 403 });
  }

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  const parsed = CreateOrgSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().formErrors?.[0] || 'Invalid request.' }, { status: 400 });
  }

  const sbConfig = requireSupabase();
  if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  const supabase = createClient(sbConfig.url, sbConfig.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { name, slug: slugIn } = parsed.data;
  const baseSlug = slugIn || slugifyName(name);
  let slug = baseSlug;
  let attempt = 0;
  const emailLower = auth.email.toLowerCase().trim();

  while (attempt < 8) {
    const { data: org, error: insErr } = await supabase
      .from('organizations')
      .insert({
        name: name.trim(),
        slug,
        created_by_email: emailLower,
        updated_at: new Date().toISOString(),
      })
      .select('id, name, slug, created_at')
      .single();

    if (!insErr && org) {
      const { error: memErr } = await supabase.from('organization_members').insert({
        organization_id: org.id,
        user_id: auth.userId,
        email: emailLower,
        is_org_admin: true,
        entitlements: {},
        updated_at: new Date().toISOString(),
      });

      if (memErr) {
        await supabase.from('organizations').delete().eq('id', org.id);
        logger.error('org create: member insert failed', { requestId: getRequestId(request), message: memErr.message });
        return NextResponse.json({ error: 'Failed to create organization membership.' }, { status: 502 });
      }

      return NextResponse.json({ success: true, organization: org });
    }

    if (insErr?.code !== '23505') {
      logger.error('org create failed', { requestId: getRequestId(request), message: insErr?.message });
      return NextResponse.json({ error: insErr?.message || 'Failed to create organization.' }, { status: 502 });
    }

    attempt += 1;
    slug = `${baseSlug}-${attempt}`;
  }

  return NextResponse.json({ error: 'Could not allocate a unique slug.' }, { status: 409 });
}
