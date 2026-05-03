/**
 * GET /api/me/budget
 *
 * Returns the calling user's budget bucket so the chat client can render
 * the trial banner without needing to know the org/byo plumbing. Shape:
 *
 *   { mode: 'anonymous' }
 *   { mode: 'trial', remaining, granted, percent }
 *   { mode: 'trial_exhausted', granted }
 *   { mode: 'org_byo', orgId }
 *   { mode: 'org_platform', orgId }
 *
 * Cheap call — used to decide whether to show the soft "X tokens left" pill,
 * a 50%-warning banner, or the full blocking gate. The chat agent itself
 * still does its own pre-flight via requireBudgetClearance, so this endpoint
 * is purely UI.
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { resolveBudgetMode } from '@/lib/trialBudget';

export const maxDuration = 5;

export async function GET(request) {
  const auth = await requireAuth(request);
  if (auth.error) {
    // Anonymous → no gate needed; the rate-limiter handles it.
    return NextResponse.json({ mode: 'anonymous' });
  }
  const mode = await resolveBudgetMode({ email: auth.email, userId: auth.userId });
  if (mode.mode === 'trial' && mode.granted) {
    const consumed = mode.granted - mode.remaining;
    // Credits framing — 1 credit = 1,000 tokens. Most AI products show
    // credits because users don't think in tokens. We round-down so the
    // widget never overpromises (49,999 tokens left ≠ 50 credits).
    const TOKENS_PER_CREDIT = 1000;
    return NextResponse.json({
      ...mode,
      consumed,
      percent: Math.round((consumed / mode.granted) * 100),
      credits: {
        granted:   Math.floor(mode.granted   / TOKENS_PER_CREDIT),
        remaining: Math.max(0, Math.floor(mode.remaining / TOKENS_PER_CREDIT)),
        consumed:  Math.floor(consumed       / TOKENS_PER_CREDIT),
        tokensPerCredit: TOKENS_PER_CREDIT,
      },
    });
  }
  if (mode.mode === 'trial_exhausted' && mode.granted) {
    const TOKENS_PER_CREDIT = 1000;
    return NextResponse.json({
      ...mode,
      credits: {
        granted: Math.floor(mode.granted / TOKENS_PER_CREDIT),
        remaining: 0,
        consumed: Math.floor(mode.granted / TOKENS_PER_CREDIT),
        tokensPerCredit: TOKENS_PER_CREDIT,
      },
    });
  }
  return NextResponse.json(mode);
}
