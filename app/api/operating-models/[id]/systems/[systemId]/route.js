/**
 * PATCH  /api/operating-models/[id]/systems/[systemId]
 * DELETE /api/operating-models/[id]/systems/[systemId]
 *
 * Edit / remove a canonical system. Admin-only.
 *
 * Note: process_systems rows that link to this system have ON DELETE SET NULL,
 * so deleting a canonical row leaves the raw mentions intact (they show as
 * "unlinked" in the inventory until re-promoted).
 */

import { NextResponse } from 'next/server';
import { checkOrigin, isValidUUID, getRequestId } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveModelAccess } from '@/lib/operatingModel/auth';
import { updateModelSystem, deleteModelSystem } from '@/lib/operatingModel/repo';
import { logger } from '@/lib/logger';

export const maxDuration = 10;

const VALID_LAYERS = new Set(['system_of_record', 'productivity', 'workflow', 'analytics', 'comms', 'other']);

export async function PATCH(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id, systemId } = await params;
  if (!isValidUUID(id) || !isValidUUID(systemId)) {
    return NextResponse.json({ error: 'Valid ids required.' }, { status: 400 });
  }

  const access = await resolveModelAccess({ modelId: id, email: auth.email, userId: auth.userId });
  if (access.error)    return NextResponse.json({ error: access.error }, { status: access.status });
  if (!access.isAdmin) return NextResponse.json({ error: 'Only org admins can edit systems.' }, { status: 403 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  if (body?.layer && !VALID_LAYERS.has(body.layer)) {
    return NextResponse.json({ error: `layer must be one of: ${[...VALID_LAYERS].join(', ')}.` }, { status: 400 });
  }

  const result = await updateModelSystem(systemId, body || {});
  if (!result.ok) {
    if (result.reason === 'name_required') {
      return NextResponse.json({ error: 'name cannot be empty.' }, { status: 400 });
    }
    logger.warn('System PATCH failed', { requestId: getRequestId(request), systemId });
    return NextResponse.json({ error: 'Failed to update system.' }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id, systemId } = await params;
  if (!isValidUUID(id) || !isValidUUID(systemId)) {
    return NextResponse.json({ error: 'Valid ids required.' }, { status: 400 });
  }

  const access = await resolveModelAccess({ modelId: id, email: auth.email, userId: auth.userId });
  if (access.error)    return NextResponse.json({ error: access.error }, { status: access.status });
  if (!access.isAdmin) return NextResponse.json({ error: 'Only org admins can edit systems.' }, { status: 403 });

  const result = await deleteModelSystem(systemId);
  if (!result.ok) {
    logger.warn('System DELETE failed', { requestId: getRequestId(request), systemId });
    return NextResponse.json({ error: 'Failed to delete system.' }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
