/**
 * GET  /api/operating-models/[id]/artefacts
 * POST /api/operating-models/[id]/artefacts
 *
 * The workspace "Artefacts" panel. GET lists every artefact for the
 * model (newest first); POST creates one manually (the agent path
 * goes through the emit_artefact chat tool, not this route). Any org
 * member may read AND write — emitting an artefact never mutates the
 * canonical model, so this is NOT admin-gated.
 *
 * Body (POST): { type?, title?, content?, language?, meta? }
 */

import { NextResponse } from 'next/server';
import { checkOrigin, isValidUUID, getRequestId } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveModelAccess } from '@/lib/operatingModel/auth';
import { listArtefacts, createArtefact } from '@/lib/operatingModel/artefacts';
import { logger } from '@/lib/logger';

export const maxDuration = 10;

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Valid model id required.' }, { status: 400 });

  const access = await resolveModelAccess({ modelId: id, email: auth.email, userId: auth.userId });
  if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

  const artefacts = await listArtefacts(id);
  return NextResponse.json({ artefacts });
}

export async function POST(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Valid model id required.' }, { status: 400 });

  const access = await resolveModelAccess({ modelId: id, email: auth.email, userId: auth.userId });
  if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

  let payload;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  const content = typeof payload?.content === 'string' ? payload.content : '';
  if (content.length > 200_000) {
    return NextResponse.json({ error: 'content must be ≤ 200k chars.' }, { status: 400 });
  }
  const meta = payload?.meta && typeof payload.meta === 'object' && !Array.isArray(payload.meta)
    ? payload.meta : {};

  const row = await createArtefact({
    operating_model_id: id,
    type: payload?.type || 'markdown',
    title: payload?.title || null,
    content,
    language: payload?.language || null,
    source: 'user',
    meta,
    created_by_email: auth.email,
  });
  if (!row) {
    logger.warn('Artefact create failed', { requestId: getRequestId(request), modelId: id });
    return NextResponse.json({ error: 'Failed to create artefact.' }, { status: 502 });
  }
  return NextResponse.json({ artefact: row });
}
