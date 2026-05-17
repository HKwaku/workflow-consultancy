/**
 * PATCH  /api/operating-models/[id]/artefacts/[artefactId]  (rename)
 * DELETE /api/operating-models/[id]/artefacts/[artefactId]
 *
 * Rename / remove an artefact from the panel. Member-access (not
 * admin-gated). Both repo calls are scoped by model id so a member
 * can't touch another model's artefact via a guessed id.
 */

import { NextResponse } from 'next/server';
import { checkOrigin, isValidUUID, getRequestId } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveModelAccess } from '@/lib/operatingModel/auth';
import { updateArtefact, deleteArtefact } from '@/lib/operatingModel/artefacts';
import { logger } from '@/lib/logger';

export const maxDuration = 10;

async function gate(request, params) {
  const { id, artefactId } = await params;
  if (!isValidUUID(id) || !isValidUUID(artefactId)) {
    return { error: NextResponse.json({ error: 'Valid ids required.' }, { status: 400 }) };
  }
  const auth = await requireAuth(request);
  if (auth.error) return { error: NextResponse.json(auth.error.body, { status: auth.error.status }) };

  const access = await resolveModelAccess({ modelId: id, email: auth.email, userId: auth.userId });
  if (access.error) return { error: NextResponse.json({ error: access.error }, { status: access.status }) };
  return { id, artefactId };
}

export async function PATCH(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const g = await gate(request, params);
  if (g.error) return g.error;

  let patch;
  try { patch = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  if (patch?.title != null && String(patch.title).length > 200) {
    return NextResponse.json({ error: 'title must be ≤ 200 chars.' }, { status: 400 });
  }

  const result = await updateArtefact(g.id, g.artefactId, patch || {});
  if (!result.ok) {
    logger.warn('Artefact PATCH failed', { requestId: getRequestId(request), artefactId: g.artefactId });
    return NextResponse.json({ error: 'Failed to update artefact.' }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const g = await gate(request, params);
  if (g.error) return g.error;

  const result = await deleteArtefact(g.id, g.artefactId);
  if (!result.ok) {
    logger.warn('Artefact DELETE failed', { requestId: getRequestId(request), artefactId: g.artefactId });
    return NextResponse.json({ error: 'Failed to delete artefact.' }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
