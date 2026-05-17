import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout,
  requireSupabase, checkOrigin, getRequestId,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { resolveDealAccess, requireDealEditor } from '@/lib/dealAuth';
import { logger } from '@/lib/logger';
import { deriveProcessMetrics } from '@/lib/processMetrics';
import { loadDecidedChangesByProcess } from '@/lib/changes/repo';
import { decidedSavingsFromChanges } from '@/lib/changes/savings';

/**
 * GET /api/deals/[id]/flows
 * Lists every flow in the deal. Owner, collaborators, and participants
 * can all read - participants see flows for their own participant row plus
 * flows for other companies (but the flow row itself exposes no PII).
 */
export async function GET(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id: dealId } = await params;
  if (!dealId) return NextResponse.json({ error: 'Deal ID required.' }, { status: 400 });

  const access = await resolveDealAccess({ dealId, email: auth.email, userId: auth.userId });
  if (!access) return NextResponse.json({ error: 'Access denied.' }, { status: 403 });

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  try {
    const flowResp = await fetchWithTimeout(
      `${sb.url}/rest/v1/deal_flows?deal_id=eq.${encodeURIComponent(dealId)}&select=*&order=created_at.asc`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) }
    );
    const flows = flowResp.ok ? await flowResp.json() : [];

    const processIds = flows.map((f) => f.process_id).filter(Boolean);
    let processMap = {};
    if (processIds.length) {
      const rResp = await fetchWithTimeout(
        `${sb.url}/rest/v1/processes?id=in.(${processIds.map(encodeURIComponent).join(',')})&select=id,flow_data,created_at,updated_at`,
        { method: 'GET', headers: getSupabaseHeaders(sb.key) }
      );
      if (rResp.ok) {
        for (const r of await rResp.json()) processMap[r.id] = r;
      }
    }

    // Potential savings = accepted/decided changes per process (£0 when
    // nothing is decided). One batched query for every flow's process.
    const decidedByProcess = await loadDecidedChangesByProcess(Object.keys(processMap));

    return NextResponse.json({
      flows: flows.map((f) => {
        const p = f.process_id ? processMap[f.process_id] : null;
        const metrics = p ? deriveProcessMetrics(p) : null;
        const decidedSavings = p
          ? decidedSavingsFromChanges(decidedByProcess.get(p.id), metrics.total_annual_cost)
          : 0;
        return {
          id: f.id,
          dealId: f.deal_id,
          participantId: f.participant_id,
          label: f.label,
          flowKind: f.flow_kind,
          processId: f.process_id,
          reportId: f.process_id, // back-compat alias for older clients
          status: f.status,
          createdByEmail: access.canManage ? f.created_by_email : undefined,
          createdAt: f.created_at,
          updatedAt: f.updated_at,
          process: p ? {
            id: p.id,
            createdAt: p.created_at,
            updatedAt: p.updated_at,
            totalAnnualCost:     metrics.total_annual_cost,
            potentialSavings:    decidedSavings,
            automationPercentage: metrics.automation_percentage,
            automationGrade:     metrics.automation_grade,
          } : null,
          startUrl: f.process_id ? null : `/workspace/map?dealFlowId=${encodeURIComponent(f.id)}`,
          openUrl: f.process_id ? `/workspace/map?dealFlowId=${encodeURIComponent(f.id)}&resume=1` : null,
        };
      }),
    });
  } catch (err) {
    logger.error('List deal flows error', { requestId: getRequestId(request), error: err.message });
    return NextResponse.json({ error: 'Failed to list flows.' }, { status: 500 });
  }
}

/**
 * POST /api/deals/[id]/flows
 * Owner or collaborator creates a new flow slot for a specific participant (company).
 * Body: { participantId: UUID, label: string, flowKind?: string }
 * Returns the flow row + a deep link to start mapping in /workspace/map.
 */
export async function POST(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id: dealId } = await params;
  if (!dealId) return NextResponse.json({ error: 'Deal ID required.' }, { status: 400 });

  const guard = await requireDealEditor({ dealId, email: auth.email, userId: auth.userId });
  if (guard.error) return NextResponse.json(guard.error, { status: guard.status });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  const { participantId, label, flowKind } = body;
  if (!participantId || typeof participantId !== 'string') {
    return NextResponse.json({ error: 'participantId is required.' }, { status: 400 });
  }
  if (!label || typeof label !== 'string' || label.trim().length === 0 || label.length > 200) {
    return NextResponse.json({ error: 'label is required (max 200 chars).' }, { status: 400 });
  }

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  try {
    // Verify the participant belongs to this deal
    const partResp = await fetchWithTimeout(
      `${sb.url}/rest/v1/deal_participants?id=eq.${encodeURIComponent(participantId)}&deal_id=eq.${encodeURIComponent(dealId)}&select=id`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) }
    );
    const [participant] = partResp.ok ? await partResp.json() : [];
    if (!participant) {
      return NextResponse.json({ error: 'Participant not found in this deal.' }, { status: 404 });
    }

    const insResp = await fetchWithTimeout(
      `${sb.url}/rest/v1/deal_flows`,
      {
        method: 'POST',
        headers: { ...getSupabaseWriteHeaders(sb.key), Prefer: 'return=representation' },
        body: JSON.stringify({
          deal_id: dealId,
          participant_id: participantId,
          label: label.trim().slice(0, 200),
          flow_kind: flowKind?.trim().slice(0, 100) || null,
          created_by_email: auth.email,
          status: 'draft',
        }),
      }
    );
    if (!insResp.ok) {
      const text = await insResp.text().catch(() => '');
      logger.warn('Create deal flow: Supabase error', { requestId: getRequestId(request), status: insResp.status, body: text });
      return NextResponse.json({ error: 'Failed to create flow.' }, { status: 502 });
    }
    const [flow] = await insResp.json();

    return NextResponse.json({
      success: true,
      flow: {
        id: flow.id,
        dealId: flow.deal_id,
        participantId: flow.participant_id,
        label: flow.label,
        flowKind: flow.flow_kind,
        processId: flow.process_id,
        reportId: flow.process_id,
        status: flow.status,
        createdAt: flow.created_at,
      },
      startUrl: flow.process_id ? null : `/workspace/map?dealFlowId=${encodeURIComponent(flow.id)}`,
      openUrl: flow.process_id ? `/workspace/map?dealFlowId=${encodeURIComponent(flow.id)}&resume=1` : null,
    }, { status: 201 });
  } catch (err) {
    logger.error('Create deal flow error', { requestId: getRequestId(request), error: err.message });
    return NextResponse.json({ error: 'Failed to create flow.' }, { status: 500 });
  }
}
