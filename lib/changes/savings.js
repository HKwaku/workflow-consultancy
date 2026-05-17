/**
 * Decided-savings derivation.
 *
 * "Potential savings" only means something once a change to the process /
 * operating model has actually been DECIDED — not as a speculative "if you
 * automated everything" heuristic. This module turns a process's change
 * records into a £/yr figure, counting only changes the reviewer accepted
 * (and not later reverted/rejected).
 *
 * A decided change with no quantified impact contributes £0 — we never
 * guess. The number grows only as real decisions are made.
 */

// Accepted and everything downstream of it (applied → live → measured)
// counts as a decided improvement. 'proposed' isn't decided yet;
// 'rejected' / 'reverted' are terminal-negative and contribute nothing.
const DECIDED_STATES = new Set(['accepted', 'applied', 'live', 'measured']);

export function isDecidedChange(change) {
  return !!change && DECIDED_STATES.has(change.state);
}

/**
 * £/yr saved by a single decided change.
 *   1. Measured `annual_cost` outcome (value_before - value_after) wins —
 *      it's an observed delta, not a prediction.
 *   2. Else the proposer's expected_impact: an explicit `annual_savings`
 *      (£), or `cost_pct` applied to the process's annual cost.
 *   3. Else 0 — decided but unquantified.
 * Never negative.
 */
export function changeAnnualSaving(change, annualCost) {
  if (!isDecidedChange(change)) return 0;

  const outcomes = Array.isArray(change.change_outcomes) ? change.change_outcomes : [];
  let measured = 0;
  for (const o of outcomes) {
    if (!o) continue;
    const metric = String(o.metric || '').toLowerCase().replace(/\s+/g, '_');
    if (metric !== 'annual_cost') continue;
    const before = Number(o.value_before);
    const after = Number(o.value_after);
    if (Number.isFinite(before) && Number.isFinite(after)) measured += before - after;
  }
  if (measured > 0) return measured;

  const ei = change.expected_impact && typeof change.expected_impact === 'object'
    ? change.expected_impact
    : {};
  const explicit = Number(ei.annual_savings);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const costPct = Number(ei.cost_pct);
  const base = Number(annualCost);
  if (Number.isFinite(costPct) && costPct > 0 && Number.isFinite(base) && base > 0) {
    return base * (costPct / 100);
  }
  return 0;
}

/**
 * Sum decided savings across a process's changes. `changes` is the array
 * for ONE process (e.g. from loadDecidedChangesByProcess). Returns a
 * rounded, non-negative £/yr figure (0 when nothing is decided).
 */
export function decidedSavingsFromChanges(changes, annualCost) {
  if (!Array.isArray(changes) || changes.length === 0) return 0;
  let total = 0;
  for (const c of changes) total += changeAnnualSaving(c, annualCost);
  return Math.max(0, Math.round(total));
}
