/**
 * POST /api/operating-models/[id]/functions
 *
 * Create a new capability under this model. Admin-only.
 * Body: { name, parent_function_id?, layer?, status?, owner_email?, description?, order_index? }
 *
 * Returns: { id }
 */

import { NextResponse } from 'next/server';
import { checkOrigin, isValidUUID, getRequestId } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveModelAccess } from '@/lib/operatingModel/auth';
import { createFunction } from '@/lib/operatingModel/repo';
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
  if (!access.isAdmin) return NextResponse.json({ error: 'Only org admins can edit functions.' }, { status: 403 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  const name = String(body?.name || '').trim();
  if (!name) return NextResponse.json({ error: 'name required.' }, { status: 400 });
  if (name.length > 200) return NextResponse.json({ error: 'name must be ≤ 200 chars.' }, { status: 400 });

  // parent_function_id, when supplied, must be a uuid (or null)
  const parentId = body?.parent_function_id ?? null;
  if (parentId != null && !isValidUUID(parentId)) {
    return NextResponse.json({ error: 'parent_function_id must be a uuid or null.' }, { status: 400 });
  }

  const newId = await createFunction({
    operating_model_id: id,
    name,
    parent_function_id: parentId,
    layer: body?.layer || 'value_chain',
    status: body?.status || 'live',
    owner_email: body?.owner_email || null,
    description: body?.description || null,
    order_index: body?.order_index || 0,
  });
  if (!newId) {
    logger.warn('Capability create failed', { requestId: getRequestId(request), modelId: id });
    return NextResponse.json({ error: 'Failed to create capability.' }, { status: 502 });
  }
  return NextResponse.json({ id: newId });
}
