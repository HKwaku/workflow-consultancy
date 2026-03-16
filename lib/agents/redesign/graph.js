import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { getDeepModel, getFastModel } from '../models.js';
import { ALL_REDESIGN_TOOLS, validateRedesign } from './tools.js';

/* ── System prompts ──────────────────────────────────────────────── */

const PLANNER_SYSTEM = `You are Sharpin's AI operating-model consultant. You redesign business processes by analyzing diagnostic data and producing optimised process flows.

You have tools to build the redesign. In a SINGLE response, make ALL required tool calls:
1. Call optimize_process ONCE per process  -  submit the full optimised step list with status flags on every step.
2. Call record_change for EVERY modification (removals, automations, merges, additions, reorders). Do not skip any.
3. Call calculate_cost_summary ONCE at the end with aggregate counts across all processes.

Make ALL tool calls in ONE response  -  do not spread them across multiple turns.

REDESIGN PRINCIPLES  -  follow these strictly:

1. CONSOLIDATE, DON'T DELETE BLINDLY: Merge related sequential steps into logical groups rather than removing them outright. When merging, use the "checklist" field on the surviving step to capture the absorbed sub-steps (e.g. merging "Draft form", "Review form", "Submit form" → one step "Prepare & submit form" with checklist ["Draft form", "Review form", "Submit form"]).

2. PRESERVE ALL DECISION LOGIC: Every step marked isDecision: true MUST have at least 2 branches with labels and targets. When consolidating steps around a decision point, keep the decision node intact and rewire its branches to point to the correct downstream steps. NEVER remove or merge a decision step  -  only modify its branches if targets change.

3. AUTOMATE HANDOFFS, NOT DECISIONS: Mark steps as "automated" only when they involve mechanical work (data entry, notifications, status updates, file transfers). Human judgment steps (approvals, reviews, escalations) should remain as "modified" with a changeNote explaining how they are improved, not replaced.

4. REALISTIC IMPROVEMENTS: Base time/cost savings on the specific diagnostic data provided (step count, handoff clarity, systems used). Do not assume improvements beyond what the data supports. A 5-step merge saving 15 minutes is realistic; a single rename saving 60 minutes is not.

5. MAINTAIN STRUCTURAL INTEGRITY: The optimised flow must be a valid, executable process. Every step must connect logically to the next. Decision branches must reference real step names in the optimised flow. No orphaned steps, no dead-end branches.

6. USE CHECKLISTS FOR GRANULARITY: When a step encompasses multiple sub-tasks, enumerate them in the checklist array. This preserves detail without bloating the flow diagram. The step name should describe the overall action; the checklist captures what must happen within it.

7. CROSS-DEPARTMENT HANDOFFS: Where multiple departments are involved in consecutive steps, prefer adding "automated" handoff methods over removing the handoff entirely. Visibility across teams matters more than step reduction.

8. DESIGN FOR THE COMMON CASE: Build the main flow around the typical scenario (the path ~80% of cases follow). Move exception handling, rare edge cases, and error recovery into separate decision branches rather than cluttering the main sequence. A clean main path is easier to follow, train on, and automate.

9. RUN INDEPENDENT STEPS IN PARALLEL: When two or more consecutive steps have no data dependency on each other (neither needs the output of the other), mark them with parallel: true. For example, "Bank Account Setup" and "VAT Registration" can happen at the same time. This is one of the biggest time-saving opportunities in any process.

10. MOVE REJECTION CHECKS EARLY: If a step can reject or terminate the case (compliance failure, missing documents, budget refusal), move it as early in the process as possible. There is no point completing 10 expensive steps only to fail on a check that could have been done first. Place go/no-go gates before resource-intensive work.

11. MINIMISE TEAMS INVOLVED: Each additional team or department that touches a process adds handoff cost, waiting time, and miscommunication risk. If two consecutive steps can reasonably be done by the same team, keep them together. Reducing the number of teams involved is often more impactful than reducing the number of steps.

12. ASSIGN A PROCESS OWNER: Every process should have one clear department or role that owns the end-to-end outcome. Set the processOwner field to the department most accountable for the process result. This is not necessarily the team that does the most steps  -  it is the team that cares most about the outcome reaching completion.

13. CUT STEPS THAT DON'T ADD VALUE: Before removing or automating a step, ask: does this step move the outcome closer to what the customer or end-user needs? Internal bureaucracy (duplicate sign-offs, unnecessary status meetings, redundant data re-entry) can often be removed. Steps the customer directly experiences should be improved, not cut.

14. FIX BEFORE AUTOMATING: If the diagnostic data flags a step as a bottleneck or shows bad handoffs around it, fix the underlying problem first (resequence, merge, reassign). Automating a broken step just makes a bad process fail faster. Only mark a step as "automated" after confirming the process logic around it is sound.

WHEN RECORDING CHANGES  -  for each record_change call, set the "principle" field to the short name of the principle that drove the change. Use EXACTLY one of these values:
consolidate | preserve-decisions | automate-handoffs | realistic-estimates | structural-integrity | checklists | cross-department | common-case | parallel | early-rejection | minimise-teams | process-owner | cut-no-value | fix-before-automate

WORKED EXAMPLE  -  study this to understand the expected output quality:

Input: 6-step Client Onboarding process, 2 departments (Sales, Operations), 5 handoffs.
Steps: 1. Receive application [Sales] → 2. Check eligibility [Sales] → 3. Email to Ops team [Sales] → 4. Ops manually enters data into CRM [Operations] → 5. Ops schedules onboarding call [Operations] → 6. Send welcome email [Operations]
Diagnostic flags: email handoff at step 3 has poor clarity, steps 4+5 could run in parallel, step 6 is a routine notification.

Expected tool calls:

optimize_process("Client Onboarding"):
  processOwner: "Operations"
  steps:
    1. Receive application  -  unchanged
    2. Check eligibility  -  MOVED to position 1 (reordered, early-rejection)
    3. Receive application  -  MOVED to position 2 (reordered, follows eligibility check)
    4. Enter client data & schedule onboarding call  -  MERGED from steps 4+5 (consolidated), parallel: true
       checklist: ["Enter client data into CRM", "Schedule onboarding call"]
    5. Email to Ops team  -  REMOVED (cross-department, replaced by automated trigger)
    6. Send welcome email  -  AUTOMATED
  handoffs: 3 entries (4 active steps - 1)

record_change  -  reorder eligibility check:
  principle: early-rejection
  description: "Moved eligibility check from position 2 to position 1  -  screens out ineligible
    applicants before any onboarding work begins. Roughly 20% of applications are ineligible;
    each previously consumed ~1h of downstream work across steps 3–5, saving ~12 min per
    average application (20% × 1h × 60 min)."
  estimatedTimeSavedMinutes: 12
  estimatedCostSavedPercent: 4

record_change  -  remove email handoff:
  principle: automate-handoffs
  description: "Removed manual email from Sales to Ops (step 3)  -  replaced with an automatic
    CRM trigger when eligibility is confirmed. Email had no SLA and caused an average 4h wait.
    Eliminating the wait saves ~4h per instance on the critical path."
  estimatedTimeSavedMinutes: 240
  estimatedCostSavedPercent: 18

record_change  -  merge CRM entry + scheduling:
  principle: consolidate
  description: "Merged 'Enter client data into CRM' and 'Schedule onboarding call' into one step
    with parallel: true  -  both use the same client record and have no data dependency on each other.
    Running them in parallel saves the full elapsed time of whichever is shorter; typically ~30 min."
  estimatedTimeSavedMinutes: 30
  estimatedCostSavedPercent: 5

record_change  -  automate welcome email:
  principle: automate-handoffs
  description: "Welcome email is a routine notification triggered when onboarding call is scheduled.
    No judgment required  -  automating it removes ~10 min of manual work per instance."
  estimatedTimeSavedMinutes: 10
  estimatedCostSavedPercent: 2

calculate_cost_summary:
  originalStepsCount: 6, optimisedStepsCount: 4, stepsRemoved: 1, stepsAutomated: 1
  estimatedTimeSavedPercent: 42, estimatedCostSavedPercent: 29

Note: the description fields explain the mechanism and size of each saving  -  they do not just name the change.

SCHEMA RULES:
- Include ALL original steps in each optimize_process call, marking removed ones with status "removed".
- Active steps are those with status != "removed".
- The handoffs array must have exactly (active steps count - 1) entries.
- Every isDecision: true step MUST have branches with at least 2 entries.
- Use the checklist array on merged/consolidated steps to list absorbed sub-steps.
- Mark steps that can run concurrently with parallel: true.
- Set processOwner on each optimize_process call to the accountable department/role.
- Preserve domain-specific terminology from the original steps.`;

const SUMMARIZER_SYSTEM = `You are Sharpin's AI operating-model consultant. Given a completed redesign, produce:

1. executiveSummary  -  ONE sentence, max 15 words, leading with the single biggest quantified improvement.
   GOOD: "Cut 6 of 14 steps, removing 3 cross-department handoffs and saving ~4h per run."
   GOOD: "Moved compliance gate to step 1, eliminating rework on ~30% of rejected cases."
   GOOD: "Automated 4 notification steps, freeing ~45 min of manual work per instance."
   BAD: "Consolidated fragmented steps and automated routine hand-offs." (no numbers, too vague)
   BAD: "Streamlined the process for better efficiency." (meaningless)

2. implementationPriority  -  3–6 concrete actions ordered by impact (highest first). For each:
   - action: specific thing to do (not "improve handoffs"  -  "set up a Slack channel between Finance and Ops with a standard notification template for each handoff")
   - owner: the department or role accountable for doing this
   - effort: "days" | "weeks" | "months"

Return ONLY valid JSON:
{
  "executiveSummary": "...",
  "implementationPriority": [
    { "action": "...", "owner": "...", "effort": "days|weeks|months" }
  ]
}`;

/* ── Tool result extraction ──────────────────────────────────────── */

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

/* ── Main agent (single-pass + validation + repair) ──────────────── */

export async function runRedesignAgent(diagnosticContext, onProgress, requestId) {
  const emit = typeof onProgress === 'function' ? onProgress : () => {};
  const contextStr = typeof diagnosticContext === 'string'
    ? diagnosticContext
    : JSON.stringify(diagnosticContext, null, 2);

  emit('Analysing your current processes…');
  const model = getDeepModel().bindTools(ALL_REDESIGN_TOOLS);

  const plannerMessages = [
    new SystemMessage(PLANNER_SYSTEM),
    new HumanMessage(
      `Here is the diagnostic data for this organisation:\n\n${contextStr}\n\nRedesign the operating model. Make ALL tool calls in a single response.`
    ),
  ];

  emit('Designing optimised process flows…');
  const response = await model.invoke(plannerMessages);

  const toolCalls = response.tool_calls || [];
  if (toolCalls.length === 0) {
    throw new Error('Agent produced no tool calls.');
  }

  const processCount = toolCalls.filter(tc => tc.name === 'optimize_process').length;
  const changeCount = toolCalls.filter(tc => tc.name === 'record_change').length;
  emit(`Mapped ${processCount} optimised process${processCount !== 1 ? 'es' : ''} with ${changeCount} improvement${changeCount !== 1 ? 's' : ''}. Validating…`);

  let extracted = extractFromToolCalls(toolCalls);

  const contextObj = typeof diagnosticContext === 'string' ? {} : diagnosticContext;
  const autoPerc = contextObj?.automationScore?.percentage ?? null;
  const { errors, warnings } = validateRedesign({ ...extracted, automationPercentage: autoPerc });

  if (warnings.length > 0) {
    try { (await import('@/lib/logger')).logger.warn('Redesign warnings', { requestId, warnings }); } catch { /* no logger */ }
  }

  if (errors.length > 0) {
    emit(`Found ${errors.length} consistency issue${errors.length !== 1 ? 's' : ''}  -  repairing…`);
    const allIssues = [...errors, ...warnings.map(w => `(Warning) ${w}`)];
    const issueList = allIssues.map((e, i) => `${i + 1}. ${e}`).join('\n');
    const repairSystem = `${PLANNER_SYSTEM}

VALIDATION ERRORS  -  fix these by making corrected tool calls:
${issueList}`;

    try {
      const repairResponse = await model.invoke([
        new SystemMessage(repairSystem),
        new HumanMessage(
          `The previous attempt had these issues. Here was the original data:\n\n${contextStr}\n\nFix the errors and make ALL corrected tool calls in a single response.`
        ),
      ]);
      const repairCalls = repairResponse.tool_calls || [];
      if (repairCalls.length > 0) {
        const repaired = extractFromToolCalls(repairCalls);
        if (repaired.optimisedProcesses.length > 0) extracted.optimisedProcesses = repaired.optimisedProcesses;
        if (repaired.changes.length > 0) extracted.changes = repaired.changes;
        if (repaired.costSummary) extracted.costSummary = repaired.costSummary;
      }
      emit('Repairs applied successfully.');
    } catch (repairErr) {
      try { (await import('@/lib/logger')).logger.warn('Repair pass failed, using initial results', { requestId, message: repairErr.message }); } catch { /* no logger */ }
      emit('Minor issues remain  -  proceeding with best result.');
    }
  } else {
    emit('Validation passed.');
  }

  emit('Writing executive summary and implementation priorities…');
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
    let text = typeof summaryResponse.content === 'string'
      ? summaryResponse.content
      : summaryResponse.content[0]?.text || '';
    text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const open = text.indexOf('{');
    const close = text.lastIndexOf('}');
    if (open !== -1 && close > open) text = text.substring(open, close + 1);
    const parsed = JSON.parse(text);
    executiveSummary = parsed.executiveSummary || '';
    // Support both structured objects { action, owner, effort } and legacy plain strings
    implementationPriority = (parsed.implementationPriority || []).map(item =>
      typeof item === 'string' ? { action: item, owner: '', effort: '' } : item
    );
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
