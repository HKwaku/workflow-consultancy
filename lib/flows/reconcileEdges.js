/**
 * reconcileDecisionBranches
 *
 * Translates canvas edge state (flowCustomEdges / flowDeletedEdges) back into
 * steps[].branches so that the data layer always reflects the user's manual
 * canvas edits.
 *
 * Only decision steps are affected - non-decision steps have no explicit
 * branches (their sequential order is determined by array position).
 *
 * The function is IDEMPOTENT: applying it twice with the same inputs yields
 * the same result. This is guaranteed because:
 *   - Deletions match on TARGET INDEX (from the edge ID's middle segment),
 *     not on branch array position, so indices never "shift" between passes.
 *   - Additions check whether the target is already present before inserting.
 *
 * @param {object[]} steps          - Current steps array
 * @param {object[]} customEdges    - Canvas custom edges [{source, target, ...}]
 * @param {string[]} deletedEdges   - Deleted canvas edge IDs
 * @returns {object[]} Updated steps (same array if nothing changed)
 */

import { resolveBranchTarget } from './shared.js';

export function reconcileDecisionBranches(steps, customEdges, deletedEdges) {
  if (!steps?.length) return steps;

  const deletedSet = new Set(deletedEdges || []);
  const customs = customEdges || [];

  // Fast path: nothing to reconcile
  if (deletedSet.size === 0 && customs.length === 0) return steps;

  let anyChanged = false;

  const result = steps.map((step, i) => {
    if (!step.isDecision) return step;

    const original = step.branches || [];

    // Collect deleted TARGET indices for this decision step.
    // Edge ID format: e-dec-{stepIdx}-{targetIdx}-{branchIdx}
    // We key on targetIdx (not branchIdx) so results are stable across runs -
    // the target index in the edge ID is fixed when the edge was generated,
    // whereas branch array positions shift after each reconciliation.
    const deletedTargetIndices = new Set();
    deletedSet.forEach((id) => {
      const m = id.match(/^e-dec-(\d+)-(\d+)-\d+$/);
      if (m && parseInt(m[1], 10) === i) {
        deletedTargetIndices.add(parseInt(m[2], 10));
      }
    });

    // Keep branches NOT pointing to a deleted target.
    // Use resolveBranchTarget so name-based targets (e.g. "Approval check")
    // are resolved correctly - not just "Step N" format ones.
    const kept = original.filter((b) => {
      if (!b.target) return true;
      const targetIdx = resolveBranchTarget(b.target, steps);
      if (targetIdx < 0) return true; // can't resolve → keep (AI may fix later)
      return !deletedTargetIndices.has(targetIdx);
    });

    // Build set of target indices already present in kept branches
    const keptTargetIndices = new Set(
      kept
        .map((b) => resolveBranchTarget(b.target || '', steps))
        .filter((idx) => idx >= 0)
    );

    // Custom outgoing edges from this decision node → new branches to add.
    // Source/target are React Flow node IDs: "step-N" (0-based index).
    const added = customs
      .filter((c) => c.source === `step-${i}`)
      .map((c) => {
        const m = c.target?.match(/^step-(\d+)$/);
        return m ? parseInt(m[1], 10) : -1;
      })
      .filter((idx) => idx >= 0 && idx < steps.length && !keptTargetIndices.has(idx))
      .map((idx) => ({ label: '', target: `Step ${idx + 1}` }));

    const updated = [...kept, ...added];

    // Return original reference when nothing actually changed
    if (
      updated.length === original.length &&
      updated.every((b, bi) => b.target === original[bi]?.target && b.label === original[bi]?.label)
    ) {
      return step;
    }

    anyChanged = true;
    return { ...step, branches: updated };
  });

  return anyChanged ? result : steps;
}
