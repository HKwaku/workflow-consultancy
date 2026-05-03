/**
 * GET /api/deals/[id]/documents/[docId]/signed-url
 *
 * Any deal viewer (owner / collaborator / participant) can open a source
 * document via a short-lived signed Supabase Storage URL. Used by the chat
 * surface — the source/meta cards become clickable.
 *
 * Distinct from /preview?raw=1, which is editor-only and returns the same
 * shape: this route relaxes the access tier to any verified viewer because
 * the cards are exposed in chat, where participants legitimately work.
 *
 * Returns: { url, filename, mime_type, byte_size, expires_in }
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase,
  isValidUUID,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveDealAccess } from '@/lib/dealAuth';
import { logger } from '@/lib/logger';

const SIGNED_URL_TTL = 60 * 5; // 5 minutes

export const maxDuration = 10;

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id: dealId, docId } = await params;
  if (!isValidUUID(dealId) || !isValidUUID(docId)) {
    return NextResponse.json({ error: 'Valid deal id and doc id required.' }, { status: 400 });
  }

  const access = await resolveDealAccess({ dealId, email: auth.email, userId: auth.userId });
  if (!access) return NextResponse.json({ error: 'Access denied.' }, { status: 403 });

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  const docResp = await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_documents?id=eq.${encodeURIComponent(docId)}&deal_id=eq.${encodeURIComponent(dealId)}&select=id,filename,mime_type,byte_size,storage_path`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  if (!docResp.ok) return NextResponse.json({ error: 'Failed to load document.' }, { status: 502 });
  const [doc] = await docResp.json();
  if (!doc) return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
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
