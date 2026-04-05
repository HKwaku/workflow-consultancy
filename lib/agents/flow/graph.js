/**
 * Flow Consistency Agent — validates and repairs process step data
 * before flowchart rendering.
 *
 * Two-pass approach:
 *  1. Deterministic normalizer (synchronous) — handles all rule-based repairs
 *  2. AI pass (optional) — resolves ambiguous cases the normalizer can't fix:
 *     - Branch targets that reference non-existent step names or numbers
 *     - Decision nodes with 0 branches where intent is unclear
 *     - Parallel decisions with no downstream merge candidate
 *
 * Usage:
 *   import { runFlowConsistencyAgent } from '@/lib/agents/flow/graph';
 *   const { process: fixed, issues, changes } = await runFlowConsistencyAgent(process);
 */

import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { getFastModel } from '../models.js';
import { validateFlow, repairFlow } from '../../flows/normalizer.js';
import { resolveBranchTarget } from '../../flows/shared.js';
import { ALL_FLOW_CONSISTENCY_TOOLS } from './tools.js';

/* ── System prompt ────────────────────────────────────────────── */

const FLOW_CONSISTENCY_SYSTEM = `You are a flow diagram consistency specialist. You review business process step arrays and fix structural issues that would cause broken or misleading flowchart rendering.

STEP SCHEMA (each step):
- index: 0-based position in the array
- name: step label
- department: team responsible
- isDecision: true → renders as a diamond gateway; MUST have branches[]
- isMerge: true → convergence point where branches rejoin (parallel or inclusive decisions)
- parallel: if isDecision, true = AND gateway — all branches run simultaneously; false = XOR or OR
- inclusive: if isDecision, true = OR gateway — one or more branches run based on conditions
- branches[].label: branch label (e.g. "Yes", "No", "Approved")
- branches[].target: "Step N" (1-indexed) or step name — must resolve to a real step

RENDERING RULES (what breaks the diagram):
1. A branch target that cannot match any step by number or name → missing connection
2. A decision node with fewer than 2 branches → dead-end diamond
3. A parallel (parallel=true) or inclusive (inclusive=true) decision with no downstream isMerge step → branches never converge
4. A step with branches but isDecision=false → gateway not rendered as diamond
5. isMerge=true on a step that no PARALLEL or INCLUSIVE gateway flows into → invalid. isMerge is ONLY valid after parallel or inclusive gateways.
   Exclusive (XOR) decisions NEVER need a merge node — branches just point to their targets.

YOUR WORKFLOW:
1. Call flag_issue for EVERY problem in the issues list provided
2. For each error-severity issue, call the appropriate repair tool:
   - Unresolvable branch target → repair_branch_target (infer from step names and flow logic)
   - Decision with <2 branches → add_default_branches (infer Yes/No paths from context)
   - Parallel decision missing merge → mark_merge_node (pick the step after all branches complete)
   - Erroneous isMerge on an exclusive-decision convergence step → flag_issue only (the normalizer
     will strip it; do NOT call mark_merge_node to re-add it)
3. Do NOT invent connections that aren't implied by the data. If a decision has one branch and
   the other path is genuinely unclear, use the next sequential step as the fallback target.

Make ALL tool calls in a single response.`;

/* ── Apply AI-suggested repairs to steps array ────────────────── */

function applyAIRepairs(steps, toolCalls) {
  const repaired = steps.map((s) => ({
    ...s,
    branches: (s.branches || []).map((b) => ({ ...b })),
  }));
  const changes = [];

  for (const tc of toolCalls) {
    const args = tc.args || tc.input || {};

    if (tc.name === 'repair_branch_target') {
      const { stepIndex, branchIndex, suggestedTargetIndex, reason } = args;
      if (
        stepIndex >= 0 && stepIndex < repaired.length &&
        branchIndex >= 0 &&
        branchIndex < (repaired[stepIndex].branches || []).length &&
        suggestedTargetIndex >= 0 && suggestedTargetIndex < repaired.length &&
        suggestedTargetIndex !== stepIndex
      ) {
        const canonical = `Step ${suggestedTargetIndex + 1}`;
        repaired[stepIndex].branches[branchIndex] = {
          ...repaired[stepIndex].branches[branchIndex],
          target: canonical,
        };
        changes.push(
          `AI: Step ${stepIndex + 1} branch ${branchIndex + 1} target → "${canonical}" (${reason})`
        );
      }
    } else if (tc.name === 'add_default_branches') {
      const {
        stepIndex, yesBranchTargetIndex, noBranchTargetIndex,
        yesLabel = 'Yes', noLabel = 'No',
      } = args;
      if (stepIndex >= 0 && stepIndex < repaired.length) {
        const existing = repaired[stepIndex].branches || [];
        const yesTarget = `Step ${(yesBranchTargetIndex || 0) + 1}`;
        const noTarget = `Step ${(noBranchTargetIndex || 0) + 1}`;
        if (existing.length === 0) {
          repaired[stepIndex].branches = [
            { label: yesLabel, target: yesTarget },
            { label: noLabel, target: noTarget },
          ];
        } else if (existing.length === 1) {
          repaired[stepIndex].branches.push({ label: noLabel, target: noTarget });
        }
        repaired[stepIndex].isDecision = true;
        changes.push(
          `AI: Step ${stepIndex + 1} ("${repaired[stepIndex].name}") given branches: ${yesLabel}→${yesTarget}, ${noLabel}→${noTarget}`
        );
      }
    } else if (tc.name === 'mark_merge_node') {
      const { stepIndex, reason } = args;
      if (stepIndex >= 0 && stepIndex < repaired.length) {
        repaired[stepIndex].isMerge = true;
        changes.push(
          `AI: Step ${stepIndex + 1} ("${repaired[stepIndex].name}") marked as merge node (${reason})`
        );
      }
    }
  }

  return { steps: repaired, changes };
}

/* ── Build human message ─────────────────────────────────────── */

function buildStepsDescription(steps) {
  return steps
    .map((s, i) => {
      let line = `${i + 1}. "${s.name || '?'}" [${s.department || '?'}]`;
      if (s.isDecision) line += s.parallel ? ' (PARALLEL/AND gateway)' : s.inclusive ? ' (INCLUSIVE/OR gateway)' : ' (EXCLUSIVE/XOR decision)';
      if (s.isMerge) line += ' (MERGE)';
      if ((s.branches || []).length) {
        const bList = s.branches
          .map((b) => `"${b.label || '?'}" → ${b.target || 'MISSING'}`)
          .join(' | ');
        line += `\n   Branches: ${bList}`;
      }
      return line;
    })
    .join('\n');
}

/* ── Main export ─────────────────────────────────────────────── */

/**
 * Run the Flow Consistency Agent on a single process.
 *
 * @param {object} process - Process object with steps[], handoffs[], etc.
 * @param {object} [options]
 * @param {string}  [options.requestId]   - For logging
 * @param {boolean} [options.aiEnabled]   - Default true. Set false to use normalizer only.
 * @returns {Promise<{ process: object, issues: object[], changes: string[] }>}
 */
export async function runFlowConsistencyAgent(
  process,
  { requestId, aiEnabled = true } = {}
) {
  const steps = process.steps || [];

  // ── Step 1: Deterministic normalisation ─────────────────────
  const { steps: normalizedSteps, changes: normChanges } = repairFlow(steps);

  // ── Step 2: Validate post-normalisation ──────────────────────
  const remainingIssues = validateFlow(normalizedSteps);
  const errorIssues = remainingIssues.filter((i) => i.severity === 'error');

  // ── Step 3: AI pass only when errors remain ──────────────────
  let aiChanges = [];
  let finalSteps = normalizedSteps;

  if (aiEnabled && errorIssues.length > 0) {
    try {
      const model = getFastModel().bindTools(ALL_FLOW_CONSISTENCY_TOOLS);

      const stepsDesc = buildStepsDescription(normalizedSteps);
      const issuesDesc = errorIssues
        .map((iss) => `- Step ${iss.stepIndex + 1}: [${iss.type}] ${iss.description}`)
        .join('\n');

      const humanContent = `PROCESS: "${process.processName || 'Unnamed'}"

STEPS (${normalizedSteps.length} total):
${stepsDesc}

ISSUES FOUND BY NORMALIZER (${errorIssues.length} error${errorIssues.length !== 1 ? 's' : ''}):
${issuesDesc}

Please flag each issue and apply the appropriate repairs.`;

      const response = await model.invoke([
        new SystemMessage(FLOW_CONSISTENCY_SYSTEM),
        new HumanMessage(humanContent),
      ]);

      const toolCalls = response.tool_calls || [];
      if (toolCalls.length > 0) {
        const { steps: aiRepairedSteps, changes } = applyAIRepairs(
          normalizedSteps,
          toolCalls
        );
        finalSteps = aiRepairedSteps;
        aiChanges = changes;
      }
    } catch (err) {
      try {
        const { logger } = await import('@/lib/logger');
        logger.warn('Flow consistency AI pass failed — using normalizer output only', {
          requestId,
          error: err.message,
          processName: process.processName,
        });
      } catch { /* no logger */ }
    }
  }

  const allChanges = [...normChanges, ...aiChanges];
  const finalIssues = validateFlow(finalSteps);

  return {
    process: { ...process, steps: finalSteps },
    issues: finalIssues,
    changes: allChanges,
  };
}
