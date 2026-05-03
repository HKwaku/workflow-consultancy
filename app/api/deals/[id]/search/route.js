/**
 * GET /api/deals/[id]/search?q=...&limit=...&party=...
 *
 * In-workspace document search across the deal's data room. Wraps the
 * `search_deal_chunks` RPC (RRF fusion of semantic + keyword) and applies
 * per-document visibility for the calling user.
 *
 * Open to any deal viewer. The visibility filter is applied AFTER the RPC
 * so we don't expose chunks the user shouldn't see — the service-role key
 * inside the RPC bypasses RLS.
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, fetchWithTimeout, requireSupabase, isValidUUID,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveDealAccess } from '@/lib/dealAuth';
import { canSeeDocument } from '@/lib/dealDocumentVisibility';
import { searchDealChunks } from '@/lib/deal-analysis/chunkSearch';

export const maxDuration = 20;

const SNIPPET_LEN = 280;

function snippet(content, q) {
  if (!content) return '';
  const text = String(content);
  if (!q) return text.slice(0, SNIPPET_LEN);
  const lower = text.toLowerCase();
  const idx = lower.indexOf(q.toLowerCase());
  if (idx < 0) return text.slice(0, SNIPPET_LEN);
  const start = Math.max(0, idx - 80);
  return (start > 0 ? '…' : '') + text.slice(start, start + SNIPPET_LEN);
}

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Valid deal id required.' }, { status: 400 });

  const access = await resolveDealAccess({ dealId: id, email: auth.email, userId: auth.userId });
  if (!access) return NextResponse.json({ error: 'Deal not found or access denied.' }, { status: 404 });

  const sp = request.nextUrl.searchParams;
  const q = (sp.get('q') || '').trim();
  if (!q) return NextResponse.json({ error: 'q (query) required.' }, { status: 400 });
  const limit = Math.max(1, Math.min(Number(sp.get('limit') || 20), 50));
  const party = sp.get('party') || null;

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  const chunks = await searchDealChunks({
    supabaseUrl: sb.url, supabaseKey: sb.key, dealId: id,
    queryText: q, limit, party,
  });

  if (!Array.isArray(chunks) || chunks.length === 0) {
    return NextResponse.json({ q, results: [] });
  }

  // Visibility filter — load each unique document's visibility/source_party
  // metadata in one round-trip, then drop chunks whose parent document the
  // viewer can't see.
  const docIds = Array.from(new Set(chunks.map((c) => c.document_id).filter(Boolean)));
  const docMetaById = new Map();
  if (docIds.length > 0) {
    const idCsv = docIds.map(encodeURIComponent).join(',');
    const docResp = await fetchWithTimeout(
      `${sb.url}/rest/v1/deal_documents?id=in.(${idCsv})&select=id,filename,visibility,source_party,category,status`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    );
    const docs = docResp.ok ? await docResp.json() : [];
    for (const d of docs) docMetaById.set(d.id, d);
  }

  const isOwner = access.mode === 'owner';
  const isCollaborator = access.mode === 'collaborator';
  const viewerRole = access.participantRole || null;

  const results = chunks
    .filter((c) => {
      const doc = docMetaById.get(c.document_id);
      if (!doc) return false;
      return canSeeDocument({ document: doc, viewerRole, isOwner, isCollaborator });
    })
    .map((c) => {
      const doc = docMetaById.get(c.document_id) || {};
      return {
        chunk_id: c.chunk_id,
        document_id: c.document_id,
        filename: c.filename || doc.filename,
        category: doc.category || null,
        source_party: doc.source_party || null,
        page_number: c.page_number, slide_number: c.slide_number,
        sheet_name: c.sheet_name, cell_range: c.cell_range, section_path: c.section_path,
        snippet: snippet(c.content, q),
        scores: {
          fused: c.fused_score, semantic: c.semantic_score, keyword: c.keyword_score,
        },
      };
    });

  return NextResponse.json({ q, results });
}
