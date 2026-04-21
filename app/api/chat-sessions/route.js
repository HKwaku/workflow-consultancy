import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { checkOrigin, getRequestId } from '@/lib/api-helpers';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { listChatSessions, upsertChatSession } from '@/lib/chatPersistence';
import { logger } from '@/lib/logger';

/**
 * GET /api/chat-sessions?search=&status=&limit=&offset=
 *   List the signed-in user's chat sessions. Supports fuzzy search over
 *   title/last_message/summary and status filters (all|pinned|archived|starred).
 *
 * POST /api/chat-sessions
 *   Body: { id?, reportId?, kind?, title? }
 *   Idempotent — creates a session if `id` is missing, otherwise touches the
 *   existing row. Returns `{ sessionId }`.
 */

export async function GET(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const search = request.nextUrl.searchParams.get('search') || '';
  const status = request.nextUrl.searchParams.get('status') || 'all';
  const limit = parseInt(request.nextUrl.searchParams.get('limit') || '50', 10);
  const offset = parseInt(request.nextUrl.searchParams.get('offset') || '0', 10);

  try {
    const sessions = await listChatSessions({
      email: auth.email,
      userId: auth.userId,
      search,
      status,
      limit,
      offset,
    });
    return NextResponse.json({ success: true, sessions });
  } catch (err) {
    logger.error('chat-sessions list failed', { requestId: getRequestId(request), error: err.message });
    return NextResponse.json({ error: 'Failed to load chat history.' }, { status: 500 });
  }
}

export async function POST(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  try {
    const sessionId = await upsertChatSession({
      sessionId: body.id,
      userId: auth.userId,
      email: auth.email,
      reportId: body.reportId,
      kind: body.kind,
      title: body.title,
    });
    return NextResponse.json({ success: true, sessionId });
  } catch (err) {
    logger.error('chat-sessions upsert failed', { requestId: getRequestId(request), error: err.message });
    return NextResponse.json({ error: 'Failed to create session.' }, { status: 500 });
  }
}
