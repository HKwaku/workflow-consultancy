import { fetchWithTimeout, getSupabaseHeaders, getSupabaseWriteHeaders } from '@/lib/api-helpers';
import { logger } from '@/lib/logger';

/**
 * If every participant on a deal has status='complete', flip the deal itself
 * to status='complete'. Idempotent and best-effort: failures are logged, not
 * thrown, since the calling path has already done the user-visible work
 * (linking a report to a participant). Skips deals that are already complete.
 */
export async function maybeCompleteDeal({ dealId, supabaseUrl, supabaseKey, requestId }) {
  if (!dealId) return;
  try {
    const [dealResp, partsResp] = await Promise.all([
      fetchWithTimeout(
        `${supabaseUrl}/rest/v1/deals?id=eq.${encodeURIComponent(dealId)}&select=id,status`,
        { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
      ),
      fetchWithTimeout(
        `${supabaseUrl}/rest/v1/deal_participants?deal_id=eq.${encodeURIComponent(dealId)}&select=id,status`,
        { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
      ),
    ]);
    const [deal] = dealResp.ok ? await dealResp.json() : [];
    if (!deal || deal.status === 'complete') return;
    const parts = partsResp.ok ? await partsResp.json() : [];
    if (!parts.length) return;
    if (!parts.every((p) => p.status === 'complete')) return;

    await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/deals?id=eq.${encodeURIComponent(dealId)}`,
      {
        method: 'PATCH',
        headers: getSupabaseWriteHeaders(supabaseKey),
        body: JSON.stringify({ status: 'complete' }),
      }
    );
  } catch (err) {
    logger.warn('maybeCompleteDeal failed', { requestId, dealId, message: err.message });
  }
}
