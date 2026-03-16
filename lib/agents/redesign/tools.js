import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const StepSchema = z.object({
  name: z.string().describe('Step name'),
  department: z.string().describe('Department responsible'),
  isDecision: z.boolean().default(false).describe('Whether this is a decision/routing point'),
  branches: z.array(z.object({
    label: z.string().describe('Branch label, e.g. "Yes", "No", "Approved", "Rejected"'),
    target: z.string().describe('Target step name (must exactly match a step name in the steps array)'),
  })).default([]).describe('Decision branches  -  REQUIRED with ≥2 entries if isDecision is true. Each branch must route to a different active step.'),
  status: z.enum(['unchanged', 'modified', 'added', 'removed', 'automated']).describe('What happened to this step'),
  changeNote: z.string().optional().describe('Reason for the change (omit if unchanged)'),
  checklist: z.array(z.string()).default([]).describe('Sub-tasks within this step (used when merging multiple steps into one logical group)'),
  parallel: z.boolean().default(false).describe('True if this step can run at the same time as the next step (no data dependency between them)'),
});

const HandoffSchema = z.object({
  method: z.enum(['email', 'slack', 'meeting', 'shared-doc', 'automated']),
  clarity: z.enum(['no', 'yes-once', 'yes-multiple']),
});

/**
 * Tool: optimize_process
 * The agent calls this once per process to submit the full optimised step list.
 */
export const optimizeProcessTool = tool(
  async (input) => {
    const activeSteps = input.steps.filter(s => s.status !== 'removed');
    return JSON.stringify({
      processName: input.processName,
      steps: input.steps,
      handoffs: input.handoffs,
      activeStepCount: activeSteps.length,
    });
  },
  {
    name: 'optimize_process',
    description: 'Submit the full optimised step list for a process. Include ALL original steps  -  mark removed ones with status "removed". Handoffs array must have exactly (active steps - 1) entries.',
    schema: z.object({
      processName: z.string().describe('Process name matching the original'),
      processOwner: z.string().describe('The single department or role accountable for this process end-to-end'),
      steps: z.array(StepSchema).describe('Complete step list including removed steps'),
      handoffs: z.array(HandoffSchema).describe('Handoffs between active (non-removed) steps'),
    }),
  }
);

/**
 * Tool: record_change
 * The agent calls this for each modification it makes.
 */
export const recordChangeTool = tool(
  async (input) => {
    return JSON.stringify({ recorded: true, ...input });
  },
  {
    name: 'record_change',
    description: 'Record a single change made to a process. Call once per modification.',
    schema: z.object({
      process: z.string().describe('Process name'),
      stepName: z.string().describe('Affected step name'),
      type: z.enum(['removed', 'automated', 'merged', 'added', 'reordered', 'modified']),
      description: z.string().describe(
        'Causal explanation with three parts: (1) what specifically changed, ' +
        '(2) the mechanism by which it saves time or cost, ' +
        '(3) a rough size justification. ' +
        'Example: "Moved compliance check from step 5 to step 1  -  catches rejected cases before expensive downstream processing. ' +
        'Roughly 25% of cases are rejected; each previously wasted ~3h of downstream work, saving ~45 min per average instance." ' +
        'Do not write vague descriptions like "merged steps for efficiency".'
      ),
      principle: z.enum([
        'consolidate', 'preserve-decisions', 'automate-handoffs', 'realistic-estimates',
        'structural-integrity', 'checklists', 'cross-department', 'common-case',
        'parallel', 'early-rejection', 'minimise-teams', 'process-owner',
        'cut-no-value', 'fix-before-automate',
      ]).describe('Which redesign principle drove this change'),
      estimatedTimeSavedMinutes: z.number().min(0).max(480).default(0).describe('Realistic time saving estimate in minutes (0–480)'),
      estimatedCostSavedPercent: z.number().min(0).max(100).default(0).describe('Realistic cost saving percentage (0–100)'),
    }),
  }
);

/**
 * Tool: calculate_cost_summary
 * The agent calls this after all processes are optimised.
 */
export const calculateCostSummaryTool = tool(
  async (input) => {
    const summary = {
      originalStepsCount: input.originalStepsCount,
      optimisedStepsCount: input.optimisedStepsCount,
      stepsRemoved: input.stepsRemoved,
      stepsAutomated: input.stepsAutomated,
      estimatedTimeSavedPercent: input.estimatedTimeSavedPercent,
      estimatedCostSavedPercent: input.estimatedCostSavedPercent,
    };
    return JSON.stringify(summary);
  },
  {
    name: 'calculate_cost_summary',
    description: 'Calculate the overall cost summary after all processes are optimised. Counts must be consistent with recorded changes.',
    schema: z.object({
      originalStepsCount: z.number().int().min(0).describe('Total steps across all original processes'),
      optimisedStepsCount: z.number().int().min(0).describe('Total active steps in optimised processes'),
      stepsRemoved: z.number().int().min(0).describe('Total steps removed'),
      stepsAutomated: z.number().int().min(0).describe('Total steps automated'),
      estimatedTimeSavedPercent: z.number().min(0).max(100).describe('Overall time saved percentage (0–100)'),
      estimatedCostSavedPercent: z.number().min(0).max(100).describe('Overall cost saved percentage (0–100)'),
    }),
  }
);

/**
 * Programmatic validation  -  not an LLM tool, called directly by the validator node.
 */
export function validateRedesign({ optimisedProcesses, changes, costSummary, automationPercentage }) {
  const errors = [];
  const warnings = [];

  if (!optimisedProcesses || optimisedProcesses.length === 0) {
    errors.push('No optimised processes found.');
    return errors;
  }

  let totalOriginal = 0;
  let totalActive = 0;
  let totalRemoved = 0;
  let totalAutomated = 0;

  for (const proc of optimisedProcesses) {
    const steps = proc.steps || [];
    const active = steps.filter(s => s.status !== 'removed');
    const handoffs = proc.handoffs || [];
    const activeNames = new Set(active.map(s => s.name));

    totalOriginal += steps.length;
    totalActive += active.length;
    totalRemoved += steps.filter(s => s.status === 'removed').length;
    totalAutomated += steps.filter(s => s.status === 'automated').length;

    if (handoffs.length !== Math.max(0, active.length - 1)) {
      errors.push(
        `Process "${proc.processName}": handoffs count (${handoffs.length}) should be ${Math.max(0, active.length - 1)} (active steps - 1).`
      );
    }

    const activeNamesLower = new Map(active.map(s => [s.name.toLowerCase(), s.name]));

    for (const step of active) {
      if (step.isDecision) {
        if (!step.branches || step.branches.length < 2) {
          errors.push(
            `Process "${proc.processName}", step "${step.name}": decision steps must have at least 2 branches (found ${step.branches?.length || 0}).`
          );
        } else {
          for (const branch of step.branches) {
            const t = (branch.target || '').trim();
            const byName = activeNames.has(t) || activeNamesLower.has(t.toLowerCase());
            const numMatch = t.match(/(\d+)/);
            const byNum = numMatch && parseInt(numMatch[1]) - 1 >= 0 && parseInt(numMatch[1]) - 1 < steps.length && steps[parseInt(numMatch[1]) - 1]?.status !== 'removed';
            if (!byName && !byNum) {
              errors.push(
                `Process "${proc.processName}", step "${step.name}": branch "${branch.label}" targets "${branch.target}" which is not an active step. Use the exact step name as target.`
              );
            }
          }
        }
      }

      if (step.status === 'modified' && step.changeNote?.toLowerCase().includes('merg') && (!step.checklist || step.checklist.length === 0)) {
        errors.push(
          `Process "${proc.processName}", step "${step.name}": merged step should have a checklist of absorbed sub-steps.`
        );
      }
    }

    const processChanges = (changes || []).filter(
      c => c.process?.toLowerCase() === proc.processName?.toLowerCase()
    );
    const modifiedSteps = steps.filter(s => s.status && s.status !== 'unchanged');
    if (modifiedSteps.length > 0 && processChanges.length === 0) {
      errors.push(
        `Process "${proc.processName}": has ${modifiedSteps.length} modified steps but no recorded changes.`
      );
    }
  }

  if (costSummary) {
    if (costSummary.originalStepsCount !== totalOriginal) {
      errors.push(
        `costSummary.originalStepsCount (${costSummary.originalStepsCount}) does not match actual (${totalOriginal}).`
      );
    }
    if (costSummary.optimisedStepsCount !== totalActive) {
      errors.push(
        `costSummary.optimisedStepsCount (${costSummary.optimisedStepsCount}) does not match actual active (${totalActive}).`
      );
    }
    if (costSummary.stepsRemoved !== totalRemoved) {
      errors.push(
        `costSummary.stepsRemoved (${costSummary.stepsRemoved}) does not match actual (${totalRemoved}).`
      );
    }
  } else {
    errors.push('costSummary is missing.');
  }

  if (typeof automationPercentage === 'number' && automationPercentage > 30 && totalAutomated === 0) {
    errors.push(
      `The diagnostic scored automation readiness at ${automationPercentage}% but the redesign automates zero steps. At least one step should be marked "automated".`
    );
  }

  for (const proc of optimisedProcesses) {
    const active = (proc.steps || []).filter(s => s.status !== 'removed');
    const decisionSteps = active.filter(s => s.isDecision);
    for (const dec of decisionSteps) {
      const hasRejectBranch = (dec.branches || []).some(
        b => /reject|fail|deny|terminat|cancel|stop|no/i.test(b.label)
      );
      if (hasRejectBranch) {
        const idx = active.indexOf(dec);
        const position = idx / active.length;
        if (position > 0.7) {
          warnings.push(
            `Process "${proc.processName}", step "${dec.name}": this rejection gate is near the end of the process (position ${idx + 1}/${active.length}). Consider moving it earlier to avoid wasted effort on cases that will be rejected.`
          );
        }
      }
    }
  }

  return { errors, warnings };
}

export const ALL_REDESIGN_TOOLS = [
  optimizeProcessTool,
  recordChangeTool,
  calculateCostSummaryTool,
];
