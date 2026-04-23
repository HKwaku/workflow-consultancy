/**
 * Tests for reconcileDecisionBranches
 *
 * Run with: node --test tests/reconcileEdges.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileDecisionBranches } from '../lib/flows/reconcileEdges.js';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Build a minimal step array for testing */
function makeSteps(defs) {
  return defs.map((d, i) => ({
    number: i + 1,
    name: d.name ?? `Step ${i + 1}`,
    department: d.dept ?? 'Operations',
    isDecision: d.isDecision ?? false,
    isMerge: d.isMerge ?? false,
    parallel: d.parallel ?? false,
    branches: d.branches ?? [],
    systems: [],
    contributor: '',
    checklist: [],
  }));
}

// ── Test suite ─────────────────────────────────────────────────────────────

describe('reconcileDecisionBranches', () => {

  // ── Fast-path ────────────────────────────────────────────────────────────

  test('returns same reference when no canvas overrides', () => {
    const steps = makeSteps([
      { name: 'Start' },
      { name: 'Check', isDecision: true, branches: [{ label: 'Yes', target: 'Step 3' }, { label: 'No', target: 'Step 4' }] },
      { name: 'Approve' },
      { name: 'Reject' },
    ]);
    const result = reconcileDecisionBranches(steps, [], []);
    assert.equal(result, steps, 'Should return the exact same array reference');
  });

  test('returns same reference when only non-decision steps exist', () => {
    const steps = makeSteps([{ name: 'A' }, { name: 'B' }, { name: 'C' }]);
    const result = reconcileDecisionBranches(steps, [{ source: 'step-0', target: 'step-2' }], []);
    assert.equal(result, steps, 'Non-decision steps are untouched');
  });

  // ── Deletion ─────────────────────────────────────────────────────────────

  test('removes branch when its auto-generated edge is deleted - "Step N" target format', () => {
    const steps = makeSteps([
      { name: 'Check', isDecision: true, branches: [
        { label: 'Yes', target: 'Step 2' },   // → step idx 1
        { label: 'No',  target: 'Step 3' },   // → step idx 2
      ]},
      { name: 'Approve' },
      { name: 'Reject' },
    ]);
    // Deleting the "Yes" branch edge: e-dec-0-1-0 (stepIdx=0, targetIdx=1, branchIdx=0)
    const result = reconcileDecisionBranches(steps, [], ['e-dec-0-1-0']);
    assert.equal(result[0].branches.length, 1);
    assert.equal(result[0].branches[0].label, 'No');
    assert.equal(result[0].branches[0].target, 'Step 3');
  });

  test('removes branch when its auto-generated edge is deleted - NAME-BASED target (AI upload format)', () => {
    // This is the primary bug fix: AI often sets target to step names, not "Step N"
    const steps = makeSteps([
      { name: 'Check eligibility', isDecision: true, branches: [
        { label: 'Eligible',     target: 'Approve application' },  // → step idx 1
        { label: 'Not eligible', target: 'Reject application' },   // → step idx 2
      ]},
      { name: 'Approve application' },
      { name: 'Reject application' },
    ]);
    // processToReactFlow resolved "Approve application" → idx 1 → edge e-dec-0-1-0
    // User deletes this edge, wants to reconnect it
    const result = reconcileDecisionBranches(steps, [], ['e-dec-0-1-0']);
    assert.equal(result[0].branches.length, 1);
    assert.equal(result[0].branches[0].label, 'Not eligible');
  });

  test('removing a non-existent target index is a no-op', () => {
    const steps = makeSteps([
      { name: 'Check', isDecision: true, branches: [
        { label: 'Yes', target: 'Step 2' },
        { label: 'No',  target: 'Step 3' },
      ]},
      { name: 'B' }, { name: 'C' },
    ]);
    // Deleting target idx 9 (doesn't exist) should leave branches unchanged
    const result = reconcileDecisionBranches(steps, [], ['e-dec-0-9-0']);
    assert.equal(result, steps, 'Should return same reference when nothing changes');
  });

  // ── Addition ─────────────────────────────────────────────────────────────

  test('adds a new branch when user draws a connection from a decision node', () => {
    const steps = makeSteps([
      { name: 'Check', isDecision: true, branches: [
        { label: 'Yes', target: 'Step 2' },
        { label: 'No',  target: 'Step 3' },
      ]},
      { name: 'B' }, { name: 'C' }, { name: 'D' },
    ]);
    // User draws a new connection: step-0 → step-3 (idx 3 = Step 4)
    const result = reconcileDecisionBranches(steps, [{ source: 'step-0', target: 'step-3' }], []);
    assert.equal(result[0].branches.length, 3);
    assert.equal(result[0].branches[2].target, 'Step 4');
    assert.equal(result[0].branches[2].label, '');
  });

  test('does not add duplicate branch if target already present', () => {
    const steps = makeSteps([
      { name: 'Check', isDecision: true, branches: [
        { label: 'Yes', target: 'Step 2' },
        { label: 'No',  target: 'Step 3' },
      ]},
      { name: 'B' }, { name: 'C' },
    ]);
    // Custom edge pointing to step-1 (= "Step 2"), already in branches
    const result = reconcileDecisionBranches(steps, [{ source: 'step-0', target: 'step-1' }], []);
    assert.equal(result, steps, 'Should be a no-op when target already present');
  });

  test('does not add duplicate when existing branch uses name-based target resolving to same idx', () => {
    const steps = makeSteps([
      { name: 'Check', isDecision: true, branches: [
        { label: 'Yes', target: 'Approve application' }, // resolves to idx 1
        { label: 'No',  target: 'Step 3' },
      ]},
      { name: 'Approve application' }, { name: 'C' },
    ]);
    // Custom edge pointing to step-1 (= idx 1), same as "Approve application"
    const result = reconcileDecisionBranches(steps, [{ source: 'step-0', target: 'step-1' }], []);
    assert.equal(result, steps, 'Should not add duplicate even for name-based targets');
  });

  // ── Reconnection (delete + add) ───────────────────────────────────────────

  test('reconnect: replaces a branch target when old edge deleted and new custom edge added', () => {
    const steps = makeSteps([
      { name: 'Check', isDecision: true, branches: [
        { label: 'Approved', target: 'Proceed to payment' },  // → idx 1
        { label: 'Rejected', target: 'Send rejection'     },  // → idx 2
      ]},
      { name: 'Proceed to payment' },
      { name: 'Send rejection' },
      { name: 'Archive' },
    ]);
    // User reconnects: moved "Approved" branch from step-1 to step-3 (Archive)
    // handleReconnect produces: deletedEdges=['e-dec-0-1-0'], customEdges=[{source:'step-0',target:'step-3'}]
    const result = reconcileDecisionBranches(
      steps,
      [{ source: 'step-0', target: 'step-3' }],
      ['e-dec-0-1-0']
    );
    assert.equal(result[0].branches.length, 2);
    const targets = result[0].branches.map(b => b.target);
    assert.ok(targets.includes('Send rejection') || targets.some(t => /Step 3/i.test(t)),
      'Original "Rejected" branch should be kept');
    assert.ok(targets.includes('Step 4'), '"Approved" branch should now point to Step 4 (Archive)');
  });

  test('reconnect works with "Step N" format targets too', () => {
    const steps = makeSteps([
      { name: 'Check', isDecision: true, branches: [
        { label: 'Yes', target: 'Step 2' },  // → idx 1
        { label: 'No',  target: 'Step 3' },  // → idx 2
      ]},
      { name: 'B' }, { name: 'C' }, { name: 'D' },
    ]);
    const result = reconcileDecisionBranches(
      steps,
      [{ source: 'step-0', target: 'step-3' }],
      ['e-dec-0-1-0']
    );
    assert.equal(result[0].branches.length, 2);
    const targets = result[0].branches.map(b => b.target);
    assert.ok(targets.includes('Step 3'), '"No" branch kept');
    assert.ok(targets.includes('Step 4'), '"Yes" reconnected to Step 4');
  });

  // ── Idempotency ───────────────────────────────────────────────────────────

  test('is idempotent: applying twice gives same result as once', () => {
    const steps = makeSteps([
      { name: 'Check', isDecision: true, branches: [
        { label: 'Yes', target: 'Approve' },  // → idx 1
        { label: 'No',  target: 'Reject' },   // → idx 2
      ]},
      { name: 'Approve' }, { name: 'Reject' }, { name: 'Archive' },
    ]);
    const customEdges = [{ source: 'step-0', target: 'step-3' }];
    const deletedEdges = ['e-dec-0-1-0'];

    const once   = reconcileDecisionBranches(steps,  customEdges, deletedEdges);
    const twice  = reconcileDecisionBranches(once,   customEdges, deletedEdges);

    assert.deepEqual(
      twice[0].branches,
      once[0].branches,
      'Second pass should not change anything'
    );
  });

  test('idempotent even when original branches were name-based', () => {
    const steps = makeSteps([
      { name: 'Check', isDecision: true, branches: [
        { label: 'Eligible',     target: 'Approve application' },
        { label: 'Not eligible', target: 'Reject application' },
      ]},
      { name: 'Approve application' },
      { name: 'Reject application' },
      { name: 'Archive' },
    ]);
    const customEdges = [{ source: 'step-0', target: 'step-3' }];
    const deletedEdges = ['e-dec-0-1-0'];

    const once  = reconcileDecisionBranches(steps,  customEdges, deletedEdges);
    const twice = reconcileDecisionBranches(once,   customEdges, deletedEdges);

    assert.deepEqual(twice[0].branches, once[0].branches);
  });

  // ── Multiple decision steps ───────────────────────────────────────────────

  test('only modifies the targeted decision step, not others', () => {
    const steps = makeSteps([
      { name: 'Check A', isDecision: true, branches: [
        { label: 'Yes', target: 'Step 2' },
        { label: 'No',  target: 'Step 3' },
      ]},
      { name: 'B' },
      { name: 'C' },
      { name: 'Check B', isDecision: true, branches: [
        { label: 'Pass', target: 'Step 5' },
        { label: 'Fail', target: 'Step 6' },
      ]},
      { name: 'E' },
      { name: 'F' },
    ]);
    // Delete a branch from step 3 (Check B, idx 3)
    const result = reconcileDecisionBranches(steps, [], ['e-dec-3-4-0']);
    // Check A (idx 0) should be unchanged
    assert.equal(result[0], steps[0], 'Step 0 (Check A) should be same reference');
    // Check B (idx 3) should have one branch removed
    assert.equal(result[3].branches.length, 1);
    assert.equal(result[3].branches[0].label, 'Fail');
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  test('handles empty steps array', () => {
    const result = reconcileDecisionBranches([], [{ source: 'step-0', target: 'step-1' }], ['e-dec-0-1-0']);
    assert.deepEqual(result, []);
  });

  test('ignores custom edges with out-of-bounds target', () => {
    const steps = makeSteps([
      { name: 'Check', isDecision: true, branches: [
        { label: 'Yes', target: 'Step 2' },
        { label: 'No',  target: 'Step 3' },
      ]},
      { name: 'B' }, { name: 'C' },
    ]);
    // step-99 doesn't exist
    const result = reconcileDecisionBranches(steps, [{ source: 'step-0', target: 'step-99' }], []);
    assert.equal(result, steps, 'Out-of-bounds target should be ignored');
  });

  test('ignores deleted edge IDs for non-matching step index', () => {
    const steps = makeSteps([
      { name: 'Check', isDecision: true, branches: [
        { label: 'Yes', target: 'Step 2' },
        { label: 'No',  target: 'Step 3' },
      ]},
      { name: 'B' }, { name: 'C' },
    ]);
    // e-dec-5-1-0 → step 5 doesn't exist
    const result = reconcileDecisionBranches(steps, [], ['e-dec-5-1-0']);
    assert.equal(result, steps, 'Edge for non-existent step should be ignored');
  });

});
