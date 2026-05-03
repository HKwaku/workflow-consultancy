/**
 * Tests for lib/dealDocumentVisibility.js
 *
 * Run: node --test tests/dealDocumentVisibility.test.mjs
 *
 * The function is the cornerstone of per-party document confidentiality.
 * Mistakes here = a buy-side viewer seeing a sell-side upload. Every branch
 * of canSeeDocument needs explicit coverage.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  canSeeDocument,
  visibilityOptionsForDealType,
  validateVisibilityForDealType,
  visibilityLabel,
  VISIBILITY_VALUES,
} from '../lib/dealDocumentVisibility.js';

const DOC = (visibility) => ({ visibility });

describe('canSeeDocument — owner_only', () => {
  test('only owner can see', () => {
    assert.equal(canSeeDocument({ document: DOC('owner_only'), isOwner: true,  isCollaborator: false, viewerRole: null }), true);
    assert.equal(canSeeDocument({ document: DOC('owner_only'), isOwner: false, isCollaborator: true,  viewerRole: null }), false);
    assert.equal(canSeeDocument({ document: DOC('owner_only'), isOwner: false, isCollaborator: false, viewerRole: 'acquirer' }), false);
  });
});

describe('canSeeDocument — all_editors', () => {
  test('owner / collaborator / any participant can see', () => {
    assert.equal(canSeeDocument({ document: DOC('all_editors'), isOwner: true,  isCollaborator: false, viewerRole: null }), true);
    assert.equal(canSeeDocument({ document: DOC('all_editors'), isOwner: false, isCollaborator: true,  viewerRole: null }), true);
    assert.equal(canSeeDocument({ document: DOC('all_editors'), isOwner: false, isCollaborator: false, viewerRole: 'target' }), true);
  });
  test('outsider with no role sees nothing', () => {
    assert.equal(canSeeDocument({ document: DOC('all_editors'), isOwner: false, isCollaborator: false, viewerRole: null }), false);
  });
});

describe('canSeeDocument — role-scoped (acquirer_only)', () => {
  test('acquirer-role participant CAN see', () => {
    assert.equal(canSeeDocument({ document: DOC('acquirer_only'), isOwner: false, isCollaborator: false, viewerRole: 'acquirer' }), true);
  });
  test('target-role participant CANNOT see (the actual confidentiality test)', () => {
    assert.equal(canSeeDocument({ document: DOC('acquirer_only'), isOwner: false, isCollaborator: false, viewerRole: 'target' }), false);
  });
  test('collaborator without a participant role CANNOT see role-scoped docs', () => {
    assert.equal(canSeeDocument({ document: DOC('acquirer_only'), isOwner: false, isCollaborator: true, viewerRole: null }), false);
  });
  test('owner sees everything regardless of scope', () => {
    assert.equal(canSeeDocument({ document: DOC('acquirer_only'), isOwner: true, isCollaborator: false, viewerRole: null }), true);
  });
});

describe('canSeeDocument — target_only / seller_only / portfolio_only', () => {
  test('target_only mirrors acquirer_only logic', () => {
    assert.equal(canSeeDocument({ document: DOC('target_only'), viewerRole: 'target', isOwner: false, isCollaborator: false }), true);
    assert.equal(canSeeDocument({ document: DOC('target_only'), viewerRole: 'acquirer', isOwner: false, isCollaborator: false }), false);
  });
  test('portfolio_only matches both portfolio_company and platform_company roles', () => {
    assert.equal(canSeeDocument({ document: DOC('portfolio_only'), viewerRole: 'portfolio_company', isOwner: false, isCollaborator: false }), true);
    assert.equal(canSeeDocument({ document: DOC('portfolio_only'), viewerRole: 'platform_company', isOwner: false, isCollaborator: false }), true);
    assert.equal(canSeeDocument({ document: DOC('portfolio_only'), viewerRole: 'target', isOwner: false, isCollaborator: false }), false);
  });
});

describe('canSeeDocument — input safety', () => {
  test('null document → false', () => {
    assert.equal(canSeeDocument({ document: null, isOwner: true }), false);
  });
  test('missing visibility defaults to all_editors', () => {
    assert.equal(canSeeDocument({ document: {}, isOwner: false, isCollaborator: true, viewerRole: null }), true);
  });
});

describe('visibilityOptionsForDealType', () => {
  test('M&A deal → all_editors / acquirer_only / target_only / owner_only', () => {
    const opts = visibilityOptionsForDealType('ma').map((o) => o.value);
    assert.deepEqual(opts, ['all_editors', 'acquirer_only', 'target_only', 'owner_only']);
  });
  test('PE roll-up → no acquirer/target options (those roles do not exist)', () => {
    const opts = visibilityOptionsForDealType('pe_rollup').map((o) => o.value);
    assert.ok(opts.includes('portfolio_only'));
    assert.ok(!opts.includes('acquirer_only'));
    assert.ok(!opts.includes('target_only'));
  });
  test('scaling deal → just all_editors + owner_only', () => {
    const opts = visibilityOptionsForDealType('scaling').map((o) => o.value);
    assert.deepEqual(opts, ['all_editors', 'owner_only']);
  });
  test('unknown deal type → safe default', () => {
    const opts = visibilityOptionsForDealType('weird').map((o) => o.value);
    assert.deepEqual(opts, ['all_editors', 'owner_only']);
  });
});

describe('validateVisibilityForDealType', () => {
  test('rejects unknown visibility values', () => {
    const r = validateVisibilityForDealType('made_up', 'ma');
    assert.equal(r.ok, false);
    assert.match(r.error, /Unknown/);
  });
  test('rejects acquirer_only on a PE deal', () => {
    const r = validateVisibilityForDealType('acquirer_only', 'pe_rollup');
    assert.equal(r.ok, false);
    assert.match(r.error, /not valid/);
  });
  test('accepts all_editors anywhere', () => {
    for (const t of ['ma', 'pe_rollup', 'scaling']) {
      assert.equal(validateVisibilityForDealType('all_editors', t).ok, true);
    }
  });
  test('accepts target_only on M&A', () => {
    assert.equal(validateVisibilityForDealType('target_only', 'ma').ok, true);
  });
});

describe('visibilityLabel + VISIBILITY_VALUES', () => {
  test('every value has a label', () => {
    for (const v of VISIBILITY_VALUES) {
      const label = visibilityLabel(v);
      assert.ok(label && label !== v, `${v} has no human label`);
    }
  });
  test('unknown value falls back to the raw value (no crash)', () => {
    assert.equal(visibilityLabel('made_up'), 'made_up');
  });
});
