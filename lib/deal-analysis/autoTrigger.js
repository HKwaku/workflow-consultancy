/**
 * Auto-trigger a delta diligence analysis after a new document finishes
 * processing. Called from processDealDocument once a doc is in a terminal
 * state with text indexed.
 *
 * Why: diligence is iterative — sellers drip-feed the data room and every
 * new doc can flip a finding. Forcing the user to remember to re-hit
 * "Analyse" makes the platform feel stale. Auto-triggering closes the loop.
 *
 * Throttling rules (all must pass for a re-run to fire):
 *   1. There is at least one prior `complete` analysis on this deal.
 *      We never auto-run the *first* analysis — the user opts in.
 *   2. No analysis is currently `pending` or `running` for this deal.
 *   3. The most recent completed analysis finished more than
 *      `MIN_GAP_MS` ago (default 1 hour). Stops a 50-doc dump from
 *      kicking off 50 analyses.
 *   4. Anthropic key resolves for the deal owner's org.
 *
 * Best-effort throughout — any failure logs and returns silently. Never
 * raises into the worker so a flaky auto-trigger can't poison the doc
 * processing pipeline.
 */

import {
  getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout,
} from '../api-helpers.js';
import { logger } from '../logger.js';
import { resolveActiveKey } from '../customerKey.js';
import { getOrgIdForUser } from '../costGuard.js';
import { sendEvent } from '../inngest/client.js';

const MIN_GAP_MS = 60 * 60 * 1000; // 1 hour between auto-runs per deal

export async function maybeAutoTriggerDealAnalysis({ sb, dealId, requestId }) {
  if (!sb || !dealId) return { triggered: false, reason: 'missing_args' };
  try {
    // 1. Most recent analysis (any status) — gives us both the throttle
    //    timestamp and the in-flight check in one query.
    const recentResp = await fetchWithTimeout(
      `${sb.url}/rest/v1/deal_analyses?deal_id=eq.${encodeURIComponent(dealId)}&select=id,status,mode,completed_at,created_at,auto_triggered&order=created_at.desc&limit=5`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    );
    const recents = recentResp.ok ? await recentResp.json() : [];

    const inFlight = recents.find((r) => r.status === 'pending' || r.status === 'running');
    if (inFlight) return { triggered: false, reason: 'analysis_in_flight' };

    const lastComplete = recents.find((r) => r.status === 'complete');
    if (!lastComplete) return { triggered: false, reason: 'no_prior_analysis' };

    const lastCompletedAt = lastComplete.completed_at || lastComplete.created_at;
    if (lastCompletedAt) {
      const gap = Date.now() - new Date(lastCompletedAt).getTime();
      if (gap < MIN_GAP_MS) {
        return { triggered: false, reason: 'throttled', gap_ms: gap };
      }
    }

    // 2. Resolve owner + org so we can pick up a customer or platform key.
    const dealResp = await fetchWithTimeout(
      `${sb.url}/rest/v1/deals?id=eq.${encodeURIComponent(dealId)}&select=owner_email,owner_user_id`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    );
    const [dealRow] = dealResp.ok ? await dealResp.json() : [];
    if (!dealRow) return { triggered: false, reason: 'deal_not_found' };

    const orgId = await getOrgIdForUser({
      email: dealRow.owner_email, userId: dealRow.owner_user_id,
    });
    const { key: anthropicKey, source } = await resolveActiveKey({ orgId, vendor: 'anthropic' });
    if (!anthropicKey) return { triggered: false, reason: 'no_anthropic_key' };

    // 3. Insert pending analysis row, mirroring the analyse route's shape
    //    but with auto_triggered=true and the same mode as the last run.
    const mode = lastComplete.mode || 'diligence';
    const insertResp = await fetchWithTimeout(
      `${sb.url}/rest/v1/deal_analyses`,
      {
        method: 'POST',
        headers: { ...getSupabaseWriteHeaders(sb.key), Prefer: 'return=representation' },
        body: JSON.stringify({
          deal_id: dealId,
          mode,
          source_flow_ids: [],
          source_report_ids: [],
          status: 'pending',
          progress_message: 'Auto-queued — new document landed in the data room.',
          estimated_tokens: mode === 'diligence' ? 50_000 : 30_000,
          result: null,
          created_by_email: dealRow.owner_email,
          auto_triggered: true,
        }),
      },
    );
    if (!insertResp.ok) {
      const txt = await insertResp.text().catch(() => '');
      logger.warn('Auto-trigger: insert deal_analyses failed', {
        requestId, dealId, status: insertResp.status, body: txt.slice(0, 200),
      });
      return { triggered: false, reason: 'insert_failed' };
    }
    const inserted = await insertResp.json();
    const analysisRow = Array.isArray(inserted) ? inserted[0] : inserted;
    if (!analysisRow?.id) return { triggered: false, reason: 'insert_shape' };

    // 4. Enqueue. If Inngest isn't configured, the row stays pending until
    //    a user kicks the next manual run; not catastrophic.
    try {
      await sendEvent({
        name: 'deal-analysis.requested',
        data: {
          analysis_id: analysisRow.id,
          deal_id: dealId,
          mode,
          participant_ids: [],
          process_names: [],
          requested_by_email: dealRow.owner_email,
          requested_by_user_id: dealRow.owner_user_id,
          org_id: orgId,
          api_key: anthropicKey,
          using_customer_key: source === 'customer',
          request_id: requestId || null,
          auto_triggered: true,
        },
      });
    } catch (e) {
      logger.warn('Auto-trigger: enqueue failed', { requestId, dealId, error: e.message });
      return { triggered: false, reason: 'enqueue_failed' };
    }

    logger.info('Auto-trigger: deal analysis queued', { requestId, dealId, analysis_id: analysisRow.id });
    return { triggered: true, analysis_id: analysisRow.id };
  } catch (e) {
    logger.warn('Auto-trigger crashed', { requestId, dealId, error: e.message });
    return { triggered: false, reason: 'exception' };
  }
}
