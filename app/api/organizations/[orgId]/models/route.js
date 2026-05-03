/**
 * /api/organizations/[orgId]/models
 *
 * Admin-only management of the per-org model allowlist + default.
 *
 * GET   - returns the full catalogue marked with `allowed` + `isDefault` flags.
 * PATCH - body: { allowed: string[]|null, default: string|null }.
 *         Validates against the catalogue; refuses unknown ids.
 */

import { NextResponse } from 'next/server';
import { checkOrigin, getRequestId } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireOrgAdminOrPlatformAdmin } from '@/lib/orgAdmin';
import { getOrgModelView, setOrgAllowedModels } from '@/lib/orgModels';
import { resolveActiveKey } from '@/lib/customerKey';
import { logger } from '@/lib/logger';

export const maxDuration = 15;

async function gate(request, orgId) {
  const auth = await requireAuth(request);
  if (auth.error) return { error: NextResponse.json(auth.error.body, { status: auth.error.status }) };
  const sb = getSupabaseAdmin();
  if (!sb) return { error: NextResponse.json({ error: 'Storage not configured.' }, { status: 503 }) };
  const g = await requireOrgAdminOrPlatformAdmin(sb, orgId, auth.userId, auth.email);
  if (g.error) return { error: NextResponse.json({ error: g.error }, { status: g.status }) };
  return { auth };
}

export async function GET(request, { params }) {
  const { orgId } = await params;
  const g = await gate(request, orgId);
  if (g.error) return g.error;

  // Resolution depends on whether the org has a customer key — that decides
  // whether they can see the full catalogue or just the platform allowlist.
  const k = await resolveActiveKey({ orgId, vendor: 'anthropic' });
  const view = await getOrgModelView({ orgId, hasCustomerKey: k.source === 'customer' });
  return NextResponse.json(view);
}

export async function PATCH(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const { orgId } = await params;
  const g = await gate(request, orgId);
  if (g.error) return g.error;

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  const allowed = Array.isArray(body?.allowed) ? body.allowed : (body?.allowed === null ? null : undefined);
  const defaultModel = typeof body?.default === 'string' ? body.default : (body?.default === null ? null : undefined);

  if (allowed === undefined && defaultModel === undefined) {
    return NextResponse.json({ error: 'Provide `allowed` and/or `default`.' }, { status: 400 });
  }

  const result = await setOrgAllowedModels({
    orgId,
    allowed: allowed === undefined ? undefined : allowed,
    defaultModel: defaultModel === undefined ? undefined : defaultModel,
  });
  if (!result.ok) {
    logger.warn('setOrgAllowedModels rejected', { orgId, error: result.error, requestId: getRequestId(request) });
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // Return the freshly-resolved view so the UI doesn't need a second round-trip.
  const k = await resolveActiveKey({ orgId, vendor: 'anthropic' });
  const view = await getOrgModelView({ orgId, hasCustomerKey: k.source === 'customer' });
  return NextResponse.json(view);
}
