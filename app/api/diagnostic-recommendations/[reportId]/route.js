import { NextResponse } from 'next/server';
import { getSupabaseHeaders, getSupabaseWriteHeaders, requireSupabase, fetchWithTimeout, getRequestId, checkOrigin, isValidUUID } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

/**
 * PATCH /api/diagnostic-recommendations/[reportId]
 * Body: { recommendationId, reviewStatus: 'approved'|'rejected'|'pending', reviewNote? }
 * Updates a single recommendation's review state in diagnostic_data.recommendations[].
 * Caller must own the report (contact_email matches authed session).
 */
export async function PATCH(request, ctx) {
  try {
    const originErr = checkOrigin(request);
    if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

    const auth = await requireAuth(request);
    if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

    const rl = await checkRateLimit(getRateLimitKey(request));
    if (!rl.allowed) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

    const { reportId } = await ctx.params;
    if (!reportId || !isValidUUID(reportId)) return NextResponse.json({ error: 'Valid report ID required.' }, { status: 400 });

    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
    const { recommendationId, reviewStatus, reviewNote } = body || {};
    if (!recommendationId || typeof recommendationId !== 'string') return NextResponse.json({ error: 'recommendationId required.' }, { status: 400 });
    if (!['approved', 'rejected', 'pending'].includes(reviewStatus)) return NextResponse.json({ error: 'reviewStatus must be approved, rejected, or pending.' }, { status: 400 });
    if (reviewNote !== undefined && (typeof reviewNote !== 'string' || reviewNote.length > 1000)) return NextResponse.json({ error: 'reviewNote too long.' }, { status: 400 });

    const sbConfig = requireSupabase();
    if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;

    const readResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}&select=id,contact_email,diagnostic_data`,
      { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
    );
    if (!readResp.ok) return NextResponse.json({ error: 'Failed to read report.' }, { status: 502 });
    let rows;
    try { rows = await readResp.json(); } catch { return NextResponse.json({ error: 'Failed to read report.' }, { status: 502 }); }
    if (!rows || rows.length === 0) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });

    const row = rows[0];
    if ((row.contact_email || '').toLowerCase() !== auth.email.toLowerCase()) {
      return NextResponse.json({ error: 'You do not have permission to review this report.' }, { status: 403 });
    }

    const dd = row.diagnostic_data || {};
    const recs = Array.isArray(dd.recommendations) ? dd.recommendations : [];
    const idx = recs.findIndex((r) => r && r.id === recommendationId);
    if (idx === -1) return NextResponse.json({ error: 'Recommendation not found on this report.' }, { status: 404 });

    const now = new Date().toISOString();
    const updatedRec = {
      ...recs[idx],
      reviewStatus,
      reviewedBy: auth.email,
      reviewedAt: now,
      ...(reviewNote !== undefined ? { reviewNote } : {}),
    };
    const nextRecs = [...recs.slice(0, idx), updatedRec, ...recs.slice(idx + 1)];
    const nextDd = { ...dd, recommendations: nextRecs };

    const writeResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}`,
      { method: 'PATCH', headers: getSupabaseWriteHeaders(supabaseKey), body: JSON.stringify({ diagnostic_data: nextDd, updated_at: now }) }
    );
    if (!writeResp.ok) {
      const t = await writeResp.text().catch(() => '');
      logger.warn('review PATCH write failed', { requestId: getRequestId(request), status: writeResp.status, body: t.slice(0, 300) });
      return NextResponse.json({ error: 'Write failed.' }, { status: 502 });
    }
    return NextResponse.json({ success: true, recommendation: updatedRec });
  } catch (e) {
    logger.error('review PATCH error', { requestId: getRequestId(request), error: e.message });
    return NextResponse.json({ error: 'Failed to update recommendation.' }, { status: 500 });
  }
}
