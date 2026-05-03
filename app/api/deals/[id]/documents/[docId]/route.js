/**
 * PATCH /api/deals/[id]/documents/[docId]
 *
 * Editor-only endpoint for updating the user-facing metadata fields on a
 * deal document — used by the dataroom UI to override the AI-suggested
 * category, retag, relabel, or change visibility. Doesn't touch storage,
 * chunks, or the processing lifecycle.
 *
 * Accepts: { category?, label?, source_party?, tags?, visibility? }
 * Returns: { document }
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase,
  isValidUUID, checkOrigin,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { requireDealEditor } from '@/lib/dealAuth';
import { validateVisibilityForDealType } from '@/lib/dealDocumentVisibility';
import { DOC_CATEGORIES } from '@/lib/ai/categorizeDoc';

export const maxDuration = 10;

export async function PATCH(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id: dealId, docId } = await params;
  if (!isValidUUID(dealId) || !isValidUUID(docId)) {
    return NextResponse.json({ error: 'Valid deal id and doc id required.' }, { status: 400 });
  }

  const editor = await requireDealEditor({ dealId, email: auth.email, userId: auth.userId });
  if (editor.error) return NextResponse.json(editor.error, { status: editor.status });

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'JSON body required.' }, { status: 400 }); }

  const patch = {};

  if (body.category !== undefined) {
    const cat = body.category === null ? null : String(body.category).trim();
    if (cat !== null && !DOC_CATEGORIES.includes(cat)) {
      return NextResponse.json({
        error: `Unknown category. Allowed: ${DOC_CATEGORIES.join(', ')}.`,
      }, { status: 400 });
    }
    patch.category = cat;
  }
  if (body.label !== undefined) {
    patch.label = body.label === null ? null : String(body.label).slice(0, 200);
  }
  if (body.source_party !== undefined) {
    patch.source_party = body.source_party === null ? null : String(body.source_party).slice(0, 50);
  }
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) {
      return NextResponse.json({ error: 'tags must be an array.' }, { status: 400 });
    }
    patch.tags = body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20);
  }
  if (body.visibility !== undefined) {
    const vis = String(body.visibility).trim();
    const visCheck = validateVisibilityForDealType(vis, editor.access?.deal?.type);
    if (!visCheck.ok) return NextResponse.json({ error: visCheck.error }, { status: 400 });
    patch.visibility = vis;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No editable fields provided.' }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  const resp = await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_documents?id=eq.${docId}&deal_id=eq.${dealId}&select=id,filename,mime_type,byte_size,status,processing_error,label,source_party,tags,visibility,category,page_count,uploaded_by_email,created_at,updated_at`,
    {
      method: 'PATCH',
      headers: { ...getSupabaseWriteHeaders(sb.key), Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    },
  );
  if (!resp.ok) {
    return NextResponse.json({ error: 'Failed to update document.' }, { status: 502 });
  }
  const [document] = await resp.json();
  if (!document) return NextResponse.json({ error: 'Document not found.' }, { status: 404 });

  return NextResponse.json({ document });
}
