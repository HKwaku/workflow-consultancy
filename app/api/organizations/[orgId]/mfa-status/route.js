/**
 * GET /api/organizations/[orgId]/mfa-status
 *
 * SOC 2 evidence endpoint (CC6.2). Org admins can see which members have
 * MFA enabled and which haven't. Used by the admin UI banner ("X/Y members
 * have MFA — chase the rest") and by the monthly evidence script.
 *
 * Returns:
 *   {
 *     orgId, generatedAt,
 *     totalMembers, mfaEnabled, mfaDisabled,
 *     enforcementRate (0..1), fullyEnforced (bool),
 *     members: [{ userId, email, isOrgAdmin, mfa: { enabled, factorCount, ... } }]
 *   }
 *
 * Access: org admin or platform admin only — the report names every member,
 * which is more than a regular member should see.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkOrigin, getRequestId, isValidUUID, requireSupabase } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { requireOrgAdminOrPlatformAdmin } from '@/lib/orgAdmin';
import { getOrgMfaReport } from '@/lib/mfaCheck';

export const maxDuration = 30;

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

  try {
    const report = await getOrgMfaReport(orgId);
    if (!report) {
      return NextResponse.json({ error: 'MFA report unavailable.' }, { status: 503 });
    }
    return NextResponse.json({ success: true, ...report }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    logger.error('mfa-status', { requestId: getRequestId(request), message: e?.message });
    return NextResponse.json({ error: 'Failed to compute MFA status.' }, { status: 500 });
  }
}
