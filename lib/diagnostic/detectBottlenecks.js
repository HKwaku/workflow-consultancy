/**
 * Objective bottleneck detection for process steps.
 *
 * Scores each step independently of the user's self-reported isBottleneck flag,
 * using structural signals: wait/work ratio, approvals, late decisions,
 * system count, handoff clarity, and cross-department transitions.
 *
 * Score thresholds:
 *   >= 4  → HIGH   (likely bottleneck)
 *   2–3   → MEDIUM (worth flagging)
 *   1     → LOW    (minor signal)
 *   0     → none
 */

const HIGH_THRESHOLD   = 4;
const MEDIUM_THRESHOLD = 2;

/**
 * Score a single step.
 * @param {object} step        - Step object from rawProcesses
 * @param {number} stepIndex   - 0-based index in the steps array
 * @param {number} totalSteps  - Total step count for this process
 * @param {Array}  handoffs    - Handoffs array for this process
 * @returns {{ score: number, reasons: string[] }}
 */
function scoreStep(step, stepIndex, totalSteps, handoffs = []) {
  let score = 0;
  const reasons = [];

  // 1. Wait/work ratio — clearest signal of queuing or idle time
  const work = step.workMinutes ?? 0;
  const wait = step.waitMinutes ?? 0;
  if (wait > 0) {
    const ratio = wait / Math.max(work, 1);
    if (ratio >= 5) {
      score += 3;
      reasons.push(`Wait time is ${Math.round(ratio)}× work time (${wait}m wait, ${work}m work)`);
    } else if (ratio >= 2) {
      score += 2;
      reasons.push(`High wait time (${wait}m wait vs ${work}m work)`);
    } else if (ratio >= 1) {
      score += 1;
      reasons.push(`Wait time approaches work time (${wait}m wait)`);
    }
  }

  // 2. Approval step — approval gates are a structural bottleneck
  if (step.isApproval) {
    score += 2;
    reasons.push('Approval or sign-off required');
  }

  // 3. Late-stage decision point — rework loops waste upstream work
  if (step.isDecision && (step.branches || []).length > 0 && stepIndex >= totalSteps * 0.6) {
    score += 2;
    reasons.push('Decision point in the last 40% of the process — rework risk');
  }

  // 4. Multiple systems — manual re-entry creates queuing and errors
  const sysCount = (step.systems || []).length;
  if (sysCount >= 3) {
    score += 2;
    reasons.push(`${sysCount} systems involved — manual re-entry likely`);
  } else if (sysCount === 2) {
    score += 1;
    reasons.push('Multiple systems — potential re-entry overhead');
  }

  // 5. Unclear outbound handoff — unclear handoffs cause waiting at next step
  const handoff = handoffs[stepIndex];
  if (handoff?.clarity === 'yes-major') {
    score += 2;
    reasons.push('Major clarity issue on outbound handoff');
  } else if (handoff?.clarity === 'yes-multiple') {
    score += 1;
    reasons.push('Multiple clarity issues on outbound handoff');
  }

  // 6. Cross-department transition both in and out — coordination overhead
  const prevDept = stepIndex > 0 ? step._prevDept : null;
  const nextDept = step._nextDept || null;
  if (prevDept && nextDept && prevDept !== step.department && nextDept !== step.department) {
    score += 1;
    reasons.push('Step bridges two different departments');
  }

  // 7. Self-reported — adds weight but doesn't solely drive the score
  if (step.isBottleneck) {
    score += 1;
    reasons.push('Flagged by team as bottleneck');
  }

  return { score, reasons };
}

/**
 * Detect bottlenecks across all steps in a process.
 *
 * @param {object} process - Full process object (rawProcesses[i])
 * @returns {Array<{
 *   stepIndex: number,
 *   stepName: string,
 *   score: number,
 *   risk: 'high' | 'medium' | 'low' | 'none',
 *   reasons: string[],
 *   isSelfReported: boolean,
 * }>}
 */
export function detectBottlenecks(process) {
  const steps    = process?.steps    || [];
  const handoffs = process?.handoffs || [];
  const total    = steps.length;

  // Annotate steps with adjacent department info for cross-dept detection
  const annotated = steps.map((s, i) => ({
    ...s,
    _prevDept: i > 0         ? (steps[i - 1].department || null) : null,
    _nextDept: i < total - 1 ? (steps[i + 1].department || null) : null,
  }));

  return annotated.map((step, i) => {
    const { score, reasons } = scoreStep(step, i, total, handoffs);
    const risk = score >= HIGH_THRESHOLD
      ? 'high'
      : score >= MEDIUM_THRESHOLD
      ? 'medium'
      : score >= 1
      ? 'low'
      : 'none';

    return {
      stepIndex:      i,
      stepName:       step.name || `Step ${i + 1}`,
      score,
      risk,
      reasons,
      isSelfReported: !!step.isBottleneck,
    };
  }).filter(r => r.risk !== 'none');
}

/**
 * Returns only high + medium risk steps — useful for surfacing in a summary.
 */
export function getSignificantBottlenecks(process) {
  return detectBottlenecks(process).filter(b => b.risk === 'high' || b.risk === 'medium');
}
