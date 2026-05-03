/**
 * /api/organizations/[orgId]/api-keys
 *
 * Admin-only management of customer-managed API keys (BYO Anthropic / Voyage / OpenAI).
 *
 * GET     - list active + revoked keys for this org (metadata only — never the raw key)
 * POST    - set or rotate a key. Body: { vendor, key }. Validates with a tiny
 *           live test call before storing. Audit row written via the RPC.
 * DELETE  - revoke a key. Query: ?vendor=anthropic. Audit row written.
 */

import { NextResponse } from 'next/server';
import { checkOrigin, getRequestId } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireOrgAdminOrPlatformAdmin } from '@/lib/orgAdmin';
import {
  setCustomerKey, revokeCustomerKey, listKeysForOrg, SUPPORTED_VENDORS,
} from '@/lib/customerKey';
import { logger } from '@/lib/logger';

export const maxDuration = 30;

async function authoriseOrgAdmin(request, orgId) {
  const auth = await requireAuth(request);
  if (auth.error) return { error: NextResponse.json(auth.error.body, { status: auth.error.status }) };
  const sb = getSupabaseAdmin();
  if (!sb) return { error: NextResponse.json({ error: 'Storage not configured.' }, { status: 503 }) };
  const gate = await requireOrgAdminOrPlatformAdmin(sb, orgId, auth.userId, auth.email);
  if (gate.error) return { error: NextResponse.json({ error: gate.error }, { status: gate.status }) };
  return { auth };
}

export async function GET(request, { params }) {
  const { orgId } = await params;
  const gate = await authoriseOrgAdmin(request, orgId);
  if (gate.error) return gate.error;

  const keys = await listKeysForOrg({ orgId });
  return NextResponse.json({ keys });
}

export async function POST(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });
  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const { orgId } = await params;
  const gate = await authoriseOrgAdmin(request, orgId);
  if (gate.error) return gate.error;

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  const vendor = String(body?.vendor || '').toLowerCase();
  const rawKey = typeof body?.key === 'string' ? body.key.trim() : '';

  if (!SUPPORTED_VENDORS.includes(vendor)) {
    return NextResponse.json({ error: `Unsupported vendor. Supported: ${SUPPORTED_VENDORS.join(', ')}.` }, { status: 400 });
  }
  if (!rawKey) return NextResponse.json({ error: 'key is required.' }, { status: 400 });

  const reqId = getRequestId(request);
  const result = await setCustomerKey({
    orgId, vendor, rawKey,
    actorEmail: gate.auth.email, actorUserId: gate.auth.userId, requestId: reqId,
  });
  if (!result.ok) {
    logger.warn('Customer key set failed', { orgId, vendor, error: result.error });
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    fingerprint: result.fingerprint,
    keyId: result.keyId,
  }, { status: 201 });
}

export async function DELETE(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const { orgId } = await params;
  const gate = await authoriseOrgAdmin(request, orgId);
  if (gate.error) return gate.error;

  const sp = request.nextUrl.searchParams;
  const vendor = String(sp.get('vendor') || '').toLowerCase();
  if (!SUPPORTED_VENDORS.includes(vendor)) {
    return NextResponse.json({ error: 'vendor query param required.' }, { status: 400 });
  }

  const reqId = getRequestId(request);
  const result = await revokeCustomerKey({
    orgId, vendor,
    actorEmail: gate.auth.email, actorUserId: gate.auth.userId, requestId: reqId,
  });
  if (!result.ok) return NextResponse.json({ error: result.error || 'Revoke failed.' }, { status: 400 });
  return NextResponse.json({ ok: true });
}
