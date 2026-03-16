import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSupabaseHeaders, getSupabaseWriteHeaders, stripEmDashes, requireSupabase, fetchWithTimeout, getRequestId, checkOrigin } from '@/lib/api-helpers';
import { GenerateRedesignSchema } from '@/lib/ai-schemas';
import { runRedesignAgent } from '@/lib/agents/redesign/graph';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export const maxDuration = 60;

function sseStream(request, handler) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, data) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        await handler(send);
      } catch (err) {
        logger.error('Redesign SSE stream error', { requestId: getRequestId(request), error: err.message, stack: err.stack });
        send('error', { error: err.message || 'Unexpected error.' });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

export async function POST(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
  const email = auth.email;

  const rl = checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

  const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
  if (contentLength > 2 * 1024 * 1024) return NextResponse.json({ error: 'Request body too large.' }, { status: 413 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  const parsed = GenerateRedesignSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Valid report ID required.' }, { status: 400 });
  const { reportId, regenerate } = parsed.data;

  const sbConfig = requireSupabase();
  if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const { url: supabaseUrl, key: supabaseKey } = sbConfig;
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'AI service not configured.' }, { status: 503 });

  const sbHeaders = getSupabaseHeaders(supabaseKey);

  const url = `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}&contact_email=ilike.${encodeURIComponent(email.toLowerCase())}&select=id,diagnostic_data,contact_name,company`;
  const sbResp = await fetchWithTimeout(url, { method: 'GET', headers: sbHeaders });
  if (!sbResp.ok) return NextResponse.json({ error: 'Failed to fetch report from storage.' }, { status: 502 });

  let rows;
  try { rows = await sbResp.json(); } catch (e) { logger.error('Generate redesign: Supabase parse error', { requestId: getRequestId(request), error: e.message }); return NextResponse.json({ error: 'Failed to fetch report from storage.' }, { status: 502 }); }
  if (!rows || rows.length === 0) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });

  const report = rows[0];
  const d = report.diagnostic_data || {};

  if (!regenerate) {
    const rdUrl = `${supabaseUrl}/rest/v1/report_redesigns?report_id=eq.${reportId}&select=redesign_data,decisions,status,accepted_at&order=created_at.desc&limit=1`;
    const rdResp = await fetchWithTimeout(rdUrl, { method: 'GET', headers: sbHeaders });
    let rdRows;
    try { rdRows = rdResp.ok ? await rdResp.json() : []; } catch (e) { rdRows = []; }
    if (rdRows.length > 0) {
      const rd = rdRows[0];
      const cached = { ...rd.redesign_data, decisions: rd.decisions, status: rd.status, acceptedAt: rd.accepted_at };
      return NextResponse.json({ success: true, reportId, redesign: cached, cached: true });
    }
    if (d.redesign) return NextResponse.json({ success: true, reportId, redesign: d.redesign, cached: true });
  }

  const rawProcesses = d.rawProcesses || [];
  const diagnosticContext = JSON.stringify({
    company: report.company || d.contact?.company || '',
    processes: (d.processes || []).map(p => ({ name: p.name, type: p.type, annualCost: p.annualCost, stepsCount: p.stepsCount, elapsedDays: p.elapsedDays, steps: (p.steps || []).map(s => ({ name: s.name, type: s.type, handoff: s.handoff, automatable: s.automatable, bottleneck: s.bottleneck, painPoints: s.painPoints })) })),
    rawProcesses: rawProcesses.map(rp => ({
      processName: rp.processName,
      steps: (rp.steps || []).map(s => ({ number: s.number, name: s.name, department: s.department, isDecision: s.isDecision || false, isExternal: s.isExternal || false, branches: s.branches || [] })),
      handoffs: (rp.handoffs || []).map(h => ({ from: h.from?.name, to: h.to?.name, method: h.method, clarity: h.clarity })),
      bottleneck: rp.bottleneck, issues: rp.issues || [], biggestDelay: rp.biggestDelay,
      costs: rp.costs ? { hoursPerInstance: rp.costs.hoursPerInstance, hourlyRate: rp.costs.hourlyRate, totalAnnualCost: rp.costs.totalAnnualCost, teamSize: rp.costs.teamSize } : null,
      frequency: rp.frequency ? { type: rp.frequency.type, annual: rp.frequency.annual, inFlight: rp.frequency.inFlight } : null,
      userTime: rp.userTime ? { execution: rp.userTime.execution, waiting: rp.userTime.waiting, total: rp.userTime.total } : null,
      lastExample: rp.lastExample?.elapsedDays != null ? { elapsedDays: rp.lastExample.elapsedDays } : null,
    })),
    summary: { totalProcesses: (d.summary || {}).totalProcesses, totalAnnualCost: (d.summary || {}).totalAnnualCost, potentialSavings: (d.summary || {}).potentialSavings, automationPercentage: d.automationScore?.percentage },
    recommendations: (d.recommendations || []).slice(0, 10).map(r => r.text),
    roadmapPhases: d.roadmap?.phases ? Object.keys(d.roadmap.phases) : []
  }, null, 2);

  // Guard: reject if context is too large (~80k chars ≈ 20k tokens)
  const MAX_CONTEXT_CHARS = 80_000;
  if (diagnosticContext.length > MAX_CONTEXT_CHARS) {
    logger.warn('Redesign context too large', { requestId: getRequestId(request), chars: diagnosticContext.length });
    return NextResponse.json({ error: 'Diagnostic data is too large to process. Please reduce the number of processes or steps.' }, { status: 413 });
  }

  return sseStream(request, async (send) => {
    send('progress', { message: 'Loading your diagnostic data…' });

    let redesign;
    try {
      redesign = stripEmDashes(
        await runRedesignAgent(diagnosticContext, (msg) => {
          send('progress', { message: msg });
        }, getRequestId(request))
      );
    } catch (agentErr) {
      const errMsg = agentErr?.message || String(agentErr);
      logger.error('Redesign agent error', { requestId: getRequestId(request), error: errMsg, stack: agentErr?.stack });
      send('error', { error: `AI redesign agent failed: ${errMsg.slice(0, 200)}` });
      return;
    }

    if (!regenerate) {
      send('progress', { message: 'Saving redesign to your account…' });
      try {
        const rdPayload = {
          id: crypto.randomUUID(), report_id: reportId,
          redesign_data: { ...redesign, source: 'ai' }, decisions: {}, status: 'pending',
          created_at: new Date().toISOString(), updated_at: new Date().toISOString()
        };
        await fetchWithTimeout(`${supabaseUrl}/rest/v1/report_redesigns`, {
          method: 'POST', headers: getSupabaseWriteHeaders(supabaseKey), body: JSON.stringify(rdPayload)
        });
      } catch (rdErr) { logger.warn('Failed to save redesign to table', { requestId: getRequestId(request), message: rdErr.message }); }
      try {
        const auditEvent = {
          type: 'redesign_ai',
          detail: regenerate ? 'AI regenerated redesign' : 'AI generated redesign',
          timestamp: new Date().toISOString(),
          actor: 'AI',
        };
        const auditTrail = [...(d.auditTrail || []), auditEvent].slice(-50);
        const updatedData = { ...d, redesign, auditTrail };
        await fetchWithTimeout(`${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}`, {
          method: 'PATCH',
          headers: { ...sbHeaders, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({ diagnostic_data: updatedData, updated_at: new Date().toISOString() })
        });
      } catch (cacheErr) { logger.error('Failed to cache redesign', { requestId: getRequestId(request), error: cacheErr?.message }); }
    }

    send('done', { success: true, reportId, redesign, needsSaveChoice: !!regenerate });
  });
}
