/**
 * GET /api/chat/intro
 *
 * Returns Reina's opening message for the model or deal agent. Computed
 * from real data (no LLM call) so the user's first turn lands instantly
 * with actual numbers.
 *
 * Query params:
 *   modelId?: operating model id
 *   dealId?:  deal id
 *
 * Precedence: dealId wins (a deal anchor overrides a model anchor).
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { isValidUUID } from '@/lib/api-helpers';
import { resolveModelAccess } from '@/lib/operatingModel/auth';
import { resolveDealAccess } from '@/lib/dealAuth';
import { computeAgentIntro } from '@/lib/agents/chat/intros';

export const maxDuration = 15;

export async function GET(request) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const sp = request.nextUrl.searchParams;
  const dealId  = sp.get('dealId');
  const modelId = sp.get('modelId');

  if (dealId) {
    if (!isValidUUID(dealId)) return NextResponse.json({ error: 'Valid dealId required.' }, { status: 400 });
    const access = await resolveDealAccess({ dealId, email: auth.email, userId: auth.userId });
    if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });
    const intro = await computeAgentIntro('deal', { dealId });
    return NextResponse.json({ mode: 'deal', intro: intro || '' });
  }

  if (modelId) {
    if (!isValidUUID(modelId)) return NextResponse.json({ error: 'Valid modelId required.' }, { status: 400 });
    const access = await resolveModelAccess({ modelId, email: auth.email, userId: auth.userId });
    if (access.error) return NextResponse.json({ error: access.error }, { status: access.status });
    const intro = await computeAgentIntro('model', { operatingModelId: modelId });
    return NextResponse.json({ mode: 'model', intro: intro || '' });
  }

  return NextResponse.json({ mode: null, intro: '' });
}
