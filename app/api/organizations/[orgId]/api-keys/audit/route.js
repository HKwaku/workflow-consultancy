/**
 * GET /api/organizations/[orgId]/api-keys/audit
 *
 * Returns the append-only audit trail for this org's API keys.
 * Admin only. Newest first; default 50 rows, max 200.
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireOrgAdminOrPlatformAdmin } from '@/lib/orgAdmin';
import { listKeyAuditForOrg } from '@/lib/customerKey';

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { orgId } = await params;
  const sb = getSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const gate = await requireOrgAdminOrPlatformAdmin(sb, orgId, auth.userId, auth.email);
  if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const sp = request.nextUrl.searchParams;
  const limit = Math.min(Number(sp.get('limit')) || 50, 200);
  const audit = await listKeyAuditForOrg({ orgId, limit });
  return NextResponse.json({ audit });
}
