/**
 * GET /api/integrations/[provider]/folders?orgId=...&kind=...&...
 *
 * Folder/library picker — proxies the provider's pickFolder() so the
 * org-admin or workspace UI can browse without holding the token.
 *
 * Query: provider-specific. SharePoint: kind=sites|drives|items, plus
 * site_id/drive_id/item_id. Drive: kind=folders, parent_id=<id|root>.
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getProvider } from '@/lib/connectors';
import { resolveActiveToken } from '@/lib/connectors/tokens';
import { getOrgIdForUser } from '@/lib/costGuard';

export const maxDuration = 15;

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { provider } = await params;
  const def = getProvider(provider);
  if (!def?.pickFolder) return NextResponse.json({ error: 'Provider does not support folder picking.' }, { status: 501 });

  // Either the request supplies an orgId (admin path) or we resolve from the user.
  let orgId = request.nextUrl.searchParams.get('orgId');
  if (!orgId) orgId = await getOrgIdForUser({ email: auth.email, userId: auth.userId });
  if (!orgId) return NextResponse.json({ error: 'No organisation context.' }, { status: 400 });

  const tok = await resolveActiveToken({ orgId, provider });
  if (!tok) return NextResponse.json({ error: `No active ${provider} integration.` }, { status: 400 });

  // Build the query by passing through everything except orgId.
  const query = {};
  request.nextUrl.searchParams.forEach((v, k) => { if (k !== 'orgId') query[k] = v; });

  try {
    const items = await def.pickFolder({ accessToken: tok.accessToken, query });
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Picker failed.' }, { status: 502 });
  }
}
