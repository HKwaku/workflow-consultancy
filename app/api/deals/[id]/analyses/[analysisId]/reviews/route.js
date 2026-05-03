/**
 * /api/deals/[id]/analyses/[analysisId]/reviews
 *
 * GET   - list reviews for an analysis (one row per finding_key with a decision)
 * PATCH - upsert a review row: { finding_key, status, reviewer_note?, edited_title?, edited_body? }
 *
 * Editor-only. Pending findings are hidden from the rendered deal report
 * unless the viewer is an editor; rejected findings are hidden from everyone.
 *
 * Approvals carry across analysis re-runs because finding_key is content-stable
 * (sha1 of category+title) — see lib/deal-analysis/findingsShape.js.
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase,
  checkOrigin, getRequestId,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { requireDealEditor } from '@/lib/dealAuth';
import { logger } from '@/lib/logger';

const VALID_STATUSES = new Set(['pending', 'approved', 'rejected', 'needs_revision']);

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id, analysisId } = await params;
  const editor = await requireDealEditor({ dealId: id, email: auth.email, userId: auth.userId });
  if (editor.error) return NextResponse.json(editor.error, { status: editor.status });

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  const resp = await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_finding_reviews?analysis_id=eq.${encodeURIComponent(analysisId)}&select=*&order=updated_at.desc`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  if (!resp.ok) return NextResponse.json({ error: 'Failed to load reviews.' }, { status: 502 });
  const rows = await resp.json();
  return NextResponse.json({ reviews: rows });
}

export async function PATCH(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id, analysisId } = await params;
  const editor = await requireDealEditor({ dealId: id, email: auth.email, userId: auth.userId });
  if (editor.error) return NextResponse.json(editor.error, { status: editor.status });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  const { finding_key, status, reviewer_note, edited_title, edited_body } = body || {};

  if (!finding_key || typeof finding_key !== 'string' || finding_key.length > 64) {
    return NextResponse.json({ error: 'finding_key required.' }, { status: 400 });
  }
  if (status && !VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: `Invalid status. Must be one of: ${[...VALID_STATUSES].join(', ')}.` }, { status: 400 });
  }

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const reqId = getRequestId(request);

  const row = {
    deal_id: id,
    analysis_id: analysisId,
    finding_key,
    status: status || 'pending',
    reviewer_note: typeof reviewer_note === 'string' ? reviewer_note.slice(0, 2000) : null,
    edited_title: typeof edited_title === 'string' ? edited_title.slice(0, 500) : null,
    edited_body:  typeof edited_body  === 'string' ? edited_body.slice(0, 4000) : null,
    decided_by_email: auth.email,
    decided_at: new Date().toISOString(),
  };

  // Upsert via PostgREST on the (analysis_id, finding_key) unique index.
  const resp = await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_finding_reviews?on_conflict=analysis_id,finding_key`,
    {
      method: 'POST',
      headers: {
        ...getSupabaseWriteHeaders(sb.key),
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(row),
    },
  );
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    logger.error('finding review upsert failed', { requestId: reqId, status: resp.status, body: txt.slice(0, 300) });
    return NextResponse.json({ error: 'Failed to save review.' }, { status: 502 });
  }
  const [saved] = await resp.json();
  return NextResponse.json({ review: saved });
}
