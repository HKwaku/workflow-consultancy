/**
 * POST /api/deals/[id]/documents/[docId]/reprocess
 *
 * Resets the document to status='pending' (clearing any error) and re-emits
 * `deal-document.uploaded` to Inngest. Used to retry a failed upload, to
 * re-run after VOYAGE_API_KEY was added, or to refresh chunks after the
 * extractor / chunker is upgraded.
 *
 * Existing chunks are NOT deleted upfront — the worker is idempotent on
 * (document_id, chunk_index) but won't currently dedupe across runs. A
 * `wipe=1` query param explicitly clears chunks first for the upgrade case.
 *
 * Editor-only.
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase,
  checkOrigin, getRequestId, isValidUUID,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { requireDealEditor } from '@/lib/dealAuth';
import { sendEvent } from '@/lib/inngest/client';
import { logger } from '@/lib/logger';
import { recordTransition } from '@/lib/changes/repo';

export async function POST(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id, docId } = await params;
  if (!isValidUUID(docId)) return NextResponse.json({ error: 'docId required.' }, { status: 400 });

  // Optional body — chat-staged proposals pass `change_id` so we can flip
  // the staged change to `applied` after a successful reprocess. Body is
  // optional because the workspace's manual Retry button posts no body.
  let bodyChangeId = null;
  try {
    const txt = await request.text();
    if (txt) bodyChangeId = JSON.parse(txt)?.change_id || null;
  } catch { /* body is optional */ }

  const editor = await requireDealEditor({ dealId: id, email: auth.email, userId: auth.userId });
  if (editor.error) return NextResponse.json(editor.error, { status: editor.status });

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const reqId = getRequestId(request);

  // Verify the document belongs to this deal and has a storage_path to send.
  const docResp = await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_documents?id=eq.${encodeURIComponent(docId)}&deal_id=eq.${encodeURIComponent(id)}&select=id,storage_path,mime_type,byte_size,status`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  if (!docResp.ok) return NextResponse.json({ error: 'Failed to load document.' }, { status: 502 });
  const [doc] = await docResp.json();
  if (!doc) return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
  if (!doc.storage_path) {
    return NextResponse.json({ error: 'Document has no stored bytes — re-upload required.' }, { status: 409 });
  }

  // Optional wipe of existing chunks before re-running.
  const wipe = request.nextUrl.searchParams.get('wipe') === '1';
  if (wipe) {
    const delResp = await fetchWithTimeout(
      `${sb.url}/rest/v1/deal_document_chunks?document_id=eq.${docId}`,
      { method: 'DELETE', headers: getSupabaseWriteHeaders(sb.key) },
    );
    if (!delResp.ok) {
      logger.warn('Failed to wipe chunks before reprocess', { requestId: reqId, status: delResp.status });
    }
  }

  // Reset status + clear error.
  const patchResp = await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_documents?id=eq.${docId}`,
    {
      method: 'PATCH',
      headers: getSupabaseWriteHeaders(sb.key),
      body: JSON.stringify({ status: 'pending', processing_error: null }),
    },
  );
  if (!patchResp.ok) {
    return NextResponse.json({ error: 'Failed to reset document status.' }, { status: 502 });
  }

  // Re-enqueue.
  let queueResult;
  try {
    queueResult = await sendEvent({
      name: 'deal-document.uploaded',
      data: {
        deal_id: id,
        document_id: docId,
        storage_path: doc.storage_path,
        mime_type: doc.mime_type,
        byte_size: doc.byte_size,
      },
    });
  } catch (e) {
    logger.error('Failed to re-enqueue deal-document.uploaded', { requestId: reqId, error: e.message });
    return NextResponse.json({ error: 'Failed to enqueue worker. Check INNGEST_EVENT_KEY.' }, { status: 502 });
  }

  // Doc state has already mutated; flip the staged change to applied. The
  // proposal has landed in user-visible terms even if the worker won't pick
  // it up (Inngest unconfigured).
  const changeId = bodyChangeId || request.nextUrl.searchParams.get('change_id');
  if (typeof changeId === 'string' && changeId) {
    recordTransition({ id: changeId, state: 'applied', actor_email: auth.email })
      .catch((e) => logger.warn('Change transition (reprocess) failed', { requestId: reqId, message: e.message }));
  }

  if (queueResult?.skipped) {
    return NextResponse.json({
      ok: true,
      enqueued: false,
      reason: queueResult.reason,
      hint: 'Inngest is not configured. Document is reset to pending; configure INNGEST_EVENT_KEY (or run inngest-cli dev) to actually re-process.',
    });
  }

  return NextResponse.json({ ok: true, enqueued: true });
}
