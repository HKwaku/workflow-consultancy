import { NextResponse } from 'next/server';
import { getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase, checkOrigin, getRequestId } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
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
    // Fetch deal
    const dealResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/deals?id=eq.${encodeURIComponent(id)}&select=*`,
      { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
    );
    if (!dealResp.ok) return NextResponse.json({ error: 'Failed to fetch deal.' }, { status: 502 });
    const [deal] = await dealResp.json();
    if (!deal) return NextResponse.json({ error: 'Deal not found.' }, { status: 404 });

    // Auth check: must be owner or participant
    const isOwner = deal.owner_email === auth.email;
    if (!isOwner) {
      const partCheckResp = await fetchWithTimeout(
        `${supabaseUrl}/rest/v1/deal_participants?deal_id=eq.${id}&participant_email=eq.${encodeURIComponent(auth.email)}&select=id`,
        { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
      );
      const partRows = partCheckResp.ok ? await partCheckResp.json() : [];
      if (!partRows.length) return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
    }

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
      participantEmail: isOwner ? p.participant_email : undefined, // hide emails from non-owners
      participantName: p.participant_name,
      status: p.status,
      inviteUrl: isOwner ? `${baseUrl}/process-audit?participant=${p.invite_token}` : undefined,
      reportId: p.report_id,
      report: p.report_id ? reportSummaries[p.report_id] || null : null,
      invitedAt: p.invited_at,
      completedAt: p.completed_at,
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
        ownerEmail: isOwner ? deal.owner_email : undefined,
        isOwner,
        createdAt: deal.created_at,
        updatedAt: deal.updated_at,
      },
      participants: enrichedParticipants,
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
    // Verify ownership
    const checkResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/deals?id=eq.${encodeURIComponent(id)}&select=id,owner_email`,
      { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
    );
    const [deal] = checkResp.ok ? await checkResp.json() : [];
    if (!deal) return NextResponse.json({ error: 'Deal not found.' }, { status: 404 });
    if (deal.owner_email !== auth.email) return NextResponse.json({ error: 'Only the deal owner can update it.' }, { status: 403 });

    // Build update payload — only allow safe fields
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

  return base;
}
