/**
 * GET /api/deals/[id]/documents/[docId]/preview?chunk_id=<uuid>&context=<n>
 *
 * Returns the chunk content for an evidence pointer plus N neighbouring
 * chunks (default 1 either side) for context. Open to any deal viewer so
 * the per-finding evidence drawer in the workspace works for participants
 * too — visibility is enforced per-document via canSeeDocument(). Editors
 * see everything, participants see only what their role is allowed.
 *
 * Also: GET /api/deals/[id]/documents/[docId]/preview?raw=1
 *   Returns a signed Supabase Storage URL pointing at the original bytes
 *   so the browser can render the source file (PDF in <iframe>, etc).
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase,
  isValidUUID,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveDealAccess } from '@/lib/dealAuth';
import { canSeeDocument } from '@/lib/dealDocumentVisibility';
import { logger } from '@/lib/logger';

const SIGNED_URL_TTL = 60 * 5; // 5 minutes

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id, docId } = await params;
  if (!isValidUUID(docId)) return NextResponse.json({ error: 'docId required.' }, { status: 400 });

  const access = await resolveDealAccess({ dealId: id, email: auth.email, userId: auth.userId });
  if (!access) return NextResponse.json({ error: 'Deal not found or access denied.' }, { status: 404 });

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  const sp = request.nextUrl.searchParams;
  const wantRaw = sp.get('raw') === '1';
  const chunkId = sp.get('chunk_id');
  const context = Math.max(0, Math.min(Number(sp.get('context')) || 1, 5));

  // Fetch the document row so we can verify it belongs to this deal and
  // (for raw mode) get the storage_path. Includes visibility/source_party
  // so canSeeDocument() can apply the per-role filter below.
  const docResp = await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_documents?id=eq.${encodeURIComponent(docId)}&deal_id=eq.${encodeURIComponent(id)}&select=id,filename,mime_type,byte_size,storage_path,page_count,status,visibility,source_party`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  if (!docResp.ok) return NextResponse.json({ error: 'Failed to load document.' }, { status: 502 });
  const [doc] = await docResp.json();
  if (!doc) return NextResponse.json({ error: 'Document not found.' }, { status: 404 });

  // Visibility check — return 404 (not 403) so participants don't learn
  // about docs they shouldn't see.
  const isOwner = access.mode === 'owner';
  const isCollaborator = access.mode === 'collaborator';
  const viewerRole = access.participantRole || null;
  if (!canSeeDocument({ document: doc, viewerRole, isOwner, isCollaborator })) {
    return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
  }

  // ── Raw bytes mode: signed storage URL ─────────────────────────
  if (wantRaw) {
    if (!doc.storage_path) return NextResponse.json({ error: 'Document has no storage path.' }, { status: 404 });
    const signResp = await fetchWithTimeout(
      `${sb.url}/storage/v1/object/sign/deal-documents/${doc.storage_path}`,
      {
        method: 'POST',
        headers: { ...getSupabaseWriteHeaders(sb.key), 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: SIGNED_URL_TTL }),
      },
    );
    if (!signResp.ok) {
      const txt = await signResp.text().catch(() => '');
      logger.warn('storage sign failed', { status: signResp.status, body: txt.slice(0, 200) });
      return NextResponse.json({ error: 'Failed to sign storage URL.' }, { status: 502 });
    }
    const { signedURL } = await signResp.json();
    // signedURL is a path; prefix with the supabase URL.
    const fullUrl = signedURL.startsWith('http')
      ? signedURL
      : `${sb.url}/storage/v1${signedURL.startsWith('/') ? '' : '/'}${signedURL}`;
    return NextResponse.json({
      url: fullUrl,
      filename: doc.filename,
      mime_type: doc.mime_type,
      byte_size: doc.byte_size,
      expires_in: SIGNED_URL_TTL,
    });
  }

  // ── Chunk-with-context mode ────────────────────────────────────
  if (!chunkId || !isValidUUID(chunkId)) {
    return NextResponse.json({ error: 'chunk_id (uuid) required (or pass raw=1).' }, { status: 400 });
  }

  const targetResp = await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_document_chunks?id=eq.${encodeURIComponent(chunkId)}&document_id=eq.${encodeURIComponent(docId)}&select=id,document_id,chunk_index,page_number,slide_number,sheet_name,cell_range,section_path,content,token_count`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  if (!targetResp.ok) return NextResponse.json({ error: 'Failed to load chunk.' }, { status: 502 });
  const [target] = await targetResp.json();
  if (!target) return NextResponse.json({ error: 'Chunk not found in this document.' }, { status: 404 });

  // Adjacent chunks (chunk_index between target.chunk_index - context and + context)
  const lo = Math.max(0, target.chunk_index - context);
  const hi = target.chunk_index + context;
  const neighboursResp = await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_document_chunks?document_id=eq.${encodeURIComponent(docId)}&chunk_index=gte.${lo}&chunk_index=lte.${hi}&select=id,document_id,chunk_index,page_number,slide_number,sheet_name,cell_range,section_path,content&order=chunk_index.asc`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  const neighbours = neighboursResp.ok ? await neighboursResp.json() : [target];

  // Defence-in-depth: every returned chunk MUST belong to the document we
  // already visibility-checked. The PostgREST filter `document_id=eq.${docId}`
  // already enforces this, but a regression that joins across documents
  // would silently leak — assert client-side too.
  const safeChunks = neighbours.filter((c) => c.document_id === doc.id);
  if (safeChunks.length === 0) {
    return NextResponse.json({ error: 'Chunk not found in this document.' }, { status: 404 });
  }
  // Strip document_id from the wire payload — clients never need it and
  // it's noise.
  const wireChunks = safeChunks.map(({ document_id, ...rest }) => rest);

  return NextResponse.json({
    document: {
      id: doc.id,
      filename: doc.filename,
      mime_type: doc.mime_type,
      page_count: doc.page_count,
    },
    target_chunk_id: target.id,
    chunks: wireChunks,
  });
}
