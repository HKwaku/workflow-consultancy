/**
 * GET /api/me/operating-model
 *
 * Resolves the calling user → their org → its default operating model.
 * Returns:
 *   { modelId, organizationId, isAdmin }     when fully resolved
 *   { modelId: null, reason: '<...>' }       otherwise
 *
 * The /workspace page calls this on mount to decide whether to render
 * the workspace home or fall back to /org-admin (no model yet).
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { resolveDefaultModelForUser } from '@/lib/operatingModel/auth';

export const maxDuration = 10;

export async function GET(request) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const result = await resolveDefaultModelForUser({ email: auth.email, userId: auth.userId });
  return NextResponse.json(result);
}
