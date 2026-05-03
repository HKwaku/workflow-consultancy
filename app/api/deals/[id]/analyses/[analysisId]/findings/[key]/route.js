/**
 * /api/deals/[id]/analyses/[analysisId]/findings/[key]
 *
 * GET   - read a single finding row (any deal viewer)
 * PATCH - editor-only mutation of tags + stale clearance.
 *
 * Tags vocabulary lives in `lib/deal-analysis/findingTags.js` and is
 * advisory only — we don't constrain at the DB layer because diligence
 * teams will want to add their own buckets. The PATCH endpoint validates
 * against the recommended set but accepts arbitrary strings.
 *
 * Clearing stale: editors can set stale=false explicitly when they've
 * re-verified the finding against the new doc version. Re-flipping to
 * true is only ever done by the worker (see lib/deal-analysis/staleness).
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase,
  isValidUUID, checkOrigin,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveDealAccess, requireDealEditor } from '@/lib/dealAuth';
import { RECOMMENDED_FINDING_TAGS } from '@/lib/deal-analysis/findingTags';

export const maxDuration = 10;

const SELECT_COLS = 'finding_key,section,title,body,severity,confidence,category,recommendations,tags,stale,stale_reason,stale_at,created_at,updated_at';

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id, analysisId, key } = await params;
  if (!isValidUUID(id) || !isValidUUID(analysisId)) {
    return NextResponse.json({ error: 'Valid deal id + analysis id required.' }, { status: 400 });
  }

  const access = await resolveDealAccess({ dealId: id, email: auth.email, userId: auth.userId });
  if (!access) return NextResponse.json({ error: 'Deal not found or access denied.' }, { status: 404 });

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  const resp = await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_findings?analysis_id=eq.${analysisId}&finding_key=eq.${encodeURIComponent(key)}&select=${SELECT_COLS}&limit=1`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  if (!resp.ok) return NextResponse.json({ error: 'Failed to load finding.' }, { status: 502 });
  const [finding] = await resp.json();
  if (!finding) return NextResponse.json({ error: 'Finding not found.' }, { status: 404 });
  return NextResponse.json({ finding });
}

export async function PATCH(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id, analysisId, key } = await params;
  if (!isValidUUID(id) || !isValidUUID(analysisId)) {
    return NextResponse.json({ error: 'Valid deal id + analysis id required.' }, { status: 400 });
  }

  const editor = await requireDealEditor({ dealId: id, email: auth.email, userId: auth.userId });
  if (editor.error) return NextResponse.json(editor.error, { status: editor.status });

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'JSON body required.' }, { status: 400 }); }

  const patch = { updated_at: new Date().toISOString() };
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) return NextResponse.json({ error: 'tags must be an array.' }, { status: 400 });
    patch.tags = body.tags
      .map((t) => String(t).trim().toLowerCase().replace(/\s+/g, '_'))
      .filter(Boolean)
      .slice(0, 10);
  }
  if (body.stale !== undefined) {
    // Only allow editors to *clear* stale. Setting stale=true happens
    // automatically via lib/deal-analysis/staleness when a doc changes.
    if (body.stale !== false) {
      return NextResponse.json({ error: 'stale can only be cleared (set to false) via this endpoint.' }, { status: 400 });
    }
    patch.stale = false;
    patch.stale_reason = null;
    patch.stale_at = null;
  }

  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: 'No mutable fields provided.' }, { status: 400 });
  }

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  const resp = await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_findings?analysis_id=eq.${analysisId}&finding_key=eq.${encodeURIComponent(key)}&select=${SELECT_COLS}`,
    {
      method: 'PATCH',
      headers: { ...getSupabaseWriteHeaders(sb.key), Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    },
  );
  if (!resp.ok) return NextResponse.json({ error: 'Failed to update finding.' }, { status: 502 });
  const [finding] = await resp.json();
  if (!finding) return NextResponse.json({ error: 'Finding not found.' }, { status: 404 });

  return NextResponse.json({ finding, recommendedTags: RECOMMENDED_FINDING_TAGS });
}
