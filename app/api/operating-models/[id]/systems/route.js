/**
 * POST /api/operating-models/[id]/systems
 *
 * Create a system in the inventory. Admin-only.
 * Body: { name, vendor?, category?, layer?, owner_email?, description? }
 *
 * UPSERTs on (operating_model_id, match_key) — adding "Salesforce" twice
 * yields the same row, so this is safe to call from the "promote unlinked"
 * affordance in the System Inventory card.
 *
 * Returns: { id }
 */

import { NextResponse } from 'next/server';
import { checkOrigin, isValidUUID, getRequestId } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveModelAccess } from '@/lib/operatingModel/auth';
import { createModelSystem } from '@/lib/operatingModel/repo';
import { logger } from '@/lib/logger';

export const maxDuration = 10;

const VALID_LAYERS = new Set(['system_of_record', 'productivity', 'workflow', 'analytics', 'comms', 'other']);

export async function POST(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Valid model id required.' }, { status: 400 });

  const access = await resolveModelAccess({ modelId: id, email: auth.email, userId: auth.userId });
  if (access.error)    return NextResponse.json({ error: access.error }, { status: access.status });
  if (!access.isAdmin) return NextResponse.json({ error: 'Only org admins can edit systems.' }, { status: 403 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  const name = String(body?.name || '').trim();
  if (!name) return NextResponse.json({ error: 'name required.' }, { status: 400 });
  if (name.length > 200) return NextResponse.json({ error: 'name must be ≤ 200 chars.' }, { status: 400 });

  if (body?.layer && !VALID_LAYERS.has(body.layer)) {
    return NextResponse.json({ error: `layer must be one of: ${[...VALID_LAYERS].join(', ')}.` }, { status: 400 });
  }

  const newId = await createModelSystem({
    operating_model_id: id,
    name,
    vendor: body?.vendor || null,
    category: body?.category || null,
    layer: body?.layer || 'other',
    owner_email: body?.owner_email || null,
    description: body?.description || null,
  });
  if (!newId) {
    logger.warn('System create failed', { requestId: getRequestId(request), modelId: id });
    return NextResponse.json({ error: 'Failed to create system.' }, { status: 502 });
  }
  return NextResponse.json({ id: newId });
}
