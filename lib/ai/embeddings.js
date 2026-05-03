/**
 * Voyage AI embedding wrapper. Used for deal-document chunks and for query
 * embedding at search time.
 *
 * Voyage is the embedding provider Anthropic recommends (Anthropic does not
 * ship its own embedding model). Same vendor relationship; clean separation
 * of concerns.
 *
 * Model: voyage-3-large (1024 dims) — matches the vector(1024) column on
 * deal_document_chunks.embedding. Change here AND the migration if you swap
 * model.
 *
 * Env: VOYAGE_API_KEY. If unset, every function returns null/[] so callers
 * can degrade to keyword-only search instead of crashing.
 */

import { logger } from '../logger.js';

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
export const VOYAGE_MODEL = 'voyage-3-large';
export const EMBED_DIM = 1024;

function isConfigured() {
  return !!process.env.VOYAGE_API_KEY;
}

async function callVoyage({ inputs, inputType }) {
  if (!isConfigured()) return { vectors: null, totalTokens: 0 };
  const resp = await fetch(VOYAGE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: inputs,
      input_type: inputType,        // 'document' or 'query'
      output_dimension: EMBED_DIM,
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`Voyage ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const data = await resp.json();
  const vectors = (data.data || []).map((d) => d.embedding);
  // Voyage returns usage.total_tokens for the whole batch
  const totalTokens = Number(data?.usage?.total_tokens || 0);
  return { vectors, totalTokens };
}

/**
 * Embed a single query string. Returns the vector array (length EMBED_DIM)
 * or null if embeddings are not configured / call fails.
 *
 * @returns {Promise<{vector: number[]|null, tokens: number}>}
 */
export async function embedQuery(text) {
  if (!text || !isConfigured()) return null;
  try {
    const { vectors, totalTokens } = await callVoyage({ inputs: [text.slice(0, 4000)], inputType: 'query' });
    const vec = vectors?.[0] || null;
    if (vec) {
      // Stash tokens on the vector so callers can opt-in to recording usage.
      // Vectors are arrays of numbers; we attach via a non-enumerable prop so
      // JSON serialisation isn't disturbed.
      Object.defineProperty(vec, '__tokens', { value: totalTokens, enumerable: false });
    }
    return vec;
  } catch (e) {
    logger.warn('embedQuery failed', { error: e.message });
    return null;
  }
}

/**
 * Embed a batch of document chunks. Voyage allows up to 128 inputs per call;
 * we batch in 64s to keep response sizes reasonable. Returns an array of vectors
 * the same length as inputs, with null for any individual failure.
 *
 * Also returns total tokens via a non-enumerable __tokens prop on the array.
 */
export async function embedDocuments(texts) {
  if (!Array.isArray(texts) || texts.length === 0) {
    const empty = [];
    Object.defineProperty(empty, '__tokens', { value: 0, enumerable: false });
    return empty;
  }
  if (!isConfigured()) {
    const out = texts.map(() => null);
    Object.defineProperty(out, '__tokens', { value: 0, enumerable: false });
    return out;
  }

  const batches = [];
  for (let i = 0; i < texts.length; i += 64) batches.push(texts.slice(i, i + 64));

  const out = [];
  let totalTokens = 0;
  for (const batch of batches) {
    try {
      const trimmed = batch.map((t) => String(t || '').slice(0, 8000));
      const { vectors, totalTokens: batchTokens } = await callVoyage({ inputs: trimmed, inputType: 'document' });
      out.push(...(vectors || batch.map(() => null)));
      totalTokens += batchTokens;
    } catch (e) {
      logger.warn('embedDocuments batch failed', { error: e.message, batchSize: batch.length });
      out.push(...batch.map(() => null));
    }
  }
  Object.defineProperty(out, '__tokens', { value: totalTokens, enumerable: false });
  return out;
}

export function embeddingsConfigured() {
  return isConfigured();
}
