/**
 * Smoke tests for lib/exporters/dealDiligenceToPptx.js
 *
 * Run with: node --test tests/dealDiligenceToPptx.test.mjs
 *
 * We don't crack open the .pptx ZIP; we just verify the builder returns a
 * non-empty PPTX-shaped buffer for a variety of valid inputs without throwing.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildDealDiligencePptx } from '../lib/exporters/dealDiligenceToPptx.js';

function f(key, extra = {}) {
  return {
    key,
    title: `Finding ${key}`,
    body: `Body text for ${key}.`,
    severity: extra.severity || 'medium',
    confidence: extra.confidence ?? 0.7,
    impact: extra.impact || [],
    evidence: extra.evidence || [],
    recommendations: extra.recommendations || [],
    ...extra,
  };
}

// PPTX is just a ZIP, which always starts with bytes "PK\x03\x04".
function isPptxBuffer(buf) {
  if (!Buffer.isBuffer(buf) && !(buf instanceof Uint8Array)) return false;
  if (buf.length < 100) return false;
  return buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

describe('buildDealDiligencePptx', () => {
  test('produces a valid pptx buffer for a minimal analysis', async () => {
    const buf = await buildDealDiligencePptx({
      dealName: 'Project Atlas',
      completedAt: new Date().toISOString(),
      result: {
        summary: 'Two-sentence overall summary.',
        executiveSummary: f('exec', { impact: ['day_one', 'tsa'] }),
        technologyLandscape: [f('t1'), f('t2', { severity: 'high' })],
        operationalFootprint: [f('op1')],
        organisation: [],
        redFlags: [f('rf1', { severity: 'critical', impact: ['day_one'] })],
        keyFindings: [f('k1')],
      },
    });
    assert.ok(isPptxBuffer(buf), 'expected a PPTX-shaped buffer');
    assert.ok(buf.length > 5000, `buffer too small: ${buf.length} bytes`);
  });

  test('handles entirely empty sections without throwing', async () => {
    const buf = await buildDealDiligencePptx({
      dealName: 'Empty Deal',
      completedAt: null,
      result: {
        executiveSummary: null,
        technologyLandscape: [],
        operationalFootprint: [],
        organisation: [],
        redFlags: [],
        keyFindings: [],
      },
    });
    assert.ok(isPptxBuffer(buf));
  });

  test('handles findings with rich evidence + recommendations', async () => {
    const buf = await buildDealDiligencePptx({
      dealName: 'Rich Deal',
      completedAt: '2026-04-25T10:00:00Z',
      result: {
        executiveSummary: f('exec', {
          impact: ['day_one', 'tsa', 'separation', 'long_term'],
          confidence: 0.9,
          recommendations: ['Rec one', 'Rec two', 'Rec three'],
          evidence: [
            { kind: 'document_chunk', ref: { filename: 'CIM.pdf', page_number: 42, chunk_id: 'abc', document_id: 'def' }, snippet: 'Snippet text' },
            { kind: 'process_step',   ref: { step_index: 7, step_name: 'Approve invoice' } },
            { kind: 'metric',         ref: { source: 'cost_analysis', field: 'total' } },
          ],
        }),
        keyFindings: [
          f('k1', { severity: 'high',     impact: ['day_one'] }),
          f('k2', { severity: 'critical', impact: ['tsa'] }),
        ],
      },
    });
    assert.ok(isPptxBuffer(buf));
    assert.ok(buf.length > 8000);
  });

  test('handles missing dealName + missing completedAt', async () => {
    const buf = await buildDealDiligencePptx({
      result: { keyFindings: [f('only')] },
    });
    assert.ok(isPptxBuffer(buf));
  });

  test('handles findings with no evidence (renders the warning slide content)', async () => {
    const buf = await buildDealDiligencePptx({
      dealName: 'No-evidence deal',
      completedAt: new Date().toISOString(),
      result: {
        keyFindings: [f('e1', { evidence: [] })],
      },
    });
    assert.ok(isPptxBuffer(buf));
  });
});
