/**
 * Tests for the design-surface diff helper. The component is React, but
 * the diff function is pure — we re-implement the same logic here so the
 * algorithm is locked in, and verify the shape we depend on for rendering.
 *
 * Run: node --test tests/processDesignDiff.test.mjs
 *
 * If/when ProcessDesignSurface.jsx exports `diffSteps` directly, this can
 * import that. For now, this file owns the spec.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Inline copy of the diffSteps algorithm. KEEP IN SYNC with
// components/workspace/ProcessDesignSurface.jsx.
function diffSteps(currentSteps, targetSteps) {
  const cByName = new Map((currentSteps || []).map((s, i) => [s.name || `step-${i}`, { step: s, idx: i }]));
  const tByName = new Map((targetSteps  || []).map((s, i) => [s.name || `step-${i}`, { step: s, idx: i }]));
  const out = [];
  for (const [name, t] of tByName) {
    const c = cByName.get(name);
    if (!c) {
      out.push({ kind: 'added', name, current: null, target: t.step });
    } else {
      const same = JSON.stringify(c.step) === JSON.stringify(t.step);
      out.push({ kind: same ? 'unchanged' : 'modified', name, current: c.step, target: t.step });
    }
  }
  for (const [name, c] of cByName) {
    if (!tByName.has(name)) out.push({ kind: 'removed', name, current: c.step, target: null });
  }
  return out;
}

describe('diffSteps', () => {
  test('returns [] for two empty inputs', () => {
    assert.deepEqual(diffSteps([], []), []);
    assert.deepEqual(diffSteps(null, null), []);
  });

  test('marks only-in-target steps as added (in target order)', () => {
    const out = diffSteps(
      [{ name: 'A' }],
      [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
    );
    assert.equal(out.length, 3);
    assert.equal(out[0].kind, 'unchanged');
    assert.equal(out[1].kind, 'added');
    assert.equal(out[1].name, 'B');
    assert.equal(out[2].kind, 'added');
    assert.equal(out[2].name, 'C');
  });

  test('marks only-in-current steps as removed (after the target rows)', () => {
    const out = diffSteps(
      [{ name: 'A' }, { name: 'B' }],
      [{ name: 'A' }],
    );
    assert.equal(out.length, 2);
    assert.equal(out[0].kind, 'unchanged');
    assert.equal(out[1].kind, 'removed');
    assert.equal(out[1].name, 'B');
  });

  test('detects modification when same name has different fields', () => {
    const out = diffSteps(
      [{ name: 'Approve PO', workMinutes: 10 }],
      [{ name: 'Approve PO', workMinutes: 5 }],
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].kind, 'modified');
  });

  test('treats deeply-equal steps as unchanged', () => {
    const a = { name: 'X', systems: ['SAP'], workMinutes: 30 };
    const b = { name: 'X', systems: ['SAP'], workMinutes: 30 };
    const out = diffSteps([a], [b]);
    assert.equal(out[0].kind, 'unchanged');
  });

  test('handles nameless steps via positional fallback (step-N)', () => {
    const out = diffSteps(
      [{ workMinutes: 10 }, { workMinutes: 20 }],
      [{ workMinutes: 10 }, { workMinutes: 30 }],
    );
    // Both sides have step-0 and step-1 — step-0 unchanged, step-1 modified.
    assert.equal(out.length, 2);
    const byName = Object.fromEntries(out.map((r) => [r.name, r.kind]));
    assert.equal(byName['step-0'], 'unchanged');
    assert.equal(byName['step-1'], 'modified');
  });

  test('preserves target order even when current was reordered', () => {
    const out = diffSteps(
      [{ name: 'C' }, { name: 'A' }, { name: 'B' }],
      [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
    );
    // First three rows are the targets in target order
    assert.equal(out[0].name, 'A');
    assert.equal(out[1].name, 'B');
    assert.equal(out[2].name, 'C');
    // No removals because all three are matched
    assert.equal(out.length, 3);
  });
});
