import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { checkOrigin, getRequestId } from '@/lib/api-helpers';
import { fetchMessagesForSession, patchChatSession, deleteChatSession, getChatSession, fetchArtefactsForSession } from '@/lib/chatPersistence';
import { getSupabaseAdmin } from '@/lib/supabase';
import { resolveDealAccess } from '@/lib/dealAuth';
import { logger } from '@/lib/logger';

async function verifyOwnership(sessionId, auth) {
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from('chat_sessions')
    .select('id,user_id,email,report_id')
    .eq('id', sessionId)
    .maybeSingle();
  if (!data) return false;
  const emailLower = (auth.email || '').toLowerCase();
  const sessionOwned =
    (auth.userId && data.user_id === auth.userId) ||
    (emailLower && (data.email || '').toLowerCase() === emailLower);
  if (!sessionOwned) return false;

  // If the session's report is linked to a deal (via deal_flows or
  // deal_participants) the caller must still have deal access. A participant
  // removed from a deal should not be able to resume an old session against
  // that deal's report.
  if (data.report_id) {
    try {
      const { data: flowRows } = await sb
        .from('deal_flows')
        .select('deal_id')
        .eq('report_id', data.report_id)
        .limit(1);
      let dealId = flowRows?.[0]?.deal_id || null;
      if (!dealId) {
        const { data: partRows } = await sb
          .from('deal_participants')
          .select('deal_id')
          .eq('report_id', data.report_id)
          .limit(1);
        dealId = partRows?.[0]?.deal_id || null;
      }
      if (dealId) {
        const access = await resolveDealAccess({ dealId, email: auth.email, userId: auth.userId });
        if (!access) return false;
      }
    } catch {
      /* tables may be missing pre-migration - don't block base ownership */
    }
  }
  return true;
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
    const [messages, session, artefacts] = await Promise.all([
      fetchMessagesForSession(id),
      getChatSession(id),
      fetchArtefactsForSession(id),
    ]);
    return NextResponse.json({ success: true, messages, session, artefacts });
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
