/**
 * Tests for Phase 5 intake plumbing:
 *   - SendDiagnosticReportInputSchema accepts the new optional anchor fields
 *   - the path-prefix algorithm used by CapabilityIntakePicker (re-implemented
 *     here so the spec is locked in even though the component itself is React)
 *
 * Run: node --test tests/capabilityIntake.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/* ── Schema accepts the new optional anchors ─────────────────── */

describe('SendDiagnosticReportInputSchema — workspace anchors', () => {
  let SendDiagnosticReportInputSchema;
  test('schema imports', async () => {
    ({ SendDiagnosticReportInputSchema } = await import('../lib/ai-schemas.js'));
    assert.ok(SendDiagnosticReportInputSchema);
  });

  test('accepts operatingModelId + functionId as uuids', () => {
    // Zod v4's .uuid() validates the version+variant nibbles, not just the
    // shape. Use proper v4 UUIDs: third group starts with 4, fourth with 8/9/a/b.
    const ok = SendDiagnosticReportInputSchema.safeParse({
      operatingModelId: '11111111-1111-4111-8111-111111111111',
      functionId: '22222222-2222-4222-9222-222222222222',
    });
    assert.equal(ok.success, true);
  });

  test('accepts null/undefined for both', () => {
    assert.equal(SendDiagnosticReportInputSchema.safeParse({}).success, true);
    assert.equal(SendDiagnosticReportInputSchema.safeParse({
      operatingModelId: null, functionId: null,
    }).success, true);
  });

  test('rejects non-uuid strings', () => {
    const bad = SendDiagnosticReportInputSchema.safeParse({ operatingModelId: 'not-a-uuid' });
    assert.equal(bad.success, false);
  });
});

/* ── Capability path-prefix algorithm (locked in) ──────────── */

// Inline copy of the pathFor logic from CapabilityIntakePicker. KEEP IN
// SYNC with components/diagnostic/CapabilityIntakePicker.jsx.
function pathPrefixed(flat) {
  if (!Array.isArray(flat) || !flat.length) return [];
  const byId = new Map(flat.map((c) => [c.id, c]));
  const pathFor = (id, seen = new Set()) => {
    const c = byId.get(id);
    if (!c || seen.has(id)) return [];
    seen.add(id);
    if (!c.parent_function_id) return [c.name];
    return [...pathFor(c.parent_function_id, seen), c.name];
  };
  return flat.map((c) => ({ id: c.id, label: pathFor(c.id).join(' / ') }));
}

describe('function path-prefix labels', () => {
  test('top-level functions have just the name', () => {
    const out = pathPrefixed([{ id: 'fin', name: 'Finance', parent_function_id: null }]);
    assert.deepEqual(out, [{ id: 'fin', label: 'Finance' }]);
  });

  test('nested functions show "Parent / Child"', () => {
    const out = pathPrefixed([
      { id: 'fin', name: 'Finance', parent_function_id: null },
      { id: 'ar',  name: 'AR',      parent_function_id: 'fin' },
      { id: 'cash', name: 'Cash collection', parent_function_id: 'ar' },
    ]);
    const byId = Object.fromEntries(out.map((r) => [r.id, r.label]));
    assert.equal(byId.fin,  'Finance');
    assert.equal(byId.ar,   'Finance / AR');
    assert.equal(byId.cash, 'Finance / AR / Cash collection');
  });

  test('orphaned children (parent missing) show as their own root', () => {
    const out = pathPrefixed([
      { id: 'orphan', name: 'Orphaned', parent_function_id: 'gone' },
    ]);
    assert.equal(out[0].label, 'Orphaned');
  });

  test('handles a cycle without infinite recursion', () => {
    const out = pathPrefixed([
      { id: 'a', name: 'A', parent_function_id: 'b' },
      { id: 'b', name: 'B', parent_function_id: 'a' },
    ]);
    // The "seen" guard breaks the cycle; both walks terminate.
    assert.equal(out.length, 2);
    assert.ok(out.every((r) => typeof r.label === 'string' && r.label.length > 0));
  });
});
