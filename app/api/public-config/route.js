import { NextResponse } from 'next/server';
import { checkOrigin, getRequestId } from '@/lib/api-helpers';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export async function GET(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });
  const rl = checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

  // Optional: set PUBLIC_CONFIG_RESTRICTED=true to disable in production (e.g. if not using monitor)
  if (process.env.NODE_ENV === 'production' && process.env.PUBLIC_CONFIG_RESTRICTED === 'true') {
    return NextResponse.json({ error: 'Not available.' }, { status: 404 });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    logger.warn('Public config: Supabase not configured', { requestId: getRequestId(request) });
    return NextResponse.json(
      { error: 'Supabase not configured. Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) in environment variables.' },
      { status: 503 }
    );
  }

  return NextResponse.json({ supabaseUrl, supabaseAnonKey }, {
    headers: { 'Cache-Control': 'public, max-age=300' }
  });
}
