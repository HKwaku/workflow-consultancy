/**
 * PATCH  /api/operating-models/[id]/functions/[funcId]
 * DELETE /api/operating-models/[id]/functions/[funcId]
 *
 * Edit / remove a capability. Admin-only. Sub-functions are reparented
 * to NULL (top-level) on delete via the FK ON DELETE SET NULL — they
 * survive but become roots, easier to recover than cascading them out.
 */

import { NextResponse } from 'next/server';
import { checkOrigin, isValidUUID, getRequestId } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveModelAccess } from '@/lib/operatingModel/auth';
import { updateFunction, deleteFunction } from '@/lib/operatingModel/repo';
import { logger } from '@/lib/logger';

export const maxDuration = 10;

export async function PATCH(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id, funcId } = await params;
  if (!isValidUUID(id) || !isValidUUID(funcId)) {
    return NextResponse.json({ error: 'Valid ids required.' }, { status: 400 });
  }

  const access = await resolveModelAccess({ modelId: id, email: auth.email, userId: auth.userId });
  if (access.error)    return NextResponse.json({ error: access.error }, { status: access.status });
  if (!access.isAdmin) return NextResponse.json({ error: 'Only org admins can edit functions.' }, { status: 403 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  // Reject moving a capability under itself or its own descendant — easy
  // foot-gun via the picker. Self-loop check is cheap; descendant cycles
  // are detected by Postgres at write time (would just orphan in the tree).
  if (body?.parent_function_id === funcId) {
    return NextResponse.json({ error: 'A capability cannot be its own parent.' }, { status: 400 });
  }

  const result = await updateFunction(funcId, body || {});
  if (!result.ok) {
    logger.warn('Capability PATCH failed', { requestId: getRequestId(request), funcId });
    return NextResponse.json({ error: 'Failed to update capability.' }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id, funcId } = await params;
  if (!isValidUUID(id) || !isValidUUID(funcId)) {
    return NextResponse.json({ error: 'Valid ids required.' }, { status: 400 });
  }

  const access = await resolveModelAccess({ modelId: id, email: auth.email, userId: auth.userId });
  if (access.error)    return NextResponse.json({ error: access.error }, { status: access.status });
  if (!access.isAdmin) return NextResponse.json({ error: 'Only org admins can edit functions.' }, { status: 403 });

  const result = await deleteFunction(funcId);
  if (!result.ok) {
    logger.warn('Capability DELETE failed', { requestId: getRequestId(request), funcId });
    return NextResponse.json({ error: 'Failed to delete capability.' }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
