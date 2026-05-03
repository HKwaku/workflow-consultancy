/**
 * /api/deals/[id]/analyses/[analysisId]/findings/[key]/comments
 *
 * GET  - list comments on a finding (any deal viewer)
 * POST - add a comment (any deal viewer can comment; participants can too,
 *        so the seller-side can defend or clarify a finding without going
 *        through the deal team)
 *
 * Comments are distinct from deal_finding_reviews.reviewer_note: that's a
 * single per-reviewer note tied to approve/reject/needs_revision; this is
 * a free thread anyone with deal access can contribute to.
 *
 * @-mentions are stored as a parallel string[] on the row but we don't
 * notify yet — captured for future webhook integration.
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase,
  isValidUUID, checkOrigin,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveDealAccess } from '@/lib/dealAuth';

export const maxDuration = 10;

const SELECT_COLS = 'id,analysis_id,deal_id,finding_key,author_email,body,mentions,created_at,updated_at';
const MENTION_RE = /@([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;

function parseMentions(body) {
  const out = new Set();
  let m;
  while ((m = MENTION_RE.exec(body)) !== null) out.add(m[1].toLowerCase());
  return [...out].slice(0, 20);
}

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
    `${sb.url}/rest/v1/deal_finding_comments?analysis_id=eq.${analysisId}&finding_key=eq.${encodeURIComponent(key)}&select=${SELECT_COLS}&order=created_at.asc&limit=200`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  if (!resp.ok) return NextResponse.json({ error: 'Failed to load comments.' }, { status: 502 });
  const comments = await resp.json();
  return NextResponse.json({ comments });
}

export async function POST(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id, analysisId, key } = await params;
  if (!isValidUUID(id) || !isValidUUID(analysisId)) {
    return NextResponse.json({ error: 'Valid deal id + analysis id required.' }, { status: 400 });
  }

  const access = await resolveDealAccess({ dealId: id, email: auth.email, userId: auth.userId });
  if (!access) return NextResponse.json({ error: 'Deal not found or access denied.' }, { status: 404 });

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'JSON body required.' }, { status: 400 }); }

  const text = String(body?.body || '').trim();
  if (!text) return NextResponse.json({ error: 'body is required.' }, { status: 400 });
  if (text.length > 4000) return NextResponse.json({ error: 'body too long (max 4000 chars).' }, { status: 400 });

  const mentions = parseMentions(text);

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  const resp = await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_finding_comments?select=${SELECT_COLS}`,
    {
      method: 'POST',
      headers: { ...getSupabaseWriteHeaders(sb.key), Prefer: 'return=representation' },
      body: JSON.stringify({
        analysis_id: analysisId,
        deal_id: id,
        finding_key: key,
        author_email: auth.email,
        body: text,
        mentions,
      }),
    },
  );
  if (!resp.ok) return NextResponse.json({ error: 'Failed to post comment.' }, { status: 502 });
  const [comment] = await resp.json();
  return NextResponse.json({ comment }, { status: 201 });
}

export async function DELETE(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id, analysisId, key } = await params;
  if (!isValidUUID(id) || !isValidUUID(analysisId)) {
    return NextResponse.json({ error: 'Valid deal id + analysis id required.' }, { status: 400 });
  }

  const access = await resolveDealAccess({ dealId: id, email: auth.email, userId: auth.userId });
  if (!access) return NextResponse.json({ error: 'Deal not found or access denied.' }, { status: 404 });

  const sp = request.nextUrl.searchParams;
  const commentId = sp.get('comment_id');
  if (!commentId || !isValidUUID(commentId)) return NextResponse.json({ error: 'comment_id required.' }, { status: 400 });

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  // Authors can delete their own comments; deal owners can delete any.
  const isOwner = access.mode === 'owner';
  const filter = isOwner
    ? `id=eq.${commentId}&analysis_id=eq.${analysisId}&finding_key=eq.${encodeURIComponent(key)}`
    : `id=eq.${commentId}&analysis_id=eq.${analysisId}&finding_key=eq.${encodeURIComponent(key)}&author_email=eq.${encodeURIComponent(auth.email)}`;

  const resp = await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_finding_comments?${filter}`,
    { method: 'DELETE', headers: getSupabaseWriteHeaders(sb.key) },
  );
  if (!resp.ok) return NextResponse.json({ error: 'Failed to delete.' }, { status: 502 });
  return NextResponse.json({ ok: true });
}
