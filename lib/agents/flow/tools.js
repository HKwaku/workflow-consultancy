/**
 * LangChain tools for the Flow Consistency Agent.
 * Handles ambiguous repairs that the deterministic normalizer can't resolve.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/* ── Tool 1: flag_issue ───────────────────────────────────────── */

export const flagIssueTool = tool(
  async (input) => JSON.stringify({ recorded: true, ...input }),
  {
    name: 'flag_issue',
    description:
      'Record a flow consistency issue found in the process step data. Call this for every problem you identify before calling any repair tools.',
    schema: z.object({
      stepIndex: z
        .number()
        .int()
        .min(0)
        .describe('0-based index of the step with the issue'),
      type: z
        .enum([
          'unresolvable-branch',
          'insufficient-branches',
          'missing-merge-node',
          'self-referencing-branch',
          'missing-decision-flag',
          'orphaned-step',
          'other',
        ])
        .describe('Issue category'),
      description: z
        .string()
        .max(300)
        .describe('Clear description of the issue and why it causes rendering problems'),
      severity: z
        .enum(['error', 'warning'])
        .describe('error = causes broken rendering; warning = visual inconsistency only'),
    }),
  }
);

/* ── Tool 2: repair_branch_target ────────────────────────────── */

export const repairBranchTargetTool = tool(
  async (input) => JSON.stringify({ repaired: true, ...input }),
  {
    name: 'repair_branch_target',
    description:
      'Fix an unresolvable branch target. Use when a branch says "go to [name or unclear reference]" but cannot be matched to any step. Infer the correct target step from context — step names, flow logic, and branch labels.',
    schema: z.object({
      stepIndex: z
        .number()
        .int()
        .min(0)
        .describe('0-based index of the decision step with the broken branch'),
      branchIndex: z
        .number()
        .int()
        .min(0)
        .describe('0-based index of the branch within the step'),
      suggestedTargetIndex: z
        .number()
        .int()
        .min(0)
        .describe('0-based index of the correct target step (your best inference)'),
      reason: z
        .string()
        .max(300)
        .describe(
          'Reasoning for this target (e.g. "closest name match", "only step in the No path", "implied by the flow sequence")'
        ),
    }),
  }
);

/* ── Tool 3: add_default_branches ────────────────────────────── */

export const addDefaultBranchesTool = tool(
  async (input) => JSON.stringify({ repaired: true, ...input }),
  {
    name: 'add_default_branches',
    description:
      'Add branches to a decision node that has fewer than 2. Use surrounding context to infer what the Yes/No paths should be. Only call when the decision node genuinely needs branches to be renderable.',
    schema: z.object({
      stepIndex: z
        .number()
        .int()
        .min(0)
        .describe('0-based index of the decision step needing branches'),
      yesBranchTargetIndex: z
        .number()
        .int()
        .min(0)
        .describe('0-based index of the step the Yes/positive branch should go to'),
      noBranchTargetIndex: z
        .number()
        .int()
        .min(0)
        .describe('0-based index of the step the No/negative branch should go to'),
      yesLabel: z
        .string()
        .optional()
        .default('Yes')
        .describe('Label for the positive branch (e.g. "Approved", "Pass", "Yes")'),
      noLabel: z
        .string()
        .optional()
        .default('No')
        .describe('Label for the negative branch (e.g. "Rejected", "Fail", "No")'),
    }),
  }
);

/* ── Tool 4: mark_merge_node ─────────────────────────────────── */

export const markMergeNodeTool = tool(
  async (input) => JSON.stringify({ repaired: true, ...input }),
  {
    name: 'mark_merge_node',
    description:
      'Mark an existing step as the convergence point (isMerge) for a parallel decision. Use the step that logically follows when all parallel branches complete. Only call when the normalizer could not identify a merge candidate.',
    schema: z.object({
      stepIndex: z
        .number()
        .int()
        .min(0)
        .describe('0-based index of the step to mark as isMerge=true'),
      reason: z
        .string()
        .max(300)
        .describe('Why this step is the correct convergence point'),
    }),
  }
);

/* ── Export all tools ─────────────────────────────────────────── */

export const ALL_FLOW_CONSISTENCY_TOOLS = [
  flagIssueTool,
  repairBranchTargetTool,
  addDefaultBranchesTool,
  markMergeNodeTool,
];
