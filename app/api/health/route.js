import { NextResponse } from 'next/server';
import { requireSupabase, getRequestId } from '@/lib/api-helpers';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export async function GET(request) {
  const rl = checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });
  const requestId = getRequestId(request);
  const checks = { ok: true, timestamp: new Date().toISOString() };
  try {
    const sb = requireSupabase();
    checks.supabase = sb ? 'ok' : 'missing-config';
    checks.anthropic = process.env.ANTHROPIC_API_KEY ? 'ok' : 'not-configured';
    if (!sb) checks.ok = false;
  } catch (e) {
    checks.ok = false;
    checks.error = e.message;
    logger.error('Health check failed', { requestId, error: e.message, stack: e.stack });
  }
  if (!checks.ok) logger.warn('Health check unhealthy', { requestId, checks });
  return NextResponse.json(checks, { status: checks.ok ? 200 : 503 });
}
