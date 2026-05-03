/**
 * Tests for lib/deal-analysis/findingsShape.js -> verifyEvidence
 *
 * Run: node --test tests/verifyEvidence.test.mjs
 *
 * The validator is the production replacement for trusting model-emitted
 * citations. It must:
 *   - Drop document_chunk evidence when chunk_id is unknown
 *   - Drop document_chunk evidence when snippet doesn't overlap the chunk
 *   - Pass through process_step / chat_turn / metric kinds (not in scope)
 *   - Drop a finding only when ALL pointers were originally present + invalidated
 *   - Keep findings that legitimately had no evidence to begin with
 *   - Downgrade confidence by 0.2 when any pointer was invalidated
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseFindings, verifyEvidence } from '../lib/deal-analysis/findingsShape.js';

function chunkIndex(rows) {
  const m = new Map();
  for (const r of rows) m.set(r.id, { content: r.content, document_id: r.document_id || 'doc-1' });
  return m;
}

function makeBundle(rawFindings) {
  return normaliseFindings({ keyFindings: rawFindings });
}

describe('verifyEvidence — basics', () => {
  test('returns zero stats for empty bundle', () => {
    const stats = verifyEvidence({ findings: [], perPath: {} }, new Map());
    assert.deepEqual(stats, { droppedFindings: 0, downgradedFindings: 0, droppedEvidence: 0 });
  });

  test('finding with NO evidence stays put', () => {
    const bundle = makeBundle([{ title: 'Finding A', body: 'body', evidence: [] }]);
    const stats = verifyEvidence(bundle, new Map());
    assert.equal(bundle.perPath.keyFindings.length, 1);
    assert.equal(stats.droppedFindings, 0);
  });
});

describe('verifyEvidence — invalid chunk_id', () => {
  test('drops document_chunk evidence whose chunk_id is unknown', () => {
    const bundle = makeBundle([{
      title: 'Finding A',
      body: 'body',
      confidence: 0.8,
      evidence: [
        { kind: 'document_chunk', ref: { chunk_id: 'ghost' }, snippet: 'anything' },
      ],
    }]);
    const stats = verifyEvidence(bundle, new Map());

    // Original-evidence-count was 1, all invalidated -> finding dropped
    assert.equal(bundle.perPath.keyFindings.length, 0);
    assert.equal(stats.droppedFindings, 1);
    assert.equal(stats.droppedEvidence, 1);
  });

  test('keeps finding when one of two pointers is valid; downgrades confidence', () => {
    const idx = chunkIndex([
      { id: 'real-1', content: 'The sky is blue and the grass is green.' },
    ]);
    const bundle = makeBundle([{
      title: 'Finding A',
      body: 'body',
      confidence: 0.9,
      evidence: [
        { kind: 'document_chunk', ref: { chunk_id: 'real-1' }, snippet: 'sky is blue' },
        { kind: 'document_chunk', ref: { chunk_id: 'ghost' }, snippet: 'whatever' },
      ],
    }]);
    const stats = verifyEvidence(bundle, idx);

    assert.equal(bundle.perPath.keyFindings.length, 1);
    const f = bundle.perPath.keyFindings[0];
    assert.equal(f.evidence.length, 1);
    assert.equal(f.evidence[0].ref.chunk_id, 'real-1');
    // Confidence downgraded from 0.9 by 0.2
    assert.equal(f.confidence, 0.7);
    assert.equal(stats.downgradedFindings, 1);
    assert.equal(stats.droppedEvidence, 1);
    assert.equal(stats.droppedFindings, 0);
  });
});

describe('verifyEvidence — snippet matching', () => {
  test('exact substring match: keeps evidence, no downgrade', () => {
    const idx = chunkIndex([
      { id: 'c1', content: 'Total revenue grew from £12M to £18M between FY24 and FY25.' },
    ]);
    const bundle = makeBundle([{
      title: 'Revenue trajectory',
      confidence: 0.85,
      evidence: [
        { kind: 'document_chunk', ref: { chunk_id: 'c1' }, snippet: 'Total revenue grew from £12M to £18M' },
      ],
    }]);
    const stats = verifyEvidence(bundle, idx);
    assert.equal(bundle.perPath.keyFindings[0].evidence.length, 1);
    assert.equal(bundle.perPath.keyFindings[0].confidence, 0.85);
    assert.equal(stats.downgradedFindings, 0);
  });

  test('paraphrased snippet with overlapping 5-grams: keeps evidence', () => {
    const idx = chunkIndex([
      { id: 'c1', content: 'The acquirer maintains five regional offices and one central headquarters in London.' },
    ]);
    const bundle = makeBundle([{
      title: 'Office footprint',
      confidence: 0.8,
      evidence: [
        // Heavily overlapping 5-grams with chunk (>= 60% threshold)
        { kind: 'document_chunk', ref: { chunk_id: 'c1' }, snippet: 'The acquirer maintains five regional offices and one central headquarters in London' },
      ],
    }]);
    const stats = verifyEvidence(bundle, idx);
    assert.equal(bundle.perPath.keyFindings[0].evidence.length, 1);
    assert.equal(stats.downgradedFindings, 0);
  });

  test('snippet with no overlap: drops evidence + downgrades', () => {
    const idx = chunkIndex([
      { id: 'c1', content: 'Headcount stable at 240 over three years.' },
    ]);
    const bundle = makeBundle([{
      title: 'Fabricated claim',
      confidence: 0.9,
      evidence: [
        { kind: 'document_chunk', ref: { chunk_id: 'c1' }, snippet: 'CEO is leaving in Q3 to start a competing firm' },
      ],
    }]);
    const stats = verifyEvidence(bundle, idx);
    // Sole pointer dropped, originally 1 -> finding dropped
    assert.equal(bundle.perPath.keyFindings.length, 0);
    assert.equal(stats.droppedFindings, 1);
    assert.equal(stats.droppedEvidence, 1);
  });

  test('missing snippet: keeps evidence (model gave us a chunk_id without quote)', () => {
    const idx = chunkIndex([{ id: 'c1', content: 'Some content.' }]);
    const bundle = makeBundle([{
      title: 'Cited but unquoted',
      confidence: 0.7,
      evidence: [
        { kind: 'document_chunk', ref: { chunk_id: 'c1' } },  // no snippet
      ],
    }]);
    const stats = verifyEvidence(bundle, idx);
    assert.equal(bundle.perPath.keyFindings[0].evidence.length, 1);
    assert.equal(stats.downgradedFindings, 0);
  });
});

describe('verifyEvidence — non-document_chunk kinds pass through', () => {
  test('process_step + chat_turn + metric are untouched', () => {
    const bundle = makeBundle([{
      title: 'Multi-source finding',
      confidence: 0.8,
      evidence: [
        { kind: 'process_step', ref: { step_index: 4, step_name: 'Approve invoice' } },
        { kind: 'chat_turn',    ref: { message_id: 'msg-1' } },
        { kind: 'metric',       ref: { source: 'cost_analysis', field: 'total' } },
      ],
    }]);
    const stats = verifyEvidence(bundle, new Map());
    assert.equal(bundle.perPath.keyFindings[0].evidence.length, 3);
    assert.equal(stats.droppedEvidence, 0);
    assert.equal(stats.droppedFindings, 0);
  });

  test('mixed valid + non-document evidence: keep all when document is valid', () => {
    const idx = chunkIndex([{ id: 'c1', content: 'Sky is blue.' }]);
    const bundle = makeBundle([{
      title: 'Mixed',
      confidence: 0.85,
      evidence: [
        { kind: 'document_chunk', ref: { chunk_id: 'c1' }, snippet: 'Sky is blue' },
        { kind: 'process_step', ref: { step_index: 1 } },
      ],
    }]);
    verifyEvidence(bundle, idx);
    assert.equal(bundle.perPath.keyFindings[0].evidence.length, 2);
  });
});

describe('verifyEvidence — section coverage', () => {
  test('walks every finding-bearing section path', () => {
    const result = {
      mergeRecommendations: [{ title: 'M1', evidence: [{ kind: 'document_chunk', ref: { chunk_id: 'ghost' } }] }],
      opportunities:        [{ title: 'O1', evidence: [{ kind: 'document_chunk', ref: { chunk_id: 'ghost' } }] }],
      integrationRisks:     [{ title: 'I1', evidence: [{ kind: 'document_chunk', ref: { chunk_id: 'ghost' } }] }],
      risks:                [{ title: 'R1', evidence: [{ kind: 'document_chunk', ref: { chunk_id: 'ghost' } }] }],
      redFlags:             [{ title: 'F1', evidence: [{ kind: 'document_chunk', ref: { chunk_id: 'ghost' } }] }],
      keyFindings:          [{ title: 'K1', evidence: [{ kind: 'document_chunk', ref: { chunk_id: 'ghost' } }] }],
      technologyLandscape:  [{ title: 'T1', evidence: [{ kind: 'document_chunk', ref: { chunk_id: 'ghost' } }] }],
      operationalFootprint: [{ title: 'OP1', evidence: [{ kind: 'document_chunk', ref: { chunk_id: 'ghost' } }] }],
      organisation:         [{ title: 'ORG1', evidence: [{ kind: 'document_chunk', ref: { chunk_id: 'ghost' } }] }],
    };
    const bundle = normaliseFindings(result);
    const stats = verifyEvidence(bundle, new Map());

    assert.equal(stats.droppedFindings, 9, 'every section\'s finding should be dropped');
    for (const path of Object.keys(result)) {
      assert.equal(bundle.perPath[path]?.length || 0, 0, `${path} should be empty`);
    }
  });
});

describe('verifyEvidence — confidence floor', () => {
  test('cannot push confidence below 0', () => {
    const bundle = makeBundle([{
      title: 'Low conf already',
      confidence: 0.05,
      evidence: [
        { kind: 'document_chunk', ref: { chunk_id: 'real' }, snippet: 'matches' },
        { kind: 'document_chunk', ref: { chunk_id: 'ghost' }, snippet: 'fake' },
      ],
    }]);
    const idx = chunkIndex([{ id: 'real', content: 'matches the snippet exactly here' }]);
    verifyEvidence(bundle, idx);
    assert.equal(bundle.perPath.keyFindings[0].confidence, 0);
  });
});
