/**
 * GET /api/me/operating-models
 *
 * Returns every operating model the calling user can see (every model
 * under their organization). Used by the workspace's Standard scope
 * picker so the user can switch between operating models the same way
 * they switch between deals.
 *
 * Returns:
 *   { models: [{ id, name, kind, status, isDefault }] }
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSupabaseHeaders, fetchWithTimeout, requireSupabase, checkOrigin } from '@/lib/api-helpers';
import { resolveDefaultModelForUser } from '@/lib/operatingModel/auth';
import { createOperatingModel, setMemberPreferredModel, listOrgModels } from '@/lib/operatingModel/repo';
import { logger } from '@/lib/logger';

export const maxDuration = 10;

export async function GET(request) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ models: [] });
  const headers = getSupabaseHeaders(sb.key);

  try {
    // Resolve org from organization_members (same approach as
    // resolveDefaultModelForUser). Then fetch every model under that
    // org. One round-trip each so failures degrade gracefully.
    const filters = [];
    if (auth.userId) filters.push(`user_id.eq.${encodeURIComponent(auth.userId)}`);
    if (auth.email)  filters.push(`email.eq.${encodeURIComponent(auth.email.toLowerCase())}`);
    if (!filters.length) return NextResponse.json({ models: [] });

    const memResp = await fetchWithTimeout(
      `${sb.url}/rest/v1/organization_members?or=(${filters.join(',')})` +
        `&select=organization:organization_id(id,default_operating_model_id)&limit=5`,
      { method: 'GET', headers },
    );
    if (!memResp.ok) return NextResponse.json({ models: [] });
    const memRows = await memResp.json();
    const orgIds = [...new Set(memRows.map((r) => r.organization?.id).filter(Boolean))];
    const defaultByOrg = new Map();
    for (const r of memRows) {
      if (r.organization?.id) defaultByOrg.set(r.organization.id, r.organization.default_operating_model_id || null);
    }
    if (!orgIds.length) return NextResponse.json({ models: [] });

    const modelsResp = await fetchWithTimeout(
      `${sb.url}/rest/v1/operating_models?organization_id=in.(${orgIds.map(encodeURIComponent).join(',')})` +
        `&select=id,organization_id,name,kind,status,description,created_at,updated_at` +
        `&order=name.asc&limit=200`,
      { method: 'GET', headers },
    );
    if (!modelsResp.ok) return NextResponse.json({ models: [] });
    const rows = await modelsResp.json();
    const models = rows.map((m) => ({
      id: m.id,
      organizationId: m.organization_id,
      name: m.name,
      kind: m.kind,
      status: m.status,
      description: m.description || null,
      isDefault: defaultByOrg.get(m.organization_id) === m.id,
      createdAt: m.created_at,
      updatedAt: m.updated_at,
    }));
    // Which model is *active* for this member (preferred → else org
    // default). Resolved separately so the switcher can mark it.
    const r = await resolveDefaultModelForUser({ email: auth.email, userId: auth.userId });
    return NextResponse.json({
      models,
      activeModelId: r.modelId || null,
      defaultModelId: r.defaultModelId || null,
      organizationId: r.organizationId || null,
      isAdmin: !!r.isAdmin,
    });
  } catch (e) {
    logger.error('GET /api/me/operating-models failed', { error: e.message });
    return NextResponse.json({ models: [] });
  }
}

export async function POST(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  const name = String(body?.name || '').trim();
  if (!name) return NextResponse.json({ error: 'name is required.' }, { status: 400 });
  if (name.length > 200) return NextResponse.json({ error: 'name must be 200 characters or fewer.' }, { status: 400 });

  const r = await resolveDefaultModelForUser({ email: auth.email, userId: auth.userId });
  if (!r.organizationId) return NextResponse.json({ error: 'You are not a member of an organisation.' }, { status: 403 });

  const modelId = await createOperatingModel({
    organization_id: r.organizationId, name, created_by_email: auth.email || null,
  });
  if (!modelId) return NextResponse.json({ error: 'Failed to create the model.' }, { status: 502 });

  // The new model becomes the creator's active model immediately.
  await setMemberPreferredModel({
    organizationId: r.organizationId, email: auth.email, userId: auth.userId, modelId,
  });
  return NextResponse.json({ model: { id: modelId, name }, activeModelId: modelId });
}

export async function PUT(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  const modelId = body?.modelId ? String(body.modelId) : null; // null = reset to org default

  const r = await resolveDefaultModelForUser({ email: auth.email, userId: auth.userId });
  if (!r.organizationId) return NextResponse.json({ error: 'You are not a member of an organisation.' }, { status: 403 });

  if (modelId) {
    // Never let a member point resolution at another org's model.
    const models = await listOrgModels(r.organizationId);
    if (!models.some((m) => m.id === modelId)) {
      return NextResponse.json({ error: 'That model is not in your organisation.' }, { status: 400 });
    }
  }
  const res = await setMemberPreferredModel({
    organizationId: r.organizationId, email: auth.email, userId: auth.userId, modelId,
  });
  if (!res.ok) return NextResponse.json({ error: 'Failed to switch model.' }, { status: 502 });
  return NextResponse.json({ ok: true, activeModelId: modelId || r.defaultModelId || null });
}
