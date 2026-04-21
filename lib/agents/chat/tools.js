/* Anthropic SDK tool definitions for the diagnostic chat agent. */

const BRANCH_PROPERTIES = {
  label: { type: 'string' },
  target: { type: 'string', description: 'Target step reference, e.g. "Step N"' },
};
const BRANCH_REQUIRED = ['label', 'target'];

const STEP_PROPERTIES = {
  name: { type: 'string' },
  department: { type: 'string' },
  isExternal: { type: 'boolean' },
  isDecision: { type: 'boolean' },
  isMerge: { type: 'boolean' },
  parallel: { type: 'boolean' },
  workMinutes: { type: 'number' },
  waitMinutes: { type: 'number' },
  systems: { type: 'array', items: { type: 'string' } },
  branches: {
    type: 'array',
    items: { type: 'object', properties: BRANCH_PROPERTIES, required: BRANCH_REQUIRED },
  },
  owner: { type: 'string' },
  checklist: { type: 'array', items: { type: 'string' } },
};

export const ADD_STEP_TOOL = {
  name: 'add_step',
  description: 'Add a new process step to the flow. Use isMerge:true for a convergence point after parallel or exclusive branches.',
  input_schema: {
    type: 'object',
    properties: {
      ...STEP_PROPERTIES,
      name: { type: 'string', description: 'Step name (concise, 3-8 words)' },
      department: { type: 'string', description: 'Department responsible (Sales, Finance, IT, HR, etc.)' },
      isExternal: { type: 'boolean', description: 'Whether this involves an external party' },
      isDecision: { type: 'boolean', description: 'Whether this is a decision/routing point' },
      isMerge: { type: 'boolean', description: 'Whether this is a merge/convergence point where branches rejoin' },
      parallel: { type: 'boolean', description: 'If isDecision: true = AND/parallel gateway (all branches run simultaneously)' },
      inclusive: { type: 'boolean', description: 'If isDecision: true = OR/inclusive gateway (one or more branches run)' },
      workMinutes: { type: 'number', description: 'Active hands-on work time in minutes' },
      waitMinutes: { type: 'number', description: 'Waiting/idle time in minutes (e.g. 120 for approvals)' },
      systems: { type: 'array', items: { type: 'string' }, description: 'Systems or tools used at this step' },
      branches: {
        type: 'array',
        items: { type: 'object', properties: BRANCH_PROPERTIES, required: BRANCH_REQUIRED },
        description: 'Decision branches (only if isDecision:true). Set target to e.g. "Step 3"',
      },
      owner: { type: 'string', description: 'Person or role responsible for this step' },
      checklist: { type: 'array', items: { type: 'string' }, description: 'Checklist items that must be done at this step' },
      afterStep: { type: 'number', description: 'Insert after this step number. 0 = beginning, omit = append to end' },
    },
    required: ['name'],
  },
};

export const UPDATE_STEP_TOOL = {
  name: 'update_step',
  description: 'Update properties of an existing step. Only include fields you want to change.',
  input_schema: {
    type: 'object',
    properties: {
      stepNumber: { type: 'number', description: 'The step number to update (1-based)' },
      name: { type: 'string' },
      department: { type: 'string' },
      isExternal: { type: 'boolean' },
      isDecision: { type: 'boolean' },
      isMerge: { type: 'boolean', description: 'Mark as merge/convergence point' },
      workMinutes: { type: 'number', description: 'Active work time in minutes' },
      waitMinutes: { type: 'number', description: 'Waiting time in minutes' },
      systems: { type: 'array', items: { type: 'string' } },
      branches: {
        type: 'array',
        items: { type: 'object', properties: BRANCH_PROPERTIES, required: BRANCH_REQUIRED },
        description: 'Set branch routes. target must be "Step N" (1-based)',
      },
      parallel: { type: 'boolean', description: 'true = AND/parallel gateway (all branches run)' },
      inclusive: { type: 'boolean', description: 'true = OR/inclusive gateway (one or more branches run)' },
      owner: { type: 'string', description: 'Person or role responsible' },
      checklist: { type: 'array', items: { type: 'string' } },
    },
    required: ['stepNumber'],
  },
};

export const REMOVE_STEP_TOOL = {
  name: 'remove_step',
  description: 'Remove a step from the flow.',
  input_schema: {
    type: 'object',
    properties: {
      stepNumber: { type: 'number', description: 'Step number to remove (1-based)' },
    },
    required: ['stepNumber'],
  },
};

export const SET_HANDOFF_TOOL = {
  name: 'set_handoff',
  description: 'Set handoff details between consecutive steps.',
  input_schema: {
    type: 'object',
    properties: {
      fromStep: { type: 'number', description: 'Step number that hands off (1-based)' },
      method: {
        type: 'string',
        enum: ['email-details', 'email-check', 'slack', 'spreadsheet', 'in-person', 'verbal', 'they-knew', 'other'],
        description: 'How the next person/team finds out',
      },
      clarity: {
        type: 'string',
        enum: ['no', 'yes-once', 'yes-multiple', 'yes-major'],
        description: 'Did the next person come back for clarification?',
      },
    },
    required: ['fromStep', 'method'],
  },
};

export const ADD_CUSTOM_DEPARTMENT_TOOL = {
  name: 'add_custom_department',
  description: 'Add a custom department to the picklist. Use when the user explicitly asks to add a new department (e.g. Warehouse, Logistics).',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Department name' },
    },
    required: ['name'],
  },
};

export const REPLACE_ALL_STEPS_TOOL = {
  name: 'replace_all_steps',
  description: 'Replace the entire step list. Use when the user describes a complete flow from scratch or wants to start over.',
  input_schema: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: STEP_PROPERTIES,
          required: ['name'],
        },
      },
    },
    required: ['steps'],
  },
};

export const ALL_CHAT_TOOLS = [
  ADD_STEP_TOOL,
  UPDATE_STEP_TOOL,
  REMOVE_STEP_TOOL,
  SET_HANDOFF_TOOL,
  ADD_CUSTOM_DEPARTMENT_TOOL,
  REPLACE_ALL_STEPS_TOOL,
];
