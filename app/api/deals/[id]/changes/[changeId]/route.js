/**
 * PATCH /api/deals/[id]/changes/[changeId]
 *
 * Advance a change's state. Editor-only. Body:
 *   { state: 'live' | 'reverted' | 'measured' | 'applied' | ... }
 *
 * Used by the workspace Changes timeline so a reviewer can mark a
 * proposal "live in production" or "reverted" without leaving the
 * surface. Other state transitions land via:
 *   * proposed → applied  — the apply endpoint of each propose_* tool
 *   * applied → measured  — recordOutcome() (auto-flips)
 * Both still work via this PATCH if needed for manual reconciliation.
 *
 * Returns: { ok: true, state }
 */

import { NextResponse } from 'next/server';
import { checkOrigin, isValidUUID, getRequestId } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { requireDealEditor } from '@/lib/dealAuth';
import { recordTransition } from '@/lib/changes/repo';
import { logger } from '@/lib/logger';

const ALLOWED_TRANSITIONS = new Set([
  'proposed', 'accepted', 'rejected', 'applied', 'live', 'measured', 'reverted',
]);

export async function PATCH(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id, changeId } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Valid deal id required.' }, { status: 400 });
  if (!isValidUUID(changeId)) return NextResponse.json({ error: 'Valid change id required.' }, { status: 400 });

  const editor = await requireDealEditor({ dealId: id, email: auth.email, userId: auth.userId });
  if (editor.error) return NextResponse.json(editor.error, { status: editor.status });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  const state = String(body?.state || '').trim();
  if (!ALLOWED_TRANSITIONS.has(state)) {
    return NextResponse.json({ error: `Invalid state. Must be one of: ${[...ALLOWED_TRANSITIONS].join(', ')}.` }, { status: 400 });
  }

  const result = await recordTransition({ id: changeId, state, actor_email: auth.email });
  if (!result.ok) {
    logger.warn('Change PATCH failed', { requestId: getRequestId(request), changeId, state });
    return NextResponse.json({ error: 'Failed to update change.' }, { status: 502 });
  }
  return NextResponse.json({ ok: true, state });
}
