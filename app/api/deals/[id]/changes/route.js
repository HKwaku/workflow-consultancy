/**
 * GET /api/deals/[id]/changes
 *
 * Returns the deal's change-timeline rows newest first. Wraps
 * lib/changes/repo.loadChanges(); RLS scoping enforces that callers can
 * only read changes for deals they own / collaborate on / participate in.
 *
 * Open to any deal viewer (read). Editor gating lives on the per-row
 * PATCH at /api/deals/[id]/changes/[changeId].
 *
 * Returns: { changes: Change[] } where each Change carries its embedded
 * change_outcomes array via the PostgREST relation.
 */

import { NextResponse } from 'next/server';
import { isValidUUID } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveDealAccess } from '@/lib/dealAuth';
import { loadChanges } from '@/lib/changes/repo';

export const maxDuration = 10;

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Valid deal id required.' }, { status: 400 });

  const access = await resolveDealAccess({ dealId: id, email: auth.email, userId: auth.userId });
  if (!access) return NextResponse.json({ error: 'Deal not found or access denied.' }, { status: 404 });

  const sp = request.nextUrl.searchParams;
  const limit = Math.max(10, Math.min(Number(sp.get('limit') || 200), 500));

  const changes = await loadChanges({ dealId: id, limit });
  return NextResponse.json({ changes });
}
