/**
 * Hybrid chunk search for deal documents.
 *
 * Wraps the search_deal_chunks Postgres RPC (defined in migration-deal-diligence.sql).
 * If embeddings are available (VOYAGE_API_KEY set + chunks have non-null embedding),
 * the RPC returns RRF-fused (semantic + keyword) results. Otherwise it returns
 * keyword-only.
 *
 * Server-side only: uses the service-role Supabase headers because the caller
 * has already enforced deal-level auth.
 */

import { getSupabaseHeaders, fetchWithTimeout } from '@/lib/api-helpers';
import { embedQuery } from '@/lib/ai/embeddings';
import { logger } from '@/lib/logger';

/**
 * @param {object} args
 * @param {string} args.supabaseUrl
 * @param {string} args.supabaseKey - service role key
 * @param {string} args.dealId
 * @param {string} args.queryText
 * @param {number} [args.limit]
 * @param {string} [args.party] - filter to a single source_party
 * @returns {Promise<Array<{chunk_id, document_id, filename, page_number, slide_number, sheet_name, cell_range, section_path, content, semantic_score, keyword_score, fused_score}>>}
 */
export async function searchDealChunks({
  supabaseUrl, supabaseKey, dealId, queryText, limit = 12, party = null,
}) {
  if (!queryText || !queryText.trim()) return [];

  // Embed the query if a key is configured. Best-effort — keyword-only
  // search still works if embedding fails.
  let queryVector = null;
  try {
    queryVector = await embedQuery(queryText);
  } catch (e) {
    logger.warn('Query embedding failed; falling back to keyword search', { error: e.message });
  }

  const body = {
    p_deal_id: dealId,
    p_query_text: queryText.slice(0, 1000),
    p_query_vector: queryVector,
    p_limit: Math.max(1, Math.min(limit, 50)),
    p_party: party,
  };

  const resp = await fetchWithTimeout(
    `${supabaseUrl}/rest/v1/rpc/search_deal_chunks`,
    {
      method: 'POST',
      headers: { ...getSupabaseHeaders(supabaseKey), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    15000,
  );

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    logger.warn('search_deal_chunks RPC failed', { status: resp.status, body: txt.slice(0, 300) });
    return [];
  }

  const rows = await resp.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}
