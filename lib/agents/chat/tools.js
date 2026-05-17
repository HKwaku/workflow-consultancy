/* Anthropic SDK tool definitions for the diagnostic chat agent. */

import { skillIds, skillCatalogue } from '../artefacts/skills.js';

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
      functionId: {
        type: 'string',
        description: 'Optional function (capability) id this step belongs to. Use when a process spans functions — e.g. order-to-cash steps that handle invoicing should be tagged with the Finance/AR function id, picking + packing with Operations/Fulfilment, etc. Pull ids from the workspace_tree block in the system prompt. Leave unset for steps that just inherit the process owner.',
      },
      roleId: {
        type: 'string',
        description: 'Optional team (model_role) id that performs this step. Prefer this over functionId + department when the team is known — the client snapshots the role\'s first function onto the step automatically, keeping function attribution coherent with team ownership.',
      },
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

/* ── Connector / edge mutations ───────────────────────────────────── */

export const ADD_CONNECTOR_TOOL = {
  name: 'add_connector',
  description:
    'Add a manual connector (edge) between two existing steps. Use for out-of-sequence wiring: rework loops, jumps, or cross-branch links. For decision outputs, prefer update_step.branches instead.',
  input_schema: {
    type: 'object',
    properties: {
      fromStep: { type: 'number', description: '1-based step number the connector leaves from' },
      toStep: { type: 'number', description: '1-based step number the connector arrives at' },
    },
    required: ['fromStep', 'toStep'],
  },
};

export const REMOVE_CONNECTOR_TOOL = {
  name: 'remove_connector',
  description:
    'Remove a connector between two steps. Works for both manual connectors and the default sequence arrow between consecutive steps.',
  input_schema: {
    type: 'object',
    properties: {
      fromStep: { type: 'number', description: '1-based step number the connector leaves from' },
      toStep: { type: 'number', description: '1-based step number the connector arrives at' },
    },
    required: ['fromStep', 'toStep'],
  },
};

export const REDIRECT_CONNECTOR_TOOL = {
  name: 'redirect_connector',
  description:
    'Rewire an existing connector to a new source and/or target. Equivalent to dragging a connector endpoint to a different step.',
  input_schema: {
    type: 'object',
    properties: {
      fromStep: { type: 'number', description: '1-based source step of the existing connector' },
      toStep: { type: 'number', description: '1-based target step of the existing connector' },
      newFromStep: { type: 'number', description: 'New source step (1-based). Omit to keep current.' },
      newToStep: { type: 'number', description: 'New target step (1-based). Omit to keep current.' },
    },
    required: ['fromStep', 'toStep'],
  },
};

export const INSERT_STEP_BETWEEN_TOOL = {
  name: 'insert_step_between',
  description:
    'Insert a new step in the middle of an existing connector. The connector is removed and the new step replaces it between the two endpoints.',
  input_schema: {
    type: 'object',
    properties: {
      fromStep: { type: 'number', description: '1-based source step of the connector to split' },
      toStep: { type: 'number', description: '1-based target step of the connector to split' },
      ...STEP_PROPERTIES,
      name: { type: 'string', description: 'Step name for the new step (concise, 3-8 words)' },
    },
    required: ['fromStep', 'toStep', 'name'],
  },
};

/* ── Branch-level mutations (decision nodes) ──────────────────────── */

const BRANCH_LOCATOR = {
  stepNumber: { type: 'number', description: '1-based step number of the decision step that owns the branch' },
  branchIndex: { type: 'number', description: '1-based branch position on the decision step (1 = first branch). Use when the agent knows the order. Either branchIndex or branchLabel is required.' },
  branchLabel: { type: 'string', description: 'Existing branch label (case-insensitive match). Use when the agent knows the label but not the position.' },
};

export const SET_BRANCH_TARGET_TOOL = {
  name: 'set_branch_target',
  description:
    'Change one branch\'s target on a decision step without re-listing the whole branches array. Use when the user says "the Approved branch should go to step 7" or similar.',
  input_schema: {
    type: 'object',
    properties: {
      ...BRANCH_LOCATOR,
      newTargetStep: { type: 'number', description: '1-based step number the branch should now point to' },
    },
    required: ['stepNumber', 'newTargetStep'],
  },
};

export const SET_BRANCH_PROBABILITY_TOOL = {
  name: 'set_branch_probability',
  description:
    'Set the probability % on one branch of an exclusive decision. Used to weight wait-time predictions. Value is 0-100. Pass null/omit to clear.',
  input_schema: {
    type: 'object',
    properties: {
      ...BRANCH_LOCATOR,
      probability: { type: 'number', description: 'Percentage 0-100. Omit to clear the probability.' },
    },
    required: ['stepNumber'],
  },
};

export const SET_BRANCH_LABEL_TOOL = {
  name: 'set_branch_label',
  description:
    'Rename a branch on a decision step (e.g. change "Yes" to "Approved").',
  input_schema: {
    type: 'object',
    properties: {
      ...BRANCH_LOCATOR,
      newLabel: { type: 'string', description: 'New branch label' },
    },
    required: ['stepNumber', 'newLabel'],
  },
};

export const REMOVE_BRANCH_TOOL = {
  name: 'remove_branch',
  description:
    'Remove one branch from a decision step. The remaining branches keep their order.',
  input_schema: {
    type: 'object',
    properties: BRANCH_LOCATOR,
    required: ['stepNumber'],
  },
};

export const ADD_BRANCH_TOOL = {
  name: 'add_branch',
  description:
    'Add a new branch to a decision step. Use when the user asks to add another path to an existing decision (e.g. add a "Cancelled" branch). For decisions that don\'t exist yet, use update_step or add_step instead.',
  input_schema: {
    type: 'object',
    properties: {
      stepNumber: { type: 'number', description: '1-based step number of the decision step' },
      label: { type: 'string', description: 'Branch label (e.g. "Approved", "Rejected"). Optional.' },
      target: { type: 'string', description: 'Target step reference, e.g. "Step 7". Optional - leave blank if unknown.' },
      probability: { type: 'number', description: 'Optional probability 0-100 for exclusive decisions.' },
    },
    required: ['stepNumber'],
  },
};

/* ── Step ordering / metadata / inputs ────────────────────────────── */

export const REORDER_STEP_TOOL = {
  name: 'reorder_step',
  description:
    'Move an existing step to a different position in the sequence. Equivalent to dragging it up/down in the list.',
  input_schema: {
    type: 'object',
    properties: {
      stepNumber: { type: 'number', description: '1-based step number to move' },
      position: { type: 'number', description: '1-based target position (1 = first, equal to step count = last)' },
    },
    required: ['stepNumber', 'position'],
  },
};

export const SET_PROCESS_NAME_TOOL = {
  name: 'set_process_name',
  description:
    'Rename the overall process. Updates the process title shown across the workspace.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'New process name (concise, 2-6 words)' },
    },
    required: ['name'],
  },
};

export const SET_PROCESS_DEFINITION_TOOL = {
  name: 'set_process_definition',
  description:
    'Set process boundary metadata: start trigger, completion criteria, and complexity. Mirrors the Screen 1 "Define this process" inputs. Only include fields you want to change.',
  input_schema: {
    type: 'object',
    properties: {
      startsWhen: { type: 'string', description: 'What triggers this process to start' },
      completesWhen: { type: 'string', description: 'What signals the process is complete' },
      complexity: { type: 'string', description: 'Complexity rating (e.g. "simple", "moderate", "complex")' },
    },
  },
};

export const SET_STEP_DETAILS_TOOL = {
  name: 'set_step_details',
  description:
    'Set advanced step fields not covered by update_step: wait reason, wait note, capacity, and free-form description. Only include fields you want to change.',
  input_schema: {
    type: 'object',
    properties: {
      stepNumber: { type: 'number', description: '1-based step number' },
      waitType: {
        type: 'string',
        enum: ['dependency', 'blocked', 'capacity', 'wip'],
        description: 'Why the step waits: dependency (waiting on someone), blocked (missing info), capacity (person unavailable), wip (in queue). Pass null/omit to clear.',
      },
      waitNote: { type: 'string', description: 'Free-text note explaining the wait reason' },
      capacity: { type: 'number', description: 'How many of these can run at once' },
      description: { type: 'string', description: 'Free-form description of what happens at this step' },
    },
    required: ['stepNumber'],
  },
};

export const SET_COST_INPUT_TOOL = {
  name: 'set_cost_input',
  description:
    'Set the cost-basis inputs from Screen 4: how often the process runs, team size, and hours per instance. Only include fields you want to change.',
  input_schema: {
    type: 'object',
    properties: {
      frequency: {
        type: 'string',
        enum: ['daily', 'few-per-week', 'weekly', 'twice-monthly', 'monthly', 'quarterly', 'twice-yearly', 'yearly'],
        description: 'How often the process runs',
      },
      teamSize: { type: 'number', description: 'Number of people involved per instance' },
      hoursPerInstance: { type: 'number', description: 'Hours of effort per single run of the process' },
    },
  },
};

export const SET_BOTTLENECK_TOOL = {
  name: 'set_bottleneck',
  description:
    'Set the Screen 4 bottleneck inputs: the dominant cause and a free-text "why". Mirrors the user\'s pick on the cost screen.',
  input_schema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        enum: ['waiting', 'approvals', 'manual-work', 'handoffs', 'systems', 'unclear', 'rework', 'other'],
        description: 'Dominant bottleneck reason',
      },
      why: { type: 'string', description: 'Free-text detail explaining the bottleneck' },
    },
  },
};

export const SET_FREQUENCY_DETAILS_TOOL = {
  name: 'set_frequency_details',
  description:
    'Set additional frequency fields beyond the type/annual rate: in-flight (currently running) instance count.',
  input_schema: {
    type: 'object',
    properties: {
      inFlight: { type: 'number', description: 'Number of instances currently in progress' },
    },
  },
};

export const SET_PE_CONTEXT_TOOL = {
  name: 'set_pe_context',
  description:
    'Set PE-module-specific portfolio context fields: SOP documentation status, key-person dependency, investor/board reporting impact. Only meaningful when the diagnostic is in PE mode.',
  input_schema: {
    type: 'object',
    properties: {
      peSopStatus: {
        type: 'string',
        enum: ['documented', 'partial', 'undocumented'],
        description: 'SOP documentation status',
      },
      peKeyPerson: {
        type: 'string',
        enum: ['yes', 'partial', 'no'],
        description: 'Key-person dependency level',
      },
      peReportingImpact: {
        type: 'string',
        enum: ['yes-direct', 'yes-indirect', 'no'],
        description: 'Whether the process feeds investor/board reporting',
      },
    },
  },
};

export const ADD_STEP_SYSTEM_TOOL = {
  name: 'add_step_system',
  description:
    'Add a single system/tool to a step\'s systems list (case-insensitive dedup). Use when the user names one tool to add - prefer this over update_step for incremental adds.',
  input_schema: {
    type: 'object',
    properties: {
      stepNumber: { type: 'number', description: '1-based step number' },
      system: { type: 'string', description: 'System or tool name (e.g. "Salesforce", "Excel")' },
    },
    required: ['stepNumber', 'system'],
  },
};

export const REMOVE_STEP_SYSTEM_TOOL = {
  name: 'remove_step_system',
  description:
    'Remove a single system/tool from a step\'s systems list (case-insensitive match).',
  input_schema: {
    type: 'object',
    properties: {
      stepNumber: { type: 'number', description: '1-based step number' },
      system: { type: 'string', description: 'System or tool name to remove' },
    },
    required: ['stepNumber', 'system'],
  },
};

export const ADD_CHECKLIST_ITEM_TOOL = {
  name: 'add_checklist_item',
  description:
    'Add one checklist item to a step. Use for incremental adds when the user names a single thing - prefer this over update_step.checklist for one-at-a-time edits.',
  input_schema: {
    type: 'object',
    properties: {
      stepNumber: { type: 'number', description: '1-based step number' },
      text: { type: 'string', description: 'Checklist item text' },
    },
    required: ['stepNumber', 'text'],
  },
};

export const TOGGLE_CHECKLIST_ITEM_TOOL = {
  name: 'toggle_checklist_item',
  description:
    'Mark a checklist item checked/unchecked on a step. Identify the item by 1-based itemIndex OR by text (case-insensitive match).',
  input_schema: {
    type: 'object',
    properties: {
      stepNumber: { type: 'number', description: '1-based step number' },
      itemIndex: { type: 'number', description: '1-based item position. Either itemIndex or text is required.' },
      text: { type: 'string', description: 'Existing item text (case-insensitive match)' },
      checked: { type: 'boolean', description: 'Target state. Omit to flip current state.' },
    },
    required: ['stepNumber'],
  },
};

export const REMOVE_CHECKLIST_ITEM_TOOL = {
  name: 'remove_checklist_item',
  description:
    'Remove one checklist item from a step. Identify by 1-based itemIndex OR by text (case-insensitive match).',
  input_schema: {
    type: 'object',
    properties: {
      stepNumber: { type: 'number', description: '1-based step number' },
      itemIndex: { type: 'number', description: '1-based item position. Either itemIndex or text is required.' },
      text: { type: 'string', description: 'Existing item text (case-insensitive match)' },
    },
    required: ['stepNumber'],
  },
};

export const REMOVE_CUSTOM_DEPARTMENT_TOOL = {
  name: 'remove_custom_department',
  description:
    'Remove a custom department from the picklist. Only affects custom (user-added) departments, not built-ins. Steps that still reference the name will keep their string value.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Department name to remove' },
    },
    required: ['name'],
  },
};

// Living-workspace migration: TRIGGER_REDESIGN_TOOL and
// PIN_FLOW_SNAPSHOT_TOOL removed. AI improvements now land as inline
// change proposals on the live process (propose_change tool); the
// canvas IS the artefact, so pinned snapshots are obsolete.

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
    'Get the live cost summary for the current process: labour rates, annual cost, estimated savings, payback, ROI. Computed on-demand from step timings + rates; always available. Call when the user asks about cost, savings, payback, or ROI.',
  input_schema: { type: 'object', properties: {} },
};

export const GET_RECOMMENDATIONS_TOOL = {
  name: 'get_recommendations',
  description:
    'Get live AI recommendations for this process (top automation / redesign opportunities). Computed on-demand from the current flow; always available. Call when the user asks about opportunities, next steps, quick wins, or what to automate.',
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
    'Fetch a concise summary of a single process by id: name, step count, live annual cost, live savings, live automation %, payback. All numbers computed on-demand. Use ids returned by list_model_processes / list_deal_participants / etc.',
  input_schema: {
    type: 'object',
    properties: {
      reportId: { type: 'string', description: 'Process id (internal identifier)' },
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

// Living-workspace migration: GENERATE_REPORT_TOOL and GENERATE_COST_TOOL
// removed. There is no terminal "generate report" step — the canvas is
// always live. Cost / savings / automation derive on read from
// flow_data.rawProcesses[].steps[] via lib/processMetrics.js, surfaced
// in the dashboard and rollup endpoints anytime the user asks.

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

/**
 * Hybrid (semantic + keyword) search across the data-room documents uploaded
 * to a deal. Only available when the chat session is bound to a deal_id —
 * the executor will refuse the call otherwise. Returns top-N chunks with
 * citations (filename + page/slide/sheet/range) so the model can cite them
 * in finding.evidence[].
 */
export const SEARCH_DEAL_DOCUMENTS_TOOL = {
  name: 'search_deal_documents',
  description:
    'Search the deal data room (CIMs, financials, contracts, decks) for passages relevant to a question. Returns up to 12 chunks with filename and page/slide/sheet locators. Use BEFORE writing findings about deal-level topics so you can cite chunk_ids in evidence[].',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural-language search query (max 500 chars).' },
      party: {
        type: 'string',
        enum: ['acquirer', 'target', 'seller', 'self', 'portfolio'],
        description: 'Optional: restrict to documents tagged with this source party.',
      },
      limit: { type: 'number', description: 'How many chunks to return (1-30, default 12).' },
    },
    required: ['query'],
  },
};

/**
 * The next four tools answer "dashboard-y" questions about a deal without
 * reading from the data room. Use them when the user asks "who is on this
 * deal?", "what's in the data room?", "what findings have we got?", "what's
 * the status?". They short-circuit a search_deal_documents round-trip when
 * the answer is in the deal's metadata.
 */

export const GET_DEAL_SUMMARY_TOOL = {
  name: 'get_deal_summary',
  description:
    'Get a one-shot snapshot of the current deal: type (PE/M&A/Scaling), status, name, participant count, document count, latest analysis status. Call when the user asks "what is this deal?", "summarise this deal", or wants a quick orientation. Only works on deal-bound chats.',
  input_schema: { type: 'object', properties: {} },
};

export const LIST_DEAL_PARTICIPANTS_TOOL = {
  name: 'list_deal_participants',
  description:
    'List participants on the current deal (company, role, status, completion). Call when the user asks "who is on this deal?", "which companies are participating?", "is everyone done?". Only works on deal-bound chats.',
  input_schema: { type: 'object', properties: {} },
};

export const LIST_DEAL_DOCUMENTS_TOOL = {
  name: 'list_deal_documents',
  description:
    'List documents in the data room with filename, source party, status (pending/parsing/embedding/ready/stored/failed), AI-suggested category (Financial, Legal, HR, IP, Tech, Commercial, Operational, Other), label, page count, byte size. `stored` means the file is in the data room and downloadable but not text-indexed (image, audio, video, archive, or scanned PDF without OCR). Call when the user asks "what is in the data room?", "what documents do we have?", "is anything still processing?". Only works on deal-bound chats.',
  input_schema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Max documents to return (1-200, default 50).' },
      party: {
        type: 'string',
        enum: ['acquirer', 'target', 'seller', 'self', 'portfolio'],
        description: 'Optional: filter by source party tag.',
      },
    },
  },
};

/**
 * The next group of tools all follow the SAME propose-then-confirm pattern:
 * the executor stages a proposal via the deal_proposal SSE event; the client
 * renders an Apply button; the user clicks to commit. The chat agent itself
 * never mutates deal state — every change requires a click.
 *
 * Mirrors the cost-proposal pattern (set_labour_rate, set_non_labour_cost,
 * set_investment) so the UX is consistent.
 */

// Living-workspace migration: PROPOSE_FINDING_REVIEW_TOOL,
// PROPOSE_GENERATE_REPORT_TOOL, PROPOSE_RUN_ANALYSIS_TOOL, and
// PROPOSE_EXPORT_PPTX_TOOL removed. deal_analyses + per-analysis
// review snapshots and PPTX exports are gone. The deal IS the
// deliverable; findings are visible inline but reviewing them
// happens on the deal page UI, not via chat proposals.

export const PROPOSE_LINK_PARTICIPANT_REPORT_TOOL = {
  name: 'propose_link_participant_report',
  description:
    'Stage linking an existing process to a participant slot on the current deal. Use when the user says "use the existing flow for Acme" or "link this process to the target slot". Call list_deal_participants for participant ids. Editor-only at apply.',
  input_schema: {
    type: 'object',
    properties: {
      participantId: { type: 'string', description: 'Participant UUID from list_deal_participants.' },
      reportId: { type: 'string', description: 'Process id (internal identifier).' },
    },
    required: ['participantId', 'reportId'],
  },
};

export const PROPOSE_UNDO_LAST_ACTION_TOOL = {
  name: 'propose_undo_last_action',
  description:
    'Stage an undo for a recent reversible deal action. Supported kinds: "link_participant_report" (unlinks a report from a participant slot). Other actions (invites, uploads, reprocess) are NOT undoable from chat - they have side effects (sent emails, queued workers) that need a deliberate process. Use when the user says "undo that" / "revert" / "I changed my mind" about an action they recently took.',
  input_schema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['link_participant_report'], description: 'Which kind of action to undo.' },
      participantId: { type: 'string', description: 'Required when kind=link_participant_report.' },
    },
    required: ['kind'],
  },
};

export const PROPOSE_UPLOAD_DOCUMENT_TOOL = {
  name: 'propose_upload_document',
  description:
    'Stage a request to upload one or more documents to the deal data room. Use when the user implies a doc is missing ("we need the audited financials", "do we have the customer contracts?") or asks to add documents. The Apply button takes the user to the data-room upload UI — actual file selection happens in the browser. Editor-only.',
  input_schema: {
    type: 'object',
    properties: {
      docTypes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Short list of document types you want the user to upload (e.g. ["audited financials FY22-FY24", "customer contracts", "MSAs"]). Keep each entry under 80 chars.',
      },
      reason: { type: 'string', description: 'Optional one-liner shown alongside the request explaining why these are needed.' },
    },
    required: ['docTypes'],
  },
};

export const PROPOSE_REPROCESS_DOCUMENT_TOOL = {
  name: 'propose_reprocess_document',
  description:
    'Stage a re-run of the parsing + embedding pipeline for a specific deal document. Use when list_deal_documents shows a doc in failed/pending status, or when the user explicitly asks to retry a document. The doc keeps its bytes — only its status flips back to pending and the worker is re-emitted. Editor-only at apply.',
  input_schema: {
    type: 'object',
    properties: {
      documentId: { type: 'string', description: 'Document UUID from list_deal_documents.' },
      wipe: { type: 'boolean', description: 'If true, delete existing chunks before re-running. Use after a chunker upgrade or for a clean re-extraction. Default false.' },
      reason: { type: 'string', description: 'Optional one-liner shown to the user explaining why you suggested the reprocess.' },
    },
    required: ['documentId'],
  },
};

export const PROPOSE_INVITE_PARTICIPANT_TOOL = {
  name: 'propose_invite_participant',
  description:
    'Stage adding a participant to the current deal. Use when the user asks to invite someone to fill a participant slot (e.g. "invite acme.io as a portfolio company", "add John from BigCo as the target"). The Apply button creates the participant; if email is provided and the user opts in, an invite email is sent via the existing pipeline. Editor-only at apply time.',
  input_schema: {
    type: 'object',
    properties: {
      companyName: { type: 'string', description: 'Company / business unit name (max 200 chars).' },
      role: {
        type: 'string',
        enum: ['platform_company', 'portfolio_company', 'acquirer', 'target', 'self'],
        description: 'Participant role. PE roll-ups use platform/portfolio; M&A uses acquirer/target; scaling uses self.',
      },
      email: { type: 'string', description: 'Optional contact email.' },
      name: { type: 'string', description: 'Optional contact person name.' },
      sendInviteEmail: { type: 'boolean', description: 'If true and email is set, send the invite email immediately on Apply. Default false (just create the slot + invite link).' },
    },
    required: ['companyName', 'role'],
  },
};

export const LIST_DEAL_FINDINGS_TOOL = {
  name: 'list_deal_findings',
  description:
    'List findings from the most recent diligence analysis on this deal. Returns each finding with title, area, severity, status (and reviewer status if a review row exists), and evidence count. Call when the user asks "what have we found?", "show me the open findings", "what red flags?". Only works on deal-bound chats with at least one analysis run.',
  input_schema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Max findings to return (1-100, default 30).' },
      area: { type: 'string', description: 'Optional: filter by area string (e.g. "tech", "operations", "red flags").' },
    },
  },
};

export const LIST_DEAL_CHANGES_TOOL = {
  name: 'list_deal_changes',
  description:
    'List recorded changes on this deal — proposals from the chat, redesign edits, finding reviews, and their lifecycle (proposed → applied → live → measured → reverted). Returns each change with subject, kind, state, rationale, who proposed it, and any measured outcomes. Call when the user asks "what changes have we made?", "what did we propose last week?", "what landed?", "did anything actually move?". Each card the client renders deep-links into the workspace timeline (?focusChange=…).',
  input_schema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Max changes to return (1-100, default 30).' },
      state: {
        type: 'string',
        description: 'Optional state filter: "open" (proposed+accepted), "applied", "live", "measured", "reverted", "rejected", or "all" (default).',
      },
    },
  },
};

/* ── Workspace setup tools ─────────────────────────────────────────
   These let the user set up their operating-model workspace via chat
   ("add a Finance function with AR under it", "add Sarah as AR manager
   with 2 FTE", "we use Stripe for payments"). The agent stages a proposal
   that the user confirms inline; only on confirm does the row land. The
   user must be inside a workspace context (operatingModelId on ctx) and
   an admin of that org for the apply to succeed.

   Defined here (above ALL_CHAT_TOOLS) so the array literal below can
   reference them at module-load time without TDZ errors.
   ─────────────────────────────────────────────────────────────────── */

export const PROPOSE_ADD_FUNCTION_TOOL = {
  name: 'propose_add_function',
  description:
    'Stage adding a function (capability) to the user\'s operating-model workspace. Functions are the hierarchical taxonomy people file processes under (Finance / AR / Cash collection). Use when the user says "add a Finance function" or "add AR under Finance". Does NOT mutate — the client surfaces a Confirm button. Requires the user to be in a workspace context.',
  input_schema: {
    type: 'object',
    properties: {
      name:               { type: 'string', description: 'Function name (e.g. "Finance", "Accounts Receivable").' },
      parent_function_id: { type: 'string', description: 'Optional parent function id when nesting (e.g. "AR" under "Finance"). Omit for top-level functions.' },
      description:        { type: 'string', description: 'Optional one-liner describing what the function does.' },
    },
    required: ['name'],
  },
};

export const PROPOSE_ADD_ROLE_TOOL = {
  name: 'propose_add_role',
  description:
    'Stage adding a role to the workspace inventory. Roles carry headcount (FTE) and an optional owner email; the rollup uses these for cost/FTE totals. Example: "add Sarah Hoyle as AR Manager, 2 FTE". Does NOT mutate — the client surfaces a Confirm button.',
  input_schema: {
    type: 'object',
    properties: {
      name:        { type: 'string', description: 'Role name (e.g. "AR Manager", "Tier-2 Support").' },
      headcount:   { type: 'number', description: 'FTE count (whole or fractional). Defaults to 1 when omitted.' },
      owner_email: { type: 'string', description: 'Optional email of the person currently in the role.' },
      function_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional function ids (capability ids) the role spans. Headcount gets distributed equally across them in the rollup.',
      },
      description: { type: 'string', description: 'Optional one-liner.' },
    },
    required: ['name'],
  },
};

export const PROPOSE_ADD_SYSTEM_TOOL = {
  name: 'propose_add_system',
  description:
    'Stage adding a system to the workspace inventory. Systems are the tools/platforms processes touch (Stripe, Salesforce, NetSuite). Example: "we use Stripe for payments" → propose_add_system({ name: "Stripe", category: "payments" }). Does NOT mutate — client surfaces a Confirm button.',
  input_schema: {
    type: 'object',
    properties: {
      name:        { type: 'string', description: 'System name (vendor + product, e.g. "Salesforce", "NetSuite").' },
      vendor:      { type: 'string', description: 'Optional vendor when distinct from the product name.' },
      category:    { type: 'string', description: 'Optional category (e.g. "CRM", "ERP", "payments").' },
      layer:       { type: 'string', enum: ['system_of_record', 'system_of_engagement', 'system_of_intelligence', 'integration', 'other'], description: 'Optional architectural layer.' },
      owner_email: { type: 'string', description: 'Optional system owner email.' },
      description: { type: 'string', description: 'Optional one-liner.' },
    },
    required: ['name'],
  },
};

export const PROPOSE_WORKSPACE_BULK_SETUP_TOOL = {
  name: 'propose_workspace_bulk_setup',
  description:
    'Stage MANY workspace items at once. Use when the user pastes an org chart, a function/role/system list, or asks to "set up the workspace". Interpret the pasted text and emit a single structured plan (functions + roles + systems together). The user reviews per-row in a single confirmation card and applies in one click. Does NOT mutate. Prefer this over many propose_add_* calls when the user is doing bulk setup.',
  input_schema: {
    type: 'object',
    properties: {
      functions: {
        type: 'array',
        description: 'Functions to create. Order matters for nesting: list parents before children, and use parent_path to point at a parent already in this same list (or an existing function in the workspace).',
        items: {
          type: 'object',
          properties: {
            name:        { type: 'string', description: 'Function name (e.g. "Finance", "Accounts Receivable").' },
            parent_path: { type: 'string', description: 'Optional. The parent function name (e.g. "Finance") or slash-separated path ("Finance / AR"). Resolved against new + existing functions.' },
            description: { type: 'string', description: 'Optional one-liner.' },
          },
          required: ['name'],
        },
      },
      roles: {
        type: 'array',
        description: 'Roles to create. Reference functions by name (function_names) — they\'ll be resolved against existing + newly-planned functions at apply time.',
        items: {
          type: 'object',
          properties: {
            name:           { type: 'string' },
            headcount:      { type: 'number' },
            owner_email:    { type: 'string' },
            function_names: { type: 'array', items: { type: 'string' }, description: 'Function name(s) this role spans, by display name.' },
            description:    { type: 'string' },
          },
          required: ['name'],
        },
      },
      systems: {
        type: 'array',
        description: 'Systems to create. No dependencies — these can land in any order.',
        items: {
          type: 'object',
          properties: {
            name:        { type: 'string' },
            vendor:      { type: 'string' },
            category:    { type: 'string' },
            layer:       { type: 'string', enum: ['system_of_record', 'system_of_engagement', 'system_of_intelligence', 'integration', 'other'] },
            owner_email: { type: 'string' },
            description: { type: 'string' },
          },
          required: ['name'],
        },
      },
      notes: { type: 'string', description: 'Brief plain-English summary of what you interpreted from the pasted text. Shown to the user above the per-row checklist.' },
    },
  },
};

/* ── Process lifecycle (Tier 1) ────────────────────────────────────
   The agent can edit an open process exhaustively but, before this,
   could not create, copy, file, or remove one. These stage a Confirm
   card like the propose_add_* tools; the user applies. ids come from
   list_model_processes / the workspace_tree. Workspace context required.
   ─────────────────────────────────────────────────────────────────── */

export const CREATE_PROCESS_TOOL = {
  name: 'create_process',
  description:
    'Stage creating a NEW empty process in the active operating model. Use when the user wants to map a process that does not exist yet ("map a returns process under Logistics"). After the user confirms, open it with open_process({intent:"edit"}) and build it with the step tools. Does NOT mutate — the client surfaces a Confirm button. Requires a workspace context.',
  input_schema: {
    type: 'object',
    properties: {
      name:        { type: 'string', description: 'Name for the new process (e.g. "Customer returns").' },
      function_id: { type: 'string', description: 'Optional function (capability) id from the workspace_tree to file it under immediately.' },
    },
    required: ['name'],
  },
};

export const DUPLICATE_PROCESS_TOOL = {
  name: 'duplicate_process',
  description:
    'Stage duplicating an existing process in this model (deep copy of its flow). Use for "make a copy of the AP process so I can draft a to-be version". Does NOT mutate — the client surfaces a Confirm button.',
  input_schema: {
    type: 'object',
    properties: {
      source_process_id: { type: 'string', description: 'The id of the process to copy (from list_model_processes).' },
      name:              { type: 'string', description: 'Name for the copy. Defaults to "<original> (copy)".' },
    },
    required: ['source_process_id'],
  },
};

export const FILE_PROCESS_TOOL = {
  name: 'file_process',
  description:
    'Stage filing a process under a function (capability), or unfiling it (pass function_id=null). Use for "file the AP process under Finance". Does NOT mutate — the client surfaces a Confirm button.',
  input_schema: {
    type: 'object',
    properties: {
      process_id:  { type: 'string', description: 'The process id (from list_model_processes).' },
      function_id: { type: ['string', 'null'], description: 'Target function id from the workspace_tree, or null to unfile.' },
    },
    required: ['process_id', 'function_id'],
  },
};

export const DELETE_PROCESS_TOOL = {
  name: 'delete_process',
  description:
    'Stage permanently deleting a process from this model. Destructive — only when the user is explicit ("delete the duplicate AP process"). Does NOT mutate — the client surfaces a Confirm button the user must click.',
  input_schema: {
    type: 'object',
    properties: {
      process_id:   { type: 'string', description: 'The process id to delete (from list_model_processes).' },
      process_name: { type: 'string', description: 'Process name — for the confirmation card only.' },
    },
    required: ['process_id'],
  },
};

/* ── Operating-model edit / delete (Tier 2) ────────────────────────
   propose_add_* only created. These complete the CRUD: rename / move /
   retire functions, roles, systems. Same staged-Confirm governance.
   Target ids come from the workspace_tree in the system prompt.
   ─────────────────────────────────────────────────────────────────── */

export const PROPOSE_UPDATE_FUNCTION_TOOL = {
  name: 'propose_update_function',
  description:
    'Stage editing an existing function (rename, change description, layer, status, or owner). Use for "rename the AR function to Receivables". Does NOT mutate — the client surfaces a Confirm button.',
  input_schema: {
    type: 'object',
    properties: {
      function_id: { type: 'string', description: 'The function id to edit (from the workspace_tree).' },
      name:        { type: 'string', description: 'New name.' },
      description: { type: 'string', description: 'New one-liner.' },
      layer:       { type: 'string', enum: ['value_chain', 'enabling', 'governance'], description: 'New layer.' },
      status:      { type: 'string', enum: ['live', 'planned', 'retired'], description: 'New status.' },
      owner_email: { type: 'string', description: 'New owner email.' },
    },
    required: ['function_id'],
  },
};

export const PROPOSE_MOVE_FUNCTION_TOOL = {
  name: 'propose_move_function',
  description:
    'Stage moving a function under a different parent (re-nesting the capability tree), or to top-level (parent_function_id=null). Use for "move Cash collection under Treasury". Does NOT mutate — the client surfaces a Confirm button.',
  input_schema: {
    type: 'object',
    properties: {
      function_id:        { type: 'string', description: 'The function id to move (from the workspace_tree).' },
      parent_function_id: { type: ['string', 'null'], description: 'New parent function id, or null for top-level. Cannot be the function itself.' },
    },
    required: ['function_id', 'parent_function_id'],
  },
};

export const PROPOSE_DELETE_FUNCTION_TOOL = {
  name: 'propose_delete_function',
  description:
    'Stage deleting a function. Sub-functions reparent to top-level (not cascaded); processes filed under it become unfiled. Destructive — be explicit. Does NOT mutate — the client surfaces a Confirm button.',
  input_schema: {
    type: 'object',
    properties: {
      function_id:   { type: 'string', description: 'The function id to delete (from the workspace_tree).' },
      function_name: { type: 'string', description: 'Function name — for the confirmation card only.' },
    },
    required: ['function_id'],
  },
};

export const PROPOSE_UPDATE_ROLE_TOOL = {
  name: 'propose_update_role',
  description:
    'Stage editing a role (rename, change headcount/FTE, owner, function scope, description). Use for "bump AR Manager to 3 FTE". Does NOT mutate — the client surfaces a Confirm button.',
  input_schema: {
    type: 'object',
    properties: {
      role_id:      { type: 'string', description: 'The role id to edit (from the workspace_tree).' },
      name:         { type: 'string', description: 'New role name.' },
      headcount:    { type: 'number', description: 'New FTE count (>= 0).' },
      owner_email:  { type: 'string', description: 'New owner email.' },
      function_ids: { type: 'array', items: { type: 'string' }, description: 'Replace the function ids this role spans.' },
      description:  { type: 'string', description: 'New one-liner.' },
    },
    required: ['role_id'],
  },
};

export const PROPOSE_DELETE_ROLE_TOOL = {
  name: 'propose_delete_role',
  description:
    'Stage deleting a role from the inventory. Destructive — be explicit. Does NOT mutate — the client surfaces a Confirm button.',
  input_schema: {
    type: 'object',
    properties: {
      role_id:   { type: 'string', description: 'The role id to delete (from the workspace_tree).' },
      role_name: { type: 'string', description: 'Role name — for the confirmation card only.' },
    },
    required: ['role_id'],
  },
};

export const PROPOSE_UPDATE_SYSTEM_TOOL = {
  name: 'propose_update_system',
  description:
    'Stage editing a system in the inventory (rename, vendor, category, architectural layer, owner, description). Use for "set NetSuite\'s layer to system_of_record". Does NOT mutate — the client surfaces a Confirm button.',
  input_schema: {
    type: 'object',
    properties: {
      system_id:   { type: 'string', description: 'The system id to edit (from the workspace_tree).' },
      name:        { type: 'string', description: 'New system name.' },
      vendor:      { type: 'string', description: 'New vendor.' },
      category:    { type: 'string', description: 'New category.' },
      layer:       { type: 'string', enum: ['system_of_record', 'system_of_engagement', 'system_of_intelligence', 'integration', 'other'], description: 'New architectural layer.' },
      owner_email: { type: 'string', description: 'New owner email.' },
      description: { type: 'string', description: 'New one-liner.' },
    },
    required: ['system_id'],
  },
};

export const PROPOSE_DELETE_SYSTEM_TOOL = {
  name: 'propose_delete_system',
  description:
    'Stage deleting a system from the inventory. Steps referencing it keep their text mention but lose the link. Destructive — be explicit. Does NOT mutate — the client surfaces a Confirm button.',
  input_schema: {
    type: 'object',
    properties: {
      system_id:   { type: 'string', description: 'The system id to delete (from the workspace_tree).' },
      system_name: { type: 'string', description: 'System name — for the confirmation card only.' },
    },
    required: ['system_id'],
  },
};

/* ── Artefact emission ─────────────────────────────────────────────
   The escape hatch for output that has NO home in the app schema.
   Everything else the agent produces lands somewhere typed: a step, a
   function, a role, a system, a finding, a proposal. When the user
   asks for something that isn't any of those — a comparison table, a
   draft policy, an exec summary, a SQL query, a JSON dataset, a
   mermaid diagram — emit it as an artefact. It is persisted and shown
   in the workspace "Outputs" panel (like the artefacts side panel in
   a Claude chat). Requires a workspace context (operatingModelId).
   ─────────────────────────────────────────────────────────────────── */

export const EMIT_ARTEFACT_TOOL = {
  name: 'emit_artefact',
  description:
    'Commission a standalone deliverable for the workspace Outputs panel. Use ONLY for content that does not fit any existing structure (it is NOT a process step, function, role, system, finding, cost input, or proposal): a draft document/policy, an exec one-pager, a comparison table, a risk register, a dataset, a SQL query, a project plan / Gantt, a diagram. ' +
    'You do NOT write the artefact body yourself — pick the closest `skill` and hand over a precise `spec` plus the grounding facts in `context`; a specialist sub-agent generates and validates it. ' +
    'Only use skill="raw" (and pass `content`) for something trivial you can write in one line. Do not use this to restate a short chat answer — only when the user wants a concrete deliverable they can keep. ' +
    'IMPORTANT — real Office files: if the user asks for a PowerPoint/deck/slides use skill="deck"; a Word document/report/memo use "document" (or ic_memo / process_sop); an Excel/spreadsheet/workbook/model use "workbook" (or synergy_model / cost_baseline). These build an actual .pptx/.docx/.xlsx binary. NEVER answer a request for a .pptx/.docx/.xlsx with a markdown/table/json/raw artefact — that produces an unusable text file, not the file they asked for. If an office build fails, tell the user it failed and offer to retry; do not substitute a text artefact. ' +
    `Skills: ${skillCatalogue()}.`,
  input_schema: {
    type: 'object',
    properties: {
      skill: {
        type: 'string',
        enum: skillIds(),
        description: 'The closest matching artefact skill (drives format + the specialist used). Use "custom" for a deliverable that fits none; "raw" only when you are supplying `content` yourself for something trivial.',
      },
      title: { type: 'string', description: 'Short human title shown in the Outputs list (e.g. "AP vs AR cost comparison").' },
      spec: {
        type: 'string',
        description: 'Precise instructions for the specialist: exactly what to produce, scope, parameters, sections/columns wanted, tone, length. Be specific — this is the brief, not a topic.',
      },
      context: {
        type: 'string',
        description: 'The grounding facts the artefact must be built on — paste the relevant numbers/findings you already have (costs, FTE, bottlenecks, process names, recommendations). The specialist cannot see the chat; if you omit data it will assume.',
      },
      content: { type: 'string', description: 'ONLY for skill="raw": the full artefact body you are supplying directly.' },
      language: { type: 'string', description: 'ONLY for skill="raw" with code: the language for syntax highlighting (sql, javascript, …).' },
      summary: { type: 'string', description: 'Optional one-line description of what this is / why it was produced.' },
      supersedes: { type: 'string', description: 'Optional: the id of an existing artefact this is a revised version of (use when the user asks to refine/redo a previous output). Creates a new version linked to it.' },
    },
    required: ['skill', 'title'],
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
  // Connector mutations
  ADD_CONNECTOR_TOOL,
  REMOVE_CONNECTOR_TOOL,
  REDIRECT_CONNECTOR_TOOL,
  INSERT_STEP_BETWEEN_TOOL,
  // Branch-level mutations
  SET_BRANCH_TARGET_TOOL,
  SET_BRANCH_PROBABILITY_TOOL,
  SET_BRANCH_LABEL_TOOL,
  REMOVE_BRANCH_TOOL,
  ADD_BRANCH_TOOL,
  // Step ordering / metadata / inputs
  REORDER_STEP_TOOL,
  SET_PROCESS_NAME_TOOL,
  SET_PROCESS_DEFINITION_TOOL,
  SET_STEP_DETAILS_TOOL,
  SET_COST_INPUT_TOOL,
  SET_BOTTLENECK_TOOL,
  SET_FREQUENCY_DETAILS_TOOL,
  SET_PE_CONTEXT_TOOL,
  ADD_STEP_SYSTEM_TOOL,
  REMOVE_STEP_SYSTEM_TOOL,
  ADD_CHECKLIST_ITEM_TOOL,
  TOGGLE_CHECKLIST_ITEM_TOOL,
  REMOVE_CHECKLIST_ITEM_TOOL,
  REMOVE_CUSTOM_DEPARTMENT_TOOL,
  // Reads (live computations — no "if generated" gating)
  GET_BOTTLENECKS_TOOL,
  GET_CRITICAL_PATH_TOOL,
  GET_STEP_METRICS_TOOL,
  GET_COST_SUMMARY_TOOL,
  GET_RECOMMENDATIONS_TOOL,
  LOAD_REPORT_SUMMARY_TOOL,
  // Cost inputs (live — set rates, system cost, investment as you map)
  SET_LABOUR_RATE_TOOL,
  SET_NON_LABOUR_COST_TOOL,
  SET_INVESTMENT_TOOL,
  // Navigation
  HIGHLIGHT_STEP_TOOL,
  // Undo
  UNDO_LAST_ACTION_TOOL,
  // Discovery / proposal
  PROPOSE_CHANGE_TOOL,
  ASK_DISCOVERY_TOOL,
  // Deal data-room retrieval
  SEARCH_DEAL_DOCUMENTS_TOOL,
  // Deal metadata reads
  GET_DEAL_SUMMARY_TOOL,
  LIST_DEAL_PARTICIPANTS_TOOL,
  LIST_DEAL_DOCUMENTS_TOOL,
  LIST_DEAL_FINDINGS_TOOL,
  LIST_DEAL_CHANGES_TOOL,
  // Deal mutations (proposed; client confirms with Apply button)
  PROPOSE_INVITE_PARTICIPANT_TOOL,
  PROPOSE_REPROCESS_DOCUMENT_TOOL,
  PROPOSE_LINK_PARTICIPANT_REPORT_TOOL,
  PROPOSE_UPLOAD_DOCUMENT_TOOL,
  PROPOSE_UNDO_LAST_ACTION_TOOL,
  // Workspace setup (operating-model mutations; client confirms with Apply)
  PROPOSE_ADD_FUNCTION_TOOL,
  PROPOSE_ADD_ROLE_TOOL,
  PROPOSE_ADD_SYSTEM_TOOL,
  PROPOSE_WORKSPACE_BULK_SETUP_TOOL,
  // Process lifecycle (Tier 1) — create / copy / file / delete a process
  CREATE_PROCESS_TOOL,
  DUPLICATE_PROCESS_TOOL,
  FILE_PROCESS_TOOL,
  DELETE_PROCESS_TOOL,
  // Operating-model edit / delete (Tier 2) — completes the CRUD
  PROPOSE_UPDATE_FUNCTION_TOOL,
  PROPOSE_MOVE_FUNCTION_TOOL,
  PROPOSE_DELETE_FUNCTION_TOOL,
  PROPOSE_UPDATE_ROLE_TOOL,
  PROPOSE_DELETE_ROLE_TOOL,
  PROPOSE_UPDATE_SYSTEM_TOOL,
  PROPOSE_DELETE_SYSTEM_TOOL,
  // Artefact emission (schema-free generated output)
  EMIT_ARTEFACT_TOOL,
];

// open_process lives below ALL_CHAT_TOOLS but the process agent still
// needs it: view-mode Reina silently calls open_process({intent:'edit'})
// when the user asks for a change, so the view→edit flip happens
// without forcing the user through a banner button. Patched in at
// module-load time.

/* ── Model & Deal agent navigation + read tools ─────────────────── */

// open_workspace_view — switches the workspace canvas to a named tab.
// Used by the Model agent when the user says "show me the insights" /
// "open analysis" etc. Client listens for a `vesno:set-workspace-view`
// custom event with { view } and updates the tab.
export const OPEN_WORKSPACE_VIEW_TOOL = {
  name: 'open_workspace_view',
  description: 'Switch the workspace canvas to a specific tab. Use when the user asks to see insights, analysis, the function map, the graph, FTE breakdown, or canonical inventory.',
  input_schema: {
    type: 'object',
    properties: {
      view: {
        type: 'string',
        enum: ['list', 'map', 'graph', 'fte', 'inventory', 'insights', 'analysis'],
        description: 'Target tab',
      },
    },
    required: ['view'],
  },
};

// focus_function — filter the workspace list to a single function so
// the user sees just that slice. functionId from the workspace_tree.
export const FOCUS_FUNCTION_TOOL = {
  name: 'focus_function',
  description: 'Filter the workspace to a single function so the user sees only its processes. Pass null to clear the filter and show every function.',
  input_schema: {
    type: 'object',
    properties: {
      functionId: { type: ['string', 'null'], description: 'Function id (from the workspace_tree) or null to clear' },
      functionName: { type: 'string', description: 'Function name — for the confirmation message only' },
    },
    required: ['functionId'],
  },
};

// open_process — opens a specific process on the canvas in view or
// edit mode. The agent interprets the user's intent: "show me the AP
// process" -> view; "let me edit it" -> edit. Loads the flow inline
// without a page reload.
export const OPEN_PROCESS_TOOL = {
  name: 'open_process',
  description: 'Open a specific process on the canvas (loads its flow inline). Use intent="view" by default. Use intent="edit" only when the user explicitly says they want to make changes, edit, modify, redesign, fix, update, or similar.',
  input_schema: {
    type: 'object',
    properties: {
      reportId: { type: 'string', description: 'The process id (internal identifier — pass the id you got back from list_model_processes / get_top_recommendations / etc.)' },
      intent: { type: 'string', enum: ['view', 'edit'], description: 'view (default) or edit' },
      processName: { type: 'string', description: 'Process name — for the confirmation message only' },
    },
    required: ['reportId'],
  },
};

// open_deal_view — same as open_workspace_view but for the deal
// workspace. The deal workspace exposes the same tabs (list/map/graph/
// fte/inventory/insights/analysis) plus the per-participant scope.
export const OPEN_DEAL_VIEW_TOOL = {
  name: 'open_deal_view',
  description: "Switch the current deal's workspace canvas to a specific tab.",
  input_schema: {
    type: 'object',
    properties: {
      view: {
        type: 'string',
        enum: ['list', 'map', 'graph', 'fte', 'inventory', 'insights', 'analysis'],
        description: 'Target tab',
      },
    },
    required: ['view'],
  },
};

// focus_participant — scope the deal workspace to a single participant
// or the combined view. participantId=null means combined.
export const FOCUS_PARTICIPANT_TOOL = {
  name: 'focus_participant',
  description: 'Scope the deal workspace to a single participant, or pass null for the combined view.',
  input_schema: {
    type: 'object',
    properties: {
      participantId: { type: ['string', 'null'], description: 'Participant id or null for combined' },
      participantLabel: { type: 'string', description: 'Participant company/role label — for the confirmation message only' },
    },
    required: ['participantId'],
  },
};

// get_model_summary — model totals + function list + top processes by
// cost. Output is a compact text block the agent can quote. Tool, not
// inline-only, because follow-up questions like "how big is HR?" want
// to re-fetch the latest numbers.
export const GET_MODEL_SUMMARY_TOOL = {
  name: 'get_model_summary',
  description: 'Get a compact summary of the active operating model: totals, function list, top processes by cost.',
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
};

// get_top_recommendations — model-level rollup of every process's
// recommendations, ranked by impact. Falls back to "none yet" when no
// processes have generated AI recommendations.
export const GET_TOP_RECOMMENDATIONS_TOOL = {
  name: 'get_top_recommendations',
  description: 'List the highest-impact recommendations across every process in this operating model.',
  input_schema: {
    type: 'object',
    properties: {
      functionId: { type: 'string', description: 'Optional — filter to one function' },
      limit:      { type: 'number', description: 'How many to return (default 8, max 25)' },
    },
  },
};

// get_top_bottlenecks — bottleneck steps across the model, ranked by
// wait time. Self-reported flags surface first.
export const GET_TOP_BOTTLENECKS_TOOL = {
  name: 'get_top_bottlenecks',
  description: 'List the worst bottleneck steps across every process in this operating model, ranked by wait time.',
  input_schema: {
    type: 'object',
    properties: {
      functionId: { type: 'string', description: 'Optional — filter to one function' },
      limit:      { type: 'number', description: 'How many to return (default 8, max 25)' },
    },
  },
};

// get_function_heatmap — pulls the Insights heatmap data: per-function
// process count, cost, savings, automation %.
export const GET_FUNCTION_HEATMAP_TOOL = {
  name: 'get_function_heatmap',
  description: "Get the operating model's function heatmap: processes, cost, savings, and automation per function.",
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
};

// list_model_processes — every process in the active operating model.
// The ONLY way to enumerate processes for the user — never list across
// workspaces.
export const LIST_MODEL_PROCESSES_TOOL = {
  name: 'list_model_processes',
  description: "List the processes in this operating model. Returns id, name, function, annual cost, savings, automation. ALWAYS use this when the user asks what processes exist — never list anything cross-workspace.",
  input_schema: {
    type: 'object',
    properties: {
      functionId: { type: 'string', description: 'Optional — filter to one function id' },
      limit:      { type: 'number', description: 'Default 25, max 100' },
    },
  },
};

/* ── Agent allow-lists ──────────────────────────────────────────── */

// Model agent — when the chat is anchored to an operating model and
// no specific process is open. Read + navigation tools + the existing
// workspace "propose" tools. NO step-editing tools — those only make
// sense inside an open process.
export const MODEL_AGENT_TOOLS = [
  // Reads
  GET_MODEL_SUMMARY_TOOL,
  GET_FUNCTION_HEATMAP_TOOL,
  GET_TOP_RECOMMENDATIONS_TOOL,
  GET_TOP_BOTTLENECKS_TOOL,
  LIST_MODEL_PROCESSES_TOOL,
  LOAD_REPORT_SUMMARY_TOOL,
  // Navigation (model)
  OPEN_WORKSPACE_VIEW_TOOL,
  FOCUS_FUNCTION_TOOL,
  OPEN_PROCESS_TOOL,
  // Workspace setup (existing proposers)
  PROPOSE_ADD_FUNCTION_TOOL,
  PROPOSE_ADD_ROLE_TOOL,
  PROPOSE_ADD_SYSTEM_TOOL,
  PROPOSE_WORKSPACE_BULK_SETUP_TOOL,
  // Process lifecycle (Tier 1) — "map a new process under X", copy, file, remove
  CREATE_PROCESS_TOOL,
  DUPLICATE_PROCESS_TOOL,
  FILE_PROCESS_TOOL,
  DELETE_PROCESS_TOOL,
  // Operating-model edit / delete (Tier 2) — completes the CRUD
  PROPOSE_UPDATE_FUNCTION_TOOL,
  PROPOSE_MOVE_FUNCTION_TOOL,
  PROPOSE_DELETE_FUNCTION_TOOL,
  PROPOSE_UPDATE_ROLE_TOOL,
  PROPOSE_DELETE_ROLE_TOOL,
  PROPOSE_UPDATE_SYSTEM_TOOL,
  PROPOSE_DELETE_SYSTEM_TOOL,
  // Artefact emission (schema-free generated output)
  EMIT_ARTEFACT_TOOL,
  // Discovery
  ASK_DISCOVERY_TOOL,
];

// Deal agent — when the chat is anchored to a deal and no specific
// process is open. Deal reads + navigation + the existing deal-level
// proposers.
export const DEAL_AGENT_TOOLS = [
  // Reads
  GET_DEAL_SUMMARY_TOOL,
  LIST_DEAL_PARTICIPANTS_TOOL,
  LIST_DEAL_DOCUMENTS_TOOL,
  LIST_DEAL_FINDINGS_TOOL,
  LIST_DEAL_CHANGES_TOOL,
  SEARCH_DEAL_DOCUMENTS_TOOL,
  LOAD_REPORT_SUMMARY_TOOL,
  // Navigation (deal)
  OPEN_DEAL_VIEW_TOOL,
  FOCUS_PARTICIPANT_TOOL,
  OPEN_PROCESS_TOOL,
  // Deal-level proposers (existing)
  PROPOSE_INVITE_PARTICIPANT_TOOL,
  PROPOSE_REPROCESS_DOCUMENT_TOOL,
  PROPOSE_LINK_PARTICIPANT_REPORT_TOOL,
  PROPOSE_UPLOAD_DOCUMENT_TOOL,
  // Artefact emission (resolves the user's default model when the deal
  // chat has no operating model anchored).
  EMIT_ARTEFACT_TOOL,
  // Discovery
  ASK_DISCOVERY_TOOL,
];

// Patch in OPEN_PROCESS_TOOL after declaration (TDZ: it's defined further
// down the file). The process agent uses this to silently flip from
// view-mode to edit-mode when the user requests a change.
ALL_CHAT_TOOLS.push(OPEN_PROCESS_TOOL);

// Workspace setup tool defs are declared above the ALL_CHAT_TOOLS array
// (see "Workspace setup tools" block) so the array literal can reference
// them without TDZ errors at module load.
