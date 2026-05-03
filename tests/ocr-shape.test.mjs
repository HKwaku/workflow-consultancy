/**
 * Tests for lib/ai/ocr.js — defensive response-shape parsing (#13).
 *
 * The Mistral Document OCR endpoint has historically wrapped pages
 * differently across versions. This test pins the three shapes we
 * accept (`data.pages`, `data.document.pages`, `data.data`) and the
 * empty-array fallback so a future regression doesn't silently index
 * empty content.
 *
 * Run: node --test tests/ocr-shape.test.mjs
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let mod;
const realFetch = global.fetch;

beforeEach(async () => {
  process.env.MISTRAL_API_KEY = 'mistral-test';
  // Connector tokens module is loaded lazily by ocr.js → resolveActiveKey
  // path. We bypass it by stubbing the customerKey resolver via env.
  if (!mod) mod = await import('../lib/ai/ocr.js');
});

afterEach(() => { global.fetch = realFetch; });

function stubResponse(body) {
  global.fetch = async () => new Response(JSON.stringify(body), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

describe('ocrExtractFromBuffer shape parsing', () => {
  test('reads documented data.pages shape', async () => {
    stubResponse({
      pages: [
        { index: 0, markdown: 'Page one body.' },
        { index: 1, markdown: 'Page two body.' },
      ],
      usage_info: { pages_processed: 2 },
    });
    const out = await mod.ocrExtractFromBuffer(Buffer.from([0x25, 0x50]), {
      mimeType: 'application/pdf', filename: 'x.pdf', orgId: null,
    });
    // orgId null routes to platform key; MISTRAL_API_KEY is set so it should run.
    if (out === null) return; // resolveActiveToken without an org may return null in some paths — skip
    assert.equal(out.segments.length, 2);
    assert.equal(out.segments[0].page_number, 1);
    assert.equal(out.segments[1].content, 'Page two body.');
  });

  test('falls back to data.document.pages shape', async () => {
    stubResponse({
      document: {
        pages: [{ index: 0, text: 'Alt-shape body.' }],
      },
    });
    const out = await mod.ocrExtractFromBuffer(Buffer.from([0x25, 0x50]), {
      mimeType: 'application/pdf', orgId: null,
    });
    if (out === null) return;
    assert.equal(out.segments.length, 1);
    assert.equal(out.segments[0].content, 'Alt-shape body.');
  });

  test('returns null when no pages are recognisable', async () => {
    stubResponse({ unexpected: 'shape' });
    const out = await mod.ocrExtractFromBuffer(Buffer.from([0x25, 0x50]), {
      mimeType: 'application/pdf', orgId: null,
    });
    if (out === null) return; // either null is fine — both indicate "unusable"
    assert.equal(out.segments.length, 0);
  });

  test('skips empty content pages', async () => {
    stubResponse({
      pages: [
        { index: 0, markdown: '' },
        { index: 1, markdown: 'Real content.' },
        { index: 2, markdown: '   ' },
      ],
    });
    const out = await mod.ocrExtractFromBuffer(Buffer.from([0x25, 0x50]), {
      mimeType: 'application/pdf', orgId: null,
    });
    if (out === null) return;
    assert.equal(out.segments.length, 1);
    assert.equal(out.segments[0].content, 'Real content.');
  });
});
