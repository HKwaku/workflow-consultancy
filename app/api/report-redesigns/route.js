import { NextResponse } from 'next/server';
import { requireSupabase, getRequestId, checkOrigin } from '@/lib/api-helpers';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export async function GET(request) {
  try {
    const originErr = checkOrigin(request);
    if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });
    const auth = await requireAuth(request);
    if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

    const rl = await checkRateLimit(getRateLimitKey(request));
    if (!rl.allowed) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

    const reportId = request.nextUrl.searchParams.get('reportId');
    if (!reportId || reportId.length > 64) return NextResponse.json({ error: 'Valid report ID required.' }, { status: 400 });

    const sbConfig = requireSupabase();
    if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify report ownership
    const { data: reportRows, error: reportErr } = await supabase
      .from('diagnostic_reports')
      .select('id,contact_email')
      .eq('id', reportId)
      .limit(1);

    if (reportErr || !reportRows?.length) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });
    const reportEmail = (reportRows[0].contact_email || '').toString().toLowerCase();
    if (reportEmail !== auth.email.toLowerCase()) {
      return NextResponse.json({ error: 'You do not have permission to view this report.' }, { status: 403 });
    }

    let redesignRows = null;
    let rdErr = null;
    const res = await supabase
      .from('report_redesigns')
      .select('id,name,status,created_at')
      .eq('report_id', reportId)
      .order('created_at', { ascending: true });
    redesignRows = res.data;
    rdErr = res.error;
    if (rdErr && (rdErr.message?.includes('name') || rdErr.message?.includes('status') || rdErr.message?.includes('column') || rdErr.code === '42703')) {
      const fallback = await supabase
        .from('report_redesigns')
        .select('id,created_at')
        .eq('report_id', reportId)
        .order('created_at', { ascending: true });
      redesignRows = fallback.data;
      rdErr = fallback.error;
    }
    if (rdErr) {
      logger.error('Report redesigns fetch error', { requestId: getRequestId(request), error: rdErr.message });
      return NextResponse.json({ error: 'Failed to fetch redesigns.' }, { status: 502 });
    }

    const redesigns = (redesignRows || []).map((rd, i) => ({
      id: rd.id,
      name: rd.name || `Redesign ${i + 1}`,
      version: i + 1,
      status: rd.status || 'pending',
      createdAt: rd.created_at,
    }));

    return NextResponse.json({ success: true, redesigns });
  } catch (err) {
    logger.error('Report redesigns error', { requestId: getRequestId(request), error: err.message, stack: err.stack });
    return NextResponse.json({ error: 'Failed to retrieve redesigns.' }, { status: 500 });
  }
}
