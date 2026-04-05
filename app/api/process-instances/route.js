import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireSupabase, getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, isValidUUID, isValidEmail, getRequestId, checkOrigin } from '@/lib/api-helpers';
import { ProcessInstanceInputSchema } from '@/lib/ai-schemas';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { requireAuth } from '@/lib/auth';
import { logger } from '@/lib/logger';

export async function POST(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

  const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
  if (contentLength > 2 * 1024 * 1024) return NextResponse.json({ error: 'Request body too large.' }, { status: 413 });

  const sbConfig = requireSupabase();
  if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const { url: supabaseUrl, key: supabaseKey } = sbConfig;

  try {
    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
    const parsed = ProcessInstanceInputSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid input. processName (max 200 chars) and status are required.' }, { status: 400 });
    const { reportId, processName, instanceName, status, notes, email } = parsed.data;

    const userEmail = auth.email.toLowerCase();
    const payloadEmail = (email || userEmail).toString().toLowerCase();
    if (payloadEmail !== userEmail) return NextResponse.json({ error: 'You can only log instances for your own email.' }, { status: 403 });

    const payload = {
      id: crypto.randomUUID(), report_id: reportId || null, email: userEmail,
      process_name: processName, instance_name: instanceName || null,
      status, notes: notes || null, logged_at: new Date().toISOString(),
      user_id: auth.userId || null,
    };

    const sbResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/process_instances`, {
      method: 'POST',
      headers: getSupabaseWriteHeaders(supabaseKey),
      body: JSON.stringify(payload)
    });

    if (!sbResp.ok) return NextResponse.json({ error: 'Failed to log instance.' }, { status: 502 });
    return NextResponse.json({ success: true, instanceId: payload.id });
  } catch (error) {
    logger.error('Log instance error', { requestId: getRequestId(request), error: error.message, stack: error.stack });
    return NextResponse.json({ error: 'Failed to log instance.' }, { status: 500 });
  }
}

export async function GET(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

  const sbConfig = requireSupabase();
  if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const { url: supabaseUrl, key: supabaseKey } = sbConfig;

  try {
    const sp = request.nextUrl.searchParams;
    const email = sp.get('email');
    const reportId = sp.get('reportId');
    const processName = sp.get('processName');
    const lim = sp.get('limit');

    if (!email && !reportId) return NextResponse.json({ error: 'email or reportId is required.' }, { status: 400 });

    // Scope to authenticated user: email must match, or reportId must be owned
    const userEmail = auth.email.toLowerCase();
    let filter = '';
    if (email) {
      if (!isValidEmail(email) || email.toLowerCase() !== userEmail) {
        return NextResponse.json({ error: 'You can only query instances for your own email.' }, { status: 403 });
      }
      filter = `email=ilike.${encodeURIComponent(userEmail)}`;
    } else {
      if (!reportId || !isValidUUID(reportId)) return NextResponse.json({ error: 'Valid reportId required.' }, { status: 400 });
      // Verify report ownership
      const reportResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}&select=contact_email`, { method: 'GET', headers: getSupabaseHeaders(supabaseKey) });
      let reportRows;
      try { reportRows = reportResp.ok ? await reportResp.json() : []; } catch (e) { logger.error('Get instances: Supabase report parse error', { requestId: getRequestId(request), error: e.message }); return NextResponse.json({ error: 'Failed to verify report.' }, { status: 502 }); }
      if (!reportRows?.length || (reportRows[0].contact_email || '').toString().toLowerCase() !== userEmail) {
        return NextResponse.json({ error: 'You do not have permission to access this report.' }, { status: 403 });
      }
      filter = `report_id=eq.${encodeURIComponent(reportId)}`;
    }
    if (processName) filter += `&process_name=eq.${encodeURIComponent(processName)}`;

    const rowLimit = Math.min(parseInt(lim) || 200, 500);
    const url = `${supabaseUrl}/rest/v1/process_instances?${filter}&select=*&order=logged_at.desc&limit=${rowLimit}`;

    const sbResp = await fetchWithTimeout(url, {
      method: 'GET',
      headers: getSupabaseHeaders(supabaseKey)
    });

    if (!sbResp.ok) return NextResponse.json({ error: 'Failed to fetch instances.' }, { status: 502 });
    let rows;
    try { rows = await sbResp.json(); } catch (e) { logger.error('Get instances: Supabase parse error', { requestId: getRequestId(request), error: e.message }); return NextResponse.json({ error: 'Failed to fetch instances.' }, { status: 502 }); }

    const byProcess = {};
    rows.forEach(r => {
      const key = r.process_name || 'Unknown';
      if (!byProcess[key]) byProcess[key] = { started: 0, completed: 0, stuck: 0, waiting: 0, cancelled: 0, inProgress: 0, instances: [] };
      byProcess[key][r.status === 'in-progress' ? 'inProgress' : r.status] = (byProcess[key][r.status === 'in-progress' ? 'inProgress' : r.status] || 0) + 1;
      byProcess[key].instances.push(r);
    });

    Object.keys(byProcess).forEach(proc => {
      const instances = byProcess[proc].instances;
      const completed = instances.filter(i => i.status === 'completed');
      const started = instances.filter(i => i.status === 'started');
      const completionTimes = [];
      completed.forEach(c => {
        const match = started.find(s => s.instance_name && s.instance_name === c.instance_name);
        if (match) {
          const days = (new Date(c.logged_at) - new Date(match.logged_at)) / (1000 * 60 * 60 * 24);
          if (days > 0 && days < 365) completionTimes.push(days);
        }
      });
      byProcess[proc].avgCompletionDays = completionTimes.length > 0
        ? Math.round(completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length * 10) / 10
        : null;
      byProcess[proc].totalInstances = instances.length;
    });

    return NextResponse.json({ success: true, totalEvents: rows.length, processes: byProcess, recentEvents: rows.slice(0, 20) });
  } catch (error) {
    logger.error('Get instances error', { requestId: getRequestId(request), error: error.message, stack: error.stack });
    return NextResponse.json({ error: 'Failed to retrieve instances.' }, { status: 500 });
  }
}
