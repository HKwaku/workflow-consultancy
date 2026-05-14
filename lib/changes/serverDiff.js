/**
 * Server-side diff of rawProcesses[] for the relational changelog.
 *
 * Living-workspace contract: client helpers record discrete events
 * (addStep / removeStep / moveStep) as their own rows at the moment
 * the user clicks. The agent's batch records every tool-call mutation.
 * But INLINE edits (typing into a step name, changing a department
 * dropdown, adjusting work minutes) bypass both paths — they call
 * `setSteps((prev) => prev.map(...))` directly, then the autosave
 * eventually PATCHes /api/update-diagnostic with the new rawProcesses.
 *
 * This helper plugs that gap. At PATCH time, the API reads the old
 * row, this helper diffs scalar step fields, and emits one
 * `kind='modified'` row per step whose fields changed. The API then
 * batch-writes via `recordChanges`.
 *
 * Critically, it does NOT emit 'added' / 'removed' / 'reordered' —
 * those are recorded by the client at the moment of the event, and
 * recording them again here would double-write.
 *
 * Match strategy: by step.number (1-based position). If positions
 * differ (i.e. a reorder happened) the client already wrote a
 * 'reordered' row; we don't re-detect that here. Edge case where a
 * user simultaneously renames AND reorders in the same save will
 * mis-attribute the modify to the new position — acceptable.
 */

const SCALAR_FIELDS = [
  'name',
  'department',
  'isDecision',
  'isMerge',
  'isExternal',
  'parallel',
  'inclusive',
  'workMinutes',
  'waitMinutes',
  'durationUnit',
  'contributor',
  'roleId',
  'functionId',
  'capabilityId',
  'waitType',
  'waitNote',
  'capacity',
];

function indexByNumber(steps) {
  if (!Array.isArray(steps)) return new Map();
  const m = new Map();
  for (const s of steps) {
    if (!s) continue;
    const n = Number(s.number);
    if (Number.isFinite(n) && n > 0) m.set(n, s);
  }
  return m;
}

function diffScalarFields(oldStep, newStep) {
  const changed = [];
  for (const f of SCALAR_FIELDS) {
    const a = oldStep?.[f];
    const b = newStep?.[f];
    // Treat undefined / null / '' as equivalent so an "" → undefined
    // doesn't count as a real edit.
    const aNorm = a == null || a === '' ? null : a;
    const bNorm = b == null || b === '' ? null : b;
    if (aNorm === bNorm) continue;
    changed.push(f);
  }
  return changed;
}

/**
 * Walk every "process" entry in old + new rawProcesses arrays, match
 * by `number`, and emit a changes row for each step whose scalar
 * fields differ. Returns an array of input objects shaped for
 * `recordChanges()`.
 *
 * @param {Array} oldRaw  — old flow_data.rawProcesses (may be empty)
 * @param {Array} newRaw  — new flow_data.rawProcesses (may be empty)
 * @param {Object} ctx    — { processId, actorEmail }
 */
export function diffStepsForChangelog(oldRaw, newRaw, ctx) {
  if (!ctx?.processId) return [];
  const oldProcs = Array.isArray(oldRaw) ? oldRaw : [];
  const newProcs = Array.isArray(newRaw) ? newRaw : [];
  if (!oldProcs.length && !newProcs.length) return [];

  const rows = [];
  // Walk by process index. Most processes have one entry, but the
  // canvas supports multi-process flows so we cover the full array.
  const limit = Math.max(oldProcs.length, newProcs.length);
  for (let pi = 0; pi < limit; pi++) {
    const oldSteps = oldProcs[pi]?.steps || [];
    const newSteps = newProcs[pi]?.steps || [];
    const oldByNum = indexByNumber(oldSteps);
    const newByNum = indexByNumber(newSteps);

    // Walk new steps; for each that also exists in old at the same
    // number, diff scalar fields.
    for (const [n, newStep] of newByNum.entries()) {
      const oldStep = oldByNum.get(n);
      if (!oldStep) continue; // added — client recorded it
      const changed = diffScalarFields(oldStep, newStep);
      if (!changed.length) continue;
      rows.push({
        process_id: ctx.processId,
        subject_type: 'process_step',
        subject_ref: {
          stepNumber: n,
          stepName: newStep.name || oldStep.name || null,
          processIndex: pi,
          fields: changed,
        },
        kind: 'modified',
        state: 'applied',
        actor_kind: 'user',
        actor_email: ctx.actorEmail || null,
        agent_name: null,
      });
    }
  }
  return rows;
}

/**
 * Exported for tests.
 */
export const __test__ = { SCALAR_FIELDS, diffScalarFields, indexByNumber };
