/**
 * /api/deals/[id]/qa
 *
 * GET   - list Q&A items for the deal (any deal viewer)
 * POST  - create a question (any deal editor + assigned-participant viewers)
 * PATCH - update a question (status, answer, assignee, etc.)
 *
 * Q&A is the diligence backbone — each row is a question to ask the seller
 * and the answer that landed. Distinct from chat (free-form) and findings
 * (model-generated). Lives in deal_qa_items.
 *
 * Visibility: open to any deal viewer so participants can see what they're
 * being asked. Editors can write; participants can answer their own
 * assigned items (PATCH allowed when assigned_participant_id matches).
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase,
  isValidUUID, checkOrigin,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveDealAccess, requireDealEditor } from '@/lib/dealAuth';

export const maxDuration = 15;

const STATUSES = new Set(['open', 'answered', 'skipped', 'obsolete']);

const SELECT_COLS =
  'id,question,asked_by_email,asked_at,assigned_participant_id,assigned_company,'
  + 'status,answer_text,answered_by_email,answered_at,'
  + 'evidence_chunk_ids,evidence_document_ids,related_finding_key,'
  + 'created_at,updated_at';

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Valid deal id required.' }, { status: 400 });

  const access = await resolveDealAccess({ dealId: id, email: auth.email, userId: auth.userId });
  if (!access) return NextResponse.json({ error: 'Deal not found or access denied.' }, { status: 404 });

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  const sp = request.nextUrl.searchParams;
  const statusFilter = sp.get('status');
  const findingFilter = sp.get('finding_key');

  let query = `${sb.url}/rest/v1/deal_qa_items?deal_id=eq.${id}&select=${SELECT_COLS}&order=asked_at.desc&limit=500`;
  if (statusFilter) query += `&status=eq.${encodeURIComponent(statusFilter)}`;
  if (findingFilter) query += `&related_finding_key=eq.${encodeURIComponent(findingFilter)}`;

  const resp = await fetchWithTimeout(query, { method: 'GET', headers: getSupabaseHeaders(sb.key) });
  if (!resp.ok) return NextResponse.json({ error: 'Failed to list Q&A.' }, { status: 502 });
  const items = await resp.json();

  // Lightweight summary so the workspace can show "12 open · 3 stale" tabs
  // without a second round-trip.
  const summary = items.reduce((acc, q) => {
    acc[q.status] = (acc[q.status] || 0) + 1;
    return acc;
  }, { open: 0, answered: 0, skipped: 0, obsolete: 0 });

  return NextResponse.json({ items, summary });
}

export async function POST(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Valid deal id required.' }, { status: 400 });

  // Editor-only write — sellers/participants can answer (PATCH) but
  // questions are authored by the deal team.
  const editor = await requireDealEditor({ dealId: id, email: auth.email, userId: auth.userId });
  if (editor.error) return NextResponse.json(editor.error, { status: editor.status });

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'JSON body required.' }, { status: 400 }); }

  const question = String(body?.question || '').trim();
  if (!question) return NextResponse.json({ error: 'question is required.' }, { status: 400 });
  if (question.length > 2000) return NextResponse.json({ error: 'question too long (max 2000 chars).' }, { status: 400 });

  const insert = {
    deal_id: id,
    question,
    asked_by_email: auth.email,
    assigned_participant_id: body.assigned_participant_id && isValidUUID(body.assigned_participant_id)
      ? body.assigned_participant_id : null,
    assigned_company: body.assigned_company ? String(body.assigned_company).slice(0, 200) : null,
    related_finding_key: body.related_finding_key ? String(body.related_finding_key).slice(0, 200) : null,
  };

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  const resp = await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_qa_items?select=${SELECT_COLS}`,
    {
      method: 'POST',
      headers: { ...getSupabaseWriteHeaders(sb.key), Prefer: 'return=representation' },
      body: JSON.stringify(insert),
    },
  );
  if (!resp.ok) return NextResponse.json({ error: 'Failed to create Q&A item.' }, { status: 502 });
  const [item] = await resp.json();
  return NextResponse.json({ item }, { status: 201 });
}

export async function PATCH(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Valid deal id required.' }, { status: 400 });

  const access = await resolveDealAccess({ dealId: id, email: auth.email, userId: auth.userId });
  if (!access) return NextResponse.json({ error: 'Deal not found or access denied.' }, { status: 404 });

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'JSON body required.' }, { status: 400 }); }

  const itemId = body?.id;
  if (!itemId || !isValidUUID(itemId)) return NextResponse.json({ error: 'id (uuid) required.' }, { status: 400 });

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  // Load current row to enforce per-mode write rights.
  const cur = await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_qa_items?id=eq.${itemId}&deal_id=eq.${id}&select=id,assigned_participant_id,status`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  const [row] = cur.ok ? await cur.json() : [];
  if (!row) return NextResponse.json({ error: 'Item not found.' }, { status: 404 });

  const isEditor = access.mode === 'owner' || access.mode === 'collaborator';
  const isAssignedParticipant = access.mode === 'participant'
    && row.assigned_participant_id
    && access.participantId === row.assigned_participant_id;
  if (!isEditor && !isAssignedParticipant) {
    return NextResponse.json({ error: 'Not allowed to update this item.' }, { status: 403 });
  }

  const patch = { updated_at: new Date().toISOString() };
  if (body.status !== undefined) {
    if (!STATUSES.has(body.status)) return NextResponse.json({ error: `status must be one of ${[...STATUSES].join(', ')}.` }, { status: 400 });
    // Participants can only flip status to/from 'answered' (implicitly when
    // they submit answer_text). Skipped / obsolete / reopen-to-open are
    // editor decisions about the question itself, not the answer.
    if (!isEditor && body.status !== 'answered') {
      return NextResponse.json({
        error: 'Participants can only mark items answered. Ask the deal team to skip or close.',
      }, { status: 403 });
    }
    patch.status = body.status;
  }
  if (body.answer_text !== undefined) {
    patch.answer_text = body.answer_text === null ? null : String(body.answer_text).slice(0, 8000);
    patch.answered_by_email = auth.email;
    patch.answered_at = new Date().toISOString();
    if (patch.answer_text && !patch.status) patch.status = 'answered';
  }
  // Editor-only fields below.
  if (isEditor) {
    if (body.question !== undefined) patch.question = String(body.question).slice(0, 2000);
    if (body.assigned_participant_id !== undefined) {
      patch.assigned_participant_id = body.assigned_participant_id && isValidUUID(body.assigned_participant_id)
        ? body.assigned_participant_id : null;
    }
    if (body.assigned_company !== undefined) {
      patch.assigned_company = body.assigned_company ? String(body.assigned_company).slice(0, 200) : null;
    }
    if (body.related_finding_key !== undefined) {
      patch.related_finding_key = body.related_finding_key ? String(body.related_finding_key).slice(0, 200) : null;
    }
    if (Array.isArray(body.evidence_chunk_ids)) {
      patch.evidence_chunk_ids = body.evidence_chunk_ids.filter(isValidUUID).slice(0, 50);
    }
    if (Array.isArray(body.evidence_document_ids)) {
      patch.evidence_document_ids = body.evidence_document_ids.filter(isValidUUID).slice(0, 50);
    }
  }

  const resp = await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_qa_items?id=eq.${itemId}&deal_id=eq.${id}&select=${SELECT_COLS}`,
    {
      method: 'PATCH',
      headers: { ...getSupabaseWriteHeaders(sb.key), Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    },
  );
  if (!resp.ok) return NextResponse.json({ error: 'Failed to update item.' }, { status: 502 });
  const [item] = await resp.json();
  return NextResponse.json({ item });
}

export async function DELETE(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Valid deal id required.' }, { status: 400 });

  const editor = await requireDealEditor({ dealId: id, email: auth.email, userId: auth.userId });
  if (editor.error) return NextResponse.json(editor.error, { status: editor.status });

  const sp = request.nextUrl.searchParams;
  const itemId = sp.get('id');
  if (!itemId || !isValidUUID(itemId)) return NextResponse.json({ error: 'id query param required.' }, { status: 400 });

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  const resp = await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_qa_items?id=eq.${itemId}&deal_id=eq.${id}`,
    { method: 'DELETE', headers: getSupabaseWriteHeaders(sb.key) },
  );
  if (!resp.ok) return NextResponse.json({ error: 'Failed to delete.' }, { status: 502 });
  return NextResponse.json({ ok: true });
}
