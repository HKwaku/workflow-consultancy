import { NextResponse } from 'next/server';
import { requireSupabase, fetchWithTimeout, getRequestId, checkOrigin } from '@/lib/api-helpers';
import { logger } from '@/lib/logger';

const RETENTION_DAYS = 30;

function requireCronAuth(request) {
  const key = process.env.CRON_API_KEY || process.env.FOLLOWUP_API_KEY;
  if (!key) return { error: 'Cron API not configured.' };
  const provided =
    request.headers.get('x-api-key') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!provided || provided !== key) return { error: 'Invalid or missing API key.' };
  return { ok: true };
}

export async function POST(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = requireCronAuth(request);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: 401 });

  const sbConfig = requireSupabase();
  if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const { url: supabaseUrl, key: supabaseKey } = sbConfig;

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  try {
    // Only delete unlinked progress rows (no report_id) that are older than retention period.
    // Linked rows (report_id IS NOT NULL) are kept as funnel data.
    const resp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/diagnostic_progress?updated_at=lt.${encodeURIComponent(cutoff)}&report_id=is.null`,
      {
        method: 'DELETE',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Prefer': 'return=representation,count=exact',
        },
      }
    );

    const requestId = getRequestId(request);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      logger.error('Cleanup progress: delete failed', { requestId, status: resp.status, body: errText?.slice(0, 300) });
      return NextResponse.json({ error: 'Delete failed.' }, { status: 502 });
    }

    // PostgREST returns Content-Range header with count when Prefer: count=exact
    const countHeader = resp.headers.get('content-range');
    const deleted = countHeader ? countHeader.split('/')[0] : 'unknown';
    logger.info('Cleanup progress: deleted rows', { requestId, deleted, cutoff });

    return NextResponse.json({ success: true, deleted, cutoff, retentionDays: RETENTION_DAYS });
  } catch (err) {
    logger.error('Cleanup progress error', { requestId: getRequestId(request), error: err.message });
    return NextResponse.json({ error: 'Cleanup failed.' }, { status: 500 });
  }
}
