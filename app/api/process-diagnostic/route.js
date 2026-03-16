import { NextResponse } from 'next/server';
import { fetchWithTimeout, checkOrigin, getRequestId } from '@/lib/api-helpers';
import { logger } from '@/lib/logger';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { ProcessRecommendationsSchema, ProcessDiagnosticInputSchema } from '@/lib/ai-schemas';
import { invokeStructured } from '@/lib/agents/structured-output';
import { get, set } from '@/lib/agents/ai-cache';
import { generateMermaidCode } from '@/lib/mermaid-helper';
import { calculateAutomationScore, generateRuleBasedRecommendations } from '@/lib/diagnostic/buildLocalResults';
import { recommendationsSystemPrompt, recommendationsUserPrompt } from '@/lib/prompts';
import { getFastModel } from '@/lib/agents/models';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { withRetry } from '@/lib/ai-retry';

const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024; // 2MB

export async function POST(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  try {
    const rl = checkRateLimit(getRateLimitKey(request));
    if (!rl.allowed) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

    const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_PAYLOAD_BYTES) return NextResponse.json({ error: 'Request body too large.' }, { status: 413 });

    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
    const parsed = ProcessDiagnosticInputSchema.safeParse(body);
    if (!parsed.success) {
      const err = parsed.error.flatten();
      const msg = err.formErrors?.join?.(' ') || err.errors?.[0]?.message || 'Invalid request. processes (1-50) required.';
      return NextResponse.json({ error: msg, details: err }, { status: 400 });
    }
    const { processes, contact, qualityScore, timestamp } = parsed.data;

    const processResults = processes.map(p => {
      const quality = calculateProcessQuality(p);
      return { name: p.processName, type: p.processType, elapsedDays: p.costs?.cycleDays || p.lastExample?.elapsedDays || 0, annualCost: p.costs?.totalAnnualCost || 0, annualInstances: p.frequency?.annual || 0, teamSize: p.costs?.teamSize || 1, stepsCount: (p.steps || []).length, quality, bottleneck: p.bottleneck || {}, priority: p.priority || {} };
    });
    const totalCost = processResults.reduce((sum, p) => sum + p.annualCost, 0);
    const totalSavings = processes.reduce((sum, p) => {
      const cost = p.costs?.totalAnnualCost || 0;
      if (!cost) return sum;
      // If the user provided an explicit savings estimate, use it
      if (p.savings?.percent) return sum + cost * (p.savings.percent / 100);
      // Derive from process signals: automation potential + handoff quality + wait time
      const steps = p.steps || [];
      const handoffs = p.handoffs || [];
      const totalSteps = steps.length || 1;
      const poorHandoffs = handoffs.filter(h => h.clarity === 'yes-multiple' || h.clarity === 'yes-major' || h.method === 'they-knew').length;
      const waitHeavy = (p.userTime?.waiting || 0) > (p.userTime?.execution || 0);
      const autoScore = calculateAutomationScore([p]);
      // Each signal contributes a bounded savings %
      const automationSavings = Math.min(25, (autoScore.percentage / 100) * 30); // up to 25%
      const handoffSavings = Math.min(10, (poorHandoffs / Math.max(1, handoffs.length)) * 15); // up to 10%
      const waitSavings = waitHeavy ? 8 : 0; // 8% if waiting > execution
      const pct = Math.min(45, Math.round(automationSavings + handoffSavings + waitSavings));
      return sum + cost * (pct / 100);
    }, 0);

    let recommendations;
    let isAIEnhanced = false;
    try {
      recommendations = await withRetry(
        () => getAIRecommendations(processes, contact),
        { maxAttempts: 3, baseDelayMs: 800, label: 'AI recommendations', logger }
      );
      isAIEnhanced = true;
    } catch (aiError) {
      logger.warn('AI recommendations failed after retries, falling back to rule-based', { requestId: getRequestId(request), error: aiError.message });
      recommendations = generateRuleBasedRecommendations(processes);
    }

    let flowDiagramUrl = null;
    try { flowDiagramUrl = await triggerN8nFlowDiagram(processes, contact); } catch (e) { /* skip */ }

    const automationScore = calculateAutomationScore(processes);

    return NextResponse.json({ success: true, processes: processResults, totalCost, potentialSavings: totalSavings, recommendations, automationScore, flowDiagramUrl, qualityScore, analysisType: isAIEnhanced ? 'ai-enhanced' : 'rule-based', timestamp });
  } catch (error) {
    logger.error('Process diagnostic error', { requestId: getRequestId(request), error: error.message, stack: error.stack });
    return NextResponse.json({ error: 'Analysis failed.' }, { status: 500 });
  }
}

async function triggerN8nFlowDiagram(processes, contact) {
  const webhookUrl = process.env.N8N_FLOW_DIAGRAM_WEBHOOK_URL || process.env.N8N_DIAGNOSTIC_WEBHOOK_URL || process.env.N8N_WEBHOOK_URL;
  if (!webhookUrl || (!webhookUrl.startsWith('http://') && !webhookUrl.startsWith('https://'))) return null;
  const mermaidCode = generateMermaidCode(processes);
  const flowData = processes.map(p => ({ processName: p.processName, processType: p.processType, startsWhen: p.definition?.startsWhen || '', completesWhen: p.definition?.completesWhen || '', steps: (p.steps || []).map(s => { const step = { number: s.number, name: s.name, department: s.department }; if (s.isDecision && s.branches?.length > 0) { step.isDecision = true; step.branches = s.branches; } if (s.isExternal) step.isExternal = true; return step; }), handoffs: (p.handoffs || []).map(h => ({ from: { name: h.from?.name, department: h.from?.department }, to: { name: h.to?.name, department: h.to?.department }, method: h.method, clarity: h.clarity })), approvals: (p.approvals || []).map(a => ({ name: a.name, who: a.who, assessment: a.assessment })), systems: (p.systems || []).map(s => ({ name: s.name, purpose: s.purpose, actions: s.actions || [] })), bottleneck: p.bottleneck || {}, costs: { totalAnnualCost: p.costs?.totalAnnualCost || 0, instanceCost: p.costs?.instanceCost || 0, elapsedDays: p.lastExample?.elapsedDays || 0, annualInstances: p.frequency?.annual || 0, teamSize: p.costs?.teamSize || 1 } }));
  const response = await fetchWithTimeout(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestType: 'flow-diagram', processes: flowData, mermaidCode, contact: { name: contact?.name || '', email: contact?.email || '', company: contact?.company || '' }, timestamp: new Date().toISOString() }) });
  if (!response.ok) throw new Error('n8n webhook returned ' + response.status);
  let result;
  try { result = await response.json(); } catch (e) { return null; }
  return result?.diagramUrl || null;
}

async function getAIRecommendations(processes, contact) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('No API key configured');
  const processDescriptions = processes.map((p, i) => {
    const steps = (p.steps || []).map(s => {
      const sysList = (s.systems || []).length ? ` [systems: ${s.systems.join(', ')}]` : '';
      const decFlag = s.isDecision ? ' [DECISION]' : '';
      const extFlag = s.isExternal ? ' [EXTERNAL]' : '';
      return `  ${s.number || i + 1}. ${s.name} [${s.department || '?'}]${sysList}${decFlag}${extFlag}`;
    }).join('\n');

    const ut = p.userTime || {};
    const timeNote = (ut.execution > 0 || ut.waiting > 0)
      ? `\n- Time per instance: ${ut.execution || 0}h active, ${ut.waiting || 0}h waiting${ut.meetings > 0 ? `, ${ut.meetings}h meetings` : ''}${ut.emails > 0 ? `, ${ut.emails}h emails` : ''}`
      : '';

    const handoffSummary = (p.handoffs || []).map((h, hi) => {
      const clarity = h.clarity === 'no' ? 'clear' : h.clarity === 'yes-once' ? 'needed 1 clarification' : 'needed multiple clarifications';
      const method = h.method === 'they-knew' ? 'assumed (no notification)' : h.method || 'unknown';
      return `  H${hi + 1}: ${h.from?.name || '?'} → ${h.to?.name || '?'} via ${method}  -  ${clarity}`;
    }).join('\n');

    const systemsList = [...new Set((p.steps || []).flatMap(s => s.systems || []))];
    const systemsNote = systemsList.length ? `\n- Systems: ${systemsList.join(', ')}` : '';

    const bottleneckNote = p.bottleneck?.reason ? `\n- Bottleneck: ${p.bottleneck.reason}` : '';
    const knowledgeNote = p.knowledge?.vacationImpact && p.knowledge.vacationImpact !== 'no-impact'
      ? `\n- Knowledge risk: process ${p.knowledge.vacationImpact} when key person is absent`
      : '';
    const issuesNote = (p.issues || []).length ? `\n- Known issues: ${p.issues.slice(0, 3).join('; ')}` : '';

    const handoffsSection = handoffSummary ? `\n- Handoffs:\n${handoffSummary}` : '';

    return `PROCESS #${i + 1}: ${p.processName} (${p.processType || 'general'})
- Duration: ${p.lastExample?.elapsedDays || '?'} days per instance
- Frequency: ${p.frequency?.annual || '?'}/year
- Annual Cost: £${((p.costs?.totalAnnualCost || 0) / 1000).toFixed(0)}K${timeNote}${systemsNote}${bottleneckNote}${knowledgeNote}${issuesNote}
- Steps:
${steps}${handoffsSection}`;
  }).join('\n---\n');

  const cacheKey = { processDescriptions };
  const cached = get(cacheKey);
  if (cached && Array.isArray(cached) && cached.length > 0) return cached;

  const fallback = [{ process: 'Overall', type: 'general', text: 'Your processes show room for optimisation.' }];
  const recommendations = await invokeStructured(
    getFastModel({ temperature: 0.5 }),
    [
      new SystemMessage(recommendationsSystemPrompt()),
      new HumanMessage(recommendationsUserPrompt(processDescriptions)),
    ],
    ProcessRecommendationsSchema,
    fallback
  );

  set(cacheKey, recommendations);
  return recommendations;
}


function calculateProcessQuality(p) {
  let score = 50;
  const flags = [];
  const steps = p.steps || [];
  const handoffs = p.handoffs || [];
  if (steps.length >= 8) score += 15;
  else if (steps.length >= 5) score += 10;
  else if (steps.length >= 3) score += 5;
  else flags.push('Limited step detail');
  const depts = new Set(steps.map((s) => s.department).filter(Boolean));
  if (depts.size > 0) score += 10;
  if (handoffs.length > 0) score += 5;
  if (steps.some((s) => s.systems?.length > 0)) score += 5;
  if (p.costs?.totalAnnualCost > 0) score += 5;
  if (p.costs?.cycleDays > 0) score += 5;
  if (p.bottleneck?.reason) score += 5;
  if (p.lastExample?.name) score += 5;
  score = Math.max(0, Math.min(100, score));
  return { score, grade: score > 85 ? 'HIGH' : score > 65 ? 'MEDIUM' : 'LOW', flags };
}
