import { NextResponse } from 'next/server';
import { requireSupabase, getRequestId, checkOrigin, fetchWithTimeout } from '@/lib/api-helpers';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export async function POST(request) {
  try {
    const originErr = checkOrigin(request);
    if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });
    const auth = await requireAuth(request);
    if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

    const rl = await checkRateLimit(getRateLimitKey(request));
    if (!rl.allowed) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
    const reportId = body.reportId != null ? String(body.reportId).trim() : '';
    const redesignId = body.redesignId != null ? String(body.redesignId).trim() : '';
    const name = body.name != null ? String(body.name).trim() : '';

    if (!reportId || reportId.length > 64) return NextResponse.json({ error: 'Valid report ID required.' }, { status: 400 });
    if (!redesignId || redesignId.length > 64) return NextResponse.json({ error: 'Valid redesign ID required.' }, { status: 400 });
    if (name.length > 200) return NextResponse.json({ error: 'Name must be 200 characters or less.' }, { status: 400 });

    const sbConfig = requireSupabase();
    if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify report ownership and that redesign belongs to report
    const { data: reportRows, error: reportErr } = await supabase
      .from('diagnostic_reports')
      .select('id,contact_email,diagnostic_data')
      .eq('id', reportId)
      .limit(1);

    if (reportErr || !reportRows?.length) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });
    const reportEmail = (reportRows[0].contact_email || '').toString().toLowerCase();
    if (reportEmail !== auth.email.toLowerCase()) {
      return NextResponse.json({ error: 'You do not have permission to edit this report.' }, { status: 403 });
    }

    const { data: rdRows, error: rdErr } = await supabase
      .from('report_redesigns')
      .select('id,report_id')
      .eq('id', redesignId)
      .eq('report_id', reportId)
      .limit(1);

    if (rdErr || !rdRows?.length) return NextResponse.json({ error: 'Redesign not found.' }, { status: 404 });

    const { error: updateErr } = await supabase
      .from('report_redesigns')
      .update({ name: name || null, updated_at: new Date().toISOString() })
      .eq('id', redesignId)
      .eq('report_id', reportId);

    if (updateErr) {
      logger.error('Rename redesign error', { requestId: getRequestId(request), error: updateErr.message, code: updateErr.code });
      const errMsg = process.env.NODE_ENV === 'development' ? updateErr.message : 'Failed to rename redesign.';
      return NextResponse.json({ error: errMsg }, { status: 502 });
    }

    // Append audit event to diagnostic_data
    const d = reportRows[0].diagnostic_data || {};
    const auditEvent = {
      type: 'redesign_rename',
      detail: `Renamed redesign to "${name}"`,
      timestamp: new Date().toISOString(),
      actor: auth.email,
    };
    const auditTrail = [...(d.auditTrail || []), auditEvent].slice(-50);
    const sbHeaders = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
    const patchResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}`, {
      method: 'PATCH',
      headers: sbHeaders,
      body: JSON.stringify({ diagnostic_data: { ...d, auditTrail }, updated_at: new Date().toISOString() }),
    });
    if (!patchResp.ok) logger.warn('Rename redesign: failed to update audit trail', { requestId: getRequestId(request) });

    return NextResponse.json({ success: true, redesignId, name: name || null });
  } catch (err) {
    logger.error('Rename redesign error', { requestId: getRequestId(request), error: err.message, stack: err.stack });
    return NextResponse.json({ error: 'Failed to rename redesign.' }, { status: 500 });
  }
}
