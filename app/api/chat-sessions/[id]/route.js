import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { checkOrigin, getRequestId } from '@/lib/api-helpers';
import { fetchMessagesForSession, patchChatSession, deleteChatSession, getChatSession } from '@/lib/chatPersistence';
import { getSupabaseAdmin } from '@/lib/supabase';
import { logger } from '@/lib/logger';

async function verifyOwnership(sessionId, auth) {
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from('chat_sessions')
    .select('id,user_id,email')
    .eq('id', sessionId)
    .maybeSingle();
  if (!data) return false;
  const emailLower = (auth.email || '').toLowerCase();
  if (auth.userId && data.user_id === auth.userId) return true;
  if (emailLower && (data.email || '').toLowerCase() === emailLower) return true;
  return false;
}

export async function GET(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!(await verifyOwnership(id, auth))) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  try {
    const [messages, session] = await Promise.all([
      fetchMessagesForSession(id),
      getChatSession(id),
    ]);
    return NextResponse.json({ success: true, messages, session });
  } catch (err) {
    logger.error('chat-sessions fetch failed', { requestId: getRequestId(request), error: err.message });
    return NextResponse.json({ error: 'Failed to load messages.' }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!(await verifyOwnership(id, auth))) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  try {
    await patchChatSession(id, body);
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error('chat-sessions patch failed', { requestId: getRequestId(request), error: err.message });
    return NextResponse.json({ error: 'Failed to update session.' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!(await verifyOwnership(id, auth))) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  try {
    await deleteChatSession(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error('chat-sessions delete failed', { requestId: getRequestId(request), error: err.message });
    return NextResponse.json({ error: 'Failed to delete session.' }, { status: 500 });
  }
}
