/**
 * Tests for lib/ai/embeddings.js
 *
 * Run with: node --test tests/embeddings.test.mjs
 *
 * No network calls — these tests verify the no-op behaviour when
 * VOYAGE_API_KEY is unset, plus the constants the rest of the system
 * relies on.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

let mod;
let originalKey;

before(async () => {
  // Snapshot then clear before importing so isConfigured() reads false.
  originalKey = process.env.VOYAGE_API_KEY;
  delete process.env.VOYAGE_API_KEY;
  mod = await import('../lib/ai/embeddings.js');
});

after(() => {
  if (originalKey !== undefined) process.env.VOYAGE_API_KEY = originalKey;
});

describe('exported constants', () => {
  test('VOYAGE_MODEL matches the migration vector(N) dimensionality', () => {
    assert.equal(mod.VOYAGE_MODEL, 'voyage-3-large');
    assert.equal(mod.EMBED_DIM, 1024);
  });
});

describe('embeddingsConfigured', () => {
  test('returns false when VOYAGE_API_KEY is unset', () => {
    assert.equal(mod.embeddingsConfigured(), false);
  });

  test('returns true when VOYAGE_API_KEY is set', () => {
    process.env.VOYAGE_API_KEY = 'test-key';
    try {
      assert.equal(mod.embeddingsConfigured(), true);
    } finally {
      delete process.env.VOYAGE_API_KEY;
    }
  });
});

describe('embedQuery (no key)', () => {
  test('returns null for any input', async () => {
    assert.equal(await mod.embedQuery('hello'), null);
    assert.equal(await mod.embedQuery(''), null);
    assert.equal(await mod.embedQuery(null), null);
  });
});

describe('embedDocuments (no key)', () => {
  test('returns [] for empty / non-array input', async () => {
    assert.deepEqual(await mod.embedDocuments([]), []);
    assert.deepEqual(await mod.embedDocuments(null), []);
    assert.deepEqual(await mod.embedDocuments('not-an-array'), []);
  });

  test('returns array of nulls matching input length when key is unset', async () => {
    const out = await mod.embedDocuments(['a', 'b', 'c']);
    assert.equal(out.length, 3);
    for (const v of out) assert.equal(v, null);
  });
});
