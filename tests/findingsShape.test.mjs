/**
 * Tests for lib/deal-analysis/findingsShape.js
 *
 * Run with: node --test tests/findingsShape.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  findingKey,
  normaliseFinding,
  normaliseFindings,
  SEVERITIES,
  IMPACT_AXES,
  EVIDENCE_KINDS,
  FINDINGS_SHAPE_PROMPT_BLOCK,
} from '../lib/deal-analysis/findingsShape.js';

describe('findingKey', () => {
  test('produces a stable 12-char hex string for the same inputs', () => {
    const a = findingKey({ category: 'systems', title: 'Legacy ERP risk' });
    const b = findingKey({ category: 'systems', title: 'Legacy ERP risk' });
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{12}$/);
  });

  test('is case + whitespace insensitive', () => {
    const a = findingKey({ category: 'Systems', title: '  Legacy ERP risk' });
    const b = findingKey({ category: 'systems', title: 'legacy erp risk  ' });
    assert.equal(a, b);
  });

  test('changes when title or category changes', () => {
    const a = findingKey({ category: 'systems', title: 'Legacy ERP risk' });
    const b = findingKey({ category: 'systems', title: 'Legacy CRM risk' });
    const c = findingKey({ category: 'people',  title: 'Legacy ERP risk' });
    assert.notEqual(a, b);
    assert.notEqual(a, c);
  });

  test('handles missing fields without throwing', () => {
    const k = findingKey({});
    assert.match(k, /^[0-9a-f]{12}$/);
  });
});

describe('normaliseFinding', () => {
  test('rejects non-objects and missing title', () => {
    assert.equal(normaliseFinding(null).ok, false);
    assert.equal(normaliseFinding({}).ok, false);
    assert.equal(normaliseFinding({ title: '   ' }).ok, false);
  });

  test('applies sane defaults', () => {
    const { ok, finding } = normaliseFinding({ title: 'X' });
    assert.equal(ok, true);
    assert.equal(finding.title, 'X');
    assert.equal(finding.body, '');
    assert.equal(finding.category, 'general');
    assert.equal(finding.severity, 'medium');
    assert.equal(finding.confidence, 0.5);
    assert.deepEqual(finding.impact, []);
    assert.deepEqual(finding.evidence, []);
    assert.deepEqual(finding.recommendations, []);
    assert.equal(typeof finding.key, 'string');
  });

  test('clamps confidence into [0, 1]', () => {
    assert.equal(normaliseFinding({ title: 'X', confidence: -1 }).finding.confidence, 0);
    assert.equal(normaliseFinding({ title: 'X', confidence: 2 }).finding.confidence, 1);
    assert.equal(normaliseFinding({ title: 'X', confidence: 0.7 }).finding.confidence, 0.7);
    assert.equal(normaliseFinding({ title: 'X', confidence: 'bad' }).finding.confidence, 0.5);
  });

  test('coerces invalid severity to medium', () => {
    assert.equal(normaliseFinding({ title: 'X', severity: 'nope' }).finding.severity, 'medium');
    for (const s of SEVERITIES) {
      assert.equal(normaliseFinding({ title: 'X', severity: s }).finding.severity, s);
    }
  });

  test('filters impact[] to known axes', () => {
    const f = normaliseFinding({ title: 'X', impact: ['day_one', 'bogus', 'tsa', 42] }).finding;
    assert.deepEqual(f.impact.sort(), ['day_one', 'tsa']);
    for (const axis of IMPACT_AXES) {
      const out = normaliseFinding({ title: 'X', impact: [axis] }).finding.impact;
      assert.deepEqual(out, [axis]);
    }
  });

  test('filters evidence[] to known kinds and trims snippets', () => {
    const longSnippet = 'a'.repeat(800);
    const f = normaliseFinding({
      title: 'X',
      evidence: [
        { kind: 'document_chunk', ref: { chunk_id: 'c1' }, snippet: longSnippet },
        { kind: 'unknown', ref: {} },
        { kind: 'process_step', ref: { step_index: 3 } },
        { kind: 'metric', ref: { source: 'cost', field: 'total' } },
        null,
      ],
    }).finding;
    assert.equal(f.evidence.length, 3);
    assert.equal(f.evidence[0].snippet.length, 400);
    assert.deepEqual(f.evidence.map((e) => e.kind), ['document_chunk', 'process_step', 'metric']);
    for (const k of EVIDENCE_KINDS) {
      const out = normaliseFinding({ title: 'X', evidence: [{ kind: k, ref: {} }] }).finding.evidence;
      assert.equal(out.length, 1);
    }
  });

  test('drops empty / non-string recommendations', () => {
    const f = normaliseFinding({ title: 'X', recommendations: ['Do A', '', 42, '  Do B  '] }).finding;
    assert.deepEqual(f.recommendations, ['Do A', 'Do B']);
  });

  test('lowercases category for stable keying', () => {
    const a = normaliseFinding({ title: 'X', category: 'SYSTEMS' }).finding.key;
    const b = normaliseFinding({ title: 'X', category: 'systems' }).finding.key;
    assert.equal(a, b);
  });
});

describe('normaliseFindings', () => {
  test('returns empty when result is not an object', () => {
    assert.deepEqual(normaliseFindings(null), { findings: [], perPath: {} });
    assert.deepEqual(normaliseFindings('hi'), { findings: [], perPath: {} });
  });

  test('walks all known paths', () => {
    const result = {
      mergeRecommendations: [{ title: 'M1' }],
      opportunities:        [{ title: 'O1' }],
      integrationRisks:     [{ title: 'I1' }],
      risks:                [{ title: 'R1' }],
      redFlags:             [{ title: 'F1' }],
      keyFindings:          [{ title: 'K1' }],
      technologyLandscape:  [{ title: 'T1' }],
      operationalFootprint: [{ title: 'OP1' }],
      organisation:         [{ title: 'ORG1' }],
      ignoredField:         'whatever',
    };
    const { findings, perPath } = normaliseFindings(result);
    assert.equal(findings.length, 9);
    assert.equal(perPath.mergeRecommendations.length, 1);
    assert.equal(perPath.opportunities.length, 1);
    assert.ok(!('ignoredField' in perPath));
    for (const f of findings) {
      assert.match(f.key, /^[0-9a-f]{12}$/);
    }
  });

  test('promotes singleton executiveSummary into a normalised finding (in place)', () => {
    const result = {
      executiveSummary: { title: 'Memo top line', body: 'Body text' },
    };
    const { findings } = normaliseFindings(result);
    assert.equal(findings.length, 1);
    assert.equal(result.executiveSummary.key, findings[0].key);
    assert.equal(result.executiveSummary.title, 'Memo top line');
    // Has the canonical defaults
    assert.equal(result.executiveSummary.severity, 'medium');
  });

  test('skips singleton when value is not an object', () => {
    const result = { executiveSummary: 'string instead of obj' };
    const { findings } = normaliseFindings(result);
    assert.equal(findings.length, 0);
    assert.equal(result.executiveSummary, 'string instead of obj');
  });

  test('falls back to alternative title sources for legacy shapes', () => {
    const result = {
      mergeRecommendations: [
        { finding: 'using `finding` field' },
        { name: 'using `name` field', rationale: 'why' },
      ],
    };
    const { findings } = normaliseFindings(result);
    assert.equal(findings.length, 2);
    assert.equal(findings[0].title, 'using `finding` field');
    assert.equal(findings[1].body, 'why');
  });
});

describe('FINDINGS_SHAPE_PROMPT_BLOCK', () => {
  test('mentions every required field name so the model is forced to emit them', () => {
    for (const t of ['title', 'body', 'severity', 'confidence', 'impact', 'evidence', 'recommendations']) {
      assert.ok(FINDINGS_SHAPE_PROMPT_BLOCK.includes(t), `missing ${t} in prompt block`);
    }
    for (const k of EVIDENCE_KINDS) {
      assert.ok(FINDINGS_SHAPE_PROMPT_BLOCK.includes(k), `missing evidence kind ${k}`);
    }
    for (const a of IMPACT_AXES) {
      assert.ok(FINDINGS_SHAPE_PROMPT_BLOCK.includes(a), `missing impact axis ${a}`);
    }
  });
});
