/**
 * Tests for the new catalogue helpers added with the multi-vendor
 * expansion: suggestedModelIdForPhase, userPickableIds, vendor field.
 *
 * Run: node --test tests/modelCatalogueHelpers.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  KNOWN_MODELS,
  suggestedModelIdForPhase,
  userPickableIds,
  publicCatalogue,
} from '../lib/agents/modelCatalogue.js';

const ANTHROPIC_OPUS  = 'claude-opus-4-7';
const ANTHROPIC_SON   = 'claude-sonnet-4-6';
const ANTHROPIC_HAIKU = 'claude-haiku-4-5-20251001';
const OPENAI_FAST     = 'gpt-5.4-nano';

describe('catalogue shape: vendor field', () => {
  test('every entry has a vendor', () => {
    for (const m of KNOWN_MODELS) {
      assert.ok(['anthropic', 'openai'].includes(m.vendor), `${m.id} has bad vendor: ${m.vendor}`);
    }
  });
  test('every entry has an unsupported flag', () => {
    for (const m of KNOWN_MODELS) {
      assert.equal(typeof m.unsupported, 'boolean', `${m.id} missing unsupported flag`);
    }
  });
  test('publicCatalogue exposes vendor + unsupported', () => {
    const cat = publicCatalogue();
    for (const m of cat) {
      assert.ok('vendor' in m);
      assert.ok('unsupported' in m);
    }
  });
});

describe('userPickableIds', () => {
  test('drops unsupported ids', () => {
    const out = userPickableIds([ANTHROPIC_SON, OPENAI_FAST, 'fake-id']);
    assert.equal(out.length, 1);
    assert.equal(out[0], ANTHROPIC_SON);
  });
  test('handles non-array input', () => {
    assert.deepEqual(userPickableIds(null), []);
    assert.deepEqual(userPickableIds('hi'), []);
    assert.deepEqual(userPickableIds([]), []);
  });
});

describe('suggestedModelIdForPhase', () => {
  const allowed = [ANTHROPIC_OPUS, ANTHROPIC_SON, ANTHROPIC_HAIKU];

  test('intake phase → fast tier (Haiku)', () => {
    const id = suggestedModelIdForPhase({ allowed, phase: 'intake' });
    assert.equal(id, ANTHROPIC_HAIKU);
  });
  test('map phase → chat tier (Sonnet)', () => {
    const id = suggestedModelIdForPhase({ allowed, phase: 'map' });
    assert.equal(id, ANTHROPIC_SON);
  });
  test('details/cost/complete → chat tier', () => {
    for (const phase of ['details', 'cost', 'complete']) {
      assert.equal(suggestedModelIdForPhase({ allowed, phase }), ANTHROPIC_SON);
    }
  });
  test('hasAttachments overrides → fast tier', () => {
    const id = suggestedModelIdForPhase({ allowed, phase: 'map', hasAttachments: true });
    assert.equal(id, ANTHROPIC_HAIKU);
  });

  test('falls back when desired tier is missing from allowed', () => {
    // Only Sonnet allowed; intake wants Haiku → falls back to Sonnet
    const id = suggestedModelIdForPhase({ allowed: [ANTHROPIC_SON], phase: 'intake' });
    assert.equal(id, ANTHROPIC_SON);
  });

  test('returns null on empty allowed', () => {
    assert.equal(suggestedModelIdForPhase({ allowed: [], phase: 'map' }), null);
    assert.equal(suggestedModelIdForPhase({ allowed: null, phase: 'map' }), null);
  });
});
