/**
 * Tests for lib/operatingModel/repo.js
 *
 * Run: node --test tests/operatingModelRepo.test.mjs
 *
 * Pure helpers (nestFunctions, computeModelRollup) tested without fetch.
 * Write paths fetch-stubbed.
 */

import { test, describe, beforeEach, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';

const realFetch = global.fetch;
let repo;

before(async () => {
  process.env.SUPABASE_URL = 'https://stub.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-key';
  repo = await import('../lib/operatingModel/repo.js');
});

afterEach(() => { global.fetch = realFetch; });

/* ── nestFunctions (pure) ────────────────────────────────────── */

describe('nestFunctions', () => {
  test('returns [] for empty / non-array input', () => {
    assert.deepEqual(repo.nestFunctions([]), []);
    assert.deepEqual(repo.nestFunctions(null), []);
    assert.deepEqual(repo.nestFunctions(undefined), []);
  });

  test('keeps top-level functions at the root and nests children', () => {
    const flat = [
      { id: 'finance', name: 'Finance', parent_function_id: null },
      { id: 'ar',      name: 'AR',      parent_function_id: 'finance' },
      { id: 'cash',    name: 'Cash collection', parent_function_id: 'ar' },
      { id: 'ops',     name: 'Operations', parent_function_id: null },
    ];
    const tree = repo.nestFunctions(flat);
    assert.equal(tree.length, 2);
    const finance = tree.find((n) => n.id === 'finance');
    assert.equal(finance.children.length, 1);
    assert.equal(finance.children[0].id, 'ar');
    assert.equal(finance.children[0].children.length, 1);
    assert.equal(finance.children[0].children[0].id, 'cash');
    const ops = tree.find((n) => n.id === 'ops');
    assert.equal(ops.children.length, 0);
  });

  test('orphaned children (parent missing from input) bubble up to roots', () => {
    const flat = [
      { id: 'orphan', name: 'Orphaned', parent_function_id: 'missing' },
    ];
    const tree = repo.nestFunctions(flat);
    assert.equal(tree.length, 1);
    assert.equal(tree[0].id, 'orphan');
  });
});

/* ── computeModelRollup (pure) ─────────────────────────────────── */

describe('computeModelRollup', () => {
  test('returns zero totals for empty input', () => {
    const r = repo.computeModelRollup({ reports: [], roles: [], caps: [] });
    assert.equal(r.totals.processes, 0);
    assert.equal(r.totals.fte, 0);
    assert.equal(r.totals.annualCost, 0);
    assert.equal(r.totals.avgAutomationPct, null);
    assert.deepEqual(r.byFunction, []);
    assert.equal(r.unfiledProcesses, 0);
  });

  test('rolls processes up by function_id, drops cost+savings into the right bucket', () => {
    const caps = [
      { id: 'cap1', name: 'Finance' },
      { id: 'cap2', name: 'Sales' },
    ];
    const reports = [
      { id: 'r1', function_id: 'cap1', total_annual_cost: 100_000, potential_savings: 30_000, automation_percentage: 40 },
      { id: 'r2', function_id: 'cap1', total_annual_cost:  50_000, potential_savings: 10_000, automation_percentage: 60 },
      { id: 'r3', function_id: 'cap2', total_annual_cost: 200_000, potential_savings: 50_000, automation_percentage: 20 },
      { id: 'r4', function_id: null,   total_annual_cost:  10_000, potential_savings:  2_000, automation_percentage: 80 }, // unfiled
    ];
    const r = repo.computeModelRollup({ reports, roles: [], caps });

    assert.equal(r.totals.processes, 4);
    assert.equal(r.totals.annualCost, 360_000);
    assert.equal(r.totals.potentialSavings, 92_000);
    // avg of 40, 60, 20, 80 = 50
    assert.equal(r.totals.avgAutomationPct, 50);

    const finance = r.byFunction.find((b) => b.functionId === 'cap1');
    assert.equal(finance.processCount, 2);
    assert.equal(finance.annualCost, 150_000);
    assert.equal(finance.avgAutomationPct, 50);

    const sales = r.byFunction.find((b) => b.functionId === 'cap2');
    assert.equal(sales.processCount, 1);
    assert.equal(sales.annualCost, 200_000);

    assert.equal(r.unfiledProcesses, 1);
  });

  test('distributes role headcount equally across the role\'s function_ids', () => {
    const caps = [
      { id: 'cap1', name: 'Finance' },
      { id: 'cap2', name: 'Sales' },
      { id: 'cap3', name: 'Ops' },
    ];
    const roles = [
      // 6 FTE split across 2 caps → 3 each
      { id: 'role_a', headcount: 6, function_ids: ['cap1', 'cap2'] },
      // 4 FTE all on cap3
      { id: 'role_b', headcount: 4, function_ids: ['cap3'] },
      // 2 FTE with no functions — counts in totals but not per-bucket
      { id: 'role_c', headcount: 2, function_ids: [] },
    ];
    const r = repo.computeModelRollup({ reports: [], roles, caps });
    assert.equal(r.totals.fte, 12); // 6+4+2

    const finance = r.byFunction.find((b) => b.functionId === 'cap1');
    const sales   = r.byFunction.find((b) => b.functionId === 'cap2');
    const ops     = r.byFunction.find((b) => b.functionId === 'cap3');
    assert.equal(finance.fte, 3);
    assert.equal(sales.fte,   3);
    assert.equal(ops.fte,     4);
  });

  test('step-driven FTE: roles cited on steps apportion headcount by minute share', () => {
    // Account Exec (6 FTE) is cited on steps that do 200m of work in
    // Pipeline + 100m in Sales. Step-driven attribution should land 4
    // FTE on Pipeline and 2 on Sales, ignoring the legacy equal split.
    const caps = [
      { id: 'sales', name: 'Sales' },
      { id: 'pipeline', name: 'Pipeline' },
    ];
    const roles = [
      { id: 'role_ae', headcount: 6, function_ids: ['sales', 'pipeline'] },
    ];
    const reports = [{
      id: 'r1', function_id: 'pipeline',
      diagnostic_data: {
        rawProcesses: [{
          steps: [
            { name: 'Pull report',  workMinutes: 200, roleId: 'role_ae', functionId: 'pipeline' },
            { name: 'Sales review', workMinutes: 100, roleId: 'role_ae', functionId: 'sales' },
          ],
        }],
      },
    }];
    const r = repo.computeModelRollup({ reports, roles, caps });
    const pipe  = r.byFunction.find((b) => b.functionId === 'pipeline');
    const sales = r.byFunction.find((b) => b.functionId === 'sales');
    assert.equal(pipe.fte, 4);  // 6 * (200/300)
    assert.equal(sales.fte, 2); // 6 * (100/300)
  });

  test('step-driven FTE: roles with no step citations fall back to equal split across function_ids', () => {
    const caps = [{ id: 'cap1', name: 'Finance' }, { id: 'cap2', name: 'Sales' }];
    const roles = [
      { id: 'role_unused', headcount: 6, function_ids: ['cap1', 'cap2'] },
    ];
    // No reports cite role_unused → fallback to equal split (3 each)
    const r = repo.computeModelRollup({ reports: [], roles, caps });
    const fin = r.byFunction.find((b) => b.functionId === 'cap1');
    const sal = r.byFunction.find((b) => b.functionId === 'cap2');
    assert.equal(fin.fte, 3);
    assert.equal(sal.fte, 3);
  });

  test('orphaned function_id (cap deleted but report still references it) shows as "(orphaned)"', () => {
    const r = repo.computeModelRollup({
      reports: [{ id: 'r1', function_id: 'gone' }],
      roles: [],
      caps: [],
    });
    const orphan = r.byFunction.find((b) => b.functionId === 'gone');
    assert.equal(orphan.name, '(orphaned)');
    assert.equal(orphan.processCount, 1);
  });

  test('skips automation pct samples where the value is null', () => {
    const r = repo.computeModelRollup({
      reports: [
        { id: 'r1', function_id: 'c', automation_percentage: 80 },
        { id: 'r2', function_id: 'c', automation_percentage: null },
        { id: 'r3', function_id: 'c' /* missing */ },
      ],
      roles: [],
      caps: [{ id: 'c', name: 'X' }],
    });
    assert.equal(r.totals.avgAutomationPct, 80);
    assert.equal(r.byFunction[0].avgAutomationPct, 80);
  });

  test('rolls sub-function buckets up to their top-level parent', () => {
    // Finance has two sub-functions (AR + AP). Reports filed under each
    // sub-function should aggregate into a single Finance row in the
    // heatmap output, with summed cost / processCount.
    const caps = [
      { id: 'fin',     name: 'Finance',             parent_function_id: null  },
      { id: 'fin_ar',  name: 'Accounts Receivable', parent_function_id: 'fin' },
      { id: 'fin_ap',  name: 'Accounts Payable',    parent_function_id: 'fin' },
      { id: 'sales',   name: 'Sales',               parent_function_id: null  },
    ];
    const reports = [
      { id: 'r1', function_id: 'fin_ar', total_annual_cost: 30_000, potential_savings: 5_000 },
      { id: 'r2', function_id: 'fin_ap', total_annual_cost: 20_000, potential_savings: 3_000 },
      { id: 'r3', function_id: 'sales',  total_annual_cost: 50_000, potential_savings: 10_000 },
    ];
    const r = repo.computeModelRollup({ reports, roles: [], caps });

    // Two top-level rows only — no AR / AP sub-rows.
    const filed = r.byFunction.filter((b) => b.functionId);
    assert.equal(filed.length, 2);
    const finance = r.byFunction.find((b) => b.functionId === 'fin');
    assert.equal(finance.processCount, 2);
    assert.equal(finance.annualCost, 50_000);
    assert.equal(finance.potentialSavings, 8_000);
    assert.equal(r.byFunction.some((b) => b.functionId === 'fin_ar'), false);
    assert.equal(r.byFunction.some((b) => b.functionId === 'fin_ap'), false);
  });
});

/* ── createOperatingModel (fetch stubbed) ─────────────────────── */

describe('createOperatingModel', () => {
  test('refuses without organization_id or name', async () => {
    let called = false;
    global.fetch = async () => { called = true; return new Response('{}'); };
    assert.equal(await repo.createOperatingModel({ name: 'x' }), null);
    assert.equal(await repo.createOperatingModel({ organization_id: 'o' }), null);
    assert.equal(called, false);
  });

  test('lower-cases creator email and clamps name length', async () => {
    let captured;
    global.fetch = async (_url, init) => {
      captured = JSON.parse(init.body);
      return new Response(JSON.stringify([{ id: 'm_new' }]), { status: 201 });
    };
    const id = await repo.createOperatingModel({
      organization_id: 'o1',
      name: 'X'.repeat(300),
      created_by_email: 'Owner@Example.COM',
    });
    assert.equal(id, 'm_new');
    assert.equal(captured[0].name.length, 200);
    assert.equal(captured[0].created_by_email, 'owner@example.com');
    assert.equal(captured[0].kind, 'single_entity');
  });
});

/* ── attachProcessToModel (fetch stubbed) ─────────────────────── */

describe('attachProcessToModel', () => {
  test('returns ok without a network call when no fields supplied', async () => {
    let called = false;
    global.fetch = async () => { called = true; return new Response('{}'); };
    const r = await repo.attachProcessToModel({ reportId: 'rpt_1' });
    assert.equal(r.ok, true);
    assert.equal(called, false);
  });

  test('PATCHes only the supplied columns; converts undefined→omit, null→clear', async () => {
    let captured;
    global.fetch = async (url, init) => {
      captured = { url: String(url), body: JSON.parse(init.body) };
      return new Response('', { status: 204 });
    };
    await repo.attachProcessToModel({
      reportId: 'rpt_1',
      operating_model_id: 'm1',
      function_id: null,
      // design_owner_email left undefined → must NOT appear in payload
    });
    assert.match(captured.url, /\/processes\?id=eq\.rpt_1/);
    assert.equal(captured.body.operating_model_id, 'm1');
    assert.equal(captured.body.function_id, null);
    assert.equal('design_owner_email' in captured.body, false);
  });
});

/* ── updateModelRole (fetch stubbed) ──────────────────────── */

describe('updateModelRole', () => {
  test('returns ok with no network call when patch is empty', async () => {
    let called = false;
    global.fetch = async () => { called = true; return new Response('{}'); };
    const r = await repo.updateModelRole('role_1', {});
    assert.equal(r.ok, true);
    assert.equal(called, false);
  });

  test('rejects empty name (would violate NOT NULL)', async () => {
    let called = false;
    global.fetch = async () => { called = true; return new Response('{}'); };
    const r = await repo.updateModelRole('role_1', { name: '   ' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'name_required');
    assert.equal(called, false);
  });

  test('coerces fields: clamps headcount to ≥ 0, lower-cases owner_email', async () => {
    let captured;
    global.fetch = async (_url, init) => {
      captured = JSON.parse(init.body);
      return new Response('', { status: 204 });
    };
    await repo.updateModelRole('role_1', {
      name: 'Operations Manager',
      headcount: -5,
      owner_email: 'Boss@Example.COM',
      function_ids: ['cap_1'],
    });
    assert.equal(captured.headcount, 0);
    assert.equal(captured.owner_email, 'boss@example.com');
    assert.deepEqual(captured.function_ids, ['cap_1']);
  });

  test('drops fields not in the allowlist', async () => {
    let captured;
    global.fetch = async (_url, init) => {
      captured = JSON.parse(init.body);
      return new Response('', { status: 204 });
    };
    await repo.updateModelRole('role_1', {
      name: 'X',
      operating_model_id: 'should_not_be_writable',
      id: 'should_not_be_writable',
    });
    assert.equal('operating_model_id' in captured, false);
    assert.equal('id' in captured, false);
  });
});

/* ── updateModelSystem (fetch stubbed) ────────────────────── */

describe('updateModelSystem', () => {
  test('coerces invalid layer to "other"', async () => {
    let captured;
    global.fetch = async (_url, init) => {
      captured = JSON.parse(init.body);
      return new Response('', { status: 204 });
    };
    await repo.updateModelSystem('sys_1', { name: 'X', layer: 'not-a-layer' });
    assert.equal(captured.layer, 'other');
  });

  test('keeps valid layer values', async () => {
    let captured;
    global.fetch = async (_url, init) => {
      captured = JSON.parse(init.body);
      return new Response('', { status: 204 });
    };
    await repo.updateModelSystem('sys_1', { name: 'X', layer: 'system_of_record' });
    assert.equal(captured.layer, 'system_of_record');
  });

  test('rejects empty name', async () => {
    let called = false;
    global.fetch = async () => { called = true; return new Response('{}'); };
    const r = await repo.updateModelSystem('sys_1', { name: '' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'name_required');
    assert.equal(called, false);
  });
});

/* ── deleteModelRole / deleteModelSystem (fetch stubbed) ─── */

describe('deleteModelRole / deleteModelSystem', () => {
  test('both DELETE the right URL and return ok', async () => {
    const calls = [];
    global.fetch = async (url, init) => {
      calls.push({ url: String(url), method: init?.method });
      // PostgREST DELETEs return 204 No Content in real life, but Node's
      // undici Response refuses to construct a 204 in tests. Use 200 +
      // empty body — repo.deleteModel* checks `resp.ok` (true for 200).
      return new Response('', { status: 200 });
    };
    assert.equal((await repo.deleteModelRole('role_1')).ok, true);
    assert.equal((await repo.deleteModelSystem('sys_1')).ok, true);
    assert.match(calls[0].url, /\/model_roles\?id=eq\.role_1/);
    assert.equal(calls[0].method, 'DELETE');
    assert.match(calls[1].url, /\/model_systems\?id=eq\.sys_1/);
    assert.equal(calls[1].method, 'DELETE');
  });

  test('refuse without an id', async () => {
    let called = false;
    global.fetch = async () => { called = true; return new Response('{}'); };
    assert.equal((await repo.deleteModelRole(null)).ok, false);
    assert.equal((await repo.deleteModelSystem(null)).ok, false);
    assert.equal(called, false);
  });
});

/* ── promoteTargetToCurrent (fetch stubbed) ─────────────────── */

describe('promoteTargetToCurrent', () => {
  test('refuses when no target_data is set', async () => {
    global.fetch = async () => new Response(JSON.stringify([
      { id: 'rpt_1', diagnostic_data: { name: 'old' }, target_data: null, state_kind: 'current_only' },
    ]), { status: 200 });
    const r = await repo.promoteTargetToCurrent({ reportId: 'rpt_1' });
    assert.equal(r.ok, false);
  });

  test('returns gone:true after the living-workspace migration (target_data column dropped)', async () => {
    // Pre-migration this would copy target_data into diagnostic_data and
    // record a changes row. Post-migration it's a stub that logs and
    // returns { ok: false, gone: true } — kept only so legacy callers
    // don't crash.
    let touched = false;
    global.fetch = async () => { touched = true; return new Response('', { status: 200 }); };
    const r = await repo.promoteTargetToCurrent({ reportId: 'rpt_1', actor_email: 'analyst@example.com' });
    assert.equal(r.ok, false);
    assert.equal(r.gone, true);
    assert.equal(touched, false, 'no network calls — pure stub');
  });

});
