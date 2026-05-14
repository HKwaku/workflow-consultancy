/**
 * analysis — model-level rollup of process-report findings.
 *
 * Insights = facts about the model right now (heatmap, cost, systems).
 * Analysis = recommended actions and prioritised work synthesised from
 * every process report rolled up to model level.
 *
 * Pure helpers exported for tests:
 *   computeAnalysis(reports, changeRoi)
 */

import { getSupabaseHeaders, fetchWithTimeout, requireSupabase } from '../api-helpers.js';
import { attachDerivedMetrics } from '../processMetrics.js';
import { logger } from '../logger.js';
import { classifyAutomation } from '../flows/automation.js';
import { calculateProcessSavings } from '../costSavingsCalculator.js';
import { loadChangeRoiSummary } from './crossProcess.js';

// Per the same rates used in the heatmap. Kept in sync deliberately so
// the Analysis tab's "potential" matches what Insights shows.
const AUTOMATION_SAVINGS_RATE = {
  simple:        0.90,
  agent:         0.75,
  'human-loop':  0.40,
  'multi-agent': 0.60,
};

function autoRateFor(step, idx, process) {
  const cat = classifyAutomation(step, idx, process);
  if (!cat || !cat.key) return 0;
  return AUTOMATION_SAVINGS_RATE[cat.key] ?? 0;
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function round0(n) { return Math.round(n); }

function processesFromReport(report) {
  const dd = report?.flow_data || report?.diagnostic_data || {};
  if (Array.isArray(dd.rawProcesses) && dd.rawProcesses.length) return dd.rawProcesses;
  if (Array.isArray(dd.processes)    && dd.processes.length)    return dd.processes;
  return [];
}

// ------------------------------------------------------------------
// Per-section pure computers
// ------------------------------------------------------------------

// Living-workspace contract: recommendations are derived live from the
// current step shape, not from a frozen `flow_data.recommendations` blob
// (that field is no longer written; the chat agent's get_recommendations
// surfaces the same opportunities on demand). Each row's potential dollar
// savings is split across the four savings drivers in proportion to the
// minutes each driver contributes — so the Analysis tab's "Top
// recommendations" list always reflects what's actually on the canvas.

const REC_META = {
  automation:   {
    title:     'Automate manual steps',
    rationale: 'Manual work that does not require judgement can be handed to a script or integration.',
    priority:  7,
  },
  bottleneck:   {
    title:     'Unblock the bottleneck step',
    rationale: 'The step with the longest wait time is the constraint on the whole process.',
    priority:  9,
  },
  redundancy:   {
    title:     'Consolidate approval steps',
    rationale: 'Excess decision / approval gates can collapse into one rule-based check.',
    priority:  4,
  },
  coordination: {
    title:     'Reduce handoff overhead',
    rationale: 'Email handoffs and external steps add coordination time that direct integrations remove.',
    priority:  3,
  },
};

function liveRecommendationsFromReport(report) {
  const rps = processesFromReport(report);
  if (!rps.length) return [];

  const totalSavings = num(report.potential_savings);
  const rows = [];
  let totalDriverMins = 0;

  for (const raw of rps) {
    let sav;
    try { sav = calculateProcessSavings(raw); } catch { continue; }
    const b = sav?.breakdown;
    if (!b) continue;
    const procName = raw.processName || raw.name || null;
    const drivers = [
      { kind: 'automation',   mins: b.automationMins    || 0 },
      { kind: 'bottleneck',   mins: b.bottleneckMins    || 0 },
      { kind: 'redundancy',   mins: b.redundancyMins    || 0 },
      { kind: 'coordination', mins: b.workReductionMins || 0 },
    ].filter((d) => d.mins > 0);
    for (const d of drivers) {
      totalDriverMins += d.mins;
      rows.push({ ...d, procName });
    }
  }

  return rows.map((row) => {
    const meta = REC_META[row.kind];
    const share = totalDriverMins > 0 ? (row.mins / totalDriverMins) : 0;
    const dollars = totalSavings > 0 ? Math.round(totalSavings * share) : 0;
    return {
      title:           meta.title,
      rationale:       `${meta.rationale} (~${row.mins}min/run${row.procName ? ` in "${row.procName}"` : ''})`,
      impactDollars:   dollars,
      impactLabel:     dollars > 0 ? null : `~${row.mins}min/run`,
      priority:        meta.priority,
      sourceReportId:  report.id,
      sourceCompany:   report.company || null,
      sourceProcess:   row.procName,
      functionId:      report.function_id || null,
    };
  });
}

function computeTopRecommendations(reports) {
  const out = [];
  for (const r of reports || []) out.push(...liveRecommendationsFromReport(r));
  out.sort((a, b) => (b.impactDollars - a.impactDollars)
    || (b.priority - a.priority)
    || a.title.localeCompare(b.title));
  return out;
}

function computeBottleneckInventory(reports) {
  const out = [];
  for (const r of reports || []) {
    const procs = processesFromReport(r);
    for (const proc of procs) {
      const steps = Array.isArray(proc?.steps) ? proc.steps : [];
      steps.forEach((s, i) => {
        const wait     = num(s.waitMinutes);
        const flagged  = !!s.isBottleneck;
        if (!wait && !flagged) return;
        // Severity: self-reported flag bumps high. Otherwise tier by wait.
        const risk = flagged                  ? 'high'
                   : wait >= 480              ? 'high'   // 8 hours+
                   : wait >= 60               ? 'medium' // 1 hour+
                   : 'low';
        out.push({
          stepIndex:      i,
          stepName:       s.name || s.label || `Step ${i + 1}`,
          waitMinutes:    wait,
          isSelfReported: flagged,
          risk,
          processName:    proc.name || null,
          sourceReportId: r.id,
          sourceCompany:  r.company || null,
          functionId:     s.functionId || s.capabilityId || r.function_id || null,
          department:     s.department || null,
        });
      });
    }
  }
  out.sort((a, b) => {
    if (a.isSelfReported !== b.isSelfReported) return a.isSelfReported ? -1 : 1;
    return b.waitMinutes - a.waitMinutes;
  });
  return out;
}

function computeAutomationPipeline(reports) {
  const out = [];
  for (const r of reports || []) {
    const procs = processesFromReport(r);
    if (!procs.length) continue;
    // Use the first process for the headline numbers; report-level totals
    // back-fill when steps don't carry minutes (common for inline reports).
    const proc = procs[0];
    const steps = Array.isArray(proc?.steps) ? proc.steps : [];
    let derivedSavings = 0;
    let totalMinutes   = 0;
    steps.forEach((s, i) => {
      const m = num(s.workMinutes);
      totalMinutes += m;
      derivedSavings += m * autoRateFor(s, i, proc);
    });
    const annualCost = num(r.total_annual_cost);
    // Falls back to report.potential_savings when steps don't carry minutes.
    const minuteShare = totalMinutes > 0 ? (derivedSavings / totalMinutes) : 0;
    const savings    = totalMinutes > 0 ? round0(annualCost * minuteShare) : num(r.potential_savings);
    const ratio      = annualCost > 0 ? (savings / annualCost) : 0;
    const bucket     = ratio >= 0.5 ? 'quick-win'
                     : ratio >= 0.2 ? 'strategic'
                     : 'transformation';
    out.push({
      sourceReportId: r.id,
      sourceCompany:  r.company || null,
      processName:    proc?.name || null,
      functionId:     r.function_id || null,
      annualCost,
      savings,
      ratio,
      automationPct:  num(r.automation_percentage),
      bucket,
    });
  }
  out.sort((a, b) => b.savings - a.savings);
  return out;
}

function computeRiskHotspots(reports) {
  const manualNoSystem = [];
  const shadowSteps    = [];
  // Single-point-of-failure: one role owning > N steps inside a process.
  const sopFailures = [];

  for (const r of reports || []) {
    const procs = processesFromReport(r);
    for (const proc of procs) {
      const steps = Array.isArray(proc?.steps) ? proc.steps : [];
      const ownerCount = new Map();
      steps.forEach((s, i) => {
        const owner   = s.roleId || s.role || s.owner || null;
        const systems = Array.isArray(s.systems) ? s.systems.filter(Boolean) : [];
        const isApprovalish = /approve|sign[- ]?off|review|authoris/i.test(s.name || s.label || '');

        if (owner) ownerCount.set(owner, (ownerCount.get(owner) || 0) + 1);

        if (isApprovalish && systems.length === 0) {
          manualNoSystem.push({
            stepName: s.name || s.label || `Step ${i + 1}`,
            processName: proc.name || null,
            sourceReportId: r.id, sourceCompany: r.company || null,
            owner: owner || null,
          });
        }
        if (systems.length === 0 && !isApprovalish && (s.name || s.label)) {
          shadowSteps.push({
            stepName: s.name || s.label || `Step ${i + 1}`,
            processName: proc.name || null,
            sourceReportId: r.id, sourceCompany: r.company || null,
          });
        }
      });
      // Single point of failure: any owner doing > 60% of the process's steps
      if (steps.length >= 4) {
        for (const [owner, count] of ownerCount) {
          if (count / steps.length > 0.6) {
            sopFailures.push({
              owner, stepCount: count, totalSteps: steps.length,
              processName: proc.name || null,
              sourceReportId: r.id, sourceCompany: r.company || null,
            });
          }
        }
      }
    }
  }
  return {
    manualNoSystem: manualNoSystem.slice(0, 25),
    sopFailures:    sopFailures.slice(0, 25),
    shadowSteps:    shadowSteps.slice(0, 25),
  };
}

function computeCostConcentration(reports) {
  const procRows = [];
  const stepRows = [];
  for (const r of reports || []) {
    const annual = num(r.total_annual_cost);
    const procs  = processesFromReport(r);
    const proc   = procs[0];
    procRows.push({
      sourceReportId: r.id,
      sourceCompany:  r.company || null,
      processName:    proc?.name || null,
      functionId:     r.function_id || null,
      annualCost:     annual,
      potentialSavings: num(r.potential_savings),
    });
    for (const p of procs) {
      const steps = Array.isArray(p?.steps) ? p.steps : [];
      let totalMinutes = 0;
      steps.forEach((s) => { totalMinutes += num(s.workMinutes); });
      if (!annual || !totalMinutes) continue;
      steps.forEach((s, i) => {
        const m = num(s.workMinutes);
        if (!m) return;
        const stepCost = round0(annual * (m / totalMinutes));
        stepRows.push({
          stepName:       s.name || s.label || `Step ${i + 1}`,
          processName:    p.name || null,
          sourceReportId: r.id,
          sourceCompany:  r.company || null,
          stepCost,
          workMinutes:    m,
        });
      });
    }
  }
  procRows.sort((a, b) => b.annualCost - a.annualCost);
  stepRows.sort((a, b) => b.stepCost   - a.stepCost);
  return {
    topProcesses: procRows.slice(0, 10),
    topSteps:     stepRows.slice(0, 10),
  };
}

// ------------------------------------------------------------------
// Orchestrator
// ------------------------------------------------------------------

export function computeAnalysis(reports, changeRoi) {
  return {
    topRecommendations: computeTopRecommendations(reports),
    bottlenecks:        computeBottleneckInventory(reports),
    automationPipeline: computeAutomationPipeline(reports),
    riskHotspots:       computeRiskHotspots(reports),
    costConcentration:  computeCostConcentration(reports),
    roadmap:            changeRoi || null,
    counts: {
      reports: reports?.length || 0,
    },
  };
}

export async function loadAnalysis(modelId) {
  if (!modelId) return null;
  const sb = requireSupabase();
  if (!sb) return null;
  try {
    // Pull flow_data alongside metadata. Capped at 500 — the
    // analysis is cheap arithmetic but the JSONB payloads aren't, so we
    // keep this from becoming a multi-MB response on huge models.
    // Living-workspace migration: cost / savings / automation columns
    // dropped. Live computations from flow_data step minutes — the
    // existing `num(...)` defaults to 0 when the columns are absent.
    const select = 'id,company,function_id,created_at,updated_at,flow_data';
    const filter = `operating_model_id=eq.${encodeURIComponent(modelId)}`;
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/processes?${filter}&select=${encodeURIComponent(select)}&limit=500`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    );
    if (!resp.ok) return null;
    const reports = await resp.json();
    for (const r of reports) attachDerivedMetrics(r);
    const changeRoi = await loadChangeRoiSummary(modelId);
    return computeAnalysis(reports, changeRoi);
  } catch (e) {
    logger.error('loadAnalysis failed', { modelId, error: e.message });
    return null;
  }
}
