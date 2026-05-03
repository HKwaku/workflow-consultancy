/**
 * /api/deals/[id]/connector-bindings
 *
 * GET     - list this deal's bindings (any deal viewer)
 * POST    - create a binding (editor) — body: { provider, source_ref, display_path?, source_party?, visibility? }
 * DELETE  - remove a binding (editor) — query: ?id=<uuid>
 * (also)  POST /sync — force a manual sync (handled in ./sync/route.js)
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase,
  isValidUUID, checkOrigin,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveDealAccess, requireDealEditor } from '@/lib/dealAuth';
import { getOrgIdForUser } from '@/lib/costGuard';

export const maxDuration = 15;

const SELECT_COLS =
  'id,deal_id,integration_id,source_ref,display_path,source_party,visibility,'
  + 'sync_status,last_sync_at,last_sync_error,next_sync_after,created_by_email,created_at,updated_at,'
  + 'org_integrations(provider,account_email,display_name,status)';

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Valid deal id required.' }, { status: 400 });

  const access = await resolveDealAccess({ dealId: id, email: auth.email, userId: auth.userId });
  if (!access) return NextResponse.json({ error: 'Deal not found or access denied.' }, { status: 404 });

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  const resp = await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_connector_bindings?deal_id=eq.${id}&select=${SELECT_COLS}&order=created_at.desc`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  if (!resp.ok) {
    // Table may not exist pre-migration (migration-deal-connectors.sql).
    // Return an empty list rather than 502 so the deal workspace UI keeps
    // rendering. Same pattern as /api/deals/[id]/analyses route.
    return NextResponse.json({ bindings: [] });
  }
  const bindings = await resp.json();
  return NextResponse.json({ bindings });
}

export async function POST(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Valid deal id required.' }, { status: 400 });

  const editor = await requireDealEditor({ dealId: id, email: auth.email, userId: auth.userId });
  if (editor.error) return NextResponse.json(editor.error, { status: editor.status });

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'JSON body required.' }, { status: 400 }); }

  const provider = String(body?.provider || '').trim();
  if (!provider) return NextResponse.json({ error: 'provider required.' }, { status: 400 });
  if (!body?.source_ref || typeof body.source_ref !== 'object') {
    return NextResponse.json({ error: 'source_ref object required.' }, { status: 400 });
  }

  // Resolve the active integration for the editor's org.
  const orgId = await getOrgIdForUser({ email: auth.email, userId: auth.userId });
  if (!orgId) return NextResponse.json({ error: 'No organisation context.' }, { status: 400 });

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  const intResp = await fetchWithTimeout(
    `${sb.url}/rest/v1/org_integrations?org_id=eq.${orgId}&provider=eq.${provider}&status=eq.active&select=id&limit=1`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  const [integration] = intResp.ok ? await intResp.json() : [];
  if (!integration) {
    return NextResponse.json({ error: `No active ${provider} integration for this org. Connect it under Org admin → Integrations.` }, { status: 400 });
  }

  const insert = {
    deal_id: id,
    integration_id: integration.id,
    source_ref: body.source_ref,
    display_path: body.display_path ? String(body.display_path).slice(0, 500) : null,
    source_party: body.source_party ? String(body.source_party).slice(0, 50) : null,
    visibility: body.visibility ? String(body.visibility).slice(0, 50) : 'all_editors',
    sync_status: 'active',
    next_sync_after: new Date().toISOString(), // run immediately
    created_by_email: auth.email,
  };

  const resp = await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_connector_bindings?select=${SELECT_COLS}`,
    {
      method: 'POST',
      headers: { ...getSupabaseWriteHeaders(sb.key), Prefer: 'return=representation' },
      body: JSON.stringify(insert),
    },
  );
  if (!resp.ok) return NextResponse.json({ error: 'Failed to create binding.' }, { status: 502 });
  const [binding] = await resp.json();

  // Best-effort: kick off an immediate sync via the Inngest event so the
  // user sees docs landing within seconds rather than waiting up to 15min.
  try {
    const { sendEvent } = await import('@/lib/inngest/client');
    await sendEvent({ name: 'connector-binding.sync-requested', data: { binding_id: binding.id } });
  } catch { /* swallow — cron will pick it up */ }

  return NextResponse.json({ binding }, { status: 201 });
}

export async function DELETE(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Valid deal id required.' }, { status: 400 });

  const editor = await requireDealEditor({ dealId: id, email: auth.email, userId: auth.userId });
  if (editor.error) return NextResponse.json(editor.error, { status: editor.status });

  const bindingId = request.nextUrl.searchParams.get('id');
  if (!bindingId || !isValidUUID(bindingId)) {
    return NextResponse.json({ error: 'id query param required.' }, { status: 400 });
  }

  const sb = requireSupabase();
  // Existing documents from this binding stay (FK is ON DELETE SET NULL).
  const resp = await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_connector_bindings?id=eq.${bindingId}&deal_id=eq.${id}`,
    { method: 'DELETE', headers: getSupabaseWriteHeaders(sb.key) },
  );
  if (!resp.ok) return NextResponse.json({ error: 'Failed to delete binding.' }, { status: 502 });
  return NextResponse.json({ ok: true });
}
