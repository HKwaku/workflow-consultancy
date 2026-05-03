/**
 * GET    /api/integrations?orgId=...      — list this org's integrations + the catalogue of available providers
 * DELETE /api/integrations?orgId=...&provider=... — revoke an integration (org-admin only)
 *
 * Tokens are never returned to the client; only metadata.
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase, checkOrigin,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { requireOrgAdminOrPlatformAdmin } from '@/lib/orgAdmin';
import { listProviders } from '@/lib/connectors';
import { invalidateTokenCache } from '@/lib/connectors/tokens';

export const maxDuration = 15;

const SELECT_COLS = 'id,provider,status,display_name,account_email,scopes,metadata,last_sync_at,last_sync_error,created_by_email,created_at,updated_at';

async function authoriseOrgAdmin(request, orgId) {
  const auth = await requireAuth(request);
  if (auth.error) return { error: NextResponse.json(auth.error.body, { status: auth.error.status }) };
  const sb = getSupabaseAdmin();
  if (!sb) return { error: NextResponse.json({ error: 'Storage not configured.' }, { status: 503 }) };
  const gate = await requireOrgAdminOrPlatformAdmin(sb, orgId, auth.userId, auth.email);
  if (gate.error) return { error: NextResponse.json({ error: gate.error }, { status: gate.status }) };
  return { auth };
}

export async function GET(request) {
  const orgId = request.nextUrl.searchParams.get('orgId');
  if (!orgId) return NextResponse.json({ error: 'orgId required.' }, { status: 400 });
  const gate = await authoriseOrgAdmin(request, orgId);
  if (gate.error) return gate.error;

  const sb = requireSupabase();
  const resp = await fetchWithTimeout(
    `${sb.url}/rest/v1/org_integrations?org_id=eq.${orgId}&select=${SELECT_COLS}&order=created_at.desc`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  const integrations = resp.ok ? await resp.json() : [];
  return NextResponse.json({
    integrations,
    catalogue: listProviders(),
  });
}

export async function DELETE(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const orgId = request.nextUrl.searchParams.get('orgId');
  const provider = request.nextUrl.searchParams.get('provider');
  if (!orgId || !provider) return NextResponse.json({ error: 'orgId and provider required.' }, { status: 400 });

  const gate = await authoriseOrgAdmin(request, orgId);
  if (gate.error) return gate.error;

  const sb = requireSupabase();
  // Look up the integration so we can clear the cache after.
  const cur = await fetchWithTimeout(
    `${sb.url}/rest/v1/org_integrations?org_id=eq.${orgId}&provider=eq.${provider}&select=id`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  const [row] = cur.ok ? await cur.json() : [];

  // Soft-revoke: flip status, clear tokens (set NULL via PATCH).
  const resp = await fetchWithTimeout(
    `${sb.url}/rest/v1/org_integrations?org_id=eq.${orgId}&provider=eq.${provider}`,
    {
      method: 'PATCH',
      headers: getSupabaseWriteHeaders(sb.key),
      body: JSON.stringify({
        status: 'revoked',
        access_token_enc: null,
        refresh_token_enc: null,
        updated_at: new Date().toISOString(),
      }),
    },
  );
  if (!resp.ok) return NextResponse.json({ error: 'Failed to revoke.' }, { status: 502 });
  if (row?.id) invalidateTokenCache(row.id);
  return NextResponse.json({ ok: true });
}
