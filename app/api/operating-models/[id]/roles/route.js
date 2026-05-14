/**
 * POST /api/operating-models/[id]/roles
 *
 * Create a role under this model. Admin-only.
 * Body: { name, headcount?, owner_email?, function_ids?, description? }
 *
 * Returns: { id }
 */

import { NextResponse } from 'next/server';
import { checkOrigin, isValidUUID, getRequestId } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveModelAccess } from '@/lib/operatingModel/auth';
import { createModelRole } from '@/lib/operatingModel/repo';
import { logger } from '@/lib/logger';

export const maxDuration = 10;

export async function POST(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Valid model id required.' }, { status: 400 });

  const access = await resolveModelAccess({ modelId: id, email: auth.email, userId: auth.userId });
  if (access.error)    return NextResponse.json({ error: access.error }, { status: access.status });
  if (!access.isAdmin) return NextResponse.json({ error: 'Only org admins can edit roles.' }, { status: 403 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  const name = String(body?.name || '').trim();
  if (!name) return NextResponse.json({ error: 'name required.' }, { status: 400 });
  if (name.length > 200) return NextResponse.json({ error: 'name must be ≤ 200 chars.' }, { status: 400 });

  // Validate function_ids[] are uuids — bad ones would either silently no-op
  // (PostgREST drops them) or fail the FK; reject early for a clear 400.
  const capIds = Array.isArray(body?.function_ids) ? body.function_ids : [];
  for (const c of capIds) {
    if (typeof c !== 'string' || !isValidUUID(c)) {
      return NextResponse.json({ error: 'function_ids must be an array of uuids.' }, { status: 400 });
    }
  }

  const newId = await createModelRole({
    operating_model_id: id,
    name,
    headcount: body?.headcount,
    owner_email: body?.owner_email || null,
    function_ids: capIds,
    description: body?.description || null,
  });
  if (!newId) {
    logger.warn('Role create failed', { requestId: getRequestId(request), modelId: id });
    return NextResponse.json({ error: 'Failed to create role.' }, { status: 502 });
  }
  return NextResponse.json({ id: newId });
}
