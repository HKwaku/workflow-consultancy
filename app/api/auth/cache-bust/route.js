/**
 * POST /api/auth/cache-bust
 *
 * Evicts the caller's JWT from the in-memory auth cache. Called by the
 * client just before / immediately after Supabase signOut so the
 * just-revoked token can't be replayed against this serverless instance
 * for the rest of its TTL window.
 *
 * No body. The Bearer token in the Authorization header is what gets
 * busted. Always returns 200 — refusing the request would prevent a
 * client that's already signing out from completing cleanup.
 */

import { NextResponse } from 'next/server';
import { bustAuthCacheForToken } from '@/lib/auth';

export const maxDuration = 5;

export async function POST(request) {
  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const busted = token ? bustAuthCacheForToken(token) : false;
  return NextResponse.json({ ok: true, busted });
}
