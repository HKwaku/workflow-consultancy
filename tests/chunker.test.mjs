/**
 * Tests for lib/inngest/functions/chunker.js
 *
 * Run with: node --test tests/chunker.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chunkText } from '../lib/inngest/functions/chunker.js';

// Approximate token count: chars / 4 (matches the chunker's own heuristic).
const TOK = (s) => Math.ceil(s.length / 4);

describe('chunkText', () => {
  test('returns [] for empty / null input', () => {
    assert.deepEqual(chunkText(null), []);
    assert.deepEqual(chunkText([]), []);
    assert.deepEqual(chunkText([{ content: '   ' }]), []);
  });

  test('keeps small same-locator segments together', () => {
    const segments = [
      { content: 'short paragraph one', page_number: 1 },
      { content: 'short paragraph two', page_number: 1 },
      { content: 'short paragraph three', page_number: 1 },
    ];
    const chunks = chunkText(segments);
    // All three should fold into a single chunk (way under TARGET_TOKENS)
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].page_number, 1);
    assert.match(chunks[0].content, /one[\s\S]+two[\s\S]+three/);
  });

  test('flushes when locator changes (page boundary)', () => {
    const segments = [
      { content: 'paragraph on page 1', page_number: 1 },
      { content: 'paragraph on page 2', page_number: 2 },
    ];
    const chunks = chunkText(segments);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].page_number, 1);
    assert.equal(chunks[1].page_number, 2);
    assert.ok(!chunks[0].content.includes('page 2'));
  });

  test('flushes when sheet_name changes', () => {
    const segments = [
      { content: 'cells from sheet A', sheet_name: 'A', cell_range: 'A1:Z50' },
      { content: 'cells from sheet B', sheet_name: 'B', cell_range: 'A1:Z50' },
    ];
    const chunks = chunkText(segments);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].sheet_name, 'A');
    assert.equal(chunks[1].sheet_name, 'B');
  });

  test('hard-splits a single segment that exceeds MAX (carries locator on every part)', () => {
    const huge = 'word '.repeat(2000); // ~10000 chars => ~2500 tokens
    const segments = [{ content: huge, slide_number: 7 }];
    const chunks = chunkText(segments);
    assert.ok(chunks.length > 1, `expected multi-chunk split, got ${chunks.length}`);
    for (const c of chunks) {
      assert.equal(c.slide_number, 7, 'every part must keep the slide_number locator');
      assert.ok(TOK(c.content) <= 901, `chunk too large: ${TOK(c.content)} tokens`);
    }
  });

  test('preserves all locator metadata on output chunks', () => {
    const segments = [{
      content: 'abc',
      page_number: 12,
      slide_number: null,
      sheet_name: null,
      cell_range: 'A1:B2',
      section_path: 'Chapter 2 > Heading 3',
    }];
    const chunks = chunkText(segments);
    assert.equal(chunks.length, 1);
    const c = chunks[0];
    assert.equal(c.page_number, 12);
    assert.equal(c.cell_range, 'A1:B2');
    assert.equal(c.section_path, 'Chapter 2 > Heading 3');
    assert.equal(c.slide_number, null);
    assert.equal(c.sheet_name, null);
    assert.ok(typeof c.token_count === 'number');
  });

  test('flushes when adding a new segment would exceed MAX_TOKENS_PER_CHUNK', () => {
    // Build a large-but-under-MAX segment, then add another large segment with
    // the SAME locator. The chunker should still flush because the combined
    // size would exceed MAX (900).
    const big = 'word '.repeat(700); // ~3500 chars => ~875 tokens (under MAX)
    const segments = [
      { content: big, page_number: 1 },
      { content: big, page_number: 1 },
    ];
    const chunks = chunkText(segments);
    assert.ok(chunks.length >= 2, `expected at least 2 chunks, got ${chunks.length}`);
    assert.equal(chunks[0].page_number, 1);
    assert.equal(chunks[1].page_number, 1);
  });

  test('skips empty segments inside otherwise-valid input', () => {
    const segments = [
      { content: 'first paragraph', page_number: 1 },
      { content: '', page_number: 1 },
      { content: '   ', page_number: 1 },
      { content: 'second paragraph', page_number: 1 },
    ];
    const chunks = chunkText(segments);
    assert.equal(chunks.length, 1);
    assert.match(chunks[0].content, /first[\s\S]+second/);
  });

  test('handles a mix of small + huge segments without losing data', () => {
    const huge = 'word '.repeat(2000);
    const segments = [
      { content: 'small one', page_number: 1 },
      { content: huge,        page_number: 2 },
      { content: 'small two', page_number: 3 },
    ];
    const chunks = chunkText(segments);
    // We should see: 1× page 1 chunk, ≥1× page 2 chunks, 1× page 3 chunk
    const byPage = { 1: 0, 2: 0, 3: 0 };
    for (const c of chunks) byPage[c.page_number] = (byPage[c.page_number] || 0) + 1;
    assert.equal(byPage[1], 1);
    assert.ok(byPage[2] >= 1);
    assert.equal(byPage[3], 1);
  });
});
