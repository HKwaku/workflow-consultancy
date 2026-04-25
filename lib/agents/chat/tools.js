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
    'Rename the overall process. Updates the process title shown across the UI and on the report.',
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

export const TRIGGER_REDESIGN_TOOL = {
  name: 'trigger_redesign',
  description:
    'Run the AI redesign analysis on the current report. Equivalent to clicking the manual "Redesign" rail button. Only works when a report is being edited - do not call before a report has been generated. Always confirm with the user first ("Shall I run the AI redesign now?").',
  input_schema: { type: 'object', properties: {} },
};

export const PIN_FLOW_SNAPSHOT_TOOL = {
  name: 'pin_flow_snapshot',
  description:
    'Pin a snapshot of the current flow as a chat artefact. Equivalent to the user clicking the manual "Pin current" button. Use when the user asks to bookmark, pin, save, or capture the current state.',
  input_schema: {
    type: 'object',
    properties: {
      label: { type: 'string', description: 'Optional custom label for the pinned snapshot' },
    },
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
  TRIGGER_REDESIGN_TOOL,
  PIN_FLOW_SNAPSHOT_TOOL,
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
