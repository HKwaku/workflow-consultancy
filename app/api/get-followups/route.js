import { NextResponse } from 'next/server';
import { getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase, getRequestId, checkOrigin } from '@/lib/api-helpers';
import { GetFollowupsPostSchema } from '@/lib/ai-schemas';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

const FOLLOWUP_CONFIG = {
  day3: {
    subject: 'Quick check-in on your diagnostic results',
    message: 'Hi {name}, it\'s been a few days since you completed your workflow diagnostic. Have you had a chance to review your results? Your report is still available and includes actionable insights you can start implementing today.',
  },
  day14: {
    subject: 'Your quick wins are waiting  -  let\'s make them happen',
    message: 'Hi {name}, two weeks ago you uncovered real opportunities to improve your workflows. Companies that act on quick wins within 30 days see results 3x faster. Ready to talk through your top priorities?',
  },
  day30: {
    subject: 'Your 90-day roadmap  -  time to put it into action',
    message: 'Hi {name}, a month has passed since your diagnostic. Your personalised 90-day transformation plan is designed to deliver measurable results within the first quarter. Let\'s schedule a strategy session to get started.',
  },
};

function requireFollowupAuth(request) {
  const key = process.env.FOLLOWUP_API_KEY;
  if (!key) return { error: 'Follow-up API not configured.' };
  const provided = request.headers.get('x-api-key') || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!provided || provided !== key) return { error: 'Invalid or missing API key.' };
  return { ok: true };
}

export async function GET(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });
  const auth = requireFollowupAuth(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: 401 });

  const rl = checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

  try {
    const sbConfig = requireSupabase();
    if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;

    const now = new Date().toISOString();
    const resp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/followup_events?status=eq.pending&scheduled_for=lte.${encodeURIComponent(now)}&select=id,report_id,contact_email,contact_name,company,followup_type&order=scheduled_for.asc&limit=100`,
      { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
    );
    if (!resp.ok) return NextResponse.json({ error: 'Failed to fetch follow-ups.' }, { status: 502 });

    let rows;
    try { rows = await resp.json(); } catch (e) { logger.error('Get follow-ups: Supabase parse error', { requestId: getRequestId(request), error: e.message }); return NextResponse.json({ error: 'Failed to fetch follow-ups.' }, { status: 502 }); }
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ totalDue: 0, followups: [] });
    }

    const followups = rows.map((row) => {
      const cfg = FOLLOWUP_CONFIG[row.followup_type] || FOLLOWUP_CONFIG.day3;
      const name = row.contact_name || 'there';
      return {
        id: row.id,
        reportId: row.report_id,
        email: row.contact_email,
        name,
        company: row.company || '',
        followupType: row.followup_type,
        subject: cfg.subject,
        message: cfg.message.replace(/\{name\}/g, name),
      };
    });

    return NextResponse.json({ totalDue: followups.length, followups });
  } catch (error) {
    logger.error('Get follow-ups error', { requestId: getRequestId(request), error: error.message, stack: error.stack });
    return NextResponse.json({ error: 'Failed to retrieve follow-ups.' }, { status: 500 });
  }
}

export async function POST(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });
  const auth = requireFollowupAuth(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: 401 });

  const rl = checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

  const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
  if (contentLength > 2 * 1024 * 1024) return NextResponse.json({ error: 'Request body too large.' }, { status: 413 });

  try {
    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
    const parsed = GetFollowupsPostSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid input. reportId must be UUID, followupType must be day3, day14, or day30.' }, { status: 400 });
    const { reportId, followupType } = parsed.data;

    const sbConfig = requireSupabase();
    if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;

    const now = new Date().toISOString();
    const patchResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/followup_events?report_id=eq.${encodeURIComponent(reportId)}&followup_type=eq.${encodeURIComponent(followupType)}&status=eq.pending`,
      {
        method: 'PATCH',
        headers: getSupabaseWriteHeaders(supabaseKey),
        body: JSON.stringify({ status: 'sent', sent_at: now }),
      }
    );

    if (!patchResp.ok && patchResp.status !== 204) {
      return NextResponse.json({ error: 'Failed to mark follow-up as sent.' }, { status: 502 });
    }

    return NextResponse.json({ success: true, message: 'Follow-up marked as sent.' });
  } catch (error) {
    logger.error('Mark follow-up error', { requestId: getRequestId(request), error: error.message, stack: error.stack });
    return NextResponse.json({ error: 'Failed to mark follow-up.' }, { status: 500 });
  }
}
