import { NextResponse } from 'next/server';
import { getSupabaseHeaders, getSupabaseWriteHeaders, requireSupabase, fetchWithTimeout, checkOrigin, getRequestId } from '@/lib/api-helpers';
import { RecommendPlatformSchema } from '@/lib/ai-schemas';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { requireAuth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { getFastModel } from '@/lib/agents/models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { WORKFLOW_PLATFORMS } from '@/lib/agents/workflow-export/platforms';

const PLATFORM_IDS = WORKFLOW_PLATFORMS.map((p) => p.id).join(', ');
const VALID_IDS = PLATFORM_IDS.split(', ');

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
    const parsed = RecommendPlatformSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Valid report ID required.' }, { status: 400 });
    const { reportId } = parsed.data;

    const sbConfig = requireSupabase();
    if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;

    const rdUrl = `${supabaseUrl}/rest/v1/report_redesigns?report_id=eq.${reportId}&select=id,redesign_data,status&order=created_at.desc&limit=1`;
    const rdResp = await fetchWithTimeout(rdUrl, { method: 'GET', headers: getSupabaseHeaders(supabaseKey) });
    let rdRows = [];
    try { rdRows = rdResp.ok ? await rdResp.json() : []; } catch (e) { logger.error('Recommend platform: Supabase parse error', { requestId: getRequestId(request), error: e.message }); return NextResponse.json({ error: 'Failed to fetch redesign.' }, { status: 502 }); }
    if (!rdRows.length || rdRows[0].status !== 'accepted') {
      return NextResponse.json({ error: 'No accepted redesign found.' }, { status: 400 });
    }

    // Verify report ownership via diagnostic_reports
    const reportUrl = `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}&select=contact_email`;
    const reportResp = await fetchWithTimeout(reportUrl, { method: 'GET', headers: getSupabaseHeaders(supabaseKey) });
    let reportRows = [];
    try { reportRows = reportResp.ok ? await reportResp.json() : []; } catch (e) { logger.error('Recommend platform: Supabase parse error', { requestId: getRequestId(request), error: e.message }); return NextResponse.json({ error: 'Failed to verify report.' }, { status: 502 }); }
    if (reportRows?.length && (reportRows[0].contact_email || '').toString().toLowerCase() !== auth.email.toLowerCase()) {
      return NextResponse.json({ error: 'You do not have permission to access this report.' }, { status: 403 });
    }

    const rdRow = rdRows[0];
    const redesign = rdRow.redesign_data || {};

    // Fetch segment from diagnostic report for context-aware ranking
    let reportSegment = '';
    try {
      const segResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}&select=diagnostic_data`, { method: 'GET', headers: getSupabaseHeaders(supabaseKey) });
      const segRows = segResp.ok ? await segResp.json() : [];
      reportSegment = segRows[0]?.diagnostic_data?.contact?.segment || '';
    } catch { /* non-fatal */ }

    // Return cached recommendations if available
    const cached = redesign.recommended_top3;
    if (Array.isArray(cached) && cached.length >= 3 && cached.every((id) => VALID_IDS.includes(id))) {
      const top3 = cached.slice(0, 3);
      return NextResponse.json({
        recommended: top3[0],
        recommendedTop3: top3,
        platforms: WORKFLOW_PLATFORMS.map((p) => ({
          id: p.id,
          name: p.name,
          bestFor: p.bestFor,
          rank: top3.indexOf(p.id) + 1,
        })),
      });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'AI not configured.' }, { status: 503 });
    }

    const processes = redesign.acceptedProcesses || redesign.optimisedProcesses || [];
    const processDesc = processes
      .map((p) => {
        const steps = (p.steps || []).filter((s) => s.status !== 'removed');
        return `${p.processName || p.name}: ${steps.length} steps. Departments: ${[...new Set(steps.map((s) => s.department).filter(Boolean))].join(', ') || 'unspecified'}. Systems: ${steps.flatMap((s) => s.systems || []).filter(Boolean).length} mentioned. Decisions: ${steps.filter((s) => s.isDecision).length}.`;
      })
      .join('\n');

    const SEGMENT_PLATFORM_HINTS = {
      ma: 'This is an M&A integration context - prioritise platforms with strong governance, audit trails, and multi-entity support.',
      pe: 'This is a private equity context - prioritise platforms with rapid ROI, minimal IT overhead, and clear cost tracking.',
      highstakes: 'This is a high-stakes event context - prioritise platforms with reliability, rollback support, and fast onboarding.',
      scaling: 'This is a scaling business context - prioritise platforms that handle high volume, support delegation, and integrate with existing tools.',
    };
    const segmentHint = reportSegment && SEGMENT_PLATFORM_HINTS[reportSegment] ? `\n${SEGMENT_PLATFORM_HINTS[reportSegment]}` : '';

    const systemPrompt = `You recommend workflow automation platforms based on a process redesign. Reply with exactly 3 platform ids from this list, in order of best fit first: ${PLATFORM_IDS}. Format: id1, id2, id3 (comma-separated, no other text).${segmentHint}`;
    const userPrompt = `Process redesign summary:\n${processDesc || 'No process details.'}\n\nWhich 3 platforms are the best fit, in order? Reply with exactly 3 ids, comma-separated.`;

    const model = getFastModel({ temperature: 0 });
    const response = await model.invoke([new SystemMessage(systemPrompt), new HumanMessage(userPrompt)]);
    let content = response.content;
    if (Array.isArray(content)) {
      content = content.filter((b) => b?.type === 'text').map((b) => b.text).join('');
    } else if (typeof content !== 'string') {
      content = '';
    }
    const text = String(content).trim().toLowerCase();
    const recommended = [];
    for (const part of text.split(/[,\s\n]+/)) {
      const cleaned = part.replace(/[^a-z0-9-]/g, '');
      const match = VALID_IDS.find((id) => cleaned.includes(id.replace(/-/g, '')) || id.replace(/-/g, '').includes(cleaned));
      if (match && !recommended.includes(match)) recommended.push(match);
    }
    const top3 = [...recommended, ...VALID_IDS.filter((id) => !recommended.includes(id))].slice(0, 3);

    // Cache recommendations in redesign_data
    try {
      const updatedRedesign = { ...redesign, recommended_top3: top3 };
      await fetchWithTimeout(`${supabaseUrl}/rest/v1/report_redesigns?id=eq.${rdRow.id}`, {
        method: 'PATCH',
        headers: getSupabaseWriteHeaders(supabaseKey),
        body: JSON.stringify({ redesign_data: updatedRedesign, updated_at: new Date().toISOString() }),
      });
    } catch (cacheErr) {
      logger.warn('Failed to cache platform recommendations', { requestId: getRequestId(request), message: cacheErr?.message });
    }

    return NextResponse.json({
      recommended: top3[0],
      recommendedTop3: top3,
      platforms: WORKFLOW_PLATFORMS.map((p) => ({
        id: p.id,
        name: p.name,
        bestFor: p.bestFor,
        rank: top3.indexOf(p.id) + 1,
      })),
    });
  } catch (error) {
    logger.error('Recommend platform error', { requestId: getRequestId(request), error: error.message, stack: error.stack });
    return NextResponse.json(
      { error: error.message || 'Failed to get recommendation.' },
      { status: 500 }
    );
  }
}
