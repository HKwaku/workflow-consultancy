/**
 * Tests for lib/operatingModel/crossProcess.js + processSystems.js
 * pure helpers. Network paths fetch-stubbed where needed.
 *
 * Run: node --test tests/crossProcess.test.mjs
 */

import { test, describe, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const realFetch = global.fetch;
let cp, ps;

before(async () => {
  process.env.SUPABASE_URL = 'https://stub.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-key';
  cp = await import('../lib/operatingModel/crossProcess.js');
  ps = await import('../lib/operatingModel/processSystems.js');
});

afterEach(() => { global.fetch = realFetch; });

/* ── extractSystemRows (pure) ─────────────────────────────────── */

describe('extractSystemRows', () => {
  test('returns [] for falsy / wrong-shape input', () => {
    assert.deepEqual(ps.extractSystemRows({ diagnosticData: null, reportId: 'r1' }), []);
    assert.deepEqual(ps.extractSystemRows({ diagnosticData: 'not an obj', reportId: 'r1' }), []);
    assert.deepEqual(ps.extractSystemRows({ diagnosticData: {}, reportId: 'r1' }), []);
  });

  test('walks rawProcesses[].steps[].systems[] and emits one row per mention', () => {
    const out = ps.extractSystemRows({
      diagnosticData: {
        rawProcesses: [
          { steps: [
            { name: 'Receive PO', systems: ['SAP', 'Email'] },
            { name: 'Approve',    systems: ['SAP'] },
          ] },
          { steps: [{ name: 'Invoice', systems: ['Salesforce'] }] },
        ],
      },
      reportId: 'r1',
      operatingModelId: 'm1',
      functionId: 'cap-fin',
    });

    assert.equal(out.length, 4);
    assert.equal(out[0].process_index, 0);
    assert.equal(out[0].step_index, 0);
    assert.equal(out[0].system_name_raw, 'SAP');
    assert.equal(out[0].step_name, 'Receive PO');
    assert.equal(out[0].operating_model_id, 'm1');
    assert.equal(out[0].function_id, 'cap-fin');

    // second mention on same step
    assert.equal(out[1].step_index, 0);
    assert.equal(out[1].system_name_raw, 'Email');

    // process_index 1 picks up the next process
    assert.equal(out[3].process_index, 1);
    assert.equal(out[3].system_name_raw, 'Salesforce');
  });

  test('skips empty / whitespace / non-string entries', () => {
    const out = ps.extractSystemRows({
      diagnosticData: { rawProcesses: [{ steps: [
        { systems: ['SAP', '', '   ', null, undefined, 42, 'Salesforce'] },
      ] }] },
      reportId: 'r1',
    });
    const names = out.map((r) => r.system_name_raw);
    assert.deepEqual(names, ['SAP', 'Salesforce']);
  });

  test('trims whitespace around system names', () => {
    const out = ps.extractSystemRows({
      diagnosticData: { rawProcesses: [{ steps: [{ systems: ['  SAP  '] }] }] },
      reportId: 'r1',
    });
    assert.equal(out[0].system_name_raw, 'SAP');
  });

  test('honours per-step functionId, falls back to process-level', () => {
    const out = ps.extractSystemRows({
      diagnosticData: { rawProcesses: [{ steps: [
        { name: 'Sales step', systems: ['Salesforce'], functionId: 'cap_sales' },
        { name: 'Finance step', systems: ['NetSuite'], function_id: 'cap_fin' }, // snake_case also accepted
        { name: 'Untagged step', systems: ['Slack'] }, // falls back
      ] }] },
      reportId: 'r1',
      functionId: 'cap_default',
    });
    assert.equal(out[0].function_id, 'cap_sales');
    assert.equal(out[1].function_id, 'cap_fin');
    assert.equal(out[2].function_id, 'cap_default');
  });
});

/* ── computeSystemInventory (pure) ───────────────────────────── */

describe('computeSystemInventory', () => {
  test('empty input → []', () => {
    assert.deepEqual(cp.computeSystemInventory([]), []);
    assert.deepEqual(cp.computeSystemInventory(null), []);
  });

  test('groups by system_id when present, by match_key otherwise', () => {
    const rows = [
      { report_id: 'r1', system_id: 's_sf', match_key: 'salesforce', system_name_raw: 'Salesforce', function_id: 'cap_a' },
      { report_id: 'r2', system_id: 's_sf', match_key: 'salesforce', system_name_raw: 'salesforce', function_id: 'cap_a' },
      { report_id: 'r3', system_id: null,   match_key: 'sap',        system_name_raw: 'SAP',        function_id: 'cap_b' },
      { report_id: 'r3', system_id: null,   match_key: 'sap',        system_name_raw: 'SAP',        function_id: 'cap_b' },
    ];
    const inv = cp.computeSystemInventory(rows);
    assert.equal(inv.length, 2);
    const sf = inv.find((s) => s.system_id === 's_sf');
    assert.equal(sf.processCount, 2); // distinct reports
    assert.equal(sf.stepCount, 2);
    const sap = inv.find((s) => s.system_id == null);
    assert.equal(sap.processCount, 1); // both rows on r3
    assert.equal(sap.stepCount, 2);
  });

  test('sorts by processCount desc then name asc', () => {
    const rows = [
      { report_id: 'r1', match_key: 'b', system_name_raw: 'Beta'  },
      { report_id: 'r1', match_key: 'a', system_name_raw: 'Alpha' },
      { report_id: 'r2', match_key: 'a', system_name_raw: 'Alpha' },
    ];
    const inv = cp.computeSystemInventory(rows);
    assert.equal(inv[0].system_name, 'Alpha'); // 2 processes
    assert.equal(inv[1].system_name, 'Beta');  // 1 process
  });

  test('drops rows with empty match_key and no system_id', () => {
    const rows = [
      { report_id: 'r1', match_key: '', system_name_raw: '' },
    ];
    assert.deepEqual(cp.computeSystemInventory(rows), []);
  });
});

/* ── computeFunctionHeatmap (pure) ─────────────────────────── */

describe('computeFunctionHeatmap', () => {
  test('empty inputs → []', () => {
    assert.deepEqual(cp.computeFunctionHeatmap({ reports: [], findings: [], processSystems: [], functions: [] }), []);
  });

  test('groups processes + system mentions by function_id; unfiled bucket for nulls', () => {
    const out = cp.computeFunctionHeatmap({
      reports: [
        { id: 'r1', function_id: 'cap_fin', total_annual_cost: 100_000, automation_percentage: 40 },
        { id: 'r2', function_id: 'cap_fin', total_annual_cost:  50_000, automation_percentage: 60 },
        { id: 'r3', function_id: null,      total_annual_cost:  20_000 },
      ],
      processSystems: [
        { report_id: 'r1', function_id: 'cap_fin', system_id: 'sys_sap',  match_key: 'sap' },
        { report_id: 'r2', function_id: 'cap_fin', system_id: null,        match_key: 'excel' },
        { report_id: 'r2', function_id: 'cap_fin', system_id: 'sys_sap',  match_key: 'sap' },
      ],
      functions: [{ id: 'cap_fin', name: 'Finance' }],
    });

    const fin = out.find((r) => r.function_id === 'cap_fin');
    assert.equal(fin.processCount, 2);
    assert.equal(fin.annualCost, 150_000);
    // potentialSavings is decided-changes only (the report's
    // potential_savings attributed by work-minutes share). These stub
    // reports carry no potential_savings, so it's 0.
    assert.equal(fin.potentialSavings, 0);
    assert.equal(fin.avgAutomationPct, 50);
    assert.equal(fin.systemMentions, 3);
    assert.equal(fin.distinctSystems, 2); // SAP + Excel
    assert.equal(fin.name, 'Finance');

    const unfiled = out.find((r) => r.function_id == null);
    assert.equal(unfiled.processCount, 1);
    assert.equal(unfiled.name, '(unfiled)');
  });

  test('potentialSavings = report decided savings, split by work-minutes share', () => {
    // The report carries a decided-changes savings figure
    // (potential_savings). It's attributed to functions by the same
    // work-minutes share as cost. Both steps are untagged so they fall
    // back to the owner (cap_fin) → all 20k lands on Finance.
    const out = cp.computeFunctionHeatmap({
      reports: [{
        id: 'r1', function_id: 'cap_fin', total_annual_cost: 100_000,
        potential_savings: 20_000,
        diagnostic_data: {
          rawProcesses: [{
            processName: 'Cash collection',
            steps: [
              { name: 'Receive invoice', workMinutes: 60 },
              { name: 'Approve invoice', workMinutes: 60 },
            ],
          }],
        },
      }],
      processSystems: [],
      functions: [{ id: 'cap_fin', name: 'Finance' }],
    });
    const fin = out.find((r) => r.function_id === 'cap_fin');
    assert.equal(fin.potentialSavings, 20_000);
    assert.ok(fin.potentialSavings <= fin.annualCost, 'decided savings within cost here');
    // Drill-through: one breakdown entry pointing back to the process.
    assert.equal(fin.savingsBreakdown.length, 1);
    assert.equal(fin.savingsBreakdown[0].processName, 'Cash collection');
    assert.equal(fin.savingsBreakdown[0].reportId, 'r1');
    assert.equal(fin.savingsBreakdown[0].savings, fin.potentialSavings);
  });

  test('savings = 0 and savingsBreakdown is empty when no step matches the automation classifier', () => {
    // "Coffee break" is intentionally vague enough that the classifier
    // returns null (no opportunity). With no automatable steps the
    // savings figure stays 0 and `savingsBreakdown` is empty (it's
    // filtered to entries with savings > 0). The richer `processes`
    // list still contains the process entry for the Work / Cost cells.
    const out = cp.computeFunctionHeatmap({
      reports: [{
        id: 'r1', function_id: 'cap_fin', total_annual_cost: 50_000,
        diagnostic_data: {
          rawProcesses: [{
            processName: 'Misc tasks',
            steps: [{ name: 'Coffee break', workMinutes: 15 }],
          }],
        },
      }],
      processSystems: [],
      functions: [{ id: 'cap_fin', name: 'Finance' }],
    });
    const fin = out.find((r) => r.function_id === 'cap_fin');
    assert.equal(fin.potentialSavings, 0);
    assert.equal(fin.savingsBreakdown.length, 0);
    // The Work / Cost cells still need the process to drill into.
    assert.equal(fin.processes.length, 1);
    assert.equal(fin.processes[0].processName, 'Misc tasks');
    assert.equal(fin.processes[0].savings, 0);
  });

  test('unfiled bucket sorts to the bottom', () => {
    const out = cp.computeFunctionHeatmap({
      reports: [
        { id: 'r1', function_id: 'cap_a', total_annual_cost: 1 },
        { id: 'r2', function_id: null,     total_annual_cost: 1_000_000 },
      ],
      processSystems: [],
      functions: [{ id: 'cap_a', name: 'A' }],
    });
    assert.equal(out[out.length - 1].function_id, null);
  });

  test('step-weighted attribution: spanning processes credit each function', () => {
    // One process owned by Sales but spans Sales → Ops → Finance via
    // per-step functionId. processCount lands on the owner; stepMinutes
    // attribute work to where it actually happens.
    const out = cp.computeFunctionHeatmap({
      reports: [{
        id: 'r1',
        function_id: 'cap_sales',
        diagnostic_data: {
          rawProcesses: [{ steps: [
            { name: 'Quote',        workMinutes: 30, functionId: 'cap_sales' },
            { name: 'Pick + pack',  workMinutes: 90, functionId: 'cap_ops'   },
            { name: 'Invoice',      workMinutes: 15, functionId: 'cap_fin'   },
            { name: 'Untagged',     workMinutes: 10 }, // falls back to owner
          ] }],
        },
      }],
      processSystems: [],
      functions: [
        { id: 'cap_sales', name: 'Sales' },
        { id: 'cap_ops',   name: 'Ops' },
        { id: 'cap_fin',   name: 'Finance' },
      ],
    });

    const sales = out.find((r) => r.function_id === 'cap_sales');
    const ops   = out.find((r) => r.function_id === 'cap_ops');
    const fin   = out.find((r) => r.function_id === 'cap_fin');

    // Process is owned by Sales — only Sales gets +1 processCount.
    assert.equal(sales.processCount, 1);
    assert.equal(ops.processCount,   0);
    assert.equal(fin.processCount,   0);

    // Step minutes flow to the function the step belongs to. Untagged
    // step (10m) falls back to the owner (Sales) → 30 + 10 = 40.
    assert.equal(sales.stepMinutes, 40);
    assert.equal(ops.stepMinutes,   90);
    assert.equal(fin.stepMinutes,   15);

    assert.equal(sales.stepCount, 2);
    assert.equal(ops.stepCount,   1);
    assert.equal(fin.stepCount,   1);
  });

  test('walks diagnostic_data.processes when rawProcesses is absent', () => {
    const out = cp.computeFunctionHeatmap({
      reports: [{
        id: 'r1', function_id: 'cap_a',
        diagnostic_data: { processes: [{ steps: [
          { workMinutes: 60, functionId: 'cap_b' },
        ] }] },
      }],
      processSystems: [],
      functions: [{ id: 'cap_a', name: 'A' }, { id: 'cap_b', name: 'B' }],
    });
    const b = out.find((r) => r.function_id === 'cap_b');
    assert.equal(b.stepMinutes, 60);
  });
});

/* ── computeChangeRoiSummary (pure) ──────────────────────────── */

describe('computeChangeRoiSummary', () => {
  test('empty → zero totals', () => {
    const r = cp.computeChangeRoiSummary([]);
    assert.equal(r.totals.changes, 0);
    assert.equal(r.predicted.time_minutes, 0);
    assert.deepEqual(r.realised, []);
    assert.equal(r.coverage.withOutcomes, 0);
  });

  test('rolls expected_impact across all changes', () => {
    const r = cp.computeChangeRoiSummary([
      { state: 'applied', expected_impact: { time_minutes: 30, cost_pct: 10, fte: 0.5 } },
      { state: 'live',    expected_impact: { time_minutes: 15, cost_pct: 20 } },
      { state: 'proposed', expected_impact: { fte: 0.25 } },
    ]);
    assert.equal(r.predicted.time_minutes, 45);
    assert.equal(r.predicted.avgCostPct, 15); // (10+20)/2
    assert.equal(r.predicted.fte, 0.75);
    assert.equal(r.totals.applied, 1);
    assert.equal(r.totals.live, 1);
    assert.equal(r.totals.proposed, 1);
  });

  test('groups outcomes by metric and sums delta', () => {
    const r = cp.computeChangeRoiSummary([
      { state: 'measured', change_outcomes: [
        { metric: 'cycle_time_minutes', unit: 'minutes', delta: -120 },
        { metric: 'cycle_time_minutes', unit: 'minutes', delta: -60 },
      ] },
      { state: 'measured', change_outcomes: [
        { metric: 'cost_per_run', unit: 'usd', delta: -50 },
      ] },
      { state: 'applied' /* no outcomes */ },
    ]);
    const byMetric = Object.fromEntries(r.realised.map((row) => [row.metric, row]));
    assert.equal(byMetric.cycle_time_minutes.totalDelta, -180);
    assert.equal(byMetric.cycle_time_minutes.samples, 2);
    assert.equal(byMetric.cycle_time_minutes.avgDelta, -90);
    assert.equal(byMetric.cost_per_run.totalDelta, -50);

    assert.equal(r.coverage.withOutcomes, 2);
    assert.equal(r.coverage.withoutOutcomes, 1);
  });

  test('sorts realised by absolute totalDelta desc', () => {
    const r = cp.computeChangeRoiSummary([
      { change_outcomes: [{ metric: 'small', delta: 5 }] },
      { change_outcomes: [{ metric: 'big',   delta: -500 }] },
      { change_outcomes: [{ metric: 'mid',   delta: 50 }] },
    ]);
    assert.equal(r.realised[0].metric, 'big');
    assert.equal(r.realised[1].metric, 'mid');
    assert.equal(r.realised[2].metric, 'small');
  });
});
