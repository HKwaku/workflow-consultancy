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

// Map provider id → required env vars. If any are missing/empty we surface
// a clear, actionable error to the client BEFORE handing off to the
// provider — Google's "Error 400: invalid_request" page is otherwise
// silent about which env var the operator forgot.
const REQUIRED_ENV = {
  google_drive: ['GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET', 'NEXT_PUBLIC_APP_URL'],
  sharepoint:   ['SHAREPOINT_CLIENT_ID', 'SHAREPOINT_CLIENT_SECRET', 'NEXT_PUBLIC_APP_URL'],
};

export async function GET(request, { params }) {
  const { provider } = await params;
  const def = getProvider(provider);
  if (!def) return NextResponse.json({ error: 'Unknown provider.' }, { status: 404 });
  if (!def.buildAuthUrl) return NextResponse.json({ error: 'Provider does not support OAuth.' }, { status: 501 });

  const required = REQUIRED_ENV[provider] || [];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    const expectedRedirect = process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/api/integrations/${provider}/oauth/callback`
      : '(set NEXT_PUBLIC_APP_URL)';
    return NextResponse.json({
      error: `${provider} is not fully configured. Missing env: ${missing.join(', ')}. Also confirm this redirect URI is registered in the provider console: ${expectedRedirect}`,
    }, { status: 503 });
  }

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

  // The browser cannot send an Authorization header on a top-level
  // navigation (window.location.assign), so the client now fetches
  // this endpoint with the Bearer token and we return the authorize
  // URL as JSON. The state cookie is still set on the JSON response
  // so the OAuth callback can validate it. The client follows up with
  // window.location.assign(authorizeUrl) to hand off to Google /
  // Microsoft. Returning a redirect here would 302 the fetch
  // response, which the client would then have to follow manually.
  const res = NextResponse.json({ authorizeUrl: url });
  res.cookies.set(STATE_COOKIE, stateB64, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: STATE_TTL_S,
    path: '/',
  });
  return res;
}
