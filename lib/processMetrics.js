/**
 * Living-workspace metric derivation.
 *
 * The columns `total_annual_cost`, `potential_savings`,
 * `automation_percentage`, `automation_grade` were dropped from the
 * `processes` table in the living-workspace migration. They are now
 * computed on-read from the JSONB `flow_data`:
 *
 *   1. Cached path: prefer `flow_data.summary.*` + `flow_data.automationScore.*`
 *      written by the save pipeline (cheap, accurate, captures rates the
 *      user actually set).
 *   2. Fallback path: walk `flow_data.rawProcesses[].steps[]` to derive
 *      cost (annual labour × team size × frequency) and savings
 *      (automatable minutes × rate). Used when the cached summary is
 *      missing or stale.
 *
 * Returned object uses the legacy snake_case column names so callers
 * that previously read columns off the row keep working unchanged.
 */

import { calculateProcessSavings } from './costSavingsCalculator.js';

const DEFAULT_HOURLY_RATE        = 50;     // £/hr - safe blended fallback
const DEFAULT_ON_COST_MULTIPLIER = 1.25;   // employer NI + overhead loading
const DEFAULT_UTILISATION        = 0.85;
const DEFAULT_HOURS_PER_INSTANCE = 4;
const DEFAULT_ANNUAL_FREQUENCY   = 12;
const DEFAULT_TEAM_SIZE          = 1;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toHourlyRate(rateInput, rateType) {
  const v = num(rateInput);
  if (rateType === 'daily')  return v / 8;
  if (rateType === 'annual') return v / 2080;
  return v;
}

function gradeFromPct(pct) {
  if (pct == null || !Number.isFinite(pct)) return 'N/A';
  if (pct >= 80) return 'A';
  if (pct >= 60) return 'B';
  if (pct >= 40) return 'C';
  if (pct >= 20) return 'D';
  return 'E';
}

/**
 * Walk every step across every process and aggregate cost + savings.
 * Returns minutes (savings) and total annual £ (cost). Mirrors the
 * legacy save-time computation in computeRedesignCostProfile so values
 * line up with what cached summaries store.
 */
function deriveFromRawProcesses(flowData) {
  const costAnalysis = flowData.costAnalysis || {};
  const rawProcesses = Array.isArray(flowData.rawProcesses)
    ? flowData.rawProcesses
    : (Array.isArray(flowData.processes) ? flowData.processes : []);

  if (!rawProcesses.length) {
    return { totalAnnualCost: 0, potentialSavings: 0, automationPct: null };
  }

  const labourRates       = Array.isArray(costAnalysis.labourRates) ? costAnalysis.labourRates : [];
  const blendedRate       = num(costAnalysis.blendedRate) || DEFAULT_HOURLY_RATE;
  const onCostMultiplier  = num(costAnalysis.onCostMultiplier) || DEFAULT_ON_COST_MULTIPLIER;
  const processCostDrivers = costAnalysis.processCostDrivers || {};
  const defaultRate       = blendedRate * onCostMultiplier;

  const rateByDept = labourRates.reduce((acc, r) => {
    const hr = toHourlyRate(r?.rateInput ?? r?.hourlyRate, r?.rateType);
    if (r?.department && hr > 0) acc[r.department] = hr * (num(r.utilisation) || DEFAULT_UTILISATION);
    return acc;
  }, {});

  let totalAnnualCost = 0;
  let totalSavingsMins = 0;
  let totalAutomatableSteps = 0;
  let totalSteps = 0;

  rawProcesses.forEach((raw, i) => {
    const costs    = raw.costs || {};
    const steps    = Array.isArray(raw.steps) ? raw.steps : [];
    const hours    = num(costs.hoursPerInstance) || DEFAULT_HOURS_PER_INSTANCE;
    const teamSize = num(costs.teamSize) || DEFAULT_TEAM_SIZE;
    const annual   = num(costs.annual) || num(raw?.frequency?.annual) || DEFAULT_ANNUAL_FREQUENCY;

    const depts = [...new Set(steps.map((s) => s.department).filter(Boolean))];
    const deptRates = depts.map((d) => rateByDept[d] ?? defaultRate);
    const avgRate = deptRates.length
      ? deptRates.reduce((a, b) => a + b, 0) / deptRates.length
      : defaultRate;

    const drivers       = processCostDrivers[i] || {};
    const errorRate     = Math.min(0.5, num(drivers.errorRate));
    const waitCostPct   = Math.min(0.5, num(drivers.waitCostPct));
    const annualLabour  = hours * avgRate * annual * teamSize;
    const trueAnnualCost = annualLabour + annualLabour * errorRate * 0.5 + annualLabour * waitCostPct;
    totalAnnualCost += trueAnnualCost;

    const sav = calculateProcessSavings(raw);
    const minutesSaved = (sav.breakdown?.automationMins || 0)
                       + (sav.breakdown?.bottleneckMins || 0)
                       + (sav.breakdown?.redundancyMins || 0)
                       + (sav.breakdown?.workReductionMins || 0);
    const minsPerYear = minutesSaved * annual * teamSize;
    totalSavingsMins += minsPerYear * avgRate / 60; // minutes × £/hr ÷ 60 = £

    const eligible = steps.filter((s) => !s?.isDecision && !s?.isMerge);
    const automated = eligible.filter((s) => !!s?.isAutomated);
    totalSteps += eligible.length;
    totalAutomatableSteps += automated.length;
  });

  const automationPct = totalSteps > 0
    ? Math.round((totalAutomatableSteps / totalSteps) * 100)
    : null;

  return {
    totalAnnualCost: Math.max(0, Math.round(totalAnnualCost)),
    potentialSavings: Math.max(0, Math.round(totalSavingsMins)),
    automationPct,
  };
}

/**
 * Derive cost / savings / automation for a single process row from the
 * live step data. Always walks `flow_data.rawProcesses[].steps[]` — does
 * NOT trust any cached `flow_data.summary.*` / `flow_data.automationScore.*`
 * that pre-migration save paths may have left behind. The point of the
 * living-workspace model is that metrics reflect the *current* state of
 * the canvas, not a frozen submission-time snapshot.
 *
 * Accepts either:
 *   - A row from `processes` (has `flow_data` JSONB), or
 *   - A bare flow-data object (already extracted)
 *
 * Returns the legacy column shape so consumers swap in cleanly:
 *   { total_annual_cost, potential_savings, automation_percentage, automation_grade }
 */
export function deriveProcessMetrics(rowOrFlowData) {
  if (!rowOrFlowData || typeof rowOrFlowData !== 'object') {
    return {
      total_annual_cost: 0,
      potential_savings: 0,
      automation_percentage: null,
      automation_grade: 'N/A',
    };
  }

  const flow = rowOrFlowData.flow_data
            || rowOrFlowData.diagnostic_data
            || (rowOrFlowData.rawProcesses || rowOrFlowData.processes || rowOrFlowData.costAnalysis
                ? rowOrFlowData
                : null);

  if (!flow) {
    return {
      total_annual_cost: 0,
      potential_savings: 0,
      automation_percentage: null,
      automation_grade: 'N/A',
    };
  }

  const derived = deriveFromRawProcesses(flow);

  return {
    total_annual_cost:     derived.totalAnnualCost,
    potential_savings:     derived.potentialSavings,
    automation_percentage: derived.automationPct,
    automation_grade:      gradeFromPct(derived.automationPct),
  };
}

/**
 * Merge derived metrics onto a row in-place (mutates) so existing code
 * that reads `row.total_annual_cost` etc. keeps working without
 * changes. Returns the same row for fluency.
 */
export function attachDerivedMetrics(row) {
  if (!row || typeof row !== 'object') return row;
  const m = deriveProcessMetrics(row);
  row.total_annual_cost     = m.total_annual_cost;
  row.potential_savings     = m.potential_savings;
  row.automation_percentage = m.automation_percentage;
  row.automation_grade      = m.automation_grade;
  return row;
}

/**
 * Slice a process's annual cost across the functions its steps are tagged
 * to, weighted by workMinutes. Used by the graph view's cost heatmap and
 * the owner-mismatch flag.
 *
 * Step-fallback rule: an untagged step (no functionId / capabilityId)
 * inherits `declaredFunctionId` so its cost still lands somewhere
 * meaningful instead of being silently dropped.
 *
 * Zero-attribution fallback: when no step has workMinutes (or the process
 * has zero annual cost), we either attribute everything to the declared
 * owner (single-driver) or return {} (when there's nothing to attribute).
 * The single-driver shape gives the graph a stable signal — "cost exists,
 * but we can't split it" — without ever triggering a spurious mismatch.
 *
 * @param {object} args
 * @param {Array<{steps?: Array<object>}>} args.rawProcesses - canonical
 *   shape from flow_data.rawProcesses (or flow_data.processes). Each
 *   step may have functionId / function_id / capabilityId / capability_id
 *   and workMinutes.
 * @param {string|null} args.declaredFunctionId - the row's declared
 *   owner (processes.function_id). Used as the fallback when steps are
 *   untagged.
 * @param {number} args.annualCost - the row's total_annual_cost.
 * @returns {Object<string, number>} cost attributed per function id.
 */
export function deriveCostByFunction({ rawProcesses, declaredFunctionId, annualCost }) {
  const result = {};
  const cost = Number(annualCost) || 0;
  if (cost <= 0) return result;

  const procs = Array.isArray(rawProcesses) ? rawProcesses : [];
  const wmByFunc = new Map();
  let totalWm = 0;
  for (const proc of procs) {
    const steps = Array.isArray(proc?.steps) ? proc.steps : [];
    for (const step of steps) {
      const sid = step?.functionId
        || step?.function_id
        || step?.capabilityId
        || step?.capability_id
        || declaredFunctionId
        || null;
      if (!sid) continue;
      const wm = Number(step?.workMinutes);
      if (!Number.isFinite(wm) || wm <= 0) continue;
      wmByFunc.set(sid, (wmByFunc.get(sid) || 0) + wm);
      totalWm += wm;
    }
  }

  if (totalWm > 0) {
    for (const [fid, wm] of wmByFunc) {
      result[fid] = (wm / totalWm) * cost;
    }
  } else if (declaredFunctionId) {
    result[declaredFunctionId] = cost;
  }
  return result;
}
