/**
 * GET /api/integrations/[provider]/oauth/start
 *
 * Starts the OAuth flow for an org admin connecting an external document
 * source. Redirects to the provider's authorize endpoint with a signed
 * `state` cookie carrying { orgId, nonce, returnTo } so the callback can
 * (a) tie the resulting tokens to the right org, (b) reject CSRF.
 *
 * Org-admin only.
 */

import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireAuth } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireOrgAdminOrPlatformAdmin } from '@/lib/orgAdmin';
import { getProvider } from '@/lib/connectors';

const STATE_COOKIE = 'connector_oauth_state';
const STATE_TTL_S = 600;

export async function GET(request, { params }) {
  const { provider } = await params;
  const def = getProvider(provider);
  if (!def) return NextResponse.json({ error: 'Unknown provider.' }, { status: 404 });
  if (!def.buildAuthUrl) return NextResponse.json({ error: 'Provider does not support OAuth.' }, { status: 501 });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const orgId = request.nextUrl.searchParams.get('orgId');
  if (!orgId) return NextResponse.json({ error: 'orgId query param required.' }, { status: 400 });

  const sb = getSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const gate = await requireOrgAdminOrPlatformAdmin(sb, orgId, auth.userId, auth.email);
  if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const nonce = crypto.randomBytes(16).toString('hex');
  const returnTo = request.nextUrl.searchParams.get('returnTo') || '/portal/org-admin';
  const statePayload = JSON.stringify({ orgId, nonce, returnTo, actorEmail: auth.email });
  const stateB64 = Buffer.from(statePayload).toString('base64url');

  const url = def.buildAuthUrl({ state: stateB64 });

  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, stateB64, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: STATE_TTL_S,
    path: '/',
  });
  return res;
}
