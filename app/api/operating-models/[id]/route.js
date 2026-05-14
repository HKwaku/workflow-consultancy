/**
 * GET   /api/operating-models/[id]   — full model load (model + functions
 *                                       tree + roles + systems + processCount)
 * PATCH /api/operating-models/[id]   — update name/description/settings/kind
 *                                       (admin only)
 */

import { NextResponse } from 'next/server';
import { checkOrigin, isValidUUID, getRequestId } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveModelAccess } from '@/lib/operatingModel/auth';
import { loadOperatingModel } from '@/lib/operatingModel/repo';
import { getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase } from '@/lib/api-helpers';
import { logger } from '@/lib/logger';

export const maxDuration = 10;

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Valid model id required.' }, { status: 400 });

  const access = await resolveModelAccess({ modelId: id, email: auth.email, userId: auth.userId });
  if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });

  const data = await loadOperatingModel(id);
  if (!data) return NextResponse.json({ error: 'Model not found.' }, { status: 404 });

  return NextResponse.json({ ...data, isAdmin: access.isAdmin });
}

const PATCH_FIELDS = ['name', 'kind', 'status', 'description', 'settings'];

export async function PATCH(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Valid model id required.' }, { status: 400 });

  const access = await resolveModelAccess({ modelId: id, email: auth.email, userId: auth.userId });
  if (access.error)  return NextResponse.json({ error: access.error }, { status: access.status });
  if (!access.isAdmin) return NextResponse.json({ error: 'Only org admins can edit the model.' }, { status: 403 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  const patch = {};
  for (const k of PATCH_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body || {}, k)) patch[k] = body[k];
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: `Provide at least one of: ${PATCH_FIELDS.join(', ')}.` }, { status: 400 });
  }

  if (patch.name != null) patch.name = String(patch.name).trim().slice(0, 200);
  if (patch.description != null) patch.description = String(patch.description).slice(0, 4000);

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/operating_models?id=eq.${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: { ...getSupabaseWriteHeaders(sb.key), Prefer: 'return=minimal' },
        body: JSON.stringify(patch),
      },
    );
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      logger.warn('Model PATCH failed', { requestId: getRequestId(request), status: resp.status, body: txt.slice(0, 200) });
      return NextResponse.json({ error: 'Failed to update model.' }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    logger.error('Model PATCH error', { requestId: getRequestId(request), error: e.message });
    return NextResponse.json({ error: 'Failed to update model.' }, { status: 500 });
  }
}
