/**
 * GET /api/integrations/[provider]/oauth/callback
 *
 * OAuth 2.0 callback. Exchanges the code for tokens via the provider
 * adapter, persists encrypted via the set_org_integration_tokens RPC,
 * then redirects back to the org-admin Integrations tab.
 *
 * State is validated against the httpOnly cookie set by /oauth/start.
 */

import { NextResponse } from 'next/server';
import { getProvider } from '@/lib/connectors';
import { setIntegrationTokens } from '@/lib/connectors/tokens';
import { logger } from '@/lib/logger';

const STATE_COOKIE = 'connector_oauth_state';

export async function GET(request, { params }) {
  const { provider } = await params;
  const def = getProvider(provider);
  if (!def) return NextResponse.json({ error: 'Unknown provider.' }, { status: 404 });

  const code = request.nextUrl.searchParams.get('code');
  const stateParam = request.nextUrl.searchParams.get('state');
  const errorParam = request.nextUrl.searchParams.get('error');
  if (errorParam) {
    return NextResponse.redirect(new URL(`/org-admin?integration_error=${encodeURIComponent(errorParam)}`, request.url));
  }
  if (!code || !stateParam) {
    return NextResponse.json({ error: 'Missing code/state.' }, { status: 400 });
  }

  const stateCookie = request.cookies.get(STATE_COOKIE)?.value;
  if (!stateCookie || stateCookie !== stateParam) {
    return NextResponse.json({ error: 'State mismatch — possible CSRF or expired session.' }, { status: 400 });
  }

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(stateParam, 'base64url').toString('utf8'));
  } catch {
    return NextResponse.json({ error: 'Malformed state.' }, { status: 400 });
  }
  const { orgId, returnTo, actorEmail } = parsed;
  if (!orgId) return NextResponse.json({ error: 'state missing orgId.' }, { status: 400 });

  let tokens;
  try {
    tokens = await def.exchangeCode({ code });
  } catch (e) {
    logger.error('OAuth exchange failed', { provider, error: e.message });
    return NextResponse.redirect(new URL(`/org-admin?integration_error=${encodeURIComponent(e.message)}`, request.url));
  }

  const expiresAt = tokens.expires_in
    ? new Date(Date.now() + Number(tokens.expires_in) * 1000).toISOString()
    : null;

  const persist = await setIntegrationTokens({
    orgId,
    provider,
    accountEmail: tokens.account?.email || null,
    displayName: tokens.account?.displayName || null,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || null,
    tokenExpiresAt: expiresAt,
    scopes: tokens.scope ? String(tokens.scope).split(' ').filter(Boolean) : def.scopes,
    metadata: { account: tokens.account || null },
    actorEmail: actorEmail || null,
  });
  if (!persist.ok) {
    return NextResponse.redirect(new URL(`/org-admin?integration_error=${encodeURIComponent(persist.error)}`, request.url));
  }

  const dest = new URL(returnTo || '/org-admin', request.url);
  dest.searchParams.set('integration_connected', provider);
  const res = NextResponse.redirect(dest);
  res.cookies.delete(STATE_COOKIE);
  return res;
}
