/**
 * Deterministic savings calculator - derives minutes saved from actual
 * process data rather than arbitrary benchmarks or scenario percentages.
 *
 * Drivers (all derived from step-level data):
 *   1. Step automation     - work time of manual steps that can be automated
 *   2. Bottleneck removal  - wait time of the highest-wait step (the constraint)
 *   3. Redundant steps     - work time of excess approval steps (beyond 2)
 *   4. Work time reduction - overhead of email-based handoffs + external step coordination
 */

import { getWaitProfile } from './flows/flowModel.js';

/**
 * @param {object} raw - a rawProcesses entry from diagnostic_data
 * @returns {{ reasoning, breakdown, confidence }}
 */
export function calculateProcessSavings(raw) {
  const steps = raw.steps || [];
  const n = steps.length;

  // ── Wait time profile (observed where entered, predicted by flow model as fallback) ──
  const waitProfile = getWaitProfile(raw);

  // ── Timing basis ───────────────────────────────────────────────────
  const stepWorkMins = steps.reduce((sum, s) => sum + (s.workMinutes || 0), 0);
  // Use observed wait times only for hasTiming check (predicted = no user data)
  const stepWaitMinsObserved = steps.reduce((sum, s) => sum + (s.waitMinutes || 0), 0);
  // Use effective waits (observed ?? predicted) for calculations
  const stepWaitMins = waitProfile.reduce((sum, wp) => sum + wp.effective, 0);
  const hasTiming = stepWorkMins > 0 || stepWaitMinsObserved > 0;

  const costs = raw.costs || {};
  const hoursPerInstance = costs.hoursPerInstance ?? 4;

  const hasObservedOrPredictedWait = stepWaitMins > 0;

  // If per-step timing is missing, estimate from session-level hours
  const workMins = hasTiming ? stepWorkMins : hoursPerInstance * 60;
  // Use effective waits (observed + predicted); fall back to 30% of work only when nothing available
  const waitMins = hasObservedOrPredictedWait ? stepWaitMins : workMins * 0.30;

  const confidence = hasTiming ? (n >= 4 ? 'high' : 'medium') : 'low';

  // ── Driver 1: Step automation ──────────────────────────────────────
  // Full work time of manual, non-decision, non-merge steps - this is
  // the actual time that would be eliminated by automation.
  const automatableSteps = steps.filter(s => !s.isDecision && !s.isMerge && !s.isAutomated);
  const automatableMinsFromSteps = automatableSteps.reduce((sum, s) => sum + (s.workMinutes || 0), 0);
  const automationMins = automatableMinsFromSteps > 0
    ? automatableMinsFromSteps
    : (automatableSteps.length / Math.max(n, 1)) * workMins;

  // ── Driver 2: Bottleneck removal ──────────────────────────────────
  // The bottleneck is the step with the highest effective wait time - it is the
  // constraint limiting the whole process. Uses observed wait if available,
  // falls back to the flow model prediction (work from previous step / capacity).
  let bottleneckIdx = -1;
  let maxEffectiveWait = 0;
  steps.forEach((_, idx) => {
    const w = waitProfile[idx]?.effective ?? 0;
    if (w > maxEffectiveWait) { maxEffectiveWait = w; bottleneckIdx = idx; }
  });
  const bottleneckStep = bottleneckIdx >= 0 ? steps[bottleneckIdx] : {};
  const bottleneckMins = maxEffectiveWait;

  // ── Driver 3: Redundant step removal ──────────────────────────────
  // Work time of decision/approval steps beyond the first two - these
  // are candidates for consolidation into a single rule-based gate.
  const decisionSteps = steps.filter(s => s.isDecision);
  const excessDecisionMins = decisionSteps.slice(2).reduce((sum, s) => sum + (s.workMinutes || 0), 0);
  // Fallback: when no per-step timing, use step-count signal only
  const redundancyFactor = (decisionSteps.length > 2 ? 0.04 : decisionSteps.length > 1 ? 0.02 : 0)
                         + (n > 12 ? 0.03 : n > 8 ? 0.015 : 0);
  const redundancyMins = excessDecisionMins > 0
    ? excessDecisionMins
    : workMins * redundancyFactor;

  // ── Driver 4: Work time reduction ─────────────────────────────────
  // Email handoffs create coordination overhead (~5 min each).
  // External steps add briefing/chasing/confirmation overhead (~10 min each)
  // that can't be scheduled or controlled like internal work.
  const emailHandoffs = (raw.handoffs || []).filter(h => h.method === 'email').length;
  const externalSteps = steps.filter(s => s.isExternal);
  const workReductionMins = (emailHandoffs * 5) + (externalSteps.length * 10);

  // ── Reasoning from dominant drivers ───────────────────────────────
  const drivers = [];
  if (automatableSteps.length > 0)
    drivers.push(`${automatableSteps.length} automatable step${automatableSteps.length !== 1 ? 's' : ''} (${Math.round(automationMins)}min work)`);
  if (bottleneckMins > 0 && bottleneckStep.name)
    drivers.push(`bottleneck step "${bottleneckStep.name}" (${Math.round(bottleneckMins)}min wait)`);
  if (decisionSteps.length > 2)
    drivers.push(`${decisionSteps.length} approval/decision steps (${decisionSteps.length - 2} excess)`);
  if (workReductionMins > 0) {
    const overheadParts = [];
    if (emailHandoffs >= 2) overheadParts.push(`${emailHandoffs} email handoffs`);
    if (externalSteps.length > 0) overheadParts.push(`${externalSteps.length} external step${externalSteps.length !== 1 ? 's' : ''}`);
    if (overheadParts.length > 0)
      drivers.push(`${overheadParts.join(' + ')} (~${workReductionMins}min coordination overhead)`);
  }

  const reasoning = drivers.length > 0
    ? `Savings driven by: ${drivers.join('; ')}.`
    : `Based on ${n}-step process structure${hasTiming ? ' with per-step timing data' : ' (no per-step timing recorded)'}.`;

  return {
    reasoning,
    confidence,
    breakdown: {
      automationMins:    Math.max(0, Math.round(automationMins)),
      bottleneckMins:    Math.max(0, Math.round(bottleneckMins)),
      redundancyMins:    Math.max(0, Math.round(redundancyMins)),
      workReductionMins: Math.max(0, Math.round(workReductionMins)),
      totalWorkMins:     Math.round(workMins),
      totalWaitMins:     Math.round(waitMins),
      hasTiming,
      hasPredictedWait:  !hasTiming && hasObservedOrPredictedWait,
    },
  };
}
