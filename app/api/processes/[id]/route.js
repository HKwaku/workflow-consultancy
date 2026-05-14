/**
 * RESTful process endpoint — `GET` / `PUT /api/processes/[id]`.
 *
 * The canonical surface for reading and upserting a process row in
 * the living-workspace model. Thin proxy in front of the existing
 * `/api/send-diagnostic-report` (POST upsert) and `/api/get-diagnostic`
 * (GET read) handlers — the heavy logic stays where it is for back-
 * compat, this route just gives clients a stable RESTful vocabulary.
 *
 *   PUT /api/processes/[id]            — upsert the live row
 *   GET /api/processes/[id]            — read the live row
 *   GET /api/processes/[id]?editable=1 — read with edit-mode enrichment
 *
 * Wire format: same JSON body shape the legacy endpoints accept. The
 * `id` from the URL is injected as `focusedProcessId` so the upsert
 * branches to update (id exists) or create-with-this-id (it doesn't).
 *
 * The legacy `/api/send-diagnostic-report` and `/api/get-diagnostic`
 * endpoints remain functional for any client that hasn't migrated yet.
 */

import { NextResponse } from 'next/server';

const POST_HANDLER_PROMISE = import('../../send-diagnostic-report/route.js')
  .then((m) => m.POST)
  .catch(() => null);

const GET_HANDLER_PROMISE = import('../../get-diagnostic/route.js')
  .then((m) => m.GET)
  .catch(() => null);

function readBody(text) {
  if (!text) return {};
  try { return JSON.parse(text); } catch { return null; }
}

export async function PUT(request, ctx) {
  const { id } = (await ctx.params) || {};
  const text = await request.text().catch(() => '');
  const body = readBody(text);
  if (body === null) {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  // Living-workspace contract: the path param is the canonical id of
  // the live row. Inject it as focusedProcessId so the upsert resolves
  // correctly. If the caller also sent it in the body, the path wins.
  const merged = { ...body, focusedProcessId: id };

  const POST = await POST_HANDLER_PROMISE;
  if (!POST) {
    return NextResponse.json({ error: 'Upsert handler unavailable.' }, { status: 500 });
  }

  // Forge a new Request with the merged body. Preserves auth + origin
  // headers + method becomes POST (the underlying handler expects POST).
  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json');
  const forwarded = new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(merged),
  });
  return POST(forwarded);
}

export async function GET(request, ctx) {
  const { id } = (await ctx.params) || {};
  if (!id) return NextResponse.json({ error: 'Process id required.' }, { status: 400 });

  const GET_HANDLER = await GET_HANDLER_PROMISE;
  if (!GET_HANDLER) {
    return NextResponse.json({ error: 'Read handler unavailable.' }, { status: 500 });
  }

  // The legacy /api/get-diagnostic reads `id` from `?id=...` rather
  // than a path param. Forge a URL that carries it.
  const url = new URL(request.url);
  url.searchParams.set('id', id);
  const headers = new Headers(request.headers);
  const forwarded = new Request(url.toString(), { method: 'GET', headers });
  return GET_HANDLER(forwarded);
}
