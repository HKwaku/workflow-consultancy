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

/* ── Read tools: diagnostic analytics ─────────────────────────────── */

export const GET_BOTTLENECKS_TOOL = {
  name: 'get_bottlenecks',
  description:
    'Get scored bottlenecks for the current flow. Returns highest-risk steps with wait time, causes, and severity. Call this when the user asks about bottlenecks, biggest waits, or where the flow is stuck.',
  input_schema: { type: 'object', properties: {} },
};

export const GET_CRITICAL_PATH_TOOL = {
  name: 'get_critical_path',
  description:
    'Get the critical path of the flow - the linear sequence of steps with the highest total duration (work + wait). Returns total minutes and per-step contribution. Call when the user asks about longest path, total cycle time, or what dominates duration.',
  input_schema: { type: 'object', properties: {} },
};

export const GET_STEP_METRICS_TOOL = {
  name: 'get_step_metrics',
  description:
    'Get per-step metrics (work minutes, wait minutes, decisions, merge points, missing-info warnings) for the current flow. Use to answer questions about specific steps, completeness, or summary stats.',
  input_schema: {
    type: 'object',
    properties: {
      stepNumber: { type: 'number', description: 'Optional: scope to a single step (1-based). Omit to get all.' },
    },
  },
};

export const GET_COST_SUMMARY_TOOL = {
  name: 'get_cost_summary',
  description:
    'Get the cost analysis summary for the current report: labour rates, annual cost, estimated savings, payback, ROI. Only returns data if a cost analysis has been saved. Call when the user asks about cost, savings, payback, or ROI.',
  input_schema: { type: 'object', properties: {} },
};

export const GET_RECOMMENDATIONS_TOOL = {
  name: 'get_recommendations',
  description:
    'Get the stored AI recommendations for this report (top automation / redesign / redesign opportunities). Only returns data if recommendations have been generated. Call when the user asks about opportunities, next steps, quick wins, or what to automate.',
  input_schema: { type: 'object', properties: {} },
};

/* ── Cross-report tools (requires signed-in user) ────────────────── */

export const LIST_REPORTS_TOOL = {
  name: 'list_reports',
  description:
    'List the signed-in user\'s previously saved diagnostic reports (id, process name, company, savings, date). Use when the user references "my other audits", "my last process", "compare to previous", or similar. Only works for authenticated users.',
  input_schema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Max number of reports to return (default 8, max 20)' },
    },
  },
};

export const LOAD_REPORT_SUMMARY_TOOL = {
  name: 'load_report_summary',
  description:
    'Fetch a concise summary of one of the user\'s saved reports by id: process name, step count, annual cost, savings, automation %, payback. Call list_reports first to get ids.',
  input_schema: {
    type: 'object',
    properties: {
      reportId: { type: 'string', description: 'Report id (UUID) from list_reports' },
    },
    required: ['reportId'],
  },
};

/* ── Cost mutation proposals (client proposes, user confirms) ─────── */

export const SET_LABOUR_RATE_TOOL = {
  name: 'set_labour_rate',
  description:
    'Propose an update to a department labour rate in the cost analysis. The client surfaces a one-click apply button - do not call when cost analysis is not loaded.',
  input_schema: {
    type: 'object',
    properties: {
      department: { type: 'string', description: 'Department name as it appears in the labour rates table' },
      rateInput: { type: 'number', description: 'New rate (hourly or annual - see rateType)' },
      rateType: { type: 'string', enum: ['hourly', 'annual'], description: 'Unit of the rate' },
      reason: { type: 'string', description: 'Short justification shown to the user with the apply button' },
    },
    required: ['department', 'rateInput'],
  },
};

export const SET_NON_LABOUR_COST_TOOL = {
  name: 'set_non_labour_cost',
  description:
    'Propose an update to non-labour recurring cost (software/systems, overhead). The client surfaces an apply button.',
  input_schema: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'Non-labour line key (e.g., "systems", "overhead")' },
      amount: { type: 'number', description: 'New annual amount' },
      reason: { type: 'string' },
    },
    required: ['key', 'amount'],
  },
};

export const SET_INVESTMENT_TOOL = {
  name: 'set_investment',
  description:
    'Propose an update to implementation investment (one-off cost to redesign/automate). The client surfaces an apply button.',
  input_schema: {
    type: 'object',
    properties: {
      amount: { type: 'number', description: 'One-off investment amount' },
      reason: { type: 'string' },
    },
    required: ['amount'],
  },
};

/* ── Navigation / view control ────────────────────────────────────── */

export const HIGHLIGHT_STEP_TOOL = {
  name: 'highlight_step',
  description:
    'Highlight a specific step on the flow canvas - sets the active step and scrolls the inspector to it. Use when referencing a specific step in your explanation.',
  input_schema: {
    type: 'object',
    properties: {
      stepNumber: { type: 'number', description: '1-based step number to highlight' },
    },
    required: ['stepNumber'],
  },
};

export const OPEN_PANEL_TOOL = {
  name: 'open_panel',
  description:
    'Open a panel in the workspace. "report" shows the saved diagnostic report inline; "cost" shows the cost analysis inline; "flow" returns to the canvas. Use when the user asks to see the report/cost, or when an answer benefits from showing it.',
  input_schema: {
    type: 'object',
    properties: {
      panel: { type: 'string', enum: ['flow', 'report', 'cost'], description: 'Which panel to open' },
    },
    required: ['panel'],
  },
};

/* ── Report generation (terminal action) ─────────────────────────── */

export const GENERATE_REPORT_TOOL = {
  name: 'generate_report',
  description:
    'Generate the final diagnostic report from the current flow. Only call this when ALL intake phases are complete (INTAKE PHASE STATE shows all ✓) AND the user has confirmed they want the report now. Do not call unprompted - always ask "Shall I generate your report now?" first and wait for the user to say yes. This is a terminal action: it runs the report generator and pins a report artefact to this turn.',
  input_schema: {
    type: 'object',
    properties: {
      note: { type: 'string', description: 'Optional short note shown alongside the generation trigger (e.g. "All phases complete - generating report.")' },
    },
  },
};

export const GENERATE_COST_TOOL = {
  name: 'generate_cost',
  description:
    'Open the cost analysis for the current report so the user can review labour rates, savings, payback and ROI. Only call AFTER a report has been generated AND the user has confirmed they want to see the cost view. Always ask "Shall I open the cost analysis?" first. Pins a cost_analysis artefact to this turn.',
  input_schema: {
    type: 'object',
    properties: {
      note: { type: 'string', description: 'Optional short note shown alongside the trigger.' },
    },
  },
};

/* ── Undo (action history) ────────────────────────────────────────── */

export const UNDO_LAST_ACTION_TOOL = {
  name: 'undo_last_action',
  description:
    'Revert the most recent chat-applied change to the flow (add/update/remove/handoff/replace_all). Only undoes chat actions, not manual edits.',
  input_schema: { type: 'object', properties: {} },
};

/* ── Proposal / discovery (used by both main and redesign chat) ───── */

export const PROPOSE_CHANGE_TOOL = {
  name: 'propose_change',
  description:
    'Present a specific process improvement proposal as a formatted block for the user to review BEFORE making canvas edits. Use for non-trivial changes where the user should confirm.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short title, e.g. "Remove duplicate approval step"' },
      rationale: { type: 'string', description: 'Why this improves the process - cite step names and the problem' },
      steps_affected: { type: 'array', items: { type: 'string' }, description: 'Step names to be added/changed/removed' },
      expected_impact: { type: 'string', description: 'Concrete outcome: time saved, cost reduction, risk reduction' },
    },
    required: ['title', 'rationale'],
  },
};

export const ASK_DISCOVERY_TOOL = {
  name: 'ask_discovery',
  description:
    'Ask a single focused discovery question to gather context BEFORE proposing changes. Use when you need to understand goals, constraints, or pain points.',
  input_schema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'Single specific question, max 20 words' },
      area: {
        type: 'string',
        enum: ['goal', 'bottleneck', 'cost', 'handoff', 'automation', 'constraint', 'outcome'],
        description: 'What area this question explores',
      },
    },
    required: ['question', 'area'],
  },
};

export const ALL_CHAT_TOOLS = [
  // Mutations
  ADD_STEP_TOOL,
  UPDATE_STEP_TOOL,
  REMOVE_STEP_TOOL,
  SET_HANDOFF_TOOL,
  ADD_CUSTOM_DEPARTMENT_TOOL,
  REPLACE_ALL_STEPS_TOOL,
  // Reads
  GET_BOTTLENECKS_TOOL,
  GET_CRITICAL_PATH_TOOL,
  GET_STEP_METRICS_TOOL,
  GET_COST_SUMMARY_TOOL,
  GET_RECOMMENDATIONS_TOOL,
  LIST_REPORTS_TOOL,
  LOAD_REPORT_SUMMARY_TOOL,
  // Cost proposals
  SET_LABOUR_RATE_TOOL,
  SET_NON_LABOUR_COST_TOOL,
  SET_INVESTMENT_TOOL,
  // Navigation
  HIGHLIGHT_STEP_TOOL,
  OPEN_PANEL_TOOL,
  // Terminal
  GENERATE_REPORT_TOOL,
  GENERATE_COST_TOOL,
  // Undo
  UNDO_LAST_ACTION_TOOL,
  // Discovery / proposal
  PROPOSE_CHANGE_TOOL,
  ASK_DISCOVERY_TOOL,
];
