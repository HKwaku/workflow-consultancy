import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { checkOrigin, getRequestId } from '@/lib/api-helpers';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { upsertChatSession, appendChatMessage } from '@/lib/chatPersistence';
import { getSupabaseAdmin } from '@/lib/supabase';
import { logger } from '@/lib/logger';

/**
 * POST /api/chat-messages
 *   Body: {
 *     sessionId?: string,      // if omitted, a new session is created
 *     reportId?: string,
 *     kind?: 'map'|'redesign'|'cost'|'copilot',
 *     title?: string,
 *     role: 'user'|'assistant'|'system'|'tool',
 *     content: string,
 *     actions?: object[],
 *     suggestions?: string[],
 *     attachments?: object[]
 *   }
 *
 * Returns `{ sessionId, messageId, createdAt }`.
 *
 * Called in real time from the chat client — each user send + each
 * assistant reply POSTs once, so history survives a cleared browser
 * and syncs across devices.
 */

const MAX_CONTENT_BYTES = 256 * 1024; // 256 KB per message body

export async function POST(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  const { role, content } = body;
  if (!role || !['user', 'assistant', 'system', 'tool'].includes(role)) {
    return NextResponse.json({ error: 'Invalid role.' }, { status: 400 });
  }
  if (typeof content !== 'string') {
    return NextResponse.json({ error: 'Invalid content.' }, { status: 400 });
  }
  const safeContent = content.length > MAX_CONTENT_BYTES
    ? content.slice(0, MAX_CONTENT_BYTES) + '\n[truncated]'
    : content;

  try {
    let sessionId = body.sessionId;
    const snapshot = body.processSnapshot;
    if (sessionId) {
      const sb = getSupabaseAdmin();
      const { data: row } = await sb
        .from('chat_sessions')
        .select('id,user_id,email')
        .eq('id', sessionId)
        .maybeSingle();
      if (!row) {
        // sessionId supplied but does not exist — create it under the
        // authenticated user with that exact id.
        sessionId = await upsertChatSession({
          sessionId,
          userId: auth.userId,
          email: auth.email,
          reportId: body.reportId,
          kind: body.kind,
          title: body.title,
          processSnapshot: snapshot,
        });
      } else {
        const emailLower = (auth.email || '').toLowerCase();
        const owns = (auth.userId && row.user_id === auth.userId)
          || (emailLower && (row.email || '').toLowerCase() === emailLower);
        if (!owns) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
        // Refresh title/snapshot/report link whenever the client sends them.
        if (body.title || snapshot !== undefined || body.reportId) {
          await upsertChatSession({
            sessionId,
            userId: auth.userId,
            email: auth.email,
            reportId: body.reportId,
            kind: body.kind,
            title: body.title,
            processSnapshot: snapshot,
          });
        }
      }
    } else {
      sessionId = await upsertChatSession({
        userId: auth.userId,
        email: auth.email,
        reportId: body.reportId,
        kind: body.kind,
        title: body.title,
        processSnapshot: snapshot,
      });
    }

    const msg = await appendChatMessage({
      sessionId,
      role,
      content: safeContent,
      actions: body.actions,
      suggestions: body.suggestions,
      attachments: body.attachments,
    });

    return NextResponse.json({
      success: true,
      sessionId,
      messageId: msg.id,
      createdAt: msg.created_at,
    });
  } catch (err) {
    logger.error('chat-messages append failed', { requestId: getRequestId(request), error: err.message });
    return NextResponse.json({ error: 'Failed to save message.' }, { status: 500 });
  }
}
