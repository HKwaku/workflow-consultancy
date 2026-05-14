/**
 * Tests for lib/processMetrics.js — derived cost / savings / automation.
 *
 * Living-workspace contract: the helper ALWAYS walks the live step data
 * and never trusts a cached summary. The pre-migration cache fields on
 * flow_data.summary / flow_data.automationScore are ignored on purpose
 * — they were submission-time snapshots that go stale the moment the
 * user edits a step. The whole point of the workspace model is that
 * reads reflect the current canvas.
 *
 * Run: node --test tests/processMetrics.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deriveProcessMetrics, attachDerivedMetrics } from '../lib/processMetrics.js';

describe('deriveProcessMetrics — always derives, never trusts cache', () => {
  test('ignores flow_data.summary even when populated; derives from steps', () => {
    const row = {
      flow_data: {
        summary: { totalAnnualCost: 999_999, potentialSavings: 99_999 },
        automationScore: { percentage: 99, grade: 'A' },
        rawProcesses: [{
          costs: { hoursPerInstance: 1, teamSize: 1, annual: 1 },
          steps: [{ name: 'A', workMinutes: 60, isAutomated: false }],
        }],
      },
    };
    const m = deriveProcessMetrics(row);
    // 1h × £50/hr × 1.25 × 1 inst × 1 team = £62.5 → rounds to 63.
    // NOT 999,999 — the cache is ignored.
    assert.equal(m.total_annual_cost, 63);
    assert.notEqual(m.total_annual_cost, 999_999);
    assert.notEqual(m.automation_percentage, 99);
  });

  test('returns zeros when no rawProcesses, regardless of cached summary', () => {
    const row = {
      flow_data: {
        summary: { totalAnnualCost: 1_000_000, potentialSavings: 100_000 },
        automationScore: { percentage: 75, grade: 'B' },
        // No rawProcesses or processes array.
      },
    };
    const m = deriveProcessMetrics(row);
    assert.equal(m.total_annual_cost, 0);
    assert.equal(m.potential_savings, 0);
    assert.equal(m.automation_percentage, null);
    assert.equal(m.automation_grade, 'N/A');
  });

  test('reads from diagnostic_data when flow_data is absent (back-compat)', () => {
    const row = {
      diagnostic_data: {
        rawProcesses: [{
          costs: { hoursPerInstance: 1, teamSize: 1, annual: 100 },
          steps: [{ name: 'A', workMinutes: 60, isAutomated: true }],
        }],
      },
    };
    const m = deriveProcessMetrics(row);
    // Step is automated → eligible-1 / automated-1 → 100%
    assert.equal(m.automation_percentage, 100);
    assert.equal(m.automation_grade, 'A');
  });

  test('accepts a bare flow-data object with rawProcesses', () => {
    const m = deriveProcessMetrics({
      rawProcesses: [{
        costs: { hoursPerInstance: 2, teamSize: 1, annual: 10 },
        steps: [{ name: 'A', workMinutes: 30 }],
      }],
    });
    // 2 × 50 × 1.25 × 10 × 1 = £1,250
    assert.equal(m.total_annual_cost, 1250);
  });
});

describe('deriveProcessMetrics — derivation from rawProcesses', () => {
  test('returns zeros when flow_data is empty', () => {
    const m = deriveProcessMetrics({ flow_data: {} });
    assert.equal(m.total_annual_cost, 0);
    assert.equal(m.potential_savings, 0);
    assert.equal(m.automation_percentage, null);
    assert.equal(m.automation_grade, 'N/A');
  });

  test('derives annual cost from rawProcesses[].costs', () => {
    const row = {
      flow_data: {
        rawProcesses: [{
          processName: 'Invoice processing',
          costs: { hoursPerInstance: 2, teamSize: 2, annual: 50 },
          steps: [
            { name: 'Receive',  department: 'Finance', workMinutes: 15 },
            { name: 'Validate', department: 'Finance', workMinutes: 30 },
          ],
        }],
      },
    };
    const m = deriveProcessMetrics(row);
    // 2h × £50/hr × 1.25 × 50 instances × 2 team = £12,500
    assert.equal(m.total_annual_cost, 12500);
  });

  test('honours per-department rate from costAnalysis.labourRates', () => {
    const row = {
      flow_data: {
        costAnalysis: {
          labourRates: [{ department: 'Finance', rateInput: 100, rateType: 'hourly', utilisation: 1 }],
          blendedRate: 50, onCostMultiplier: 1.25,
        },
        rawProcesses: [{
          costs: { hoursPerInstance: 1, teamSize: 1, annual: 100 },
          steps: [{ name: 'Step 1', department: 'Finance', workMinutes: 60 }],
        }],
      },
    };
    const m = deriveProcessMetrics(row);
    // 1h × £100/hr × 1 utilisation × 100 instances × 1 team = £10,000
    assert.equal(m.total_annual_cost, 10000);
  });

  test('automation percentage counts isAutomated steps over eligible steps', () => {
    const row = {
      flow_data: {
        rawProcesses: [{
          steps: [
            { name: 'A', workMinutes: 10, isAutomated: true  },
            { name: 'B', workMinutes: 10, isAutomated: false },
            { name: 'C', workMinutes: 10, isAutomated: true  },
            { name: 'D', workMinutes: 10, isDecision: true   }, // excluded
            { name: 'E', workMinutes: 10, isMerge:    true   }, // excluded
          ],
        }],
      },
    };
    const m = deriveProcessMetrics(row);
    assert.equal(m.automation_percentage, 67); // 2 of 3 eligible
    assert.equal(m.automation_grade, 'B');
  });

  test('a step edit changes derived totals (the workspace property)', () => {
    // The whole point: edit one step's workMinutes, the totals shift.
    const before = {
      flow_data: {
        rawProcesses: [{
          costs: { hoursPerInstance: 1, teamSize: 1, annual: 100 },
          steps: [
            { name: 'A', workMinutes: 30, isAutomated: false },
            { name: 'B', workMinutes: 30, isAutomated: false },
          ],
        }],
      },
    };
    const after = {
      flow_data: {
        rawProcesses: [{
          costs: { hoursPerInstance: 1, teamSize: 1, annual: 100 },
          steps: [
            { name: 'A', workMinutes: 30, isAutomated: true },  // changed
            { name: 'B', workMinutes: 30, isAutomated: false },
          ],
        }],
      },
    };
    const m1 = deriveProcessMetrics(before);
    const m2 = deriveProcessMetrics(after);
    assert.equal(m1.automation_percentage, 0);
    assert.equal(m2.automation_percentage, 50);
  });
});

describe('attachDerivedMetrics — mutates row in place', () => {
  test('adds the four legacy column keys onto the row from live data', () => {
    const row = {
      id: 'rpt_1',
      flow_data: {
        rawProcesses: [{
          costs: { hoursPerInstance: 1, teamSize: 1, annual: 10 },
          steps: [{ name: 'A', workMinutes: 60, isAutomated: true }],
        }],
      },
    };
    const out = attachDerivedMetrics(row);
    assert.equal(out, row); // same reference
    // 1 × 50 × 1.25 × 10 × 1 = £625
    assert.equal(row.total_annual_cost, 625);
    assert.equal(row.automation_percentage, 100);
    assert.equal(row.automation_grade, 'A');
  });

  test('overwrites any cached summary fields on the row', () => {
    const row = {
      id: 'rpt_1',
      flow_data: {
        summary: { totalAnnualCost: 99 },
        rawProcesses: [{
          costs: { hoursPerInstance: 1, teamSize: 1, annual: 1 },
          steps: [{ name: 'A', workMinutes: 60 }],
        }],
      },
    };
    attachDerivedMetrics(row);
    // 1 × 50 × 1.25 × 1 × 1 = £63 — derived, not the cached 99.
    assert.equal(row.total_annual_cost, 63);
  });

  test('safe on null/undefined input', () => {
    assert.equal(attachDerivedMetrics(null), null);
    assert.equal(attachDerivedMetrics(undefined), undefined);
  });
});

describe('deriveProcessMetrics — input safety', () => {
  test('handles non-object input', () => {
    const m = deriveProcessMetrics(null);
    assert.equal(m.total_annual_cost, 0);
    assert.equal(m.automation_grade, 'N/A');
  });

  test('handles row with no flow_data at all', () => {
    const m = deriveProcessMetrics({ id: 'x' });
    assert.equal(m.total_annual_cost, 0);
  });
});

describe('grade boundaries (derived from live automation %)', () => {
  test('80→A, 60→B, 40→C, 20→D, 0→E', () => {
    const grade = (autoPct) => {
      // Build a flow that yields exactly autoPct: N eligible steps, M automated.
      // For 100→A use 1/1; for 80→A use 4/5; etc. We pick the smallest pair.
      const steps = [];
      const eligible = 10;
      const automated = Math.round((autoPct / 100) * eligible);
      for (let i = 0; i < automated; i++) steps.push({ workMinutes: 1, isAutomated: true });
      for (let i = automated; i < eligible; i++) steps.push({ workMinutes: 1, isAutomated: false });
      return deriveProcessMetrics({
        flow_data: { rawProcesses: [{ steps }] },
      }).automation_grade;
    };
    assert.equal(grade(80), 'A');
    assert.equal(grade(70), 'B');
    assert.equal(grade(60), 'B');
    assert.equal(grade(50), 'C');
    assert.equal(grade(40), 'C');
    assert.equal(grade(30), 'D');
    assert.equal(grade(20), 'D');
    assert.equal(grade(10), 'E');
    assert.equal(grade(0),  'E');
  });
});
