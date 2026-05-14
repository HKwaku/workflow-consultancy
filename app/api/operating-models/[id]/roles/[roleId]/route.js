/**
 * PATCH  /api/operating-models/[id]/roles/[roleId]
 * DELETE /api/operating-models/[id]/roles/[roleId]
 *
 * Edit / remove a role. Admin-only.
 */

import { NextResponse } from 'next/server';
import { checkOrigin, isValidUUID, getRequestId } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveModelAccess } from '@/lib/operatingModel/auth';
import { updateModelRole, deleteModelRole } from '@/lib/operatingModel/repo';
import { logger } from '@/lib/logger';

export const maxDuration = 10;

export async function PATCH(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id, roleId } = await params;
  if (!isValidUUID(id) || !isValidUUID(roleId)) {
    return NextResponse.json({ error: 'Valid ids required.' }, { status: 400 });
  }

  const access = await resolveModelAccess({ modelId: id, email: auth.email, userId: auth.userId });
  if (access.error)    return NextResponse.json({ error: access.error }, { status: access.status });
  if (!access.isAdmin) return NextResponse.json({ error: 'Only org admins can edit roles.' }, { status: 403 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  if (Array.isArray(body?.function_ids)) {
    for (const c of body.function_ids) {
      if (typeof c !== 'string' || !isValidUUID(c)) {
        return NextResponse.json({ error: 'function_ids must be an array of uuids.' }, { status: 400 });
      }
    }
  }

  const result = await updateModelRole(roleId, body || {});
  if (!result.ok) {
    if (result.reason === 'name_required') {
      return NextResponse.json({ error: 'name cannot be empty.' }, { status: 400 });
    }
    logger.warn('Role PATCH failed', { requestId: getRequestId(request), roleId });
    return NextResponse.json({ error: 'Failed to update role.' }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id, roleId } = await params;
  if (!isValidUUID(id) || !isValidUUID(roleId)) {
    return NextResponse.json({ error: 'Valid ids required.' }, { status: 400 });
  }

  const access = await resolveModelAccess({ modelId: id, email: auth.email, userId: auth.userId });
  if (access.error)    return NextResponse.json({ error: access.error }, { status: access.status });
  if (!access.isAdmin) return NextResponse.json({ error: 'Only org admins can edit roles.' }, { status: 403 });

  const result = await deleteModelRole(roleId);
  if (!result.ok) {
    logger.warn('Role DELETE failed', { requestId: getRequestId(request), roleId });
    return NextResponse.json({ error: 'Failed to delete role.' }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
