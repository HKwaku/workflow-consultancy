/**
 * POST /api/deals/[id]/connector-bindings/[bindingId]/sync
 *
 * Force an immediate sync for a single binding by emitting the Inngest
 * event the sync worker subscribes to. Editor-only. No body.
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, fetchWithTimeout, requireSupabase, isValidUUID, checkOrigin,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { requireDealEditor } from '@/lib/dealAuth';
import { sendEvent } from '@/lib/inngest/client';

export const maxDuration = 10;

export async function POST(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id, bindingId } = await params;
  if (!isValidUUID(id) || !isValidUUID(bindingId)) {
    return NextResponse.json({ error: 'Valid deal id + binding id required.' }, { status: 400 });
  }

  const editor = await requireDealEditor({ dealId: id, email: auth.email, userId: auth.userId });
  if (editor.error) return NextResponse.json(editor.error, { status: editor.status });

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  // Verify the binding belongs to this deal so a malicious caller can't
  // sync arbitrary bindings by id.
  const cur = await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_connector_bindings?id=eq.${bindingId}&deal_id=eq.${id}&select=id`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  const [row] = cur.ok ? await cur.json() : [];
  if (!row) return NextResponse.json({ error: 'Binding not found.' }, { status: 404 });

  try {
    const result = await sendEvent({ name: 'connector-binding.sync-requested', data: { binding_id: bindingId } });
    return NextResponse.json({ ok: true, enqueued: !result?.skipped });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Failed to enqueue sync.' }, { status: 502 });
  }
}
