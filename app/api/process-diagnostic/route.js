import { fetchWithTimeout, checkOrigin, getRequestId } from '@/lib/api-helpers';
import { logger } from '@/lib/logger';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { ProcessDiagnosticInputSchema } from '@/lib/ai-schemas';
import { generateMermaidCode } from '@/lib/mermaid-helper';
import { calculateAutomationScore, generateRuleBasedRecommendations, calculateProcessQuality } from '@/lib/diagnostic/buildLocalResults';
import { withRetry } from '@/lib/ai-retry';
import { runRecommendationsAgent } from '@/lib/agents/recommendations/graph';
import { runFlowConsistencyAgent } from '@/lib/agents/flow/graph';
import { getModule } from '@/lib/modules/index';
import { NextResponse } from 'next/server';

export const maxDuration = 120;

export async function POST(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

  const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
  if (contentLength > 2 * 1024 * 1024) return NextResponse.json({ error: 'Request body too large.' }, { status: 413 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  const parsed = ProcessDiagnosticInputSchema.safeParse(body);
  if (!parsed.success) {
    const err = parsed.error.flatten();
    const msg = err.formErrors?.join?.(' ') || err.errors?.[0]?.message || 'Invalid request. processes (1-50) required.';
    return NextResponse.json({ error: msg, details: err }, { status: 400 });
  }

  const { processes: rawProcesses, contact, moduleId, qualityScore, timestamp } = parsed.data;
  // Resolve module config — used to supply module-specific AI system prompt
  const moduleConfig = moduleId ? getModule(moduleId) : null;
  const reqId = getRequestId(request);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, data) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { /* client disconnected */ }
      };

      try {
        // ── Stage 1: Flow consistency ────────────────────────────
        const processCount = rawProcesses.length;
        send('progress', { message: `Validating ${processCount} process${processCount !== 1 ? 'es' : ''}…`, stage: 'flow' });

        const processes = await Promise.all(
          rawProcesses.map(async (p, idx) => {
            if (processCount > 1) {
              send('progress', { message: `Checking flow structure: ${p.processName || `Process ${idx + 1}`}…`, stage: 'flow' });
            }
            try {
              const { process: fixed, changes } = await runFlowConsistencyAgent(p, { requestId: reqId });
              if (changes.length > 0) {
                logger.info('Flow consistency agent repaired process', { requestId: reqId, processName: p.processName, changes });
              }
              return fixed;
            } catch (e) {
              logger.warn('Flow consistency agent failed for process', { requestId: reqId, processName: p.processName, error: e.message });
              return p;
            }
          })
        );

        // ── Stage 2: Process metrics ─────────────────────────────
        send('progress', { message: 'Calculating costs and automation potential…', stage: 'metrics' });

        const processResults = processes.map(p => {
          const quality = calculateProcessQuality(p);
          return { name: p.processName, type: p.processType, elapsedDays: p.costs?.cycleDays || p.lastExample?.elapsedDays || 0, annualCost: p.costs?.totalAnnualCost || 0, annualInstances: p.frequency?.annual || 0, teamSize: p.costs?.teamSize || 1, stepsCount: (p.steps || []).length, quality, bottleneck: p.bottleneck || {}, priority: p.priority || {} };
        });

        const totalCost = processResults.reduce((sum, p) => sum + p.annualCost, 0);
        const totalSavings = processes.reduce((sum, p) => {
          const cost = p.costs?.totalAnnualCost || 0;
          if (!cost) return sum;
          if (p.savings?.percent) return sum + cost * (p.savings.percent / 100);
          const handoffs = p.handoffs || [];
          const poorHandoffs = handoffs.filter(h => h.clarity === 'yes-multiple' || h.clarity === 'yes-major' || h.method === 'they-knew').length;
          const waitHeavy = (p.userTime?.waiting || 0) > (p.userTime?.execution || 0);
          const autoScore = calculateAutomationScore([p]);
          const automationSavings = Math.min(25, (autoScore.percentage / 100) * 30);
          const handoffSavings = Math.min(10, (poorHandoffs / Math.max(1, handoffs.length)) * 15);
          const waitSavings = waitHeavy ? 8 : 0;
          const pct = Math.min(45, Math.round(automationSavings + handoffSavings + waitSavings));
          return sum + cost * (pct / 100);
        }, 0);

        // ── Stage 3: AI recommendations ──────────────────────────
        send('progress', { message: 'Consulting industry benchmarks and frameworks…', stage: 'recommendations' });

        let recommendations;
        let isAIEnhanced = false;
        try {
          recommendations = await withRetry(
            () => runRecommendationsAgent(
              processes,
              contact,
              (msg) => send('progress', { message: msg, stage: 'recommendations' }),
              reqId,
              moduleConfig
            ),
            { maxAttempts: 2, baseDelayMs: 1000, label: 'AI recommendations agent', logger }
          );
          isAIEnhanced = true;
        } catch (aiError) {
          logger.warn('Recommendations agent failed, falling back to rule-based', { requestId: reqId, error: aiError.message });
          send('progress', { message: 'Using rule-based analysis…', stage: 'recommendations' });
          recommendations = generateRuleBasedRecommendations(processes);
        }

        // ── Stage 4: Flow diagram ────────────────────────────────
        send('progress', { message: 'Generating flow diagrams…', stage: 'diagrams' });

        let flowDiagramUrl = null;
        try { flowDiagramUrl = await triggerN8nFlowDiagram(processes, contact); } catch { /* skip */ }

        const automationScore = calculateAutomationScore(processes);

        // ── Done ─────────────────────────────────────────────────
        send('progress', { message: 'Preparing your report…', stage: 'saving' });

        send('done', {
          success: true,
          processes: processResults,
          totalCost,
          potentialSavings: totalSavings,
          recommendations,
          automationScore,
          flowDiagramUrl,
          qualityScore,
          analysisType: isAIEnhanced ? 'ai-enhanced' : 'rule-based',
          timestamp,
        });
      } catch (error) {
        logger.error('Process diagnostic error', { requestId: reqId, error: error.message, stack: error.stack });
        send('error', { error: 'Analysis failed.' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

async function triggerN8nFlowDiagram(processes, contact) {
  const webhookUrl = process.env.N8N_FLOW_DIAGRAM_WEBHOOK_URL;
  if (!webhookUrl || (!webhookUrl.startsWith('http://') && !webhookUrl.startsWith('https://'))) return null;
  const mermaidCode = generateMermaidCode(processes);
  const flowData = processes.map(p => ({ processName: p.processName, processType: p.processType, startsWhen: p.definition?.startsWhen || '', completesWhen: p.definition?.completesWhen || '', steps: (p.steps || []).map(s => { const step = { number: s.number, name: s.name, department: s.department }; if (s.isDecision && s.branches?.length > 0) { step.isDecision = true; step.branches = s.branches; } if (s.isExternal) step.isExternal = true; return step; }), handoffs: (p.handoffs || []).map(h => ({ from: { name: h.from?.name, department: h.from?.department }, to: { name: h.to?.name, department: h.to?.department }, method: h.method, clarity: h.clarity })), approvals: (p.approvals || []).map(a => ({ name: a.name, who: a.who, assessment: a.assessment })), systems: (p.systems || []).map(s => ({ name: s.name, purpose: s.purpose, actions: s.actions || [] })), bottleneck: p.bottleneck || {}, costs: { totalAnnualCost: p.costs?.totalAnnualCost || 0, instanceCost: p.costs?.instanceCost || 0, elapsedDays: p.lastExample?.elapsedDays || 0, annualInstances: p.frequency?.annual || 0, teamSize: p.costs?.teamSize || 1 } }));
  const response = await fetchWithTimeout(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestType: 'flow-diagram', processes: flowData, mermaidCode, contact: { name: contact?.name || '', email: contact?.email || '', company: contact?.company || '' }, timestamp: new Date().toISOString() }) });
  if (!response.ok) throw new Error('n8n webhook returned ' + response.status);
  let result;
  try { result = await response.json(); } catch { return null; }
  return result?.diagramUrl || null;
}

