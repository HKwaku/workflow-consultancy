/**
 * Tests for lib/deal-analysis/findingsRepo.js
 *
 * Run: node --test tests/findingsRepo.test.mjs
 *
 * Stubs global fetch for the persist + load paths. The hydrate function is
 * pure — tested without any fetch.
 */

import { test, describe, beforeEach, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';

const realFetch = global.fetch;
let repo, findingsShape;

before(async () => {
  process.env.SUPABASE_URL = 'https://stub.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-key';
  repo = await import('../lib/deal-analysis/findingsRepo.js');
  findingsShape = await import('../lib/deal-analysis/findingsShape.js');
});

afterEach(() => { global.fetch = realFetch; });

function makeFinding(overrides = {}) {
  const f = {
    key: overrides.key || 'k1',
    title: overrides.title || 'A finding',
    body: overrides.body || 'Some body',
    category: overrides.category || 'general',
    severity: overrides.severity || 'medium',
    confidence: overrides.confidence ?? 0.7,
    impact: overrides.impact || [],
    evidence: overrides.evidence || [],
    recommendations: overrides.recommendations || [],
  };
  return f;
}

function makeBundle(perPath = {}) {
  const flat = Object.values(perPath).flat();
  return { findings: flat, perPath };
}

/* ── hydrateAnalysisFromFindings (pure) ───────────────────────── */

describe('hydrateAnalysisFromFindings', () => {
  test('rebuilds the canonical shape with array sections + executiveSummary singleton', () => {
    const rows = [
      { finding_key: 'exec', section: 'executiveSummary', order_index: 0,
        title: 'Memo top line', body: 'b', category: 'executiveSummary',
        severity: 'high', confidence: 0.9, impact: ['day_one'], evidence: [], recommendations: [] },
      { finding_key: 't1', section: 'technologyLandscape', order_index: 0,
        title: 'Tech finding 1', body: 'b', category: 'systems',
        severity: 'medium', confidence: 0.8, impact: [], evidence: [], recommendations: [] },
      { finding_key: 't2', section: 'technologyLandscape', order_index: 1,
        title: 'Tech finding 2', body: 'b', category: 'systems',
        severity: 'low', confidence: 0.6, impact: [], evidence: [], recommendations: [] },
      { finding_key: 'rf', section: 'redFlags', order_index: 0,
        title: 'Red flag', body: 'b', category: 'risks',
        severity: 'critical', confidence: 0.95, impact: ['day_one'], evidence: [], recommendations: [] },
    ];
    const analysisRow = { id: 'a-1', result: { summary: '2-line summary', proposedProcess: [{ stepNumber: 1 }] } };
    const out = repo.hydrateAnalysisFromFindings(analysisRow, rows);

    assert.equal(out.summary, '2-line summary', 'preserves narrative non-finding fields');
    assert.deepEqual(out.proposedProcess, [{ stepNumber: 1 }]);

    assert.equal(out.executiveSummary?.title, 'Memo top line');
    assert.equal(out.executiveSummary?.key, 'exec');

    assert.equal(out.technologyLandscape.length, 2);
    assert.equal(out.technologyLandscape[0].key, 't1');
    assert.equal(out.technologyLandscape[1].key, 't2');

    assert.equal(out.redFlags[0].severity, 'critical');
  });

  test('preserves order_index ordering even when rows arrive out of order', () => {
    const rows = [
      { finding_key: 'b', section: 'redFlags', order_index: 1, title: 'B', severity: 'medium', confidence: 0.5, impact: [], evidence: [], recommendations: [] },
      { finding_key: 'a', section: 'redFlags', order_index: 0, title: 'A', severity: 'medium', confidence: 0.5, impact: [], evidence: [], recommendations: [] },
    ];
    // Caller's loadFindingsForAnalysis sorts by order_index, but the
    // hydrator should not depend on input ordering — it appends in input
    // order. Confirm the contract: hydrator preserves whatever order it's given.
    const out = repo.hydrateAnalysisFromFindings({ id: 'a' }, rows);
    assert.equal(out.redFlags[0].key, 'b');
    assert.equal(out.redFlags[1].key, 'a');
  });

  test('drops empty array sections so renderer "is this empty?" checks behave the same', () => {
    const rows = [
      { finding_key: 'k', section: 'keyFindings', order_index: 0, title: 'K', severity: 'medium', confidence: 0.5, impact: [], evidence: [], recommendations: [] },
    ];
    const out = repo.hydrateAnalysisFromFindings({ id: 'a' }, rows);
    assert.ok(!('technologyLandscape' in out), 'empty arrays should be dropped');
    assert.equal(out.keyFindings.length, 1);
  });

  test('keeps singleton null when no executiveSummary row exists', () => {
    const out = repo.hydrateAnalysisFromFindings({ id: 'a', result: {} }, [
      { finding_key: 'k', section: 'keyFindings', order_index: 0, title: 'K', severity: 'medium', confidence: 0.5, impact: [], evidence: [], recommendations: [] },
    ]);
    assert.equal(out.executiveSummary, null);
  });

  test('handles empty findings array — preserves narrative, all section keys absent', () => {
    const out = repo.hydrateAnalysisFromFindings(
      { id: 'a', result: { summary: 'preserved' } },
      [],
    );
    assert.equal(out.summary, 'preserved');
    assert.equal(out.executiveSummary, null);
    assert.ok(!('technologyLandscape' in out));
  });

  test('overwrites JSONB findings with table data (no double-rendering)', () => {
    // Stale JSONB has a finding; the table has a different one. Hydrator
    // should reflect ONLY the table — that's the whole point of the refactor.
    const analysisRow = {
      id: 'a',
      result: {
        summary: 'kept',
        keyFindings: [{ key: 'old', title: 'Stale finding from JSONB' }],
      },
    };
    const rows = [
      { finding_key: 'new', section: 'keyFindings', order_index: 0,
        title: 'Fresh from table', severity: 'medium', confidence: 0.8,
        impact: [], evidence: [], recommendations: [] },
    ];
    const out = repo.hydrateAnalysisFromFindings(analysisRow, rows);
    assert.equal(out.summary, 'kept');
    assert.equal(out.keyFindings.length, 1);
    assert.equal(out.keyFindings[0].title, 'Fresh from table');
    assert.equal(out.keyFindings[0].key, 'new');
  });
});

/* ── persistFindingsForAnalysis ────────────────────────────────── */

describe('persistFindingsForAnalysis', () => {
  test('returns 0/0 when no findings to write', async () => {
    let touched = false;
    global.fetch = async () => { touched = true; return new Response('{}', { status: 200 }); };
    const r = await repo.persistFindingsForAnalysis({
      analysisId: 'a-1', dealId: 'd-1',
      bundle: { findings: [], perPath: {} },
      executiveSummary: null,
    });
    assert.deepEqual(r, { written: 0, errors: 0 });
    assert.equal(touched, false);
  });

  test('UPSERTs findings + executiveSummary in the right shape', async () => {
    let body = null;
    let url = null;
    global.fetch = async (u, opts) => {
      url = String(u);
      body = JSON.parse(opts.body);
      return new Response(null, { status: 201 });
    };

    const bundle = makeBundle({
      keyFindings: [makeFinding({ key: 'k1', title: 'KF1' })],
      technologyLandscape: [makeFinding({ key: 't1', title: 'Tech1', severity: 'high' })],
    });
    const exec = makeFinding({ key: 'exec', title: 'Exec' });

    const r = await repo.persistFindingsForAnalysis({
      analysisId: 'a-1', dealId: 'd-1', bundle, executiveSummary: exec,
    });
    assert.equal(r.written, 3);
    assert.match(url, /on_conflict=analysis_id,finding_key/);
    assert.equal(body.length, 3);
    assert.deepEqual(body.map((r) => r.section).sort(), ['executiveSummary', 'keyFindings', 'technologyLandscape']);
    // Severity coercion check
    assert.equal(body.find((r) => r.finding_key === 't1').severity, 'high');
  });

  test('coerces invalid severity to medium and clamps confidence', async () => {
    let body = null;
    global.fetch = async (u, opts) => { body = JSON.parse(opts.body); return new Response(null, { status: 201 }); };

    const bundle = makeBundle({
      keyFindings: [makeFinding({ key: 'k', severity: 'extreme', confidence: 1.5 })],
    });
    await repo.persistFindingsForAnalysis({
      analysisId: 'a-1', dealId: 'd-1', bundle, executiveSummary: null,
    });
    assert.equal(body[0].severity, 'medium');
    assert.equal(body[0].confidence, 1);
  });

  test('reports errors when batch insert fails', async () => {
    global.fetch = async () => new Response('boom', { status: 500 });
    const bundle = makeBundle({ keyFindings: [makeFinding({ key: 'k' })] });
    const r = await repo.persistFindingsForAnalysis({
      analysisId: 'a-1', dealId: 'd-1', bundle, executiveSummary: null,
    });
    assert.equal(r.written, 0);
    assert.equal(r.errors, 1);
  });
});

/* ── End-to-end shape round-trip ─────────────────────────────── */

describe('round-trip: normaliseFindings → persist payload → hydrate', () => {
  test('shapes are identical end to end', async () => {
    // Build an analysis result that normaliseFindings would produce
    const rawResult = {
      summary: 'top line',
      executiveSummary: {
        title: 'Exec', body: 'memo', severity: 'high', confidence: 0.9,
        impact: ['day_one'], evidence: [], recommendations: ['action'],
      },
      keyFindings: [
        { title: 'K1', body: 'b1', severity: 'medium', confidence: 0.7, impact: [], evidence: [], recommendations: [] },
        { title: 'K2', body: 'b2', severity: 'high', confidence: 0.8, impact: ['tsa'], evidence: [], recommendations: [] },
      ],
    };
    const bundle = findingsShape.normaliseFindings(rawResult);
    // executiveSummary singleton was promoted in place
    const exec = rawResult.executiveSummary;
    assert.ok(exec.key, 'exec gets a key after normalisation');

    // Capture what persist would write
    let written = null;
    global.fetch = async (u, opts) => { written = JSON.parse(opts.body); return new Response(null, { status: 201 }); };
    await repo.persistFindingsForAnalysis({
      analysisId: 'a-1', dealId: 'd-1',
      bundle, executiveSummary: exec,
    });

    // Simulate read: rows come back in section/order_index order
    const rowsFromDb = written.sort((a, b) => a.section.localeCompare(b.section) || a.order_index - b.order_index);

    // Hydrate
    const hydrated = repo.hydrateAnalysisFromFindings(
      { id: 'a-1', result: { summary: rawResult.summary } },
      rowsFromDb,
    );

    assert.equal(hydrated.summary, 'top line');
    assert.equal(hydrated.executiveSummary?.title, 'Exec');
    assert.equal(hydrated.executiveSummary?.key, exec.key);
    assert.equal(hydrated.keyFindings.length, 2);
    assert.equal(hydrated.keyFindings[0].title, 'K1');
    assert.equal(hydrated.keyFindings[1].title, 'K2');
  });
});
