/**
 * PATCH /api/operating-models/[id]/processes/[processId]
 *
 * File a process under a capability (or unfile by passing function_id=null).
 * Optional: set design_owner_email.
 *
 * Body: { function_id: uuid|null, design_owner_email?: string|null }
 *
 * Auth: any org member of the model's org. The diagnostic_report itself
 * may have a separate ownership (contact_email); for now we trust org
 * membership for filing decisions — these are organisational metadata,
 * not changes to the process content.
 */

import { NextResponse } from 'next/server';
import { checkOrigin, isValidUUID, getRequestId, getSupabaseHeaders, fetchWithTimeout, requireSupabase } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveModelAccess } from '@/lib/operatingModel/auth';
import { attachProcessToModel, deleteModelProcess } from '@/lib/operatingModel/repo';
import { logger } from '@/lib/logger';

export const maxDuration = 10;

export async function PATCH(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id, processId } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Valid model id required.' }, { status: 400 });
  if (!processId || typeof processId !== 'string' || processId.length > 64) {
    return NextResponse.json({ error: 'Valid report id required.' }, { status: 400 });
  }

  const access = await resolveModelAccess({ modelId: id, email: auth.email, userId: auth.userId });
  if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  // Validate the process actually belongs to this model — defence in depth
  // alongside RLS. Without this check the API silently no-ops on the wrong
  // process, which is the worst kind of bug to debug.
  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const ownerResp = await fetchWithTimeout(
    `${sb.url}/rest/v1/processes?id=eq.${encodeURIComponent(processId)}&operating_model_id=eq.${encodeURIComponent(id)}&select=id&limit=1`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  const owned = ownerResp.ok ? await ownerResp.json() : [];
  if (!owned.length) return NextResponse.json({ error: 'Process not found in this model.' }, { status: 404 });

  // function_id can be null (unfile), a uuid (file), or omitted (no change).
  // Living-workspace migration: design_owner_email column dropped, so we
  // accept the body field for back-compat but silently ignore it.
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(body || {}, 'function_id')) {
    const cap = body.function_id;
    if (cap !== null && !isValidUUID(cap)) {
      return NextResponse.json({ error: 'function_id must be a uuid or null.' }, { status: 400 });
    }
    patch.function_id = cap;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Provide function_id.' }, { status: 400 });
  }

  // attachProcessToModel expects { reportId, ... } — historical naming.
  const result = await attachProcessToModel({ reportId: processId, ...patch });
  if (!result.ok) {
    logger.warn('Process anchor PATCH failed', { requestId: getRequestId(request), processId, modelId: id });
    return NextResponse.json({ error: 'Failed to update process.' }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/operating-models/[id]/processes/[processId]
 *
 * Remove a process from the model. Scoped to operating_model_id so a
 * caller can never delete a process outside the model they were
 * authorised against. Backs the chat agent's delete_process tool,
 * which routes through an explicit Confirm card before this fires.
 */
export async function DELETE(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id, processId } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Valid model id required.' }, { status: 400 });
  if (!processId || typeof processId !== 'string' || processId.length > 64) {
    return NextResponse.json({ error: 'Valid report id required.' }, { status: 400 });
  }

  const access = await resolveModelAccess({ modelId: id, email: auth.email, userId: auth.userId });
  if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

  const result = await deleteModelProcess({ modelId: id, processId });
  if (!result.ok) {
    logger.warn('Process DELETE failed', { requestId: getRequestId(request), processId, modelId: id });
    return NextResponse.json({ error: 'Failed to delete process.' }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
