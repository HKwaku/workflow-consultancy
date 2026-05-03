/**
 * /api/deals/[id]/documents
 *
 * GET    - list documents for a deal (editor-only)
 * POST   - upload a document. Multipart/form-data: file + optional label/source_party/tags.
 *          Inserts a deal_documents row, uploads bytes to the deal-documents bucket,
 *          enqueues an Inngest event for chunking + embedding, returns the new row.
 *          The synchronous path is fast (insert + storage put + queue event); the
 *          worker handles parsing, chunking, embedding.
 */

import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase,
  checkOrigin, getRequestId,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { requireDealEditor, resolveDealAccess } from '@/lib/dealAuth';
import { logger } from '@/lib/logger';
import { sendEvent } from '@/lib/inngest/client';
import {
  validateVisibilityForDealType, canSeeDocument,
} from '@/lib/dealDocumentVisibility';

export const maxDuration = 60;

// All file formats are accepted into the data room — diligence regularly
// includes images, audio interviews, video walkthroughs, archives and other
// long-tail formats. Text-extractable types (pdf/docx/xlsx/pptx/csv/txt/md
// and plain text/json/xml) are chunked + embedded for search; everything
// else is `stored`-only and downloadable via signed URL. The MIME type is
// captured for routing downstream but never used to reject uploads.
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  // Open to anyone with deal access (owner / collaborator / participant) so
  // participants can see what's been shared with their role. Visibility
  // filtering happens below.
  const access = await resolveDealAccess({ dealId: id, email: auth.email, userId: auth.userId });
  if (!access) return NextResponse.json({ error: 'Deal not found or access denied.' }, { status: 404 });

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  const resp = await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_documents?deal_id=eq.${encodeURIComponent(id)}&select=id,filename,mime_type,byte_size,status,processing_error,label,source_party,tags,visibility,category,page_count,uploaded_by_email,created_at,updated_at&order=created_at.desc`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  if (!resp.ok) return NextResponse.json({ error: 'Failed to list documents.' }, { status: 502 });
  const rows = await resp.json();

  // Defence in depth: RLS would catch a leak, but the API uses the service-
  // role key, so we filter here too. (RLS only kicks in when callers use a
  // user-bound JWT against PostgREST.)
  const isOwner = access.mode === 'owner';
  const isCollaborator = access.mode === 'collaborator';
  const viewerRole = access.participantRole || null;
  const visible = rows.filter((doc) =>
    canSeeDocument({ document: doc, viewerRole, isOwner, isCollaborator }),
  );

  return NextResponse.json({ documents: visible });
}

export async function POST(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });
  }

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  const editor = await requireDealEditor({ dealId: id, email: auth.email, userId: auth.userId });
  if (editor.error) return NextResponse.json(editor.error, { status: editor.status });

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data.' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'file field is required.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB).` }, { status: 413 });
  }

  const label       = String(formData.get('label')        || '').slice(0, 200) || null;
  const sourceParty = String(formData.get('source_party') || '').slice(0, 50)  || null;
  const tagsRaw     = String(formData.get('tags')         || '').trim();
  const tags        = tagsRaw ? tagsRaw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20) : [];
  const visibility  = String(formData.get('visibility')   || 'all_editors').trim();

  // Validate visibility against deal type — refuses 'acquirer_only' on a
  // PE deal, etc. Bad visibility would silently make the doc invisible.
  const visCheck = validateVisibilityForDealType(visibility, editor.access?.deal?.type);
  if (!visCheck.ok) {
    return NextResponse.json({ error: visCheck.error }, { status: 400 });
  }

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const reqId = getRequestId(request);

  // Read bytes once — needed for both the hash check and the storage upload.
  const buf = Buffer.from(await file.arrayBuffer());
  const contentHash = crypto.createHash('sha256').update(buf).digest('hex');

  // Idempotency: if this exact content already exists for this deal, return
  // the existing row instead of creating a second one + triggering a second
  // Inngest run. Saves real money on the embedding pipeline. The unique
  // partial index on (deal_id, content_hash WHERE content_hash IS NOT NULL)
  // also enforces this at the DB layer.
  const dupResp = await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_documents?deal_id=eq.${encodeURIComponent(id)}&content_hash=eq.${contentHash}&select=id,filename,mime_type,byte_size,status,processing_error,label,source_party,tags,visibility,category,page_count,uploaded_by_email,created_at,updated_at&limit=1`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  if (dupResp.ok) {
    const existing = await dupResp.json();
    if (existing.length > 0) {
      logger.info('Document upload deduped via content_hash', { requestId: reqId, deal_id: id, document_id: existing[0].id });
      return NextResponse.json({ document: existing[0], deduped: true }, { status: 200 });
    }
  }

  // 1. Insert row to get an id, then derive storage path.
  const insertBody = {
    deal_id: id,
    filename: file.name || 'document',
    mime_type: file.type || null,
    byte_size: file.size,
    content_hash: contentHash,
    label, source_party: sourceParty, tags, visibility,
    uploaded_by_email: auth.email,
    status: 'pending',
  };
  const insertResp = await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_documents`,
    {
      method: 'POST',
      headers: { ...getSupabaseWriteHeaders(sb.key), Prefer: 'return=representation' },
      body: JSON.stringify(insertBody),
    },
  );
  if (!insertResp.ok) {
    const txt = await insertResp.text().catch(() => '');
    // 23505 = unique_violation — could happen if two concurrent uploads of
    // the same file race past our pre-check. Re-fetch the winner.
    if (insertResp.status === 409 || /duplicate key|23505/.test(txt)) {
      const raceResp = await fetchWithTimeout(
        `${sb.url}/rest/v1/deal_documents?deal_id=eq.${encodeURIComponent(id)}&content_hash=eq.${contentHash}&select=id,filename,mime_type,byte_size,status,visibility,uploaded_by_email,created_at&limit=1`,
        { method: 'GET', headers: getSupabaseHeaders(sb.key) },
      );
      const winner = raceResp.ok ? (await raceResp.json())[0] : null;
      if (winner) return NextResponse.json({ document: winner, deduped: true }, { status: 200 });
    }
    logger.error('deal_documents insert failed', { requestId: reqId, status: insertResp.status, body: txt.slice(0, 300) });
    return NextResponse.json({ error: 'Failed to create document row.' }, { status: 502 });
  }
  const [doc] = await insertResp.json();

  // 2. Upload file to Storage at deal-documents/{deal_id}/{doc_id}/{filename}
  const safeName = (file.name || 'document').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
  const storagePath = `${id}/${doc.id}/${safeName}`;
  const uploadResp = await fetchWithTimeout(
    `${sb.url}/storage/v1/object/deal-documents/${storagePath}`,
    {
      method: 'POST',
      headers: {
        ...getSupabaseHeaders(sb.key),
        'Content-Type': file.type || 'application/octet-stream',
        'x-upsert': 'true',
      },
      body: buf,
    },
    45000,
  );
  if (!uploadResp.ok) {
    const txt = await uploadResp.text().catch(() => '');
    logger.error('deal-documents storage upload failed', { requestId: reqId, status: uploadResp.status, body: txt.slice(0, 300) });
    // Mark row failed so the UI shows the error rather than a stuck pending row.
    await fetchWithTimeout(
      `${sb.url}/rest/v1/deal_documents?id=eq.${doc.id}`,
      {
        method: 'PATCH',
        headers: getSupabaseWriteHeaders(sb.key),
        body: JSON.stringify({ status: 'failed', processing_error: 'Upload to storage failed.' }),
      },
    );
    return NextResponse.json({ error: 'Failed to upload file.' }, { status: 502 });
  }

  // 3. Patch storage_path on the row.
  await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_documents?id=eq.${doc.id}`,
    {
      method: 'PATCH',
      headers: getSupabaseWriteHeaders(sb.key),
      body: JSON.stringify({ storage_path: storagePath }),
    },
  );

  // 4. Enqueue chunking + embedding to the worker. Best-effort - if Inngest
  // isn't configured, the row just sits at 'pending' until manually retriggered.
  try {
    await sendEvent({
      name: 'deal-document.uploaded',
      data: { deal_id: id, document_id: doc.id, storage_path: storagePath, mime_type: file.type, byte_size: file.size },
    });
  } catch (e) {
    logger.warn('Failed to enqueue deal-document event', { requestId: reqId, error: e.message });
  }

  return NextResponse.json({
    document: { ...doc, storage_path: storagePath },
  }, { status: 201 });
}

export async function DELETE(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  const editor = await requireDealEditor({ dealId: id, email: auth.email, userId: auth.userId });
  if (editor.error) return NextResponse.json(editor.error, { status: editor.status });

  const sp = request.nextUrl.searchParams;
  const docId = sp.get('document_id');
  if (!docId) return NextResponse.json({ error: 'document_id required.' }, { status: 400 });

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  // Look up storage_path before deletion so we can clean up the bytes.
  const docResp = await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_documents?id=eq.${docId}&deal_id=eq.${id}&select=storage_path`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  const [doc] = docResp.ok ? await docResp.json() : [];
  if (!doc) return NextResponse.json({ error: 'Document not found.' }, { status: 404 });

  // Storage delete is best-effort.
  if (doc.storage_path) {
    await fetchWithTimeout(
      `${sb.url}/storage/v1/object/deal-documents/${doc.storage_path}`,
      { method: 'DELETE', headers: getSupabaseHeaders(sb.key) },
    ).catch(() => {});
  }

  const delResp = await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_documents?id=eq.${docId}&deal_id=eq.${id}`,
    { method: 'DELETE', headers: getSupabaseWriteHeaders(sb.key) },
  );
  if (!delResp.ok) return NextResponse.json({ error: 'Failed to delete.' }, { status: 502 });
  return NextResponse.json({ ok: true });
}
