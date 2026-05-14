/**
 * Tests for lib/changes/canvasMutations.js — the agent-action →
 * changes-row mapper that powers the relational changelog on every
 * canvas mutation.
 *
 * Run: node --test tests/canvasMutations.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { actionToChangeRow, actionsToChangeRows } from '../lib/changes/canvasMutations.js';

const CTX = { processId: 'rpt_1', actorEmail: 'jane@example.com', agentName: 'chat' };

describe('actionToChangeRow', () => {
  test('returns null for non-mutating actions', () => {
    assert.equal(actionToChangeRow({ name: 'get_bottlenecks', input: {} }, CTX), null);
    assert.equal(actionToChangeRow({ name: 'highlight_step', input: { stepNumber: 3 } }, CTX), null);
    assert.equal(actionToChangeRow({ name: 'open_process', input: { reportId: 'x' } }, CTX), null);
  });

  test('returns null for garbage input', () => {
    assert.equal(actionToChangeRow(null, CTX), null);
    assert.equal(actionToChangeRow({}, CTX), null);
    assert.equal(actionToChangeRow({ name: 123 }, CTX), null);
  });

  test('add_step → process_step / added with breadcrumb fields', () => {
    const row = actionToChangeRow(
      { name: 'add_step', input: { stepNumber: 3, stepName: 'Validate' } },
      CTX,
    );
    assert.equal(row.subject_type, 'process_step');
    assert.equal(row.kind, 'added');
    assert.equal(row.state, 'applied');
    assert.equal(row.process_id, 'rpt_1');
    assert.equal(row.actor_email, 'jane@example.com');
    assert.equal(row.agent_name, 'chat');
    assert.deepEqual(row.subject_ref, { stepNumber: 3, stepName: 'Validate' });
  });

  test('update_step → process_step / modified', () => {
    const row = actionToChangeRow(
      { name: 'update_step', input: { stepNumber: 5, stepName: 'Renamed' } },
      CTX,
    );
    assert.equal(row.subject_type, 'process_step');
    assert.equal(row.kind, 'modified');
    assert.deepEqual(row.subject_ref, { stepNumber: 5, stepName: 'Renamed' });
  });

  test('remove_step → process_step / removed', () => {
    const row = actionToChangeRow(
      { name: 'remove_step', input: { stepNumber: 2 } },
      CTX,
    );
    assert.equal(row.kind, 'removed');
    assert.deepEqual(row.subject_ref, { stepNumber: 2 });
  });

  test('reorder_step → process_step / reordered', () => {
    const row = actionToChangeRow(
      { name: 'reorder_step', input: { stepNumber: 3 } },
      CTX,
    );
    assert.equal(row.kind, 'reordered');
  });

  test('set_handoff → handoff / modified with from/to/method', () => {
    const row = actionToChangeRow(
      { name: 'set_handoff', input: { fromStep: 2, toStep: 3, method: 'email', clarity: 'unclear' } },
      CTX,
    );
    assert.equal(row.subject_type, 'handoff');
    assert.equal(row.kind, 'modified');
    assert.deepEqual(row.subject_ref, { fromStep: 2, toStep: 3, method: 'email', clarity: 'unclear' });
  });

  test('set_cost_input → cost_input', () => {
    const row = actionToChangeRow(
      { name: 'set_cost_input', input: { field: 'hoursPerInstance', value: 6 } },
      CTX,
    );
    assert.equal(row.subject_type, 'cost_input');
    assert.deepEqual(row.subject_ref, { field: 'hoursPerInstance', value: 6 });
  });

  test('set_process_name → process / modified', () => {
    const row = actionToChangeRow(
      { name: 'set_process_name', input: { name: 'Order to cash' } },
      CTX,
    );
    assert.equal(row.subject_type, 'process');
    assert.equal(row.kind, 'modified');
    assert.equal(row.subject_ref.name, 'Order to cash');
  });

  test('branch + checklist + system step actions all land on process_step', () => {
    const actions = [
      'set_branch_target', 'set_branch_probability', 'set_branch_label',
      'add_branch', 'remove_branch',
      'add_step_system', 'remove_step_system',
      'add_checklist_item', 'toggle_checklist_item', 'remove_checklist_item',
      'add_connector', 'remove_connector', 'redirect_connector',
      'insert_step_between',
    ];
    for (const name of actions) {
      const row = actionToChangeRow({ name, input: { stepNumber: 1 } }, CTX);
      assert.equal(row.subject_type, 'process_step', `${name} should be process_step`);
    }
  });

  test('process-level mutations (replace, bottleneck, frequency, pe_context, depts)', () => {
    const actions = [
      'replace_all_steps', 'set_bottleneck', 'set_frequency_details',
      'set_pe_context', 'add_custom_department', 'remove_custom_department',
      'set_process_definition',
    ];
    for (const name of actions) {
      const row = actionToChangeRow({ name, input: {} }, CTX);
      assert.equal(row.subject_type, 'process', `${name} should be process`);
      assert.equal(row.kind, 'modified');
    }
  });

  test('defaults to actor_kind=agent and agent_name=chat when ctx omits them', () => {
    const row = actionToChangeRow(
      { name: 'add_step', input: { stepNumber: 1 } },
      { processId: 'rpt_2' },
    );
    assert.equal(row.actor_kind, 'agent');
    assert.equal(row.agent_name, 'chat');
    assert.equal(row.actor_email, null);
  });

  test('honours explicit actor_kind=user for direct canvas edits', () => {
    const row = actionToChangeRow(
      { name: 'update_step', input: { stepNumber: 1, stepName: 'X' } },
      { ...CTX, actorKind: 'user', agentName: null },
    );
    assert.equal(row.actor_kind, 'user');
  });
});

describe('actionsToChangeRows (batch)', () => {
  test('returns [] when no processId in ctx', () => {
    const rows = actionsToChangeRows(
      [{ name: 'add_step', input: { stepNumber: 1 } }],
      { actorEmail: 'jane@example.com' },
    );
    assert.deepEqual(rows, []);
  });

  test('returns [] for empty / non-array input', () => {
    assert.deepEqual(actionsToChangeRows([], CTX), []);
    assert.deepEqual(actionsToChangeRows(null, CTX), []);
  });

  test('filters out non-mutating actions in a mixed batch', () => {
    const rows = actionsToChangeRows([
      { name: 'add_step', input: { stepNumber: 1 } },
      { name: 'highlight_step', input: { stepNumber: 1 } },  // skipped
      { name: 'update_step', input: { stepNumber: 1, stepName: 'Y' } },
      { name: 'get_bottlenecks', input: {} },  // skipped
    ], CTX);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].kind, 'added');
    assert.equal(rows[1].kind, 'modified');
  });

  test('preserves order of mutating actions', () => {
    const rows = actionsToChangeRows([
      { name: 'add_step',    input: { stepNumber: 1, stepName: 'A' } },
      { name: 'remove_step', input: { stepNumber: 5 } },
      { name: 'reorder_step', input: { stepNumber: 2 } },
    ], CTX);
    assert.equal(rows.map((r) => r.kind).join(','), 'added,removed,reordered');
  });
});
