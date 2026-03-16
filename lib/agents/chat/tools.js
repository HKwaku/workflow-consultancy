import { tool } from '@langchain/core/tools';
import { z } from 'zod';

const BranchSchema = z.object({
  label: z.string(),
  target: z.string().describe('Target step reference, e.g. "Step N"'),
});

export const addStepTool = tool(
  async (input) => {
    const pos = input.afterStep != null ? `after step ${input.afterStep}` : 'at end';
    return `Added step "${input.name}" ${pos}.`;
  },
  {
    name: 'add_step',
    description: 'Add a new process step to the flow. Use isMerge:true for a convergence point after parallel or exclusive branches.',
    schema: z.object({
      name: z.string().describe('Step name (concise, 3-8 words)'),
      department: z.string().optional().describe('Department responsible (Sales, Finance, IT, HR, etc. or any custom name)'),
      isExternal: z.boolean().optional().describe('Whether this involves an external party'),
      isDecision: z.boolean().optional().describe('Whether this is a decision/routing point'),
      isMerge: z.boolean().optional().describe('Whether this is a merge/convergence point where branches rejoin'),
      parallel: z.boolean().optional().describe('If isDecision: true = parallel gateway (all branches run simultaneously); false/omit = exclusive (one branch chosen)'),
      workMinutes: z.number().optional().describe('Active hands-on work time in minutes'),
      waitMinutes: z.number().optional().describe('Waiting/idle time in minutes (e.g. 120 for approvals)'),
      systems: z.array(z.string()).optional().describe('Systems or tools used at this step'),
      branches: z.array(BranchSchema).optional().describe('Decision branches (only if isDecision:true). Set target to e.g. "Step 3"'),
      owner: z.string().optional().describe('Person or role responsible for this step'),
      checklist: z.array(z.string()).optional().describe('Checklist items that must be done at this step'),
      afterStep: z.number().optional().describe('Insert after this step number. 0 = beginning, omit = append to end'),
    }),
  }
);

export const updateStepTool = tool(
  async (input) => {
    const fields = Object.keys(input).filter(k => k !== 'stepNumber' && input[k] !== undefined);
    return `Updated step ${input.stepNumber}: ${fields.join(', ')}.`;
  },
  {
    name: 'update_step',
    description: 'Update properties of an existing step. Only include fields you want to change.',
    schema: z.object({
      stepNumber: z.number().describe('The step number to update (1-based)'),
      name: z.string().optional(),
      department: z.string().optional(),
      isExternal: z.boolean().optional(),
      isDecision: z.boolean().optional(),
      isMerge: z.boolean().optional().describe('Mark as merge/convergence point'),
      workMinutes: z.number().optional().describe('Active work time in minutes'),
      waitMinutes: z.number().optional().describe('Waiting time in minutes'),
      systems: z.array(z.string()).optional(),
      branches: z.array(BranchSchema).optional().describe('Set branch routes. target must be "Step N" (1-based)'),
      parallel: z.boolean().optional().describe('true = parallel gateway; false = exclusive decision'),
      owner: z.string().optional().describe('Person or role responsible'),
      checklist: z.array(z.string()).optional(),
    }),
  }
);

export const removeStepTool = tool(
  async (input) => `Removed step ${input.stepNumber}.`,
  {
    name: 'remove_step',
    description: 'Remove a step from the flow.',
    schema: z.object({
      stepNumber: z.number().describe('Step number to remove (1-based)'),
    }),
  }
);

export const setHandoffTool = tool(
  async (input) => `Set handoff from step ${input.fromStep}: ${input.method}.`,
  {
    name: 'set_handoff',
    description: 'Set handoff details between consecutive steps.',
    schema: z.object({
      fromStep: z.number().describe('Step number that hands off (1-based)'),
      method: z.enum([
        'email-details', 'email-check', 'slack', 'spreadsheet',
        'in-person', 'verbal', 'they-knew', 'other',
      ]).describe('How the next person/team finds out'),
      clarity: z.enum([
        'no', 'yes-once', 'yes-multiple', 'yes-major',
      ]).optional().describe('Did the next person come back for clarification?'),
    }),
  }
);

export const addCustomDepartmentTool = tool(
  async (input) => `Added custom department "${input.name}".`,
  {
    name: 'add_custom_department',
    description: 'Add a custom department to the picklist. Use when the user explicitly asks to add a new department (e.g. Warehouse, Logistics).',
    schema: z.object({
      name: z.string().describe('Department name'),
    }),
  }
);

const StepInputSchema = z.object({
  name: z.string(),
  department: z.string().optional(),
  isExternal: z.boolean().optional(),
  isDecision: z.boolean().optional(),
  isMerge: z.boolean().optional(),
  parallel: z.boolean().optional(),
  workMinutes: z.number().optional(),
  waitMinutes: z.number().optional(),
  systems: z.array(z.string()).optional(),
  branches: z.array(BranchSchema).optional(),
  owner: z.string().optional(),
  checklist: z.array(z.string()).optional(),
});

export const replaceAllStepsTool = tool(
  async (input) => `Replaced entire flow with ${input.steps.length} steps.`,
  {
    name: 'replace_all_steps',
    description: 'Replace the entire step list. Use when the user describes a complete flow from scratch or wants to start over.',
    schema: z.object({
      steps: z.array(StepInputSchema),
    }),
  }
);

export const ALL_CHAT_TOOLS = [
  addStepTool,
  updateStepTool,
  removeStepTool,
  setHandoffTool,
  addCustomDepartmentTool,
  replaceAllStepsTool,
];
