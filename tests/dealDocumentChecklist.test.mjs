/**
 * Tests for lib/dealDocumentChecklist.js — matching algorithm precision,
 * the false-positive-on-empty-categories fix (#12).
 *
 * Run: node --test tests/dealDocumentChecklist.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { matchChecklist, getChecklistForDealType } from '../lib/dealDocumentChecklist.js';

describe('matchChecklist', () => {
  test('matches a doc when both keyword and category align', () => {
    const docs = [{ id: 'd1', filename: 'audited-accounts-2025.pdf', category: 'Financial' }];
    const result = matchChecklist(docs, 'ma');
    const item = result.find((i) => i.id === 'audited_accounts');
    assert.ok(item);
    assert.equal(item.matched.length, 1);
    assert.equal(item.matched[0].id, 'd1');
  });

  test('does NOT match when keyword hits but category is wrong', () => {
    const docs = [{ id: 'd1', filename: 'audited-accounts-2025.pdf', category: 'HR' }];
    const result = matchChecklist(docs, 'ma');
    const item = result.find((i) => i.id === 'audited_accounts');
    assert.ok(item);
    assert.equal(item.matched.length, 0,
      'keyword alone must not satisfy a category-bound checklist item');
  });

  test('does NOT match when category aligns but keyword is missing', () => {
    const docs = [{ id: 'd1', filename: 'random-thing.pdf', category: 'Financial' }];
    const result = matchChecklist(docs, 'ma');
    const item = result.find((i) => i.id === 'audited_accounts');
    assert.ok(item);
    assert.equal(item.matched.length, 0,
      'category alone must not satisfy a keyword-bound item — would be too coarse');
  });

  test('M&A template includes CIM + change-of-control', () => {
    const list = getChecklistForDealType('ma');
    const ids = new Set(list.map((i) => i.id));
    assert.ok(ids.has('cim'));
    assert.ok(ids.has('change_control'));
    assert.ok(ids.has('articles')); // common item
  });

  test('PE roll-up template includes platform_summary + add-on pipeline', () => {
    const list = getChecklistForDealType('pe_rollup');
    const ids = new Set(list.map((i) => i.id));
    assert.ok(ids.has('platform_summary'));
    assert.ok(ids.has('addon_pipeline'));
  });

  test('unknown deal type falls back to common items', () => {
    const list = getChecklistForDealType('not_a_real_type');
    assert.ok(list.length > 0);
    const ids = new Set(list.map((i) => i.id));
    assert.ok(ids.has('articles'));
    assert.ok(!ids.has('cim'), 'M&A-only items should not appear in the fallback');
  });
});
