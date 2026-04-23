import { NextResponse } from 'next/server';
import { getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase, checkOrigin, getRequestId } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { resolveDealAccess, requireDealEditor, requireDealOwner } from '@/lib/dealAuth';
import { logger } from '@/lib/logger';

function buildBaseUrl(request) {
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

/**
 * GET /api/deals/[id]
 * Auth required (owner or participant).
 * Returns the deal with all participants and their report summaries.
 */
export async function GET(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Deal ID required.' }, { status: 400 });

  const sbConfig = requireSupabase();
  if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const { url: supabaseUrl, key: supabaseKey } = sbConfig;
  const baseUrl = buildBaseUrl(request);

  try {
    // Auth check: owner, collaborator, or participant
    const access = await resolveDealAccess({ dealId: id, email: auth.email, userId: auth.userId });
    if (!access) return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
    const deal = access.deal;
    const isOwner = access.mode === 'owner';
    const canSeePII = access.canManage; // owner or collaborator

    // Fetch participants
    const partResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/deal_participants?deal_id=eq.${id}&select=*&order=created_at.asc`,
      { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
    );
    const participants = partResp.ok ? await partResp.json() : [];

    // Fetch report summaries for completed participants
    const reportIds = participants.filter((p) => p.report_id).map((p) => p.report_id);
    let reportSummaries = {};
    if (reportIds.length > 0) {
      const reportsResp = await fetchWithTimeout(
        `${supabaseUrl}/rest/v1/diagnostic_reports?id=in.(${reportIds.map(encodeURIComponent).join(',')})&select=id,total_annual_cost,potential_savings,automation_percentage,automation_grade,diagnostic_mode,created_at,updated_at,diagnostic_data`,
        { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
      );
      if (reportsResp.ok) {
        const reports = await reportsResp.json();
        for (const r of reports) {
          const dd = r.diagnostic_data || {};
          const rawSteps = (dd.rawProcesses?.[0]?.steps || []).slice(0, 150).map((s) => ({
            name: s.name || '',
            department: s.department || '',
            isDecision: !!s.isDecision,
            isExternal: !!s.isExternal,
            durationMinutes: s.durationMinutes || s.workMinutes || 0,
          }));
          reportSummaries[r.id] = {
            id: r.id,
            totalAnnualCost: r.total_annual_cost,
            potentialSavings: r.potential_savings,
            automationPercentage: r.automation_percentage,
            automationGrade: r.automation_grade,
            diagnosticMode: r.diagnostic_mode,
            processCount: dd.summary?.totalProcesses || dd.processes?.length || 0,
            processes: (dd.processes || []).map((p) => ({
              name: p.name,
              annualCost: p.annualCost,
              stepsCount: p.stepsCount,
              quality: p.quality,
              automationPct: p.automationPct,
            })),
            rawSteps,
            reportUrl: `/report?id=${r.id}`,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
          };
        }
      }
    }

    const enrichedParticipants = participants.map((p) => ({
      id: p.id,
      role: p.role,
      companyName: p.company_name,
      participantEmail: canSeePII ? p.participant_email : undefined,
      participantName: p.participant_name,
      status: p.status,
      inviteUrl: canSeePII ? `${baseUrl}/process-audit?participant=${p.invite_token}` : undefined,
      reportId: p.report_id,
      report: p.report_id ? reportSummaries[p.report_id] || null : null,
      invitedAt: p.invited_at,
      completedAt: p.completed_at,
    }));

    // Fetch flows for this deal and join with report summaries
    const flowsResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/deal_flows?deal_id=eq.${encodeURIComponent(id)}&select=*&order=created_at.asc`,
      { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
    );
    const flowRows = flowsResp.ok ? await flowsResp.json() : [];
    const flowReportIds = flowRows.map((f) => f.report_id).filter(Boolean).filter((rid) => !reportSummaries[rid]);
    if (flowReportIds.length) {
      const extraResp = await fetchWithTimeout(
        `${supabaseUrl}/rest/v1/diagnostic_reports?id=in.(${flowReportIds.map(encodeURIComponent).join(',')})&select=id,total_annual_cost,potential_savings,automation_percentage,automation_grade,created_at,updated_at,diagnostic_data`,
        { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
      );
      if (extraResp.ok) {
        for (const r of await extraResp.json()) {
          reportSummaries[r.id] = {
            id: r.id,
            totalAnnualCost: r.total_annual_cost,
            potentialSavings: r.potential_savings,
            automationPercentage: r.automation_percentage,
            automationGrade: r.automation_grade,
            reportUrl: `/report?id=${r.id}`,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
          };
        }
      }
    }
    const flows = flowRows.map((f) => ({
      id: f.id,
      participantId: f.participant_id,
      label: f.label,
      flowKind: f.flow_kind,
      reportId: f.report_id,
      status: f.status,
      createdAt: f.created_at,
      updatedAt: f.updated_at,
      report: f.report_id ? reportSummaries[f.report_id] || null : null,
      startUrl: f.report_id ? null : `/process-audit?dealFlowId=${encodeURIComponent(f.id)}`,
      openUrl: f.report_id ? `/process-audit?dealFlowId=${encodeURIComponent(f.id)}&resume=1` : null,
    }));

    return NextResponse.json({
      deal: {
        id: deal.id,
        dealCode: deal.deal_code,
        type: deal.type,
        name: deal.name,
        processName: deal.process_name,
        status: deal.status,
        settings: deal.settings || {},
        stepDecisions: (deal.settings || {}).stepDecisions || {},
        ownerEmail: canSeePII ? deal.owner_email : undefined,
        collaboratorEmails: canSeePII ? (deal.collaborator_emails || []) : undefined,
        isOwner,
        accessMode: access.mode,
        canEdit: !!access.canEdit,
        canManage: !!access.canManage,
        canDelete: !!access.canDelete,
        createdAt: deal.created_at,
        updatedAt: deal.updated_at,
      },
      participants: enrichedParticipants,
      flows,
      summary: buildDealSummary(deal.type, enrichedParticipants),
    });
  } catch (err) {
    logger.error('Get deal error', { requestId: getRequestId(request), error: err.message });
    return NextResponse.json({ error: 'Failed to fetch deal.' }, { status: 500 });
  }
}

/**
 * PATCH /api/deals/[id]
 * Auth required (owner only).
 * Update deal name, processName, status, or settings (e.g. M&A step decisions, PE benchmark).
 */
export async function PATCH(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Deal ID required.' }, { status: 400 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  const sbConfig = requireSupabase();
  if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const { url: supabaseUrl, key: supabaseKey } = sbConfig;

  try {
    // Owner or collaborator may edit
    const guard = await requireDealEditor({ dealId: id, email: auth.email, userId: auth.userId });
    if (guard.error) return NextResponse.json(guard.error, { status: guard.status });

    // Build update payload - only allow safe fields
    const update = {};
    if (body.name && typeof body.name === 'string') update.name = body.name.trim().slice(0, 200);
    if (typeof body.processName === 'string') update.process_name = body.processName.trim().slice(0, 200) || null;
    if (body.status && ['draft', 'collecting', 'complete'].includes(body.status)) update.status = body.status;
    // settings is merged (not replaced) to allow incremental updates from different UI panels
    if (body.settings && typeof body.settings === 'object' && !Array.isArray(body.settings)) {
      // Fetch current settings first to merge
      const currentResp = await fetchWithTimeout(
        `${supabaseUrl}/rest/v1/deals?id=eq.${encodeURIComponent(id)}&select=settings`,
        { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
      );
      const [current] = currentResp.ok ? await currentResp.json() : [];
      update.settings = { ...(current?.settings || {}), ...body.settings };
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 });
    }

    const patchResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/deals?id=eq.${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: getSupabaseWriteHeaders(supabaseKey),
        body: JSON.stringify(update),
      }
    );

    if (!patchResp.ok) return NextResponse.json({ error: 'Failed to update deal.' }, { status: 502 });
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error('Update deal error', { requestId: getRequestId(request), error: err.message });
    return NextResponse.json({ error: 'Failed to update deal.' }, { status: 500 });
  }
}

/**
 * DELETE /api/deals/[id]
 * Auth required (owner only). Cascades to participants, flows, and analyses
 * via ON DELETE CASCADE. Linked diagnostic_reports are not removed (the FK
 * is SET NULL on deal_flows.report_id), so the underlying artefacts stay.
 */
export async function DELETE(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Deal ID required.' }, { status: 400 });

  const sbConfig = requireSupabase();
  if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const { url: supabaseUrl, key: supabaseKey } = sbConfig;

  try {
    const guard = await requireDealOwner({ dealId: id, email: auth.email, userId: auth.userId });
    if (guard.error) return NextResponse.json(guard.error, { status: guard.status });

    const delResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/deals?id=eq.${encodeURIComponent(id)}`,
      { method: 'DELETE', headers: getSupabaseWriteHeaders(supabaseKey) }
    );
    if (!delResp.ok && delResp.status !== 204) {
      return NextResponse.json({ error: 'Failed to delete deal.' }, { status: 502 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error('Delete deal error', { requestId: getRequestId(request), error: err.message });
    return NextResponse.json({ error: 'Failed to delete deal.' }, { status: 500 });
  }
}

/**
 * Compute deal-level aggregate metrics from enriched participants.
 * Returned alongside the deal to avoid a second round-trip in the portal.
 */
function buildDealSummary(type, participants) {
  const completed = participants.filter((p) => p.status === 'complete' && p.report);

  if (completed.length === 0) {
    return { completedCount: 0, totalCount: participants.length };
  }

  const totalCost = completed.reduce((sum, p) => sum + (p.report?.totalAnnualCost || 0), 0);
  const totalSavings = completed.reduce((sum, p) => sum + (p.report?.potentialSavings || 0), 0);
  const avgAutomation = completed.length
    ? Math.round(completed.reduce((sum, p) => sum + (p.report?.automationPercentage || 0), 0) / completed.length)
    : null;

  const base = {
    completedCount: completed.length,
    totalCount: participants.length,
    totalAnnualCost: totalCost,
    totalPotentialSavings: totalSavings,
    avgAutomationPercentage: avgAutomation,
  };

  if (type === 'pe_rollup') {
    // Identify the best-performing company (lowest cost per process, highest automation)
    const sorted = [...completed].sort((a, b) => (b.report?.automationPercentage || 0) - (a.report?.automationPercentage || 0));
    const benchmark = sorted[0];
    return {
      ...base,
      benchmarkCompany: benchmark ? { participantId: benchmark.id, companyName: benchmark.companyName, automationPercentage: benchmark.report?.automationPercentage } : null,
    };
  }

  if (type === 'ma') {
    const acquirer = completed.find((p) => p.role === 'acquirer');
    const target = completed.find((p) => p.role === 'target');
    return {
      ...base,
      acquirerCost: acquirer?.report?.totalAnnualCost || null,
      targetCost: target?.report?.totalAnnualCost || null,
      combinedBaseline: (acquirer?.report?.totalAnnualCost || 0) + (target?.report?.totalAnnualCost || 0),
    };
  }

  if (type === 'scaling') {
    const totalProcesses = completed.reduce((sum, p) => sum + (p.report?.processCount || 0), 0);
    const totalRawSteps = completed.reduce((sum, p) => sum + ((p.report?.rawSteps?.length) || 0), 0);
    return {
      ...base,
      totalProcesses,
      totalRawSteps,
      topOpportunity: completed
        .map((p) => ({ participantId: p.id, companyName: p.companyName, savings: p.report?.potentialSavings || 0 }))
        .sort((a, b) => b.savings - a.savings)[0] || null,
    };
  }

  return base;
}
