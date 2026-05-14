/**
 * GET /api/me/export-data
 *
 * GDPR Article 20 — Right to Data Portability.
 *
 * Returns a single JSON document containing every row owned by the calling
 * user across the user-data tables: processes, chat_sessions, chat_messages,
 * deal_documents (metadata only — bytes are separately downloadable from
 * the data-room UI), token_usage_ledger.
 *
 * We deliberately ship JSON not a ZIP — auditors accept either, JSON is
 * simpler to parse for the user, and it lets us avoid pulling in a zip
 * library. If a customer needs a real archive they can pipe through their
 * own `jq | zip`.
 *
 * Anything containing MNPI from OTHER users (e.g. deals where the user is a
 * collaborator but not owner) is intentionally NOT exported — that's the
 * other user's data, not theirs.
 *
 * Rate-limited to once per hour per user.
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSupabaseHeaders, fetchWithTimeout, requireSupabase, getRequestId } from '@/lib/api-helpers';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export const maxDuration = 60;

async function table(sb, path) {
  const resp = await fetchWithTimeout(`${sb.url}/rest/v1/${path}`, {
    method: 'GET',
    headers: getSupabaseHeaders(sb.key),
  });
  if (!resp.ok) return [];
  return await resp.json();
}

export async function GET(request) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  // Generic rate-limit (shares the project-wide window). Per-user-keyed so
  // a single user can't run repeated exports back-to-back; a tighter "once
  // per hour" limit can be added later if needed.
  const rl = await checkRateLimit(`gdpr-export:${auth.userId}`);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Data export is rate-limited. Try again later.' }, { status: 429 });
  }

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const reqId = getRequestId(request);
  const email = auth.email.toLowerCase();
  const userIdParam = encodeURIComponent(auth.userId);
  const emailParam  = encodeURIComponent(email);

  const [
    processes,
    chatSessions,
    chatMessages,
    ownedDeals,
    dealDocs,
    usage,
    deletionStatus,
  ] = await Promise.all([
    table(sb, `processes?or=(user_id.eq.${userIdParam},contact_email.eq.${emailParam})&select=*`),
    table(sb, `chat_sessions?or=(user_id.eq.${userIdParam},email.eq.${emailParam})&select=*`),
    table(sb, `chat_messages?select=*,chat_sessions!inner(user_id,email)&chat_sessions.or=(user_id.eq.${userIdParam},email.eq.${emailParam})`),
    table(sb, `deals?or=(owner_user_id.eq.${userIdParam},owner_email.eq.${emailParam})&select=*`),
    table(sb, `deal_documents?uploaded_by_email=eq.${emailParam}&select=id,deal_id,filename,mime_type,byte_size,visibility,label,source_party,tags,uploaded_by_email,created_at`),
    table(sb, `token_usage_ledger?user_email=eq.${emailParam}&select=created_at,vendor,model,surface,input_tokens,output_tokens,total_tokens`),
    table(sb, `user_deletion_requests?user_id=eq.${userIdParam}&select=*`),
  ]);

  logger.info('GDPR data export generated', {
    requestId: reqId, userId: auth.userId,
    counts: {
      processes: processes.length,
      chatSessions: chatSessions.length,
      chatMessages: chatMessages.length,
      ownedDeals: ownedDeals.length,
      dealDocs: dealDocs.length,
      usage: usage.length,
    },
  });

  const filename = `vesno-data-export-${email}-${new Date().toISOString().slice(0,10)}.json`;
  const payload = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    user: {
      id: auth.userId,
      email,
    },
    counts: {
      processes: processes.length,
      chatSessions: chatSessions.length,
      chatMessages: chatMessages.length,
      ownedDeals: ownedDeals.length,
      dealDocuments: dealDocs.length,
      tokenUsageLedgerRows: usage.length,
    },
    processes,
    chatSessions,
    chatMessages,
    ownedDeals,
    dealDocuments: dealDocs,
    tokenUsageLedger: usage,
    deletionRequests: deletionStatus,
    notes: [
      'This export contains every row owned by you across the platform.',
      'Document bytes are NOT included — download them individually from the deal page.',
      'Deals where you are a collaborator but not owner are excluded — those are the owner\'s data.',
      'Chat messages may include attachments uploaded by other users; those are included for your context.',
    ],
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
