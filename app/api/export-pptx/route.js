import { NextResponse } from 'next/server';
import { getSupabaseHeaders, requireSupabase, fetchWithTimeout, getRequestId, isValidUUID } from '@/lib/api-helpers';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { buildReportPptx } from '@/lib/exporters/reportToPptx';

/**
 * GET /api/export-pptx?id=<reportId>
 * Returns a presentation-ready .pptx for the given report.
 * Read access mirrors /api/get-diagnostic (public by design — UUID is unguessable).
 */
export async function GET(request) {
  try {
    const sp = request.nextUrl.searchParams;
    const id = sp.get('id');
    if (!id || !isValidUUID(id)) return NextResponse.json({ error: 'Valid report id required.' }, { status: 400 });

    const rl = await checkRateLimit(getRateLimitKey(request));
    if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

    const sbConfig = requireSupabase();
    if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;

    const url = `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${id}&select=id,contact_email,contact_name,company,diagnostic_data,created_at`;
    const sbResp = await fetchWithTimeout(url, { method: 'GET', headers: getSupabaseHeaders(supabaseKey) });
    if (!sbResp.ok) return NextResponse.json({ error: 'Failed to fetch report.' }, { status: 502 });
    let rows;
    try { rows = await sbResp.json(); } catch { return NextResponse.json({ error: 'Failed to parse report.' }, { status: 502 }); }
    if (!rows || !rows.length) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });

    const r = rows[0];
    const buf = await buildReportPptx({
      id: r.id,
      contactName: r.contact_name || '',
      company: r.company || '',
      diagnosticData: r.diagnostic_data || {},
      createdAt: r.created_at || null,
    });

    const safeName = (r.company || r.contact_name || 'diagnostic').toString().replace(/[^a-z0-9-_ ]/gi, '_').slice(0, 60).trim() || 'diagnostic';
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="${safeName} - process audit.pptx"`,
        'Cache-Control': 'private, max-age=0, no-store',
      },
    });
  } catch (e) {
    logger.error('export-pptx error', { requestId: getRequestId(request), error: e.message, stack: e.stack });
    return NextResponse.json({ error: 'Failed to build pptx.' }, { status: 500 });
  }
}
