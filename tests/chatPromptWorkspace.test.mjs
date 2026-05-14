/**
 * Tests for chatSystemPrompt's workspace_context block.
 *
 * The prompt is one giant string; we assert on the block appearing,
 * containing the expected fields, and being absent when neither field
 * is supplied. Brittle to copy edits, so the assertions only check
 * structural anchors (XML tag + bold names).
 *
 * Run: node --test tests/chatPromptWorkspace.test.mjs
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

let chatSystemPrompt;
let formatWorkspaceTree;

before(async () => {
  ({ chatSystemPrompt, formatWorkspaceTree } = await import('../lib/prompts.js'));
});

const baseArgs = {
  processName: 'Order to cash',
  stepsDesc: '1. Receive PO',
  incompleteBlock: '',
  phaseState: null,
  editingMode: null,
};

describe('chatSystemPrompt — workspace_context block', () => {
  test('omits the block entirely when both fields are null', () => {
    const out = chatSystemPrompt({ ...baseArgs, functionPath: null, operatingModelName: null });
    assert.equal(out.includes('<workspace_context>'), false);
    assert.equal(out.includes('Operating model:'), false);
    assert.equal(out.includes('Capability:'),       false);
  });

  test('renders both labels when both supplied', () => {
    const out = chatSystemPrompt({
      ...baseArgs,
      functionPath: 'Finance / AR / Cash collection',
      operatingModelName: 'Acme operating model',
    });
    assert.match(out, /<workspace_context>/);
    assert.match(out, /Operating model: \*\*Acme operating model\*\*/);
    assert.match(out, /Function: \*\*Finance \/ AR \/ Cash collection\*\*/);
    assert.match(out, /<\/workspace_context>/);
  });

  test('renders model only when function path is missing (unfiled)', () => {
    const out = chatSystemPrompt({
      ...baseArgs,
      functionPath: null,
      operatingModelName: 'Acme operating model',
    });
    assert.match(out, /<workspace_context>/);
    assert.match(out, /Operating model: \*\*Acme operating model\*\*/);
    assert.equal(out.includes('Capability:'), false);
  });

  test('renders function only when model name is missing', () => {
    const out = chatSystemPrompt({
      ...baseArgs,
      functionPath: 'Sales / Pipeline review',
      operatingModelName: null,
    });
    assert.match(out, /<workspace_context>/);
    assert.match(out, /Function: \*\*Sales \/ Pipeline review\*\*/);
    assert.equal(out.includes('Operating model:'), false);
  });

  test('includes the framing instruction so Reina uses the context', () => {
    const out = chatSystemPrompt({
      ...baseArgs,
      functionPath: 'Finance / AR',
    });
    // Don't match the full sentence (brittle to copy edits) — pick a
    // distinctive phrase that locks the intent.
    assert.match(out, /Don't re-ask the user which area this process belongs to/);
  });

  test('block lands BEFORE session_email so per-deal scope still wins precedence', () => {
    const out = chatSystemPrompt({
      ...baseArgs,
      functionPath: 'Operations',
      sessionEmail: 'analyst@example.com',
    });
    const wsAt = out.indexOf('<workspace_context>');
    const seAt = out.indexOf('<session_email>');
    assert.ok(wsAt > -1 && seAt > -1);
    assert.ok(wsAt < seAt, 'workspace_context should appear before session_email');
  });
});

describe('chatSystemPrompt — workspace_tree block', () => {
  test('omits the block entirely when workspaceTree is null', () => {
    const out = chatSystemPrompt({ ...baseArgs, workspaceTree: null });
    assert.equal(out.includes('<workspace_tree>'), false);
  });

  test('renders the supplied tree text inside the workspace_tree tag', () => {
    const out = chatSystemPrompt({
      ...baseArgs,
      workspaceTree: 'Functions:\n- Finance [f-1]\n  - AR [f-2]',
    });
    assert.match(out, /<workspace_tree>/);
    assert.match(out, /Finance \[f-1\]/);
    assert.match(out, /AR \[f-2\]/);
    assert.match(out, /<\/workspace_tree>/);
  });

  test('includes the dedup + parent_function_id instruction', () => {
    const out = chatSystemPrompt({
      ...baseArgs,
      workspaceTree: 'Functions:\n- Finance [f-1]',
    });
    assert.match(out, /parent_function_id/);
    assert.match(out, /Don't propose a function whose name already exists/);
  });
});

describe('formatWorkspaceTree', () => {
  test('returns empty string for null / missing model', () => {
    assert.equal(formatWorkspaceTree(null), '');
    assert.equal(formatWorkspaceTree({}), '');
  });

  test('renders a nested function tree with ids', () => {
    const out = formatWorkspaceTree({
      model: { id: 'm1', name: 'Acme' },
      functions: [
        {
          id: 'f1', name: 'Finance', children: [
            { id: 'f2', name: 'AR', children: [] },
            { id: 'f3', name: 'AP', children: [] },
          ],
        },
      ],
      functionsFlat: [
        { id: 'f1', name: 'Finance' },
        { id: 'f2', name: 'AR' },
        { id: 'f3', name: 'AP' },
      ],
      roles: [],
      systems: [],
    });
    assert.match(out, /- Finance \[f1\]/);
    assert.match(out, /  - AR \[f2\]/);
    assert.match(out, /  - AP \[f3\]/);
  });

  test('renders roles with FTE / owner / function names', () => {
    const out = formatWorkspaceTree({
      model: { id: 'm1', name: 'Acme' },
      functions: [],
      functionsFlat: [{ id: 'f2', name: 'AR' }],
      roles: [{ name: 'AR Manager', headcount: 2, owner_email: 'sarah@acme.com', function_ids: ['f2'] }],
      systems: [],
    });
    assert.match(out, /- AR Manager \(2 FTE · sarah@acme.com · under: AR\)/);
  });

  test('renders systems with vendor / category / layer', () => {
    const out = formatWorkspaceTree({
      model: { id: 'm1', name: 'Acme' },
      functions: [],
      functionsFlat: [],
      roles: [],
      systems: [{ name: 'NetSuite', vendor: 'Oracle', category: 'ERP', layer: 'system_of_record' }],
    });
    assert.match(out, /- NetSuite \(Oracle · ERP · system_of_record\)/);
  });

  test('says "(none yet)" when the workspace is empty', () => {
    const out = formatWorkspaceTree({
      model: { id: 'm1', name: 'Acme' },
      functions: [],
      functionsFlat: [],
      roles: [],
      systems: [],
    });
    assert.match(out, /Functions: \(none yet/);
  });
});
