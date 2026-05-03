/**
 * POST /api/deals/[id]/chat-session
 *
 * Find-or-create the user's copilot chat session for this deal. The
 * DealsRailButton calls this on selection so the chat surface can resume
 * the per-(user, deal) thread by pushing ?chatSession=<id> on top of
 * ?deal=<id>.
 *
 * Response: { sessionId, created }
 *
 * Access: any deal viewer (owner / collaborator / participant). The deal
 * access check also writes the `deal.access_resolved` audit row.
 */

import { NextResponse } from 'next/server';
import { checkOrigin, isValidUUID } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveDealAccess } from '@/lib/dealAuth';
import { findOrCreateDealChatSession } from '@/lib/chatPersistence';
import { logger } from '@/lib/logger';

export const maxDuration = 10;

export async function POST(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id: dealId } = await params;
  if (!dealId || !isValidUUID(dealId)) {
    return NextResponse.json({ error: 'Valid deal id required.' }, { status: 400 });
  }

  const access = await resolveDealAccess({ dealId, email: auth.email, userId: auth.userId });
  if (!access) return NextResponse.json({ error: 'Access denied.' }, { status: 403 });

  try {
    const { sessionId, created } = await findOrCreateDealChatSession({
      userId: auth.userId,
      email: auth.email,
      dealId,
      dealName: access.deal?.name || null,
    });
    return NextResponse.json({ success: true, sessionId, created });
  } catch (err) {
    logger.error('deal chat-session find-or-create failed', { dealId, error: err?.message });
    return NextResponse.json({ error: 'Failed to open chat for this deal.' }, { status: 500 });
  }
}
