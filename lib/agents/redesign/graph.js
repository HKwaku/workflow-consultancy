import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { getChatModel, getFastModel } from '../models.js';
import { ALL_REDESIGN_TOOLS, validateRedesign } from './tools.js';

/* ── System prompts ──────────────────────────────────────────────── */

const ANALYSIS_SYSTEM = `You are Vesno's process redesign consultant. Analyse the diagnostic data and produce a specific, data-backed plan for improving each business process.

Return ONLY valid JSON (no markdown fences) in this exact format:
{
  "processPlans": [
    {
      "processName": "exact process name from the data",
      "processOwner": "department most accountable for the end-to-end outcome",
      "keyProblems": [
        "specific problem — must cite actual step name, department, or metric from the data"
      ],
      "proposedChanges": [
        {
          "type": "remove|automate|merge|reorder|add|modify",
          "stepName": "primary affected step name (exact match from steps array)",
          "mergeWith": ["other step names if merging — exact name matches"],
          "newPosition": 1,
          "rationale": "MUST cite actual data: step name, department, cost/time figure, frequency. No generic statements.",
          "principle": "early-rejection|cut-no-value|consolidate|automate-handoffs|parallel|preserve-decisions|fix-before-automate|minimise-teams|common-case|cross-department|checklists|process-owner|realistic-estimates|structural-integrity",
          "estimatedTimeSavedMinutes": 0,
          "estimatedCostSavedPercent": 0
        }
      ],
      "parallelPairs": [["exact Step A name", "exact Step B name"]],
      "handoffImprovements": [
        { "after": "exact step name", "newMethod": "automated", "reason": "specific reason" }
      ]
    }
  ]
}

ANALYSIS APPROACH — work through these in order for each process:

1. START WITH THE BOTTLENECK
   Read the bottleneck, issues, and biggestDelay fields first. These are the user's own assessment of where pain is. Any change you propose must address at least one of these.

2. FIND LATE REJECTION GATES
   Scan for decision steps (isDecision: true) with branches that reject/fail/deny cases. If any appear after the third step in a process with 5+ steps, move them to the earliest viable position. Calculate wasted work: hoursPerInstance × rejection_rate × hourlyRate × annual_runs.

3. SPOT SAME-DEPARTMENT SEQUENCES
   Walk through the step list. Where two or more consecutive steps share the same department AND have no external trigger between them (no isExternal step, no decision point), propose merging. List the absorbed steps in mergeWith.

4. FLAG POOR HANDOFFS
   Check the handoffs array. Method 'email' or 'meeting' with clarity 'no' means unstructured, untracked handoffs. Cross-reference with waitMinutes on adjacent steps — high wait time next to a poor handoff is a direct automation opportunity.

5. FIND PARALLEL CANDIDATES
   Look for back-to-back steps in DIFFERENT departments where one does not need the output of the other. Common examples: registration + notification, background check + document preparation. If independent, flag them in parallelPairs.

6. USE THE ACTUAL NUMBERS
   Every estimate must reference the data. Use: costs.totalAnnualCost, costs.hoursPerInstance, costs.hourlyRate, frequency.annual, userTime.execution, userTime.waiting, lastExample.elapsedDays. Calculate, do not guess.

7. RESPECT MANUAL CONNECTIONS
   If manualConnections shows the user drew a non-sequential path (step A → step D skipping B, C), those middle steps are likely waste — investigate. If removedConnections shows a deleted link, do not reinstate it.

Propose 3–7 changes per process. Changes must be specific, data-backed, and address real problems. Vague changes like "consolidate for efficiency" are not acceptable.`;

const SYNTHESIS_SYSTEM = `You are implementing a process redesign based on a prepared analysis plan. Your job is to execute the plan precisely using the tools — not to redesign from scratch.

Make ALL tool calls in ONE response:
1. optimize_process — once per process
2. record_change — once per change from the plan
3. calculate_cost_summary — once at the end

SCHEMA RULES (non-negotiable):

STEPS:
- Include EVERY original step in the steps array. Mark removed steps as status: "removed" — never omit them.
- Active steps = those with status ≠ "removed"
- Reorder the array to reflect the new step sequence (removed steps can stay in their original position)

HANDOFFS:
- handoffs array length MUST equal max(0, active_steps_count − 1)
- For automated handoffs: method must be "automated", clarity must be "yes-multiple"
- For unchanged handoffs: preserve the original method and clarity

DECISIONS:
- Decision steps (isDecision: true): branches MUST have ≥ 2 entries
- branch.target MUST exactly match an active step name — never use "Step N" position references
- When reordering steps around a decision, update all branch targets to match new step names

MERGED STEPS:
- status: "modified" for the surviving step that absorbed others
- checklist MUST list every absorbed step name (e.g. ["Draft invoice", "Check invoice"])
- changeNote must explain what was merged and why

PARALLEL:
- Set parallel: true on the FIRST step of a parallel pair

PROCESS OWNER:
- processOwner must be set to the department most accountable for the outcome

CHANGE DESCRIPTIONS — use this structure:
"[Specific action taken] — [mechanism: why this saves time or cost] — [quantified saving using numbers from the diagnostic data]."

BAD: "Consolidated steps for improved efficiency."
GOOD: "Merged 'Draft invoice' and 'Check invoice' into one step — both performed by Finance with no data dependency between them. Eliminates ~15 min of handoff overhead per run; at £42/hr and 96 runs/yr this recovers ~£1,008/yr in wasted coordination time."

BAD: "Moved approval gate earlier."
GOOD: "Moved 'Budget approval' from step 6 to step 2 — the diagnostic flags step 6 as the bottleneck and 30% of requests are rejected here. Each rejection previously wasted ~3h of work across steps 3–5; at 120 runs/yr and 30% rejection rate this saves ~108h/yr of wasted effort."`;

const SUMMARIZER_SYSTEM = `You are Vesno's AI operating-model consultant. Given a completed redesign, produce:

1. executiveSummary — ONE sentence, max 15 words, leading with the single biggest quantified improvement.
   GOOD: "Cut 6 of 14 steps, removing 3 cross-department handoffs and saving ~4h per run."
   GOOD: "Moved compliance gate to step 1, eliminating rework on ~30% of rejected cases."
   GOOD: "Automated 4 notification steps, freeing ~45 min of manual work per instance."
   BAD: "Consolidated fragmented steps and automated routine hand-offs." (no numbers, too vague)
   BAD: "Streamlined the process for better efficiency." (meaningless)

2. implementationPriority — 3–6 concrete actions ordered by impact (highest first). For each:
   - action: specific thing to do (not "improve handoffs" — "set up a Slack channel between Finance and Ops with a standard notification template for each handoff")
   - owner: the department or role accountable for doing this
   - effort: "days" | "weeks" | "months"

Return ONLY valid JSON:
{
  "executiveSummary": "...",
  "implementationPriority": [
    { "action": "...", "owner": "...", "effort": "days|weeks|months" }
  ]
}`;

/* ── Helpers ─────────────────────────────────────────────────────── */

function parseJson(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const open = cleaned.indexOf('{');
  const close = cleaned.lastIndexOf('}');
  if (open === -1 || close <= open) return null;
  try { return JSON.parse(cleaned.substring(open, close + 1)); } catch { return null; }
}

function extractFromToolCalls(toolCalls) {
  const processMap = new Map();
  const changesMap = new Map();
  let costSummary = null;

  for (const tc of toolCalls) {
    const input = tc.args || tc.input || {};
    if (tc.name === 'optimize_process' && input.processName) {
      processMap.set(input.processName, {
        processName: input.processName,
        processOwner: input.processOwner || '',
        steps: input.steps || [],
        handoffs: input.handoffs || [],
      });
    } else if (tc.name === 'record_change') {
      const key = `${input.process}::${input.stepName}::${input.type}`;
      changesMap.set(key, { ...input });
    } else if (tc.name === 'calculate_cost_summary') {
      costSummary = { ...input };
    }
  }

  return {
    optimisedProcesses: [...processMap.values()],
    changes: [...changesMap.values()],
    costSummary,
  };
}

/* ── Main agent ── analysis → synthesis → summarize ─────────────── */

export async function runRedesignAgent(diagnosticContext, onProgress, requestId) {
  const emit = typeof onProgress === 'function' ? onProgress : () => {};
  const contextStr = typeof diagnosticContext === 'string'
    ? diagnosticContext
    : JSON.stringify(diagnosticContext, null, 2);

  // ── Pass 1: Analysis (free-form reasoning, no tools) ──────────────
  emit('Analysing your processes…');
  const analysisModel = getChatModel({ temperature: 0.1, maxTokens: 4096 });

  // Build segment-specific framing for the analysis
  let parsedCtx = {};
  try { parsedCtx = typeof diagnosticContext === 'string' ? JSON.parse(diagnosticContext) : diagnosticContext; } catch { /* ignore */ }
  const SEGMENT_REDESIGN_FRAME = {
    ma: 'REDESIGN FRAME: M&A Integration. Prioritise changes that ensure Day 1 operability and integration clarity. Flag any step that relies on undocumented knowledge as an integration risk. Standardise handoffs across entities. Frame each change in terms of integration readiness.',
    pe: 'REDESIGN FRAME: Private Equity. Prioritise changes with the highest EBITDA impact. Frame every saving in £/$ terms relative to annual cost. Identify which changes are achievable within the investment horizon. Ensure the redesign is data-room ready — changes must be defensible to investors.',
    highstakes: 'REDESIGN FRAME: High-stakes Event. Prioritise changes that reduce single points of failure and deadline risk. Frame recommendations around must-do-before-go-live vs nice-to-have. Quick wins that can be completed before the deadline take precedence over larger structural changes.',
    scaling: 'REDESIGN FRAME: Scaling Business. Prioritise changes that eliminate bottlenecks that will compound as volume increases. Automation candidates with high frequency are most valuable. Standardisation changes that enable delegation are high priority.',
  };
  const segmentFrame = parsedCtx.segment ? (SEGMENT_REDESIGN_FRAME[parsedCtx.segment] || '') : '';
  const segmentInstruction = segmentFrame ? `\n\n${segmentFrame}` : '';

  const analysisResponse = await analysisModel.invoke([
    new SystemMessage(ANALYSIS_SYSTEM),
    new HumanMessage(`Here is the diagnostic data:\n\n${contextStr}${segmentInstruction}\n\nProduce a specific redesign plan in the JSON format specified. Reference actual step names and data values throughout.`),
  ]);

  const analysisText = typeof analysisResponse.content === 'string'
    ? analysisResponse.content
    : analysisResponse.content[0]?.text || '';

  const redesignPlan = parseJson(analysisText);
  const planProcessCount = redesignPlan?.processPlans?.length ?? 0;
  const planChangeCount = redesignPlan?.processPlans?.reduce((s, p) => s + (p.proposedChanges?.length ?? 0), 0) ?? 0;

  emit(`Identified ${planChangeCount} improvement${planChangeCount !== 1 ? 's' : ''} across ${planProcessCount} process${planProcessCount !== 1 ? 'es' : ''}. Implementing redesign…`);

  // ── Pass 2: Synthesis (tool calls) ───────────────────────────────
  const synthModel = getChatModel({ temperature: 0, maxTokens: 8192 }).bindTools(ALL_REDESIGN_TOOLS);

  const synthPrompt = redesignPlan
    ? `REDESIGN PLAN (prepared by analysis phase):\n${JSON.stringify(redesignPlan, null, 2)}\n\nORIGINAL DIAGNOSTIC DATA:\n${contextStr}\n\nImplement this plan using the tools. Make ALL tool calls in a single response. Follow the schema rules exactly.`
    : `Here is the diagnostic data:\n\n${contextStr}\n\nRedesign the processes using the tools. Make ALL tool calls in a single response.`;

  const synthResponse = await synthModel.invoke([
    new SystemMessage(SYNTHESIS_SYSTEM),
    new HumanMessage(synthPrompt),
  ]);

  const toolCalls = synthResponse.tool_calls || [];
  if (toolCalls.length === 0) throw new Error('Synthesis agent produced no tool calls.');

  const processCount = toolCalls.filter(tc => tc.name === 'optimize_process').length;
  const recordCount = toolCalls.filter(tc => tc.name === 'record_change').length;
  emit(`Built ${processCount} optimised process${processCount !== 1 ? 'es' : ''} with ${recordCount} change${recordCount !== 1 ? 's' : ''}. Validating…`);

  let extracted = extractFromToolCalls(toolCalls);

  // ── Validation & repair ───────────────────────────────────────────
  const contextObj = typeof diagnosticContext === 'string' ? {} : diagnosticContext;
  const autoPerc = contextObj?.summary?.automationPercentage ?? null;
  const { errors, warnings } = validateRedesign({ ...extracted, automationPercentage: autoPerc });

  if (warnings.length > 0) {
    try { (await import('@/lib/logger')).logger.warn('Redesign warnings', { requestId, warnings }); } catch {}
  }

  if (errors.length > 0) {
    emit(`Fixing ${errors.length} structural issue${errors.length !== 1 ? 's' : ''}…`);
    const issueList = errors.map((e, i) => `${i + 1}. ${e}`).join('\n');
    try {
      const repairModel = getChatModel({ temperature: 0, maxTokens: 8192 }).bindTools(ALL_REDESIGN_TOOLS);
      const repairResponse = await repairModel.invoke([
        new SystemMessage(`${SYNTHESIS_SYSTEM}\n\nFIX THESE VALIDATION ERRORS BEFORE RESPONDING:\n${issueList}`),
        new HumanMessage(`The previous attempt had these validation errors. Fix them and re-submit ALL tool calls in a single response.\n\nREDESIGN PLAN:\n${JSON.stringify(redesignPlan, null, 2)}\n\nORIGINAL DATA:\n${contextStr}`),
      ]);
      const repairCalls = repairResponse.tool_calls || [];
      if (repairCalls.length > 0) {
        const repaired = extractFromToolCalls(repairCalls);
        if (repaired.optimisedProcesses.length > 0) extracted.optimisedProcesses = repaired.optimisedProcesses;
        if (repaired.changes.length > 0) extracted.changes = repaired.changes;
        if (repaired.costSummary) extracted.costSummary = repaired.costSummary;
        emit('Issues resolved.');
      }
    } catch (repairErr) {
      try { (await import('@/lib/logger')).logger.warn('Repair pass failed', { requestId, message: repairErr.message }); } catch {}
      emit('Proceeding with best result.');
    }
  } else {
    emit('Validation passed.');
  }

  // ── Pass 3: Summarize ─────────────────────────────────────────────
  emit('Writing executive summary…');
  let executiveSummary = '';
  let implementationPriority = [];

  try {
    const summarizerModel = getFastModel({ temperature: 0 });
    const summaryResponse = await summarizerModel.invoke([
      new SystemMessage(SUMMARIZER_SYSTEM),
      new HumanMessage(`Here is the completed redesign:\n\n${JSON.stringify({
        optimisedProcesses: extracted.optimisedProcesses,
        changes: extracted.changes,
        costSummary: extracted.costSummary,
      })}`),
    ]);
    const summaryText = typeof summaryResponse.content === 'string'
      ? summaryResponse.content
      : summaryResponse.content[0]?.text || '';
    const parsed = parseJson(summaryText);
    if (parsed) {
      executiveSummary = parsed.executiveSummary || '';
      implementationPriority = (parsed.implementationPriority || []).map(item =>
        typeof item === 'string' ? { action: item, owner: '', effort: '' } : item
      );
    }
  } catch {
    executiveSummary = 'Operating model redesign complete.';
    implementationPriority = [];
  }

  emit('Redesign complete.');
  return {
    executiveSummary,
    optimisedProcesses: extracted.optimisedProcesses,
    changes: extracted.changes,
    costSummary: extracted.costSummary,
    implementationPriority,
  };
}
