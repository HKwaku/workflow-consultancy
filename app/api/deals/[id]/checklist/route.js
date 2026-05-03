/**
 * GET /api/deals/[id]/checklist
 *
 * Returns the per-deal-type expected-documents checklist with each item
 * matched against the documents already in the data room. The dataroom UI
 * uses this to render a "received vs missing" panel that guides users
 * through the diligence bundle.
 *
 * Open to anyone with deal access (visibility-filtered just like /documents).
 *
 * Returns: { dealType, checklist: [{ id, label, categories, matched: doc[] }] }
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, fetchWithTimeout, requireSupabase, isValidUUID,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveDealAccess } from '@/lib/dealAuth';
import { canSeeDocument } from '@/lib/dealDocumentVisibility';
import { matchChecklist, getChecklistForDealType } from '@/lib/dealDocumentChecklist';

export const maxDuration = 10;

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ error: 'Valid deal id required.' }, { status: 400 });
  }

  const access = await resolveDealAccess({ dealId: id, email: auth.email, userId: auth.userId });
  if (!access) return NextResponse.json({ error: 'Deal not found or access denied.' }, { status: 404 });

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  // Fetch the deal type alongside the documents so we can pick the right
  // template. Single round-trip — both selects are bounded.
  const [dealResp, docsResp] = await Promise.all([
    fetchWithTimeout(
      `${sb.url}/rest/v1/deals?id=eq.${id}&select=id,type`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    ),
    fetchWithTimeout(
      `${sb.url}/rest/v1/deal_documents?deal_id=eq.${id}&select=id,filename,label,category,visibility,source_party,status&order=created_at.desc`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    ),
  ]);
  const [deal] = dealResp.ok ? await dealResp.json() : [];
  const docs = docsResp.ok ? await docsResp.json() : [];
  const dealType = deal?.type || null;

  // Same visibility filter as /documents — participants only see what they
  // would see in the doc list, so the checklist matches their view.
  const isOwner = access.mode === 'owner';
  const isCollaborator = access.mode === 'collaborator';
  const viewerRole = access.participantRole || null;
  const visible = docs.filter((doc) =>
    canSeeDocument({ document: doc, viewerRole, isOwner, isCollaborator }),
  );

  const checklist = matchChecklist(visible, dealType);
  const total = checklist.length;
  const received = checklist.filter((c) => c.matched.length > 0).length;

  return NextResponse.json({
    dealType,
    checklist,
    summary: { total, received, missing: total - received },
    template: getChecklistForDealType(dealType).map((c) => c.id), // ids only, for cache busting
  });
}
