/**
 * crossProcess — read helpers for the workspace's cross-process views.
 *
 * Each helper takes a model id and returns aggregated rows ready for
 * direct rendering. Heavy lifting is one or two PostgREST round-trips
 * per helper; arithmetic happens in JS for clarity (the data volumes
 * are small — at most a few hundred processes per model).
 *
 * Pure helpers exported for tests:
 *   computeSystemInventory(rows)
 *   computeFunctionHeatmap({ reports, findings, processSystems })
 *   computeChangeRoiSummary(changes)
 */

import { getSupabaseHeaders, fetchWithTimeout, requireSupabase } from '../api-helpers.js';
import { logger } from '../logger.js';
import { classifyAutomation } from '../flows/automation.js';
import { attachDerivedMetrics } from '../processMetrics.js';
import { loadDecidedChangesByProcess } from '../changes/repo.js';
import { decidedSavingsFromChanges } from '../changes/savings.js';

// Automation-savings rates per category. These map the AI/agent
// classification to the % of step labour we expect to recover when the
// step is implemented as designed. Rough rules of thumb, deliberately
// conservative on human-in-the-loop because most of those still need
// review time. Tweak in one place to re-tune the whole heatmap.
const AUTOMATION_SAVINGS_RATE = {
  simple:        0.90, // rule-based, fully automatable
  agent:         0.75, // autonomous AI agent
  'human-loop':  0.40, // agent with required human review
  'multi-agent': 0.60, // orchestrated multi-agent
};

function autoRateFor(step, idx, process) {
  const cat = classifyAutomation(step, idx, process);
  if (!cat || !cat.key) return 0;
  return AUTOMATION_SAVINGS_RATE[cat.key] ?? 0;
}

// ------------------------------------------------------------------
// System inventory — every system the model touches, ranked by reach
// ------------------------------------------------------------------

/**
 * Group process_systems rows by canonical system name. Returns:
 *   [{ system_name, system_id, processCount, stepCount, processes: [{report_id, function_id}] }]
 * Sorted by processCount desc then name asc. Pure — exported for tests.
 */
export function computeSystemInventory(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  // Group by (system_id || match_key) — the canonical link wins when
  // present, the lower-cased name is the fallback.
  const buckets = new Map();
  for (const r of rows) {
    const key = r.system_id || `raw::${(r.match_key || '').trim()}`;
    if (!key || key === 'raw::') continue;
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        system_id: r.system_id || null,
        system_name: r.system_name_raw,
        processCount: 0,
        stepCount: 0,
        processIds: new Set(),
        functionIds: new Set(),
      });
    }
    const b = buckets.get(key);
    b.stepCount += 1;
    // process_id is the new column name; accept the old report_id shape
    // for back-compat with any pre-migration mock data still in tests.
    b.processIds.add(r.process_id || r.report_id);
    if (r.function_id) b.functionIds.add(r.function_id);
  }
  return [...buckets.values()]
    .map((b) => ({
      key: b.key,
      system_id: b.system_id,
      system_name: b.system_name,
      processCount: b.processIds.size,
      stepCount: b.stepCount,
      functionCount: b.functionIds.size,
    }))
    .sort((a, b) => b.processCount - a.processCount
      || (a.system_name || '').localeCompare(b.system_name || ''));
}

export async function loadSystemInventory(modelId) {
  if (!modelId) return [];
  const sb = requireSupabase();
  if (!sb) return [];
  const headers = getSupabaseHeaders(sb.key);
  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/process_systems?operating_model_id=eq.${encodeURIComponent(modelId)}` +
        `&select=process_id,system_id,system_name_raw,match_key,function_id&limit=10000`,
      { method: 'GET', headers },
    );
    if (resp.ok) {
      const rows = await resp.json();
      if (rows.length > 0) return computeSystemInventory(rows);
    }

    // Fallback: process_systems is empty for this model. Most likely the
    // rows were inserted via SQL seed (bypassing the save path that syncs
    // the join table). Walk flow_data.rawProcesses[].steps[].systems[]
    // directly so the inventory still populates.
    const repsResp = await fetchWithTimeout(
      `${sb.url}/rest/v1/processes?operating_model_id=eq.${encodeURIComponent(modelId)}` +
        `&select=id,function_id,flow_data&limit=5000`,
      { method: 'GET', headers },
    );
    if (!repsResp.ok) return [];
    const reps = await repsResp.json();

    const sysResp = await fetchWithTimeout(
      `${sb.url}/rest/v1/model_systems?operating_model_id=eq.${encodeURIComponent(modelId)}&select=id,match_key`,
      { method: 'GET', headers },
    );
    const matchKeyToId = new Map();
    if (sysResp.ok) {
      const sys = await sysResp.json();
      for (const s of sys) matchKeyToId.set(s.match_key, s.id);
    }

    const synthRows = [];
    for (const r of reps) {
      // Living-workspace migration: column renamed to flow_data. Old
      // shape (diagnostic_data) still accepted so tests / mocks keep
      // working without modification.
      const dd = r.flow_data || r.diagnostic_data || {};
      const procs = Array.isArray(dd.rawProcesses) ? dd.rawProcesses
                  : Array.isArray(dd.processes)    ? dd.processes
                  : [];
      for (const proc of procs) {
        const steps = Array.isArray(proc?.steps) ? proc.steps : [];
        for (const step of steps) {
          const stepCapId = step?.functionId || step?.function_id || step?.capabilityId || step?.capability_id || r.function_id || null;
          const systems = Array.isArray(step?.systems) ? step.systems : [];
          for (const sys of systems) {
            const name = typeof sys === 'string' ? sys.trim() : '';
            if (!name) continue;
            synthRows.push({
              // The synthetic row uses `process_id` to match what
              // process_systems now exposes; consumers downstream don't
              // care about the field name, only the grouping behaviour.
              process_id: r.id,
              system_id: matchKeyToId.get(name.toLowerCase()) || null,
              system_name_raw: name,
              match_key: name.toLowerCase(),
              function_id: stepCapId,
            });
          }
        }
      }
    }
    return computeSystemInventory(synthRows);
  } catch (e) {
    logger.error('loadSystemInventory failed', { modelId, error: e.message });
    return [];
  }
}

// ------------------------------------------------------------------
// Capability heatmap — capability × (cost, savings, automation, severity)
// ------------------------------------------------------------------

/**
 * Aggregate processes + findings + system count per capability/function.
 * Pure — exported for tests.
 *
 * Per-step function tagging (Phase 2 — option B): when a step in
 * diagnostic_data.processes[].steps[] has a `functionId` of its own,
 * its workMinutes get counted under THAT function (where the work
 * actually happens). The process-level function_id stays as the
 * "owner" — `processCount` increments only on the owner, but
 * `stepMinutes` and `stepCount` accumulate where the work lives.
 *
 * Inputs:
 *   reports        — diagnostic_reports rows with function_id, cost,
 *                    automation, AND diagnostic_data (for step walking)
 *   findings       — reserved
 *   processSystems — process_systems rows (already step-weighted via
 *                    extractSystemRows, so its function_id is the
 *                    step's function when set)
 *   functions   — for name lookup
 *
 * Returns rows keyed by function_id (plus a null bucket for unfiled):
 *   [{
 *     function_id, name, processCount,
 *     stepCount, stepMinutes,                    // ← NEW (where the work is)
 *     annualCost, potentialSavings, avgAutomationPct,
 *     systemMentions, distinctSystems,
 *     severity: { low, medium, high, critical },
 *   }]
 */
export function computeFunctionHeatmap({ reports, findings, processSystems, functions }) {
  const funcsById = new Map((functions || []).map((c) => [c.id, c]));
  const buckets = new Map();
  const ensure = (capId) => {
    if (!buckets.has(capId)) {
      const cap = capId ? funcsById.get(capId) : null;
      buckets.set(capId, {
        function_id: capId,
        name: cap?.name || (capId ? '(orphaned)' : '(unfiled)'),
        processCount: 0,
        stepCount: 0,
        stepMinutes: 0,
        annualCost: 0,
        derivedSavings: 0,        // computed from step-level automation
        autoSum: 0, autoCount: 0,
        systemMentions: 0,
        systemKeys: new Set(),
        severity: { low: 0, medium: 0, high: 0, critical: 0 },
      });
    }
    return buckets.get(capId);
  };

  // Per-(function, process) breakdown for the drill-through. Keyed by
  // leaf function id (rolled up below) → Map<reportId, contribution>.
  // Each contribution records everything we need for the per-cell modals:
  // workMinutes / annualCostShare / savings / automatableShare / systems.
  const breakdownByCap = new Map(); // capId -> Map<reportId, entry>
  const ensureProc = (capId, reportId, base) => {
    if (!breakdownByCap.has(capId)) breakdownByCap.set(capId, new Map());
    const m = breakdownByCap.get(capId);
    if (!m.has(reportId)) {
      m.set(reportId, {
        reportId,
        processName: base.processName,
        annualCost: 0,         // share of the report's annualCost attributed to this function
        workMinutes: 0,        // step minutes attributed to this function
        savings: 0,            // derived savings attributed to this function
        automatableShare: 0,   // process-level (same for every cap touched)
        automationPct: base.automationPct, // report-level pct (denormalised)
        systems: new Set(),    // distinct system names this process used here
        isOwner: base.isOwner, // true iff the report's function_id == capId
      });
    }
    return m.get(reportId);
  };

  for (const r of reports || []) {
    const ownerBucket = ensure(r.function_id || null);
    ownerBucket.processCount += 1;
    const annualCost = Number(r.total_annual_cost) || 0;
    // Decided-changes savings for this report (set by loadFunctionHeatmap
    // from the changes table; tests pass it directly). Attributed across
    // functions by the same work-minutes share as cost — never the old
    // speculative step-automation heuristic.
    const reportSavings = Number(r.potential_savings) || 0;
    if (annualCost) ownerBucket.annualCost += annualCost;
    if (r.automation_percentage != null) {
      ownerBucket.autoSum += Number(r.automation_percentage) || 0;
      ownerBucket.autoCount += 1;
    }

    // Step-weighted attribution: walk the diagnostic_data and credit each
    // step's workMinutes to its own capability bucket (or the process
    // owner when the step is untagged). At the same time, derive savings
    // per step from the automation classifier so the heatmap reflects
    // the current flow shape rather than a stored seed value.
    // Living-workspace migration: column renamed flow_data; tests still
    // pass the old key so accept either.
    const dd = r.flow_data || r.diagnostic_data || {};
    const procArrays = [
      Array.isArray(dd.rawProcesses) ? dd.rawProcesses : null,
      Array.isArray(dd.processes)    ? dd.processes    : null,
    ].filter(Boolean);
    // Prefer rawProcesses (canonical map) when both exist.
    const procs = procArrays[0] || [];
    for (const proc of procs) {
      const steps = Array.isArray(proc?.steps) ? proc.steps : [];

      // Total work minutes for this process — used to apportion the
      // process's annual cost across its steps. Steps with no
      // workMinutes contribute zero to savings (nothing to automate).
      const totalWm = steps.reduce((s, st) => {
        const v = Number(st?.workMinutes);
        return s + (Number.isFinite(v) && v > 0 ? v : 0);
      }, 0);

      const procName = proc?.processName || proc?.name || 'Process';
      // Per-(function this proc touches) tally so we can split spanning
      // processes' work / cost / savings / systems across the right buckets.
      const procContribByCap = new Map(); // capId -> { workMinutes, systems }
      const tally = (capId) => {
        if (!procContribByCap.has(capId)) procContribByCap.set(capId, { workMinutes: 0, systems: new Set() });
        return procContribByCap.get(capId);
      };
      let procAutoMinutes = 0;

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepCapId = step?.functionId || step?.function_id || step?.capabilityId || step?.capability_id || r.function_id || null;
        const b = ensure(stepCapId);
        b.stepCount += 1;
        const wm = Number(step?.workMinutes);
        const wmValid = Number.isFinite(wm) && wm > 0 ? wm : 0;
        if (wmValid) {
          b.stepMinutes += wmValid;
          tally(stepCapId).workMinutes += wmValid;
        }
        // System mentions for this step land under the function the step
        // belongs to. Used by the per-row "Systems" drill-through so the
        // user can see which systems each function actually touches.
        const stepSystems = Array.isArray(step?.systems) ? step.systems : [];
        for (const sys of stepSystems) {
          const name = typeof sys === 'string' ? sys.trim() : '';
          if (name) tally(stepCapId).systems.add(name);
        }

        // autoRate still feeds the automatable-share signal (a "% of
        // work automatable" indicator, distinct from the £ savings
        // column, which is now decided-changes only).
        if (wmValid > 0 && totalWm > 0) {
          const rate = autoRateFor(step, i, proc);
          if (rate > 0) procAutoMinutes += wmValid * rate;
        }
      }

      const procAutomatableShare = totalWm > 0 ? procAutoMinutes / totalWm : 0;
      for (const [capId, contrib] of procContribByCap.entries()) {
        const entry = ensureProc(capId, r.id, {
          processName: procName,
          automationPct: r.automation_percentage != null ? Number(r.automation_percentage) : null,
          isOwner: capId === (r.function_id || null),
        });
        entry.workMinutes += contrib.workMinutes;
        entry.automatableShare = procAutomatableShare;
        // Cost AND decided savings both split by this function's share of
        // the process's work minutes — one conserving attribution. Σ over
        // functions == the report's annualCost / decided savings.
        if (totalWm > 0 && contrib.workMinutes > 0) {
          const share = contrib.workMinutes / totalWm;
          if (annualCost > 0) entry.annualCost += share * annualCost;
          if (reportSavings > 0) {
            const sav = share * reportSavings;
            entry.savings += sav;
            ensure(capId).derivedSavings += sav;
          }
        }
        for (const s of contrib.systems) entry.systems.add(s);
      }

      // Fallback: when a report has no step minutes (e.g. the deal API
      // strips raw steps, or the report was authored before the
      // step-detail upgrade), the step-driven savings calc lands on 0
      // even though the report carries a stored potential_savings. Fall
      // back to that value, attributed to the report's owner function,
      // so the Insights tab shows something instead of always 0.
      if (totalWm === 0 && r.potential_savings != null) {
        const fallback = Number(r.potential_savings) || 0;
        if (fallback > 0) {
          const ownerCap = r.function_id || null;
          const b = ensure(ownerCap);
          b.derivedSavings += fallback;
          const entry = ensureProc(ownerCap, r.id, {
            processName: procName,
            automationPct: r.automation_percentage != null ? Number(r.automation_percentage) : null,
            isOwner: true,
          });
          entry.savings    += fallback;
          entry.annualCost += annualCost;
          // automatableShare = report-level automation% (best signal we
          // have when steps are missing).
          if (entry.automationPct != null) entry.automatableShare = entry.automationPct / 100;
        }
      }
    }
  }

  for (const ps of processSystems || []) {
    const b = ensure(ps.function_id || null);
    b.systemMentions += 1;
    if (ps.system_id || ps.match_key) {
      b.systemKeys.add(ps.system_id || `raw::${ps.match_key}`);
    }
  }

  // Findings have no function_id today — they're per deal-analysis. We
  // count severity on a per-deal basis under the (unfiled / model-wide)
  // bucket. The heatmap renderer can choose to surface this separately.
  // Skipped here to avoid double-counting; the change-ROI summary covers
  // findings impact via the changes table instead.

  // Roll sub-function buckets up to their top-level parent. The graph
  // view + the swimlane Sub-function / Function toggle now expose the
  // hierarchy directly, so the heatmap stays one-row-per-(top-level)-
  // function. Without this, every nested sub-function (Accounts Receivable,
  // Pipeline, Engineering, ...) became its own row and the heatmap
  // doubled to ~13 rows, mostly noise. The unfiled bucket is preserved.
  const topLevelOf = (capId) => {
    let cursor = capId ? funcsById.get(capId) : null;
    if (!cursor) return capId;
    while (cursor.parent_function_id && funcsById.has(cursor.parent_function_id)) {
      cursor = funcsById.get(cursor.parent_function_id);
    }
    return cursor.id;
  };

  const rolled = new Map();
  // Per-rolled-row, per-report contribution. Sub-functions of the same
  // top-level parent merge into one entry per (process). Used for every
  // cell's drill-through (Processes / Work / Cost / Savings / Auto% /
  // Systems all read from the same per-process list).
  const rolledProcs = new Map(); // rootId -> Map<reportId, entry>

  for (const b of buckets.values()) {
    const rootId = topLevelOf(b.function_id);
    if (!rolled.has(rootId)) {
      const root = rootId ? funcsById.get(rootId) : null;
      rolled.set(rootId, {
        function_id: rootId,
        name: root?.name || (rootId ? '(orphaned)' : '(unfiled)'),
        processCount: 0,
        stepCount: 0,
        stepMinutes: 0,
        annualCost: 0,
        derivedSavings: 0,
        autoSum: 0, autoCount: 0,
        systemMentions: 0,
        systemKeys: new Set(),
        severity: { low: 0, medium: 0, high: 0, critical: 0 },
      });
      rolledProcs.set(rootId, new Map());
    }
    const r = rolled.get(rootId);
    r.processCount    += b.processCount;
    r.stepCount       += b.stepCount;
    r.stepMinutes     += b.stepMinutes;
    r.annualCost      += b.annualCost;
    r.derivedSavings  += b.derivedSavings;
    r.autoSum         += b.autoSum;
    r.autoCount       += b.autoCount;
    r.systemMentions  += b.systemMentions;
    for (const k of b.systemKeys) r.systemKeys.add(k);
    r.severity.low      += b.severity.low;
    r.severity.medium   += b.severity.medium;
    r.severity.high     += b.severity.high;
    r.severity.critical += b.severity.critical;

    // Merge this leaf's per-process map into the rolled-up parent. A
    // process that touched multiple sub-functions of the same parent
    // collapses into one entry under the parent.
    const leafMap = breakdownByCap.get(b.function_id);
    if (leafMap) {
      const target = rolledProcs.get(rootId);
      for (const [reportId, e] of leafMap.entries()) {
        const cur = target.get(reportId);
        if (!cur) {
          target.set(reportId, {
            ...e,
            systems: new Set(e.systems),
          });
        } else {
          cur.workMinutes += e.workMinutes;
          cur.savings     += e.savings;
          cur.annualCost  += e.annualCost;
          cur.automatableShare = e.automatableShare; // process-level, same value
          for (const s of e.systems) cur.systems.add(s);
        }
      }
    }
  }

  // Convert each (rootId, Map<reportId, entry>) into a sorted array of
  // process contributions for the row's drill-through.
  const processesFor = (rootId) => {
    const m = rolledProcs.get(rootId);
    if (!m) return [];
    return [...m.values()]
      .map((e) => ({
        reportId: e.reportId,
        processName: e.processName,
        annualCost: round2(e.annualCost),
        workMinutes: round2(e.workMinutes),
        savings: round2(e.savings),
        automatableShare: e.automatableShare,
        automationPct: e.automationPct,
        isOwner: e.isOwner,
        systems: [...e.systems].sort(),
      }))
      .sort((a, b) => (b.savings - a.savings) || (b.workMinutes - a.workMinutes) || (a.processName || '').localeCompare(b.processName || ''));
  };

  const rows = [...rolled.values()].map((b) => {
    const processes = processesFor(b.function_id);
    return {
      function_id: b.function_id,
      name: b.name,
      processCount: b.processCount,
      stepCount: b.stepCount,
      stepMinutes: round2(b.stepMinutes),
      annualCost: round2(b.annualCost),
      // potentialSavings is now derived from the flow (step-level
      // automation classifier × cost share). Field name kept for UI
      // back-compat; semantics changed from "stored seed value" to
      // "computed from current steps".
      potentialSavings: round2(b.derivedSavings),
      avgAutomationPct: b.autoCount ? round2(b.autoSum / b.autoCount) : null,
      systemMentions: b.systemMentions,
      distinctSystems: b.systemKeys.size,
      severity: b.severity,
      // Per-row drill-through input: every process that contributed to
      // this function's numbers, with all the per-cell metrics each
      // modal needs (workMinutes, annualCost, savings, automation,
      // systems list). The Savings cell still reads `savingsBreakdown`
      // for back-compat — it's a filtered view of `processes`.
      processes,
      savingsBreakdown: processes.filter((p) => p.savings > 0),
    };
  });

  // Sort: filed functions first by annualCost desc, then unfiled last.
  return rows.sort((a, b) => {
    if (a.function_id == null && b.function_id != null) return 1;
    if (b.function_id == null && a.function_id != null) return -1;
    return b.annualCost - a.annualCost;
  });
}

export async function loadFunctionHeatmap(modelId) {
  if (!modelId) return [];
  const sb = requireSupabase();
  if (!sb) return [];
  const headers = getSupabaseHeaders(sb.key);
  try {
    const [reportsResp, capsResp, sysResp] = await Promise.all([
      fetchWithTimeout(
        // Living-workspace migration: total_annual_cost, potential_savings,
        // automation_percentage columns dropped. Cost / savings derive
        // from flow_data step minutes — `computeFunctionHeatmap` already
        // tolerates the columns being absent (defensive `!= null` checks).
        `${sb.url}/rest/v1/processes?operating_model_id=eq.${encodeURIComponent(modelId)}` +
          `&select=id,function_id,flow_data&limit=5000`,
        { method: 'GET', headers },
      ),
      fetchWithTimeout(
        `${sb.url}/rest/v1/functions?operating_model_id=eq.${encodeURIComponent(modelId)}` +
          `&select=id,name,parent_function_id&limit=2000`,
        { method: 'GET', headers },
      ),
      fetchWithTimeout(
        `${sb.url}/rest/v1/process_systems?operating_model_id=eq.${encodeURIComponent(modelId)}` +
          `&select=process_id,system_id,match_key,function_id&limit=10000`,
        { method: 'GET', headers },
      ),
    ]);
    const reports        = reportsResp.ok ? await reportsResp.json() : [];
    const functions   = capsResp.ok    ? await capsResp.json()    : [];
    const processSystems = sysResp.ok     ? await sysResp.json()     : [];

    // Living-workspace migration: derive cost / savings / automation
    // from flow_data so computeFunctionHeatmap's `r.total_annual_cost`
    // etc. references continue to work.
    for (const r of reports) attachDerivedMetrics(r);

    return computeFunctionHeatmap({ reports, processSystems, functions });
  } catch (e) {
    logger.error('loadFunctionHeatmap failed', { modelId, error: e.message });
    return [];
  }
}

// ------------------------------------------------------------------
// Change ROI — predicted vs realised across all changes in the model
// ------------------------------------------------------------------

/**
 * Aggregate changes + their outcomes by metric. Pure — exported for tests.
 *
 * Returns:
 *   {
 *     totals: { changes, applied, live, measured, reverted },
 *     predicted: { time_minutes, cost_pct, fte },        // sum of expected_impact
 *     realised:  [{ metric, samples, totalDelta, ...}]   // grouped by outcome.metric
 *     coverage:  { withOutcomes, withoutOutcomes }       // how many changes have hard data
 *   }
 */
export function computeChangeRoiSummary(changes) {
  const summary = {
    totals: { changes: 0, proposed: 0, applied: 0, live: 0, measured: 0, reverted: 0, rejected: 0, accepted: 0 },
    predicted: { time_minutes: 0, cost_pct_sum: 0, cost_pct_count: 0, fte: 0 },
    realised: new Map(), // metric → { samples, totalDelta, withUnit }
    coverage: { withOutcomes: 0, withoutOutcomes: 0 },
  };

  for (const c of changes || []) {
    summary.totals.changes += 1;
    if (summary.totals[c.state] != null) summary.totals[c.state] += 1;

    const ei = c.expected_impact || {};
    if (ei.time_minutes != null) summary.predicted.time_minutes += Number(ei.time_minutes) || 0;
    if (ei.cost_pct     != null) {
      summary.predicted.cost_pct_sum   += Number(ei.cost_pct) || 0;
      summary.predicted.cost_pct_count += 1;
    }
    if (ei.fte          != null) summary.predicted.fte          += Number(ei.fte)          || 0;

    const outcomes = Array.isArray(c.change_outcomes) ? c.change_outcomes : [];
    if (outcomes.length === 0) {
      summary.coverage.withoutOutcomes += 1;
    } else {
      summary.coverage.withOutcomes += 1;
      for (const o of outcomes) {
        if (!o.metric) continue;
        if (!summary.realised.has(o.metric)) {
          summary.realised.set(o.metric, { metric: o.metric, samples: 0, totalDelta: 0, unit: o.unit || null });
        }
        const r = summary.realised.get(o.metric);
        r.samples += 1;
        r.totalDelta += Number(o.delta) || 0;
        if (!r.unit && o.unit) r.unit = o.unit;
      }
    }
  }

  return {
    totals: summary.totals,
    predicted: {
      time_minutes:    round2(summary.predicted.time_minutes),
      avgCostPct:      summary.predicted.cost_pct_count
        ? round2(summary.predicted.cost_pct_sum / summary.predicted.cost_pct_count) : null,
      fte:             round2(summary.predicted.fte),
    },
    realised: [...summary.realised.values()].map((r) => ({
      metric: r.metric, unit: r.unit,
      samples: r.samples, totalDelta: round2(r.totalDelta),
      avgDelta: round2(r.totalDelta / r.samples),
    })).sort((a, b) => Math.abs(b.totalDelta) - Math.abs(a.totalDelta)),
    coverage: summary.coverage,
  };
}

export async function loadChangeRoiSummary(modelId) {
  if (!modelId) return null;
  const sb = requireSupabase();
  if (!sb) return null;
  try {
    // Living-workspace migration: changes.report_id renamed to process_id,
    // and the FK target table is now `processes`. Filter changes whose
    // process belongs to this operating model. One round-trip with embed.
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/changes?` +
        `select=id,state,expected_impact,process_id,change_outcomes(metric,unit,delta),` +
        `process:process_id(operating_model_id)` +
        `&limit=2000`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    );
    if (!resp.ok) return null;
    const all = await resp.json();
    const filtered = all.filter((c) => c.process?.operating_model_id === modelId);
    return computeChangeRoiSummary(filtered);
  } catch (e) {
    logger.error('loadChangeRoiSummary failed', { modelId, error: e.message });
    return null;
  }
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
