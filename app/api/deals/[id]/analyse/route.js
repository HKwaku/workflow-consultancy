/**
 * POST /api/deals/[id]/analyse
 *
 * Owner / collaborator only. Kicks off a cross-company AI analysis.
 *
 * Replaces the previous SSE-streaming pipeline. The route now does fast
 * validation + preflight + key resolution, inserts a `pending` row into
 * deal_analyses, fires `deal-analysis.requested` to Inngest, and returns
 * `{ analysis_id }` immediately. The client polls
 * /api/deals/[id]/analyses/[analysisId]/status until terminal.
 *
 * Why: the SSE pattern held a 60-120s connection; every flaky wifi
 * disconnect mid-stream lost the result and the user paid twice. Async
 * + polling is disconnect-tolerant and resumable across page reloads.
 *
 * Body: { mode?: 'comparison' | 'synergy' | 'redesign' | 'diligence' }
 * Returns: { analysis_id, status: 'pending', estimated_tokens, poll_url }
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout,
  requireSupabase, checkOrigin, getRequestId,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { resolveActiveKey } from '@/lib/customerKey';
import { preflightTokenBudget, getOrgIdForUser } from '@/lib/costGuard';
import { requireBudgetClearance } from '@/lib/trialBudget';
import { sendEvent } from '@/lib/inngest/client';

export const maxDuration = 30;

const SUPPORTED_MODES = new Set(['comparison', 'synergy', 'redesign', 'diligence']);
const MAX_FILTER_LIST = 50;

export async function POST(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } },
    );
  }

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id: dealId } = await params;
  if (!dealId) return NextResponse.json({ error: 'Deal ID required.' }, { status: 400 });

  // Mode parsing + optional scope filters
  let mode = 'comparison';
  let participantIds = [];
  let processNames = [];
  try {
    const body = await request.json();
    if (body && typeof body.mode === 'string' && SUPPORTED_MODES.has(body.mode)) mode = body.mode;
    if (Array.isArray(body?.participantIds)) {
      participantIds = body.participantIds.map((s) => String(s)).filter(Boolean).slice(0, MAX_FILTER_LIST);
    }
    if (Array.isArray(body?.processNames)) {
      processNames = body.processNames.map((s) => String(s).trim()).filter(Boolean).slice(0, MAX_FILTER_LIST);
    }
  } catch { /* default */ }

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const reqId = getRequestId(request);

  // Editor access check
  const dealResp = await fetchWithTimeout(
    `${sb.url}/rest/v1/deals?id=eq.${encodeURIComponent(dealId)}&select=id,owner_email,collaborator_emails,name,type`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  const [deal] = dealResp.ok ? await dealResp.json() : [];
  if (!deal) return NextResponse.json({ error: 'Deal not found.' }, { status: 404 });
  const isEditor = deal.owner_email?.toLowerCase() === auth.email.toLowerCase()
    || (Array.isArray(deal.collaborator_emails) && deal.collaborator_emails.some(
      (e) => typeof e === 'string' && e.toLowerCase() === auth.email.toLowerCase(),
    ));
  if (!isEditor) {
    return NextResponse.json({ error: 'Only the deal owner or a collaborator can run analysis.' }, { status: 403 });
  }

  // Trial-budget gate. A signed-in user without an org membership can't
  // run a deal analysis on platform tokens once their trial is exhausted —
  // they must create an org and paste an Anthropic key. Most analyse
  // callers will be in an org already (deals are an org-tier feature),
  // but we gate here too for the rare in-trial-deal case.
  const gate = await requireBudgetClearance({ email: auth.email, userId: auth.userId });
  if (!gate.allowed) {
    return NextResponse.json({
      error: gate.message,
      gateAction: gate.gateAction,
      reason: gate.reason,
    }, { status: 402 });
  }

  // Resolve API key (BYO customer key, else platform). Reject early if neither
  // is configured — no point enqueueing a job that will fail.
  const orgId = await getOrgIdForUser({ email: auth.email, userId: auth.userId });
  const keyResolution = await resolveActiveKey({ orgId, vendor: 'anthropic' });
  if (!keyResolution.key) {
    return NextResponse.json(
      { error: 'No Anthropic API key configured (neither customer nor platform).' },
      { status: 503 },
    );
  }
  const usingCustomerKey = keyResolution.source === 'customer';

  // Cost preflight on the platform key. We can't precisely estimate prompt
  // size here (don't have RAG excerpts yet), so use a generous bound that
  // catches "user is at 99% of budget" cases.
  const estimatedTokens = mode === 'diligence' ? 50_000 : 30_000;
  if (!usingCustomerKey) {
    const preflight = await preflightTokenBudget({ orgId, estimatedTokens });
    if (!preflight.allowed) {
      logger.warn('Analysis blocked by token budget', {
        requestId: reqId, orgId, mode,
        consumed: preflight.consumed, budget: preflight.budget, projected: preflight.projected,
      });
      return NextResponse.json({
        error: `Monthly token budget reached. Used ${preflight.consumed} of ${preflight.budget}; this run would need ~${estimatedTokens} more. Set your own Anthropic API key in admin to bypass.`,
      }, { status: 402 });
    }
  }

  // Insert the pending row. We need its id to enqueue the worker event.
  const insertResp = await fetchWithTimeout(
    `${sb.url}/rest/v1/deal_analyses`,
    {
      method: 'POST',
      headers: { ...getSupabaseWriteHeaders(sb.key), Prefer: 'return=representation' },
      body: JSON.stringify({
        deal_id: dealId,
        mode,
        // Encode the scope filters in `name` so the worker + UI can read them
        // back. Avoids a schema migration just for two arrays.
        name: (participantIds.length || processNames.length)
          ? `scope:${JSON.stringify({ participantIds, processNames })}`
          : null,
        source_flow_ids: [],
        source_report_ids: [],
        status: 'pending',
        progress_message: 'Queued — worker will pick this up shortly.',
        estimated_tokens: estimatedTokens,
        result: null,
        created_by_email: auth.email,
      }),
    },
  );
  if (!insertResp.ok) {
    const txt = await insertResp.text().catch(() => '');
    logger.error('Failed to insert pending deal_analyses row', {
      requestId: reqId, dealId, mode, status: insertResp.status, body: txt.slice(0, 300),
    });
    return NextResponse.json({ error: 'Failed to start analysis.' }, { status: 502 });
  }
  const inserted = await insertResp.json();
  const analysisRow = Array.isArray(inserted) ? inserted[0] : inserted;
  if (!analysisRow?.id) {
    return NextResponse.json({ error: 'Analysis row insert returned unexpected shape.' }, { status: 502 });
  }

  // Fire the worker event. If Inngest isn't configured, the row stays
  // 'pending' and the polling endpoint surfaces that. Caller can decide
  // whether to retry, configure Inngest, or fall back.
  let queueResult;
  try {
    queueResult = await sendEvent({
      name: 'deal-analysis.requested',
      data: {
        analysis_id: analysisRow.id,
        deal_id: dealId,
        mode,
        participant_ids: participantIds,
        process_names: processNames,
        requested_by_email: auth.email,
        requested_by_user_id: auth.userId,
        org_id: orgId,
        api_key: keyResolution.key,
        using_customer_key: usingCustomerKey,
        request_id: reqId,
      },
    });
  } catch (err) {
    logger.error('Failed to enqueue deal-analysis.requested', { requestId: reqId, error: err.message });
    await fetchWithTimeout(
      `${sb.url}/rest/v1/deal_analyses?id=eq.${analysisRow.id}`,
      {
        method: 'PATCH',
        headers: { ...getSupabaseWriteHeaders(sb.key), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'failed',
          progress_message: null,
          error: 'Failed to enqueue worker.',
          completed_at: new Date().toISOString(),
        }),
      },
    ).catch(() => {});
    return NextResponse.json({ error: 'Failed to enqueue worker.' }, { status: 502 });
  }

  if (queueResult?.skipped) {
    return NextResponse.json({
      analysis_id: analysisRow.id,
      status: 'pending',
      enqueued: false,
      hint: 'Inngest not configured; analysis will not run until INNGEST_EVENT_KEY is set.',
      poll_url: `/api/deals/${dealId}/analyses/${analysisRow.id}/status`,
    }, { status: 202 });
  }

  return NextResponse.json({
    analysis_id: analysisRow.id,
    status: 'pending',
    enqueued: true,
    estimated_tokens: estimatedTokens,
    poll_url: `/api/deals/${dealId}/analyses/${analysisRow.id}/status`,
  }, { status: 202 });
}
