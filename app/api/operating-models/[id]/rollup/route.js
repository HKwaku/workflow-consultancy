/**
 * GET /api/operating-models/[id]/rollup
 *
 * Aggregated stats for a model:
 *   { totals: {...}, byFunction: [...], unfiledProcesses: number }
 *
 * Powers the workspace home's top stats strip + capability-tree counts.
 * Read-only for any org member.
 */

import { NextResponse } from 'next/server';
import { isValidUUID } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveModelAccess } from '@/lib/operatingModel/auth';
import { loadModelRollup } from '@/lib/operatingModel/repo';

export const maxDuration = 10;

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Valid model id required.' }, { status: 400 });

  const access = await resolveModelAccess({ modelId: id, email: auth.email, userId: auth.userId });
  if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

  const rollup = await loadModelRollup(id);
  return NextResponse.json(rollup || { totals: {}, byFunction: [], unfiledProcesses: 0 });
}
