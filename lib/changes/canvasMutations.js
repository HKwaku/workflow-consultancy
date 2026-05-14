/**
 * Map chat-agent canvas actions to `changes` table rows.
 *
 * Living-workspace contract: every mutation against the canvas is a row
 * in the `changes` table. The agent emits an action (`add_step`,
 * `update_step`, …) and the DiagnosticWorkspace handler applies it to
 * the JSONB AND records a row here at state='applied'. The relational
 * changelog becomes the canonical timeline of "what happened on this
 * process".
 *
 * Pure module — no React, no Supabase. Takes an action object, returns
 * a row suitable for `recordChanges([row])` (or null if non-mutating).
 */

// Action name → (subject_type, kind) defaults. Per-action handlers
// below override subject_ref for richer context.
const ACTION_META = {
  add_step:                   ['process_step', 'added'],
  update_step:                ['process_step', 'modified'],
  remove_step:                ['process_step', 'removed'],
  insert_step_between:        ['process_step', 'added'],
  reorder_step:               ['process_step', 'reordered'],
  set_step_details:           ['process_step', 'modified'],
  set_branch_target:          ['process_step', 'modified'],
  set_branch_probability:     ['process_step', 'modified'],
  set_branch_label:           ['process_step', 'modified'],
  add_branch:                 ['process_step', 'modified'],
  remove_branch:              ['process_step', 'modified'],
  add_step_system:            ['process_step', 'modified'],
  remove_step_system:         ['process_step', 'modified'],
  add_checklist_item:         ['process_step', 'modified'],
  toggle_checklist_item:      ['process_step', 'modified'],
  remove_checklist_item:      ['process_step', 'modified'],

  set_handoff:                ['handoff', 'modified'],

  add_connector:              ['process_step', 'modified'],
  remove_connector:           ['process_step', 'modified'],
  redirect_connector:         ['process_step', 'modified'],

  replace_all_steps:          ['process', 'modified'],
  set_process_name:           ['process', 'modified'],
  set_process_definition:     ['process', 'modified'],
  set_bottleneck:             ['process', 'modified'],
  set_frequency_details:      ['process', 'modified'],
  set_pe_context:             ['process', 'modified'],
  add_custom_department:      ['process', 'modified'],
  remove_custom_department:   ['process', 'modified'],

  set_cost_input:             ['cost_input', 'modified'],
};

const STEP_REF_FIELDS = ['stepNumber', 'stepIndex', 'stepName', 'newName', 'newTargetStep', 'branchIndex', 'branchLabel', 'newLabel', 'system', 'text'];

/**
 * Build the subject_ref payload for a step-scoped action.
 * Keeps just the fields the agent passed (or empty when none of the
 * known step-ref keys are in the input), so the relational row carries
 * enough breadcrumbs to re-open the affected step from a timeline view.
 */
function buildStepRef(input) {
  if (!input || typeof input !== 'object') return {};
  const out = {};
  for (const k of STEP_REF_FIELDS) {
    if (input[k] !== undefined) out[k] = input[k];
  }
  return out;
}

/**
 * Convert one agent action into a changes-row, or return null if the
 * action is non-mutating (a read, a navigation, etc.).
 */
export function actionToChangeRow(action, ctx) {
  if (!action || typeof action.name !== 'string') return null;
  const meta = ACTION_META[action.name];
  if (!meta) return null;

  const [subject_type, kind] = meta;
  const input = action.input || {};

  let subject_ref;
  if (subject_type === 'process') {
    subject_ref = {
      action: action.name,
      ...(input.name        ? { name: String(input.name).slice(0, 200) } : {}),
      ...(input.processName ? { processName: String(input.processName).slice(0, 200) } : {}),
    };
  } else if (subject_type === 'handoff') {
    subject_ref = {
      fromStep: input.fromStep ?? input.from ?? null,
      toStep:   input.toStep   ?? input.to   ?? null,
      method:   input.method   ?? null,
      clarity:  input.clarity  ?? null,
    };
  } else if (subject_type === 'cost_input') {
    subject_ref = {
      field: input.field || input.key || 'cost',
      value: input.value ?? input.amount ?? null,
    };
  } else {
    subject_ref = buildStepRef(input);
  }

  return {
    process_id: ctx?.processId || null,
    subject_type,
    subject_ref,
    kind,
    state: 'applied',
    actor_kind: ctx?.actorKind || 'agent',
    actor_email: ctx?.actorEmail || null,
    agent_name: ctx?.agentName || 'chat',
    rationale: action.rationale || null,
  };
}

/**
 * Filter a batch of agent actions to just the changes-row representations
 * for the mutating ones. Used to dual-write the canvas state and the
 * relational changelog in one go per agent turn.
 */
export function actionsToChangeRows(actions, ctx) {
  if (!Array.isArray(actions) || !actions.length) return [];
  if (!ctx?.processId) return []; // can't write without a process id
  const rows = [];
  for (const a of actions) {
    const row = actionToChangeRow(a, ctx);
    if (row) rows.push(row);
  }
  return rows;
}

/**
 * Exported for tests.
 */
export const __test__ = { ACTION_META, buildStepRef };
