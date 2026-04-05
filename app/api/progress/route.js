import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSupabaseHeaders, isValidUUID, fetchWithTimeout, requireSupabase, checkOrigin, getRequestId } from '@/lib/api-helpers';
import { ProgressInputSchema } from '@/lib/ai-schemas';
import { triggerWebhook } from '@/lib/triggerWebhook';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024; // 2MB

export async function POST(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

  const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
  if (contentLength > MAX_PAYLOAD_BYTES) return NextResponse.json({ error: 'Request body too large.' }, { status: 413 });

  try {
    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
    const parsed = ProgressInputSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid progress data.' }, { status: 400 });
    const { email, progressData, currentScreen, processName, isHandover, senderName, comments } = parsed.data;

    const payloadSize = JSON.stringify(progressData).length;
    if (payloadSize > 2 * 1024 * 1024) return NextResponse.json({ error: 'Progress data too large.' }, { status: 413 });

    const sbConfig = requireSupabase();
    if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;

    const progressId = body.progressId || crypto.randomUUID();
    const isUpdate = !!body.progressId;

    const proto = request.headers.get('x-forwarded-proto') || 'https';
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3000';
    const teamCode = progressData?.teamMode?.code;
    const step = body.step != null ? body.step : null;
    let resumeUrl = `${proto}://${host}/process-audit?resume=${progressId}`;
    if (teamCode) resumeUrl += `&team=${teamCode}`;
    if (step != null) resumeUrl += `&step=${step}`;

    if (senderName) progressData.handoverSender = senderName;
    if (comments) progressData.handoverComments = comments;

    const payload = {
      id: progressId, email: email || null, process_name: processName || null,
      current_screen: currentScreen || 0, progress_data: progressData, updated_at: new Date().toISOString()
    };
    if (!isUpdate) payload.created_at = new Date().toISOString();

    let sbResp;
    try {
      sbResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/diagnostic_progress`, {
        method: 'POST',
        headers: { ...getSupabaseHeaders(supabaseKey), 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(payload)
      });
    } catch (fetchErr) {
      logger.error('Save progress: Supabase fetch failed', { requestId: getRequestId(request), error: fetchErr.message });
      return NextResponse.json({ error: 'Failed to save progress. Storage unavailable.' }, { status: 503 });
    }

    if (!sbResp.ok && sbResp.status !== 201) {
      let sbError = '';
      try { const errBody = await sbResp.text(); sbError = errBody?.slice(0, 200) || ''; } catch { /* ignore */ }
      logger.error('Save progress: Supabase rejected', { requestId: getRequestId(request), status: sbResp.status, body: sbError });
      return NextResponse.json({ error: 'Failed to save progress.' }, { status: 502 });
    }

    let emailSent = false;
    if (email) {
      const isHandoverReq = isHandover === true || (isHandover !== false && !!senderName);
      const webhookSuffix = isHandoverReq ? 'HANDOVER' : 'SAVE_PROGRESS';
      const { sent } = await triggerWebhook({
        requestType: isHandoverReq ? 'handover' : 'save-progress',
        progressId,
        resumeUrl,
        email,
        processName: processName || 'your diagnostic',
        currentScreen: currentScreen || 0,
        screenLabel: getScreenLabel(currentScreen),
        senderName: senderName || null,
        comments: comments || null,
        timestamp: new Date().toISOString(),
      }, { envSuffix: webhookSuffix, requestId: getRequestId(request) });
      emailSent = sent;
    }

    return NextResponse.json({
      success: true, progressId, resumeUrl, emailSent,
      message: emailSent ? 'Progress saved! A resume link has been sent to your email.' : email ? 'Progress saved! Email delivery is not configured, but you can use the link below.' : 'Progress saved!'
    });
  } catch (error) {
    logger.error('Save progress error', { requestId: getRequestId(request), error: error.message, stack: error.stack });
    const devHint = process.env.NODE_ENV === 'development' ? error.message : undefined;
    return NextResponse.json({ error: 'Failed to save progress.', ...(devHint && { _devHint: devHint }) }, { status: 500 });
  }
}

export async function GET(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });
  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Progress ID is required. Use ?id=xxx' }, { status: 400 });
    if (!isValidUUID(id)) return NextResponse.json({ error: 'Invalid progress ID format.' }, { status: 400 });

    const sbConfig = requireSupabase();
    if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;

    const url = `${supabaseUrl}/rest/v1/diagnostic_progress?id=eq.${id}&select=*`;
    const sbResp = await fetchWithTimeout(url, { method: 'GET', headers: getSupabaseHeaders(supabaseKey) });
    if (!sbResp.ok) return NextResponse.json({ error: 'Failed to fetch progress from storage.' }, { status: 502 });
    let rows;
    try { rows = await sbResp.json(); } catch (e) { logger.error('Load progress: Supabase parse error', { requestId: getRequestId(request), error: e.message }); return NextResponse.json({ error: 'Failed to fetch progress from storage.' }, { status: 502 }); }
    if (!rows || rows.length === 0) return NextResponse.json({ error: 'Saved progress not found.' }, { status: 404 });

    const progress = rows[0];
    const createdAt = new Date(progress.created_at || progress.updated_at);
    const ageDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > 30) return NextResponse.json({ error: 'This saved progress has expired (older than 30 days).' }, { status: 410 });

    return NextResponse.json({
      success: true,
      progress: { id: progress.id, email: progress.email, processName: progress.process_name, currentScreen: progress.current_screen, progressData: progress.progress_data, updatedAt: progress.updated_at, createdAt: progress.created_at }
    });
  } catch (error) {
    logger.error('Load progress error', { requestId: getRequestId(request), error: error.message, stack: error.stack });
    return NextResponse.json({ error: 'Failed to retrieve saved progress.' }, { status: 500 });
  }
}

function getScreenLabel(screen) {
  const labels = { 0: 'Getting Started', 1: 'Process Definition', 2: 'Map Steps', 4: 'Cost & Impact', 5: 'Your Details', 6: 'Complete', '-2': 'Team Alignment' };
  return labels[screen] || 'In Progress';
}
