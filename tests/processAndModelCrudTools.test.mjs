/**
 * Tier 1 (process lifecycle) + Tier 2 (operating-model edit/delete)
 * chat tools: registration + executor staging behaviour.
 *
 * The executor never mutates — it validates input and emits a
 * `workspace_proposal` SSE the client confirms. We assert the guard,
 * the validation, and the emitted kind/payload (the contract the
 * Confirm card in DiagnosticWorkspace.jsx maps to a REST call).
 *
 * Run: node --test tests/processAndModelCrudTools.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { __executeToolForTests as executeTool } from '../lib/agents/chat/graph.js';
import { ALL_CHAT_TOOLS, MODEL_AGENT_TOOLS } from '../lib/agents/chat/tools.js';

const NEW_TOOLS = [
  'create_process', 'duplicate_process', 'file_process', 'delete_process',
  'propose_update_function', 'propose_move_function', 'propose_delete_function',
  'propose_update_role', 'propose_delete_role',
  'propose_update_system', 'propose_delete_system',
];

describe('tool registration', () => {
  test('every new tool is in ALL_CHAT_TOOLS and MODEL_AGENT_TOOLS with a valid schema', () => {
    const all = new Map(ALL_CHAT_TOOLS.map((t) => [t.name, t]));
    const model = new Set(MODEL_AGENT_TOOLS.map((t) => t.name));
    for (const name of NEW_TOOLS) {
      const t = all.get(name);
      assert.ok(t, `${name} in ALL_CHAT_TOOLS`);
      assert.ok(model.has(name), `${name} in MODEL_AGENT_TOOLS`);
      assert.equal(t.input_schema.type, 'object', `${name} schema`);
      assert.ok(t.description.length > 20, `${name} described`);
    }
  });

  test('tool names are unique across ALL_CHAT_TOOLS', () => {
    const names = ALL_CHAT_TOOLS.map((t) => t.name);
    assert.equal(names.length, new Set(names).size, 'no duplicate tool names');
  });
});

describe('executor guard: workspace context required', () => {
  for (const name of NEW_TOOLS) {
    test(`${name} refuses without operatingModelId`, async () => {
      const out = await executeTool(name, {}, { session: { email: 'a@b.com' } });
      assert.match(out, /No workspace context/i);
    });
  }
});

describe('staging emits the right workspace_proposal', () => {
  const ctxWith = () => {
    const events = [];
    return {
      events,
      ctx: { operatingModelId: 'm-1', session: { email: 'a@b.com' }, onEmit: (e, p) => events.push({ e, p }) },
    };
  };

  test('create_process → kind create_process, name carried', async () => {
    const { ctx, events } = ctxWith();
    const out = await executeTool('create_process', { name: 'Returns' }, ctx);
    assert.match(out, /Staged/);
    assert.equal(events[0].e, 'workspace_proposal');
    assert.equal(events[0].p.kind, 'create_process');
    assert.equal(events[0].p.payload.name, 'Returns');
    assert.equal(events[0].p.operatingModelId, 'm-1');
  });

  test('create_process requires a name', async () => {
    const { ctx, events } = ctxWith();
    const out = await executeTool('create_process', {}, ctx);
    assert.match(out, /name is required/);
    assert.equal(events.length, 0, 'nothing staged on validation failure');
  });

  test('file_process accepts an explicit null (unfile) and rejects a non-uuid function', async () => {
    const a = ctxWith();
    assert.match(await executeTool('file_process', { process_id: 'p1', function_id: null }, a.ctx), /Staged/);
    assert.equal(a.events[0].p.kind, 'file_process');
    assert.equal(a.events[0].p.payload.function_id, null);

    const b = ctxWith();
    const out = await executeTool('file_process', { process_id: 'p1', function_id: 'not-a-uuid' }, b.ctx);
    assert.match(out, /function_id must be/);
    assert.equal(b.events.length, 0);
  });

  test('propose_move_function rejects self-parent, maps to update_function kind', async () => {
    const FID = '11111111-1111-1111-1111-111111111111';
    const a = ctxWith();
    const bad = await executeTool('propose_move_function',
      { function_id: FID, parent_function_id: FID }, a.ctx);
    assert.match(bad, /cannot be its own parent/);
    assert.equal(a.events.length, 0);

    const b = ctxWith();
    await executeTool('propose_move_function',
      { function_id: FID, parent_function_id: null }, b.ctx);
    assert.equal(b.events[0].p.kind, 'update_function');
    assert.deepEqual(b.events[0].p.payload.patch, { parent_function_id: null });
  });

  test('propose_update_role requires at least one field', async () => {
    const { ctx, events } = ctxWith();
    const out = await executeTool('propose_update_role', { role_id: 'r1' }, ctx);
    assert.match(out, /Nothing to change/);
    assert.equal(events.length, 0);
  });

  test('propose_update_system carries only the supplied patch fields', async () => {
    const { ctx, events } = ctxWith();
    await executeTool('propose_update_system',
      { system_id: 's1', layer: 'system_of_record', bogus: 'x' }, ctx);
    assert.equal(events[0].p.kind, 'update_system');
    assert.deepEqual(events[0].p.payload, { system_id: 's1', patch: { layer: 'system_of_record' } });
  });

  test('delete_* tools stage a destructive proposal with the name echoed', async () => {
    const { ctx, events } = ctxWith();
    await executeTool('propose_delete_function', { function_id: 'f9', function_name: 'Dead fn' }, ctx);
    assert.equal(events[0].p.kind, 'delete_function');
    assert.equal(events[0].p.payload.function_id, 'f9');
    assert.equal(events[0].p.payload.function_name, 'Dead fn');
  });
});
