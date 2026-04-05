import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSupabaseHeaders, getSupabaseWriteHeaders, stripEmDashes, requireSupabase, fetchWithTimeout, getRequestId, checkOrigin } from '@/lib/api-helpers';
import { GenerateRedesignSchema } from '@/lib/ai-schemas';
import { runRedesignAgent } from '@/lib/agents/redesign/graph';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export const maxDuration = 120;

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

  const rl = await checkRateLimit(getRateLimitKey(request));
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
    segment: d.contact?.segment || '',
    ...(d.contact?.maEntity && { maEntity: d.contact.maEntity }),
    ...(d.contact?.maTimeline && { maTimeline: d.contact.maTimeline }),
    ...(d.contact?.peStage && { peStage: d.contact.peStage }),
    ...(d.contact?.highStakesType && { highStakesType: d.contact.highStakesType }),
    ...(d.contact?.highStakesDeadline && { highStakesDeadline: d.contact.highStakesDeadline }),
    processes: (d.processes || []).map(p => ({ name: p.name, type: p.type, annualCost: p.annualCost, stepsCount: p.stepsCount, elapsedDays: p.elapsedDays, steps: (p.steps || []).map(s => ({ name: s.name, type: s.type, handoff: s.handoff, automatable: s.automatable, bottleneck: s.bottleneck, painPoints: s.painPoints })) })),
    rawProcesses: rawProcesses.map(rp => {
      const steps = rp.steps || [];

      // Translate canvas edge state to step-name-based descriptions for the agent.
      // Custom edges: user manually drew a connection between two steps.
      const manualConnections = (rp.flowCustomEdges || [])
        .map(e => {
          const srcM = e.source?.match(/^step-(\d+)$/);
          const tgtM = e.target?.match(/^step-(\d+)$/);
          if (!srcM || !tgtM) return null;
          const src = steps[parseInt(srcM[1])];
          const tgt = steps[parseInt(tgtM[1])];
          if (!src || !tgt) return null;
          return { from: src.name || `Step ${parseInt(srcM[1]) + 1}`, to: tgt.name || `Step ${parseInt(tgtM[1]) + 1}` };
        })
        .filter(Boolean);

      // Deleted edges: user explicitly removed a sequential connection between two steps.
      const removedConnections = (rp.flowDeletedEdges || [])
        .map(id => {
          const m = id.match(/^e-seq-(\d+)-(\d+)$/);
          if (!m) return null;
          const src = steps[parseInt(m[1])];
          const tgt = steps[parseInt(m[2])];
          if (!src || !tgt) return null;
          return { from: src.name || `Step ${parseInt(m[1]) + 1}`, to: tgt.name || `Step ${parseInt(m[2]) + 1}` };
        })
        .filter(Boolean);

      // Derive per-step cost for easy reference by the analysis model
      const hourlyRate = rp.costs?.hourlyRate || 0;
      const annualRuns = rp.frequency?.annual || 0;

      return {
        processName: rp.processName,
        // Cost summary surfaced prominently so the agent can use real numbers
        costSummary: rp.costs ? {
          totalAnnualCost: rp.costs.totalAnnualCost,
          hoursPerInstance: rp.costs.hoursPerInstance,
          hourlyRate: rp.costs.hourlyRate,
          teamSize: rp.costs.teamSize,
          annualRuns,
          costPerHourFormula: `${rp.costs.hoursPerInstance}h × £${hourlyRate}/hr × ${annualRuns} runs/yr × ${rp.costs.teamSize} people`,
        } : null,
        steps: steps.map((s, si) => ({
          number: s.number ?? si + 1,
          name: s.name,
          department: s.department,
          isDecision: s.isDecision || false,
          isExternal: s.isExternal || false,
          branches: s.branches || [],
          ...(s.systems?.length && { systems: s.systems }),
          ...(s.workMinutes != null && { workMinutes: s.workMinutes }),
          ...(s.waitMinutes != null && { waitMinutes: s.waitMinutes }),
          ...(s.parallel && { parallel: true }),
          // Cost per step for reference
          ...(hourlyRate && s.workMinutes ? { estimatedStepCost: Math.round((s.workMinutes / 60) * hourlyRate * annualRuns) } : {}),
        })),
        handoffs: (rp.handoffs || []).map(h => ({ from: h.from?.name, to: h.to?.name, method: h.method, clarity: h.clarity })),
        ...(manualConnections.length > 0 && { manualConnections }),
        ...(removedConnections.length > 0 && { removedConnections }),
        bottleneck: rp.bottleneck, issues: rp.issues || [], biggestDelay: rp.biggestDelay,
        frequency: rp.frequency ? { type: rp.frequency.type, annual: rp.frequency.annual, inFlight: rp.frequency.inFlight } : null,
        userTime: rp.userTime ? { execution: rp.userTime.execution, waiting: rp.userTime.waiting, total: rp.userTime.total } : null,
        lastExample: rp.lastExample?.elapsedDays != null ? { elapsedDays: rp.lastExample.elapsedDays } : null,
      };
    }),
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
    send('started', { message: 'Analysis started' });
    send('progress', { message: 'Loading your diagnostic data…' });

    const timeoutId = setTimeout(() => {
      try {
        send('timeout', { message: 'Taking longer than expected — please try again if this does not complete.' });
      } catch {}
    }, 110000);

    let redesign;
    try {
      redesign = stripEmDashes(
        await runRedesignAgent(diagnosticContext, (msg) => {
          send('progress', { message: msg });
        }, getRequestId(request))
      );
    } catch (agentErr) {
      clearTimeout(timeoutId);
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

    clearTimeout(timeoutId);
    send('done', { success: true, reportId, redesign, needsSaveChoice: !!regenerate });
  });
}
