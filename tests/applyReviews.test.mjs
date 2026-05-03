/**
 * Tests for lib/deal-analysis/applyReviews.js
 *
 * Run with: node --test tests/applyReviews.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyReviewsToAnalysis,
  summariseReviewStatus,
} from '../lib/deal-analysis/applyReviews.js';

function f(key, extra = {}) {
  return {
    key,
    title: `Finding ${key}`,
    body: `Body ${key}`,
    severity: 'medium',
    confidence: 0.7,
    impact: [],
    evidence: [],
    recommendations: [],
    ...extra,
  };
}

function review(key, status, extra = {}) {
  return { finding_key: key, status, ...extra };
}

describe('applyReviewsToAnalysis', () => {
  test('returns the result unchanged for non-objects', () => {
    assert.equal(applyReviewsToAnalysis(null, []), null);
    assert.equal(applyReviewsToAnalysis('hi', []), 'hi');
  });

  test('public viewer hides pending, rejected, needs_revision', () => {
    const result = {
      keyFindings: [f('a'), f('b'), f('c'), f('d')],
    };
    const reviews = [
      review('a', 'approved'),
      review('b', 'rejected'),
      review('c', 'needs_revision'),
      // d has no review row - treated as pending
    ];
    const out = applyReviewsToAnalysis(result, reviews, 'public');
    assert.equal(out.keyFindings.length, 1);
    assert.equal(out.keyFindings[0].key, 'a');
  });

  test('editor viewer hides only rejected', () => {
    const result = {
      keyFindings: [f('a'), f('b'), f('c'), f('d')],
    };
    const reviews = [
      review('a', 'approved'),
      review('b', 'rejected'),
      review('c', 'needs_revision'),
    ];
    const out = applyReviewsToAnalysis(result, reviews, 'editor');
    assert.equal(out.keyFindings.length, 3);
    const keys = out.keyFindings.map((f) => f.key).sort();
    assert.deepEqual(keys, ['a', 'c', 'd']);
    // d still gets a _review pending stub
    const d = out.keyFindings.find((f) => f.key === 'd');
    assert.equal(d._review.status, 'pending');
  });

  test('edited title/body override original AI-generated values', () => {
    const result = { keyFindings: [f('x', { title: 'AI title', body: 'AI body' })] };
    const reviews = [review('x', 'approved', {
      edited_title: 'Human title',
      edited_body: 'Human body',
      reviewer_note: 'tightened up',
      decided_by_email: 'r@e.com',
      decided_at: '2026-04-25T12:00Z',
    })];
    const out = applyReviewsToAnalysis(result, reviews, 'public');
    assert.equal(out.keyFindings.length, 1);
    assert.equal(out.keyFindings[0].title, 'Human title');
    assert.equal(out.keyFindings[0].body, 'Human body');
    assert.equal(out.keyFindings[0]._review.status, 'approved');
    assert.equal(out.keyFindings[0]._review.reviewer_note, 'tightened up');
  });

  test('falls back to AI value when edited fields are empty', () => {
    const result = { keyFindings: [f('x', { title: 'AI title', body: 'AI body' })] };
    const reviews = [review('x', 'approved', { edited_title: '', edited_body: null })];
    const out = applyReviewsToAnalysis(result, reviews, 'public');
    assert.equal(out.keyFindings[0].title, 'AI title');
    assert.equal(out.keyFindings[0].body, 'AI body');
  });

  test('walks every finding-bearing path', () => {
    const result = {
      mergeRecommendations: [f('m1')],
      opportunities:        [f('o1')],
      integrationRisks:     [f('i1')],
      risks:                [f('r1')],
      redFlags:             [f('f1')],
      keyFindings:          [f('k1')],
      technologyLandscape:  [f('t1')],
      operationalFootprint: [f('op1')],
      organisation:         [f('org1')],
    };
    const reviews = Object.values({}); // no decisions yet
    const out = applyReviewsToAnalysis(result, reviews, 'editor');
    for (const path of Object.keys(result)) {
      assert.equal(out[path].length, 1, `${path} should retain its finding in editor mode`);
    }
    const outPublic = applyReviewsToAnalysis(result, reviews, 'public');
    for (const path of Object.keys(result)) {
      assert.equal(outPublic[path].length, 0, `${path} should be filtered out for public viewer when pending`);
    }
  });

  test('singleton executiveSummary path: hidden when pending in public mode, shown approved', () => {
    const result = { executiveSummary: f('summary-key') };
    const noReviews = applyReviewsToAnalysis(result, [], 'public');
    assert.equal(noReviews.executiveSummary, null);

    const approved = applyReviewsToAnalysis(result, [review('summary-key', 'approved')], 'public');
    assert.equal(approved.executiveSummary?.key, 'summary-key');
    assert.equal(approved.executiveSummary._review.status, 'approved');

    // Editor mode shows pending
    const editor = applyReviewsToAnalysis(result, [], 'editor');
    assert.equal(editor.executiveSummary?.key, 'summary-key');
    assert.equal(editor.executiveSummary._review.status, 'pending');
  });

  test('preserves non-finding fields on the result (e.g. summary, proposedProcess)', () => {
    const result = {
      summary: '2 sentence overview',
      proposedProcess: [{ stepNumber: 1, name: 'Receive' }],
      keyFindings: [f('a')],
    };
    const out = applyReviewsToAnalysis(result, [review('a', 'approved')], 'public');
    assert.equal(out.summary, '2 sentence overview');
    assert.deepEqual(out.proposedProcess, [{ stepNumber: 1, name: 'Receive' }]);
  });
});

describe('summariseReviewStatus', () => {
  test('counts findings by status (no review = pending)', () => {
    const result = {
      keyFindings: [f('a'), f('b'), f('c'), f('d'), f('e')],
      executiveSummary: f('s'),
    };
    const reviews = [
      review('a', 'approved'),
      review('b', 'approved'),
      review('c', 'rejected'),
      review('d', 'needs_revision'),
      review('s', 'approved'),
      // e has no review
    ];
    const counts = summariseReviewStatus(result, reviews);
    assert.equal(counts.total, 6);
    assert.equal(counts.approved, 3);
    assert.equal(counts.pending, 1);
    assert.equal(counts.rejected, 1);
    assert.equal(counts.needs_revision, 1);
  });

  test('handles missing result + reviews gracefully', () => {
    const counts = summariseReviewStatus(null, null);
    assert.deepEqual(counts, { approved: 0, pending: 0, rejected: 0, needs_revision: 0, total: 0 });
  });
});
