/**
 * Flow model — derives predicted dwell times from step touch output,
 * routing probabilities, and step capacity.
 *
 * What this model predicts:
 *   "Capacity wait" — the dwell time caused by the step not having enough
 *   throughput to keep up with incoming work. It does NOT predict:
 *   - Blocked waits (missing input, approvals, dependencies)
 *   - WIP waits (person context-switching to other concurrent items)
 *   Those causes require explicit annotation by the user (waitType field).
 *
 * Core assumption: touch time completing at step i-1 is the queue arriving
 * at step i. Predicted dwell = incoming touch time / step capacity.
 *
 * Exceptions handled:
 *   - Parallel paths: exclusive branches weight by probability; parallel
 *     branches send full work down every path.
 *   - Merge steps: sum all incoming branch contributions.
 *   - Capacity > 1: dwell is divided by the number of people at the step.
 *   - Observed waitMinutes always wins — prediction is a fallback only.
 */

/**
 * Resolve step index from a branch target string ("Step 3", "step-2", "3", etc.)
 * Returns 0-based index or null if unresolvable.
 */
function resolveBranchTarget(target, steps) {
  if (!target) return null;
  // "Step N" or "step-N" (1-indexed)
  const m = String(target).match(/(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  // Treat as 1-indexed step number
  const byNumber = steps.findIndex(s => s.number === n);
  if (byNumber !== -1) return byNumber;
  // Treat as 1-indexed position
  if (n >= 1 && n <= steps.length) return n - 1;
  return null;
}

/**
 * Compute predicted wait times for all steps in a process.
 *
 * @param {object} process - Raw process object { steps: [], handoffs: [] }
 * @returns {number[]} predictedWaitMins — indexed by step, null if not computable
 */
export function predictWaitTimes(process) {
  const steps = process?.steps || [];
  const n = steps.length;
  if (n === 0) return [];

  // Build predecessor map: for each step, which steps feed into it and
  // with what routing weight (1.0 = full, 0.5 = half, etc.)
  // Shape: predecessors[i] = [{ fromIdx, weight }]
  const predecessors = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    const s = steps[i];

    if (s.isDecision && (s.branches || []).length > 0) {
      // Decision node — route work to branch targets
      const branches = s.branches.filter(b => b.target);
      const isParallel = !!s.parallel;

      if (isParallel) {
        // All branches receive full work
        for (const br of branches) {
          const ti = resolveBranchTarget(br.target, steps);
          if (ti !== null) predecessors[ti].push({ fromIdx: i, weight: 1.0 });
        }
      } else {
        // Exclusive: distribute by probability, falling back to equal split
        const totalProb = branches.reduce((s, b) => s + (Number(b.probability) || 0), 0);
        const useProb = totalProb > 0;
        const equalShare = 1.0 / branches.length;

        for (const br of branches) {
          const ti = resolveBranchTarget(br.target, steps);
          if (ti === null) continue;
          const weight = useProb ? (Number(br.probability) || 0) / 100 : equalShare;
          predecessors[ti].push({ fromIdx: i, weight });
        }
      }
    } else if (!s.isMerge) {
      // Regular step — flows directly to next step in sequence
      const nextIdx = i + 1;
      if (nextIdx < n) {
        predecessors[nextIdx].push({ fromIdx: i, weight: 1.0 });
      }
    }
    // Merge steps receive from branches — already handled above via branch targets
  }

  // Compute predicted wait for each step
  return steps.map((s, i) => {
    const preds = predecessors[i];
    if (preds.length === 0) return null; // First step or unreachable

    const capacity = Math.max(1, Number(s.capacity) || 1);

    // Sum incoming work weighted by routing probability
    const incomingWork = preds.reduce((sum, { fromIdx, weight }) => {
      const upstreamWork = steps[fromIdx]?.workMinutes || 0;
      return sum + upstreamWork * weight;
    }, 0);

    if (incomingWork === 0) return null;
    return Math.round(incomingWork / capacity);
  });
}

/**
 * Merge observed wait times with predicted fallbacks.
 * Observed always wins; predicted fills gaps.
 *
 * @param {object} process
 * @returns {Array<{ stepIndex, observed: number|null, predicted: number|null, effective: number }>}
 */
export function getWaitProfile(process) {
  const steps = process?.steps || [];
  const predicted = predictWaitTimes(process);

  return steps.map((s, i) => {
    const observed = s.waitMinutes != null ? s.waitMinutes : null;
    const pred = predicted[i] ?? null;
    return {
      stepIndex: i,
      observed,
      predicted: pred,
      effective: observed ?? pred ?? 0,
      isEstimated: observed == null && pred != null,
    };
  });
}
