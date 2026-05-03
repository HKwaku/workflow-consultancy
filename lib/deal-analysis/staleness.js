/**
 * Mark deal_findings stale when their evidence has changed underneath them.
 *
 * Triggered from two places:
 *   1. processDealDocument — after a *re-process* run finishes (the doc had
 *      prior chunks; their ids are now invalidated).
 *   2. The reprocess API route — eagerly stales findings the moment the
 *      user clicks "reprocess", so the UI badge appears immediately rather
 *      than only after the worker finishes.
 *
 * We don't delete or rewrite the finding itself — the partner needs to see
 * what was claimed and decide whether the new chunk text supports it.
 *
 * Best-effort throughout. Failures log and return; never raise.
 */

import {
  getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout,
} from '../api-helpers.js';
import { logger } from '../logger.js';

/**
 * Find every deal_findings row whose evidence chain references this
 * document and flip stale=true with a reason.
 */
export async function markFindingsStaleForDocument({ sb, dealId, documentId, reason }) {
  if (!sb || !documentId) return { marked: 0 };
  try {
    // Findings store evidence as JSONB. We can't do a structured query
    // through PostgREST without an RPC, so we filter client-side after
    // pulling the candidate rows for this deal. Volume is small (one deal
    // rarely has > 200 findings) so this is fine.
    const findingsResp = await fetchWithTimeout(
      `${sb.url}/rest/v1/deal_findings?deal_id=eq.${dealId}&select=id,finding_key,evidence,stale&limit=500`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    );
    if (!findingsResp.ok) return { marked: 0 };
    const findings = await findingsResp.json();

    const idsToStale = [];
    for (const f of findings) {
      if (f.stale) continue; // already flagged
      const ev = Array.isArray(f.evidence) ? f.evidence : [];
      if (ev.some((e) => e?.document_id === documentId || e?.ref?.document_id === documentId)) {
        idsToStale.push(f.id);
      }
    }

    if (idsToStale.length === 0) return { marked: 0 };

    const patchResp = await fetchWithTimeout(
      `${sb.url}/rest/v1/deal_findings?id=in.(${idsToStale.map(encodeURIComponent).join(',')})`,
      {
        method: 'PATCH',
        headers: getSupabaseWriteHeaders(sb.key),
        body: JSON.stringify({
          stale: true,
          stale_reason: reason || 'A cited document was reprocessed.',
          stale_at: new Date().toISOString(),
        }),
      },
    );
    if (!patchResp.ok) {
      logger.warn('markFindingsStale: patch failed', { dealId, documentId, count: idsToStale.length });
      return { marked: 0 };
    }
    return { marked: idsToStale.length };
  } catch (e) {
    logger.warn('markFindingsStale crashed', { error: e.message, dealId, documentId });
    return { marked: 0 };
  }
}
