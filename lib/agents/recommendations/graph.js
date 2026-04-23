/**
 * AI Recommendations Agent - LangGraph-style single-pass agent.
 * Produces framework-grounded, benchmark-referenced process improvement
 * recommendations using industry knowledge and methodology tools.
 */

import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { getDeepModel } from '../models.js';
import { ALL_RECOMMENDATION_TOOLS } from './tools.js';
import { generateRuleBasedRecommendations } from '@/lib/diagnostic/buildLocalResults';

/* ── System prompt ───────────────────────────────────────────────── */

const RECOMMENDATIONS_SYSTEM = `You are Vesno's AI process improvement specialist. You analyse business process diagnostic data and produce specific, ranked recommendations grounded in industry benchmarks and established frameworks (PRINCE2, Lean, Six Sigma, Gartner, ISO 9001).

WORKFLOW - follow these steps in ONE response, making ALL tool calls:

1. FIRST: Call get_industry_guidance with the industry detected from the process data (use 'Professional Services' if unclear). Include the main process patterns you observe from the data.

2. SECOND: Call get_methodology_guidance with the specific patterns you detect from the data. Use these pattern identifiers:
   - 'high-waiting-time'       if waiting time > execution time in any process
   - 'poor-handoffs'           if handoffs use email/assumed method OR have clarity issues (yes-once or yes-multiple)
   - 'knowledge-concentration' if process breaks down or significantly degrades when key person is absent (vacation impact ≠ no-impact)
   - 'too-many-approvals'      if a process has 2+ approval steps or an approval step is flagged as bottleneck
   - 'no-process-owner'        if departments involved are unclear or no single owner is identified
   - 'manual-data-entry'       if systems are used but handoffs between them are manual/email-based
   - 'cross-department-delays' if handoffs cross more than 2 different departments
   - 'rework-loops'            if issues, rework, or errors are flagged in the data
   - 'bottleneck-at-approval'  if the identified bottleneck step is an approval or sign-off step
   - 'long-cycle-time'         if actual elapsed days significantly exceed the industry median benchmark
   - 'no-process-metrics'      if no performance data or KPIs are mentioned for the process
   - 'manual-repetitive-tasks' if there are routine mechanical steps being performed manually

3. THIRD: Call record_recommendation 5–8 times for your top recommendations. Order them by impact-to-effort ratio - surface quick wins before medium-effort and projects.

RECOMMENDATION QUALITY RULES:
- industryContext MUST reference the specific benchmark: "APQC benchmark: median X days for this industry; current process is Y days - Z× the benchmark"
- frameworkRef MUST cite the specific principle: "Lean: Eliminate Waiting Waste - waiting (Xh) exceeds active work (Yh)" or "PRINCE2: Defined Roles - no process owner assigned to [process name]"
- finding MUST be specific: reference exact step names, department names, handoff counts, times, or costs from the data provided. Never write generic findings.
- action MUST be specific: not "improve handoffs" but "Create a Slack channel between [Department A] and [Department B] with a standard 5-field notification template triggered when [step name] completes, with a 4h SLA for acknowledgement"
- estimatedTimeSavedMinutes MUST be defensible from the data: if waiting = 14 days and process runs 50×/year, calculate from those numbers; do not use round numbers not grounded in the data
- Include at least ONE recommendation for 'Cross-process' if multiple processes are submitted
- Include at least ONE 'governance' or 'knowledge' type recommendation if relevant signals exist
- Rank severity: high = blocking delivery, significant financial or compliance risk; medium = recurring friction affecting throughput; low = quality-of-life improvement
- When the data shows Vesno's handover feature could help (undocumented processes, knowledge concentration), suggest it specifically

RECOMMENDATION TYPES:
- handoff:      problems with how work passes between people or teams
- integration:  systems not connected, manual re-entry between tools
- knowledge:    key-person dependency, undocumented processes, no standard work
- automation:   mechanical tasks suitable for RPA, workflow automation, or AI
- approval:     approval bottlenecks, over-approval, unclear delegation
- governance:   missing ownership, no SLAs, no performance metrics
- compliance:   regulatory or standards alignment gaps
- general:      cross-cutting patterns that don't fit above

Make ALL tool calls in ONE response - do not split across multiple turns.`;

/* ── Process description builder ─────────────────────────────────── */

function buildProcessDescriptions(processes) {
  return processes.map((p, i) => {
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
      return `  H${hi + 1}: ${h.from?.name || '?'} → ${h.to?.name || '?'} via ${method} - ${clarity}`;
    }).join('\n');

    const systemsList = [...new Set((p.steps || []).flatMap(s => s.systems || []))];
    const systemsNote = systemsList.length ? `\n- Systems: ${systemsList.join(', ')}` : '';

    const bottleneckNote = p.bottleneck?.reason ? `\n- Bottleneck: ${p.bottleneck.reason}` : '';
    const knowledgeNote = p.knowledge?.vacationImpact && p.knowledge.vacationImpact !== 'no-impact'
      ? `\n- Knowledge risk: process ${p.knowledge.vacationImpact} when key person is absent`
      : '';
    const issuesNote = (p.issues || []).length ? `\n- Known issues: ${p.issues.slice(0, 3).join('; ')}` : '';
    const industryNote = p.industry ? `\n- Industry: ${p.industry}` : '';
    const handoffsSection = handoffSummary ? `\n- Handoffs:\n${handoffSummary}` : '';

    return `PROCESS #${i + 1}: ${p.processName} (${p.processType || 'general'})
- Duration: ${p.lastExample?.elapsedDays || '?'} days per instance
- Frequency: ${p.frequency?.annual || '?'}/year
- Annual Cost: £${((p.costs?.totalAnnualCost || 0) / 1000).toFixed(0)}K${timeNote}${systemsNote}${bottleneckNote}${knowledgeNote}${issuesNote}${industryNote}
- Steps:
${steps}${handoffsSection}`;
  }).join('\n---\n');
}

/* ── Tool call extraction ─────────────────────────────────────────── */

function extractRecommendations(toolCalls) {
  return toolCalls
    .filter(tc => tc.name === 'record_recommendation')
    .map(tc => tc.args || tc.input || {});
}

/* ── Recommendation sorting ──────────────────────────────────────── */

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };
const EFFORT_ORDER = { 'quick-win': 0, medium: 1, project: 2 };

function sortRecommendations(recs) {
  return [...recs].sort((a, b) => {
    const severityDiff = (SEVERITY_ORDER[a.severity] ?? 1) - (SEVERITY_ORDER[b.severity] ?? 1);
    if (severityDiff !== 0) return severityDiff;
    return (EFFORT_ORDER[a.effortLevel] ?? 1) - (EFFORT_ORDER[b.effortLevel] ?? 1);
  });
}

/* ── Main agent export ───────────────────────────────────────────── */

/**
 * Runs the AI Recommendations Agent.
 *
 * @param {object[]} processes - Array of process objects from the diagnostic.
 * @param {object} contact - Contact info ({ name, email, company, segment }).
 * @param {Function} [onProgress] - Optional progress callback (string message).
 * @param {string} [requestId] - Optional request ID for logging.
 * @param {object} [moduleConfig] - Optional module config from lib/modules. If provided,
 *   uses moduleConfig.agentConfig.systemPrompt and moduleConfig.agentConfig.segmentBlock.
 * @returns {Promise<object[]>} Array of recommendation objects.
 */
export async function runRecommendationsAgent(processes, contact, onProgress, requestId, moduleConfig = null) {
  const emit = typeof onProgress === 'function' ? onProgress : () => {};

  if (!processes || processes.length === 0) {
    return generateRuleBasedRecommendations(processes || []);
  }

  emit('Analysing process patterns for recommendations…');

  // Detect industry from process data
  const industry =
    processes[0]?.industry ||
    processes[0]?.contact?.industry ||
    contact?.industry ||
    'Professional Services';

  // Build segment context block - prefer module config, fall back to legacy inline dict
  let segmentBlock = '';
  if (moduleConfig?.agentConfig) {
    // Support dynamic segmentBlock builders (function) or static strings
    const blockSource = moduleConfig.agentConfig.buildSegmentBlock || moduleConfig.agentConfig.segmentBlock;
    const block = typeof blockSource === 'function' ? blockSource(contact) : blockSource;
    if (block) segmentBlock = `\n${block}\n`;
  } else if (contact?.segment) {
    // Legacy fallback for any stored reports without a moduleConfig
    const LEGACY_SEGMENT_CONTEXT = {
      ma: 'ENGAGEMENT CONTEXT: M&A Integration\n- Frame all recommendations around integration risk and Day 1 operability\n- Flag knowledge concentration as integration risk, not just efficiency risk\n- Prioritise governance, ownership clarity, and handoff standardisation across entities',
      pe: 'ENGAGEMENT CONTEXT: Private Equity\n- Frame recommendations by EBITDA impact - quantify in £/$ where data permits\n- Rank by value creation potential, not just operational convenience\n- Use data-room language: frame findings as "exit-ready" or "not exit-ready"',
      'high-risk-ops': 'ENGAGEMENT CONTEXT: High Risk Ops\n- Prioritise single points of failure and operational resilience over efficiency\n- Flag undocumented processes and knowledge concentration as compliance and continuity risks\n- Frame recommendations around risk mitigation, fallback procedures, and audit readiness',
      highstakes: 'ENGAGEMENT CONTEXT: High-stakes Event\n- Prioritise by urgency and deadline risk above all else\n- Flag any single points of failure prominently as blockers',
      scaling: 'ENGAGEMENT CONTEXT: Scaling Business\n- Focus on bottlenecks and throughput constraints that will worsen as volume grows\n- Identify automation candidates that deliver compounding value at scale',
    };
    segmentBlock = `\n${LEGACY_SEGMENT_CONTEXT[contact.segment] || ''}\n`;
  }

  // Build process descriptions
  const processDescriptions = buildProcessDescriptions(processes);

  // Build contact context - include PE-specific fields when present
  const contactLines = [
    `Company: ${contact?.company || 'Not specified'}`,
    `Industry context: ${industry}`,
  ];
  if (contact?.segment === 'pe' || contact?.peStage) {
    contactLines.push('');
    contactLines.push('PE AUDIT CONTEXT:');
    if (contact?.peStage)           contactLines.push(`  Ownership stage: ${contact.peStage}`);
    if (contact?.peYearsIn)         contactLines.push(`  Years into hold: ${contact.peYearsIn}`);
    if (contact?.peSopStatus)       contactLines.push(`  SOP / documentation: ${contact.peSopStatus}`);
    if (contact?.peReportingImpact) contactLines.push(`  Management reporting impact: ${contact.peReportingImpact}`);
    if (contact?.peKeyPerson)       contactLines.push(`  Key-person dependency: ${contact.peKeyPerson}`);
  }
  const contactContext = contactLines.join('\n');

  // Human message content
  const humanContent = `Here is the diagnostic data for this organisation:
${segmentBlock}
${processDescriptions}

${contactContext}

Analyse the data and produce 5-8 ranked recommendations. Make ALL tool calls in a single response.`;

  let model;
  try {
    model = getDeepModel().bindTools(ALL_RECOMMENDATION_TOOLS);
  } catch (modelErr) {
    // Log and fall back
    try {
      const { logger } = await import('@/lib/logger');
      logger.warn('Could not initialise recommendations model, falling back', { requestId, error: modelErr.message });
    } catch { /* no logger */ }
    return generateRuleBasedRecommendations(processes);
  }

  emit('Consulting industry benchmarks and frameworks…');

  // Use module-specific system prompt if provided, else fall back to the shared static prompt
  const systemPromptText = moduleConfig?.agentConfig?.systemPrompt || RECOMMENDATIONS_SYSTEM;

  const messages = [
    new SystemMessage(systemPromptText),
    new HumanMessage(humanContent),
  ];

  const response = await model.invoke(messages);

  const toolCalls = response.tool_calls || [];

  if (toolCalls.length === 0) {
    try {
      const { logger } = await import('@/lib/logger');
      logger.warn('Recommendations agent produced no tool calls, falling back', { requestId });
    } catch { /* no logger */ }
    return generateRuleBasedRecommendations(processes);
  }

  const industryCallCount = toolCalls.filter(tc => tc.name === 'get_industry_guidance').length;
  const methodologyCallCount = toolCalls.filter(tc => tc.name === 'get_methodology_guidance').length;
  const recCallCount = toolCalls.filter(tc => tc.name === 'record_recommendation').length;

  emit(`Gathered ${industryCallCount} industry insight${industryCallCount !== 1 ? 's' : ''}, ${methodologyCallCount} methodology guidance set${methodologyCallCount !== 1 ? 's' : ''}, recording ${recCallCount} recommendation${recCallCount !== 1 ? 's' : ''}…`);

  const rawRecommendations = extractRecommendations(toolCalls);

  // Fallback if too few recommendations recorded
  if (rawRecommendations.length < 3) {
    try {
      const { logger } = await import('@/lib/logger');
      logger.warn('Recommendations agent returned fewer than 3 recommendations, merging with rule-based', {
        requestId,
        count: rawRecommendations.length,
      });
    } catch { /* no logger */ }
    const ruleBased = generateRuleBasedRecommendations(processes);
    const merged = [...rawRecommendations, ...ruleBased].slice(0, 8);
    return sortRecommendations(merged);
  }

  const sorted = sortRecommendations(rawRecommendations);

  emit(`Recommendations complete - ${sorted.length} improvement${sorted.length !== 1 ? 's' : ''} identified.`);

  return sorted;
}
