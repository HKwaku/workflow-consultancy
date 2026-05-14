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
import { getSupabaseHeaders, fetchWithTimeout, requireSupabase } from '@/lib/api-helpers';
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
    return NextResponse.json({ models });
  } catch (e) {
    logger.error('GET /api/me/operating-models failed', { error: e.message });
    return NextResponse.json({ models: [] });
  }
}
