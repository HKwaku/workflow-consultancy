import { NextResponse } from 'next/server';
import { getSupabaseHeaders, requireSupabase, fetchWithTimeout, getRequestId, checkOrigin } from '@/lib/api-helpers';
import { GenerateWorkflowExportSchema } from '@/lib/ai-schemas';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { requireAuth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { generateWorkflowExport } from '@/lib/agents/workflow-export';
import { getSupportedPlatformIds } from '@/lib/agents/workflow-export/platforms';

export async function POST(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

  const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
  if (contentLength > 2 * 1024 * 1024) return NextResponse.json({ error: 'Request body too large.' }, { status: 413 });

  try {
    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
    const parsed = GenerateWorkflowExportSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Valid report ID and platform required.' }, { status: 400 });
    const { reportId, platform, redesignId } = parsed.data;
    const supported = getSupportedPlatformIds();
    if (!supported.includes(platform)) {
      return NextResponse.json({ error: `Platform must be one of: ${supported.join(', ')}.` }, { status: 400 });
    }

    const sbConfig = requireSupabase();
    if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;

    // Fetch report and redesign (verify ownership)
    const reportUrl = `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}&select=id,contact_email,diagnostic_data`;
    const rdUrl = redesignId
      ? `${supabaseUrl}/rest/v1/report_redesigns?report_id=eq.${reportId}&id=eq.${redesignId}&select=redesign_data,status,accepted_at`
      : `${supabaseUrl}/rest/v1/report_redesigns?report_id=eq.${reportId}&select=redesign_data,status,accepted_at&order=created_at.desc&limit=1`;

    const sbHeaders = getSupabaseHeaders(supabaseKey);
    const [reportResp, rdResp] = await Promise.all([
      fetchWithTimeout(reportUrl, { method: 'GET', headers: sbHeaders }),
      fetchWithTimeout(rdUrl, { method: 'GET', headers: sbHeaders }),
    ]);

    if (!reportResp.ok) return NextResponse.json({ error: 'Failed to fetch report.' }, { status: 502 });
    let reportRows;
    try { reportRows = await reportResp.json(); } catch (e) { logger.error('Generate workflow export: Supabase parse error', { requestId: getRequestId(request), error: e.message }); return NextResponse.json({ error: 'Failed to fetch report.' }, { status: 502 }); }
    if (!reportRows?.length) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });

    const reportEmail = (reportRows[0].contact_email || '').toString().toLowerCase();
    if (reportEmail !== auth.email.toLowerCase()) {
      return NextResponse.json({ error: 'You do not have permission to export this report.' }, { status: 403 });
    }

    let rdRows;
    try { rdRows = rdResp.ok ? await rdResp.json() : []; } catch (e) { rdRows = []; }
    let acceptedProcesses = null;

    if (rdRows.length > 0) {
      const rd = rdRows[0];
      if (rd.status === 'accepted' && rd.redesign_data?.acceptedProcesses?.length) {
        acceptedProcesses = rd.redesign_data.acceptedProcesses;
      }
    }

    if (!acceptedProcesses?.length) {
      const diagData = reportRows[0].diagnostic_data || {};
      const redesign = diagData.redesign || {};
      if (redesign.acceptedAt && redesign.acceptedProcesses?.length) {
        acceptedProcesses = redesign.acceptedProcesses;
      }
    }

    if (!acceptedProcesses?.length) {
      return NextResponse.json(
        { error: 'No accepted redesign found. Accept the redesign first, then export.' },
        { status: 400 }
      );
    }

    const { workflowJson, instructions, platform: p } = await generateWorkflowExport({
      acceptedProcesses,
      platform,
    });

    return NextResponse.json({
      success: true,
      workflowJson,
      instructions,
      platform: p,
    });
  } catch (error) {
    logger.error('Generate workflow export error', { requestId: getRequestId(request), error: error.message, stack: error.stack });
    return NextResponse.json(
      { error: error.message || 'Failed to generate workflow export.' },
      { status: 500 }
    );
  }
}
