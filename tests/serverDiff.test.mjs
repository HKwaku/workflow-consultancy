/**
 * Tests for lib/changes/serverDiff.js — the inline-edit diff that
 * /api/update-diagnostic runs at PATCH time to emit 'modified' rows
 * for step fields that changed.
 *
 * Run: node --test tests/serverDiff.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { diffStepsForChangelog } from '../lib/changes/serverDiff.js';

const CTX = { processId: 'rpt_1', actorEmail: 'jane@example.com' };

const proc = (steps) => ({ processName: 'Test', steps });

describe('diffStepsForChangelog', () => {
  test('returns [] when no processId in ctx', () => {
    const out = diffStepsForChangelog([proc([{ number: 1, name: 'A' }])], [proc([{ number: 1, name: 'B' }])], {});
    assert.deepEqual(out, []);
  });

  test('returns [] for two empty inputs', () => {
    assert.deepEqual(diffStepsForChangelog([], [], CTX), []);
    assert.deepEqual(diffStepsForChangelog(null, null, CTX), []);
  });

  test('detects a rename — single modified row with fields=["name"]', () => {
    const oldRaw = [proc([{ number: 1, name: 'Receive', department: 'Finance' }])];
    const newRaw = [proc([{ number: 1, name: 'Intake',  department: 'Finance' }])];
    const rows = diffStepsForChangelog(oldRaw, newRaw, CTX);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'modified');
    assert.equal(rows[0].actor_kind, 'user');
    assert.equal(rows[0].process_id, 'rpt_1');
    assert.deepEqual(rows[0].subject_ref.fields, ['name']);
    assert.equal(rows[0].subject_ref.stepNumber, 1);
    assert.equal(rows[0].subject_ref.stepName, 'Intake');
  });

  test('detects a multi-field edit in one row', () => {
    const oldRaw = [proc([{ number: 2, name: 'A', department: 'Ops', workMinutes: 30 }])];
    const newRaw = [proc([{ number: 2, name: 'A', department: 'Finance', workMinutes: 45 }])];
    const rows = diffStepsForChangelog(oldRaw, newRaw, CTX);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].subject_ref.fields.sort(), ['department', 'workMinutes']);
  });

  test('emits one row per changed step in a multi-step process', () => {
    const oldRaw = [proc([
      { number: 1, name: 'A' },
      { number: 2, name: 'B' },
      { number: 3, name: 'C' },
    ])];
    const newRaw = [proc([
      { number: 1, name: 'A' },         // unchanged
      { number: 2, name: 'B renamed' }, // changed
      { number: 3, name: 'C renamed' }, // changed
    ])];
    const rows = diffStepsForChangelog(oldRaw, newRaw, CTX);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].subject_ref.stepNumber, 2);
    assert.equal(rows[1].subject_ref.stepNumber, 3);
  });

  test('does NOT emit a row for an added step (client handles that)', () => {
    const oldRaw = [proc([{ number: 1, name: 'A' }])];
    const newRaw = [proc([
      { number: 1, name: 'A' },
      { number: 2, name: 'B' }, // newly added
    ])];
    const rows = diffStepsForChangelog(oldRaw, newRaw, CTX);
    assert.deepEqual(rows, []);
  });

  test('does NOT emit a row for a removed step (client handles that)', () => {
    const oldRaw = [proc([
      { number: 1, name: 'A' },
      { number: 2, name: 'B' },
    ])];
    const newRaw = [proc([{ number: 1, name: 'A' }])];
    const rows = diffStepsForChangelog(oldRaw, newRaw, CTX);
    assert.deepEqual(rows, []);
  });

  test('does NOT emit rows when only branch / system / checklist arrays change', () => {
    // Those arrays aren't in SCALAR_FIELDS — dedicated tools cover them.
    const oldRaw = [proc([{ number: 1, name: 'A', branches: [{ label: 'yes' }] }])];
    const newRaw = [proc([{ number: 1, name: 'A', branches: [{ label: 'no' }] }])];
    const rows = diffStepsForChangelog(oldRaw, newRaw, CTX);
    assert.deepEqual(rows, []);
  });

  test('treats "" / undefined / null as equivalent (no spurious edits)', () => {
    const oldRaw = [proc([{ number: 1, name: 'A', department: '' }])];
    const newRaw = [proc([{ number: 1, name: 'A', department: null }])];
    const rows = diffStepsForChangelog(oldRaw, newRaw, CTX);
    assert.deepEqual(rows, []);
  });

  test('catches isDecision / isMerge / parallel boolean flips', () => {
    const oldRaw = [proc([{ number: 1, name: 'A', isDecision: false }])];
    const newRaw = [proc([{ number: 1, name: 'A', isDecision: true  }])];
    const rows = diffStepsForChangelog(oldRaw, newRaw, CTX);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].subject_ref.fields, ['isDecision']);
  });

  test('catches workMinutes / waitMinutes / durationUnit', () => {
    const oldRaw = [proc([{ number: 1, name: 'A', workMinutes: 10, waitMinutes: 5, durationUnit: 'hours' }])];
    const newRaw = [proc([{ number: 1, name: 'A', workMinutes: 15, waitMinutes: 5, durationUnit: 'days' }])];
    const rows = diffStepsForChangelog(oldRaw, newRaw, CTX);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].subject_ref.fields.sort(), ['durationUnit', 'workMinutes']);
  });

  test('catches workspace-anchor edits: roleId / functionId / capabilityId', () => {
    const oldRaw = [proc([{ number: 1, name: 'A', roleId: 'r1', functionId: null }])];
    const newRaw = [proc([{ number: 1, name: 'A', roleId: 'r2', functionId: 'f1' }])];
    const rows = diffStepsForChangelog(oldRaw, newRaw, CTX);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].subject_ref.fields.sort(), ['functionId', 'roleId']);
  });

  test('walks multiple rawProcesses entries independently', () => {
    const oldRaw = [
      proc([{ number: 1, name: 'A' }]),
      proc([{ number: 1, name: 'X' }]),
    ];
    const newRaw = [
      proc([{ number: 1, name: 'A' }]),         // process 0 unchanged
      proc([{ number: 1, name: 'X renamed' }]), // process 1 changed
    ];
    const rows = diffStepsForChangelog(oldRaw, newRaw, CTX);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].subject_ref.processIndex, 1);
  });

  test('skips steps without a number field', () => {
    // A step without `number` can't be matched to its old counterpart;
    // diff treats it as absent on the old side → no row emitted.
    const oldRaw = [proc([{ name: 'A' }])];
    const newRaw = [proc([{ name: 'A renamed' }])];
    const rows = diffStepsForChangelog(oldRaw, newRaw, CTX);
    assert.deepEqual(rows, []);
  });

  test('attribution: actor_kind=user, agent_name=null', () => {
    const oldRaw = [proc([{ number: 1, name: 'A' }])];
    const newRaw = [proc([{ number: 1, name: 'B' }])];
    const rows = diffStepsForChangelog(oldRaw, newRaw, CTX);
    assert.equal(rows[0].actor_kind, 'user');
    assert.equal(rows[0].agent_name, null);
    assert.equal(rows[0].state, 'applied');
  });
});
