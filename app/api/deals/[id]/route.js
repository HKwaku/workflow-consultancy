import { NextResponse } from 'next/server';
import { getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase, checkOrigin, getRequestId } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { resolveDealAccess, requireDealEditor, requireDealOwner } from '@/lib/dealAuth';
import { logger } from '@/lib/logger';
import { deriveProcessMetrics } from '@/lib/processMetrics';
import { loadDecidedChangesByProcess } from '@/lib/changes/repo';
import { decidedSavingsFromChanges } from '@/lib/changes/savings';

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
    // Auth check: owner, collaborator, or participant. resolveDealAccess
    // returns null both when the deal doesn't exist and when the caller
    // isn't allowed to see it; differentiate here so a stale URL gets a
    // clear 404 instead of a misleading 403.
    const sbHeaders = getSupabaseHeaders(supabaseKey);
    const existsResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/deals?id=eq.${encodeURIComponent(id)}&select=id&limit=1`,
      { method: 'GET', headers: sbHeaders },
    );
    const existsRows = existsResp.ok ? await existsResp.json() : [];
    if (!existsRows.length) {
      return NextResponse.json({ error: 'Deal not found.' }, { status: 404 });
    }
    const access = await resolveDealAccess({ dealId: id, email: auth.email, userId: auth.userId });
    if (!access) return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
    const deal = access.deal;
    const isOwner = access.mode === 'owner';
    const canSeePII = access.canManage; // owner or collaborator

    // Parallelise the three independent reads (participants, flows,
    // auxiliary stats) so the wall-clock cost is one Supabase round-
    // trip instead of three. Auxiliary stats internally already
    // parallelises its two sub-fetches. Trim select= to the columns
    // actually consumed below to cut payload size.
    const headers = getSupabaseHeaders(supabaseKey);
    // Living-workspace migration: deal_participants.report_id and
    // deal_flows.report_id columns renamed to process_id.
    const PARTICIPANT_COLS = 'id,role,company_name,participant_email,participant_name,invite_token,process_id,status,invited_at,completed_at';
    const FLOW_COLS = 'id,participant_id,label,flow_kind,process_id,status,created_at,updated_at';
    const [partResp, flowsResp, auxiliary] = await Promise.all([
      fetchWithTimeout(
        `${supabaseUrl}/rest/v1/deal_participants?deal_id=eq.${id}&select=${PARTICIPANT_COLS}&order=created_at.asc`,
        { method: 'GET', headers },
      ),
      fetchWithTimeout(
        `${supabaseUrl}/rest/v1/deal_flows?deal_id=eq.${encodeURIComponent(id)}&select=${FLOW_COLS}&order=created_at.asc`,
        { method: 'GET', headers },
      ),
      buildDealAuxiliaryStats({ dealId: deal.id, supabaseUrl, supabaseKey }),
    ]);
    const participants = partResp.ok ? await partResp.json() : [];
    const flowRows = flowsResp.ok ? await flowsResp.json() : [];

    // Combined report fetch: union of report_ids referenced from
    // participants AND flows, in a single query, instead of two
    // sequential queries (the second of which dedupes against the
    // first). Detail columns are only needed for the participant
    // path, so we only run the heavy SELECT on participant ids and
    // the lighter SELECT on flow-only extras.
    const participantReportIds = participants.filter((p) => p.process_id).map((p) => p.process_id);
    const flowOnlyReportIds = flowRows
      .map((f) => f.process_id)
      .filter(Boolean)
      .filter((rid) => !participantReportIds.includes(rid));
    const reportSummaries = {};

    // Living-workspace migration: cost / savings / automation columns
    // dropped; diagnostic_data renamed to flow_data. Cost / savings are
    // derived on-the-fly from step minutes — leave the headline numbers
    // as null until we wire computeProcessCost(steps) here too.
    const PROCESS_SELECT = 'id,created_at,updated_at,flow_data';

    const [participantReportsResp, flowOnlyReportsResp] = await Promise.all([
      participantReportIds.length
        ? fetchWithTimeout(
          `${supabaseUrl}/rest/v1/processes?id=in.(${participantReportIds.map(encodeURIComponent).join(',')})&select=${PROCESS_SELECT}`,
          { method: 'GET', headers },
        )
        : Promise.resolve(null),
      flowOnlyReportIds.length
        ? fetchWithTimeout(
          `${supabaseUrl}/rest/v1/processes?id=in.(${flowOnlyReportIds.map(encodeURIComponent).join(',')})&select=${PROCESS_SELECT}`,
          { method: 'GET', headers },
        )
        : Promise.resolve(null),
    ]);

    const buildSummary = (r) => {
      const dd = r.flow_data || {};
      const rawSteps = (dd.rawProcesses?.[0]?.steps || []).slice(0, 150).map((s) => ({
        name: s.name || '',
        department: s.department || '',
        isDecision: !!s.isDecision,
        isExternal: !!s.isExternal,
        workMinutes: s.workMinutes ?? null,
        waitMinutes: s.waitMinutes ?? null,
        systems: Array.isArray(s.systems) ? s.systems.filter((x) => typeof x === 'string') : [],
        durationMinutes: s.durationMinutes || s.workMinutes || 0,
      }));
      const m = deriveProcessMetrics(r);
      return {
        id: r.id,
        totalAnnualCost:     m.total_annual_cost,
        // Decided-changes only; enriched from the changes table below.
        potentialSavings:    0,
        automationPercentage: m.automation_percentage,
        automationGrade:     m.automation_grade,
        processCount: dd.summary?.totalProcesses || dd.processes?.length || 0,
        processes: (dd.processes || []).map((p) => ({
          name: p.name,
          annualCost: p.annualCost,
          stepsCount: p.stepsCount,
          quality: p.quality,
          automationPct: p.automationPct,
        })),
        rawSteps,
        reportUrl: `/workspace/map?view=${r.id}`,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    };

    if (participantReportsResp?.ok) {
      const reports = await participantReportsResp.json();
      for (const r of reports) reportSummaries[r.id] = buildSummary(r);
    }
    if (flowOnlyReportsResp?.ok) {
      for (const r of await flowOnlyReportsResp.json()) reportSummaries[r.id] = buildSummary(r);
    }

    // Potential savings = accepted/decided changes per underlying process.
    // One batched query across every report on the deal; absent = £0.
    const decidedByProcess = await loadDecidedChangesByProcess(Object.keys(reportSummaries));
    for (const [pid, summary] of Object.entries(reportSummaries)) {
      const changes = decidedByProcess.get(pid);
      if (changes) summary.potentialSavings = decidedSavingsFromChanges(changes, summary.totalAnnualCost);
    }

    const enrichedParticipants = participants.map((p) => ({
      id: p.id,
      role: p.role,
      companyName: p.company_name,
      participantEmail: canSeePII ? p.participant_email : undefined,
      participantName: p.participant_name,
      status: p.status,
      inviteUrl: canSeePII ? `${baseUrl}/workspace/map?participant=${p.invite_token}` : undefined,
      // Legacy field name `reportId` retained in the API response for
      // client back-compat — DB column underneath is `process_id`.
      reportId: p.process_id,
      report: p.process_id ? reportSummaries[p.process_id] || null : null,
      invitedAt: p.invited_at,
      completedAt: p.completed_at,
    }));
    const flows = flowRows.map((f) => ({
      id: f.id,
      participantId: f.participant_id,
      label: f.label,
      flowKind: f.flow_kind,
      reportId: f.process_id,
      status: f.status,
      createdAt: f.created_at,
      updatedAt: f.updated_at,
      report: f.process_id ? reportSummaries[f.process_id] || null : null,
      startUrl: f.process_id ? null : `/workspace/map?dealFlowId=${encodeURIComponent(f.id)}`,
      openUrl: f.process_id ? `/workspace/map?dealFlowId=${encodeURIComponent(f.id)}&resume=1` : null,
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
      summary: {
        ...buildDealSummary(deal.type, enrichedParticipants),
        ...auxiliary,
      },
    }, {
      // Short browser cache so back/forward and tab-revisits within
      // 5 s skip the server entirely. private = per-user (response
      // varies by Authorization). stale-while-revalidate gives a
      // cheap snappy navigation while a fresh fetch runs in the bg.
      headers: { 'Cache-Control': 'private, max-age=5, stale-while-revalidate=30' },
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
    // Living-workspace contract: deals don't terminate. Allow flipping
    // between draft / collecting (active lifecycle states) but reject
    // 'complete' — there is no done state for a living deal.
    if (body.status && ['draft', 'collecting'].includes(body.status)) update.status = body.status;
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
/**
 * DELETE /api/deals/[id]
 *
 * Two-phase cascading deletion:
 *   Phase 1 — `?confirm=1` is OMITTED → returns an "impact" payload
 *     listing every child that would be deleted. The client renders
 *     this in a confirmation dialog so the owner can see exactly what
 *     they're about to lose. NOTHING is deleted.
 *   Phase 2 — `?confirm=1` IS present → actually deletes the deal AND
 *     every dependent row across 11 child tables, plus storage files
 *     for any documents on the deal. Diagnostic_reports survive (the
 *     participants' own work) but get unlinked (deal_id → null).
 *
 * Owner-only. Audit log entries are preserved for forensics; their
 * deal_id remains set so the audit trail still surfaces "deal X
 * deleted" downstream.
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

    const confirm = request.nextUrl.searchParams.get('confirm') === '1';
    const headers = getSupabaseHeaders(supabaseKey);
    const writeHeaders = getSupabaseWriteHeaders(supabaseKey);

    // Helper: count rows for a child table by deal_id.
    const countBy = async (table) => {
      try {
        const r = await fetchWithTimeout(
          `${supabaseUrl}/rest/v1/${table}?deal_id=eq.${encodeURIComponent(id)}&select=id`,
          { method: 'GET', headers: { ...headers, Prefer: 'count=exact', Range: '0-0' } },
        );
        const range = r.headers.get('content-range') || '';
        const m = range.match(/\/(\d+)$/);
        if (m) return parseInt(m[1], 10);
        const rows = await r.json().catch(() => []);
        return Array.isArray(rows) ? rows.length : 0;
      } catch { return 0; }
    };

    // Hydrate the deal name + all child counts in parallel for the
    // impact preview. This is the response when ?confirm=1 is missing.
    const dealResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/deals?id=eq.${encodeURIComponent(id)}&select=name,deal_code,type,collaborator_emails`,
      { method: 'GET', headers },
    );
    const dealRow = dealResp.ok ? (await dealResp.json().catch(() => []))[0] : null;
    if (!dealRow) return NextResponse.json({ error: 'Deal not found.' }, { status: 404 });

    // Living-workspace migration: deal_analyses dropped — count omitted.
    const [
      participants, flows, documents, chunks,
      findings, findingComments, findingReviews, qaItems,
      bindings, sessions,
    ] = await Promise.all([
      countBy('deal_participants'),
      countBy('deal_flows'),
      countBy('deal_documents'),
      countBy('deal_document_chunks'),
      countBy('deal_findings'),
      countBy('deal_finding_comments'),
      countBy('deal_finding_reviews'),
      countBy('deal_qa_items'),
      countBy('deal_connector_bindings'),
      countBy('chat_sessions'),
    ]);
    const analyses = 0;

    // Processes are unlinked, not deleted — they're the participants' work.
    const reportsResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/processes?deal_id=eq.${encodeURIComponent(id)}&select=id`,
      { method: 'GET', headers },
    );
    const linkedReports = reportsResp.ok ? (await reportsResp.json().catch(() => [])).length : 0;

    const impact = {
      deal: { id, name: dealRow.name, dealCode: dealRow.deal_code, type: dealRow.type },
      counts: {
        participants, flows, documents, document_chunks: chunks,
        analyses, findings, finding_comments: findingComments,
        finding_reviews: findingReviews, qa_items: qaItems,
        connector_bindings: bindings, chat_sessions: sessions,
      },
      reports_unlinked: linkedReports,
      collaborators_revoked: Array.isArray(dealRow.collaborator_emails) ? dealRow.collaborator_emails.length : 0,
    };

    if (!confirm) {
      // Dry-run — return the impact preview WITHOUT deleting anything.
      return NextResponse.json({ success: true, dryRun: true, impact });
    }

    // ── Phase 2: actual deletion. Order matters because some FKs may
    // not be CASCADE — explicit deletes guarantee a clean teardown
    // regardless of the schema's FK actions. Each step is best-effort
    // (4xx/5xx logged, not fatal) so a partial failure on one child
    // doesn't leave the parent deal stuck behind. ──

    // 0. Storage: delete every file under deal-documents/<dealId>/. Best
    //    effort; if storage is misconfigured we still proceed with the
    //    DB cascade so the user isn't blocked.
    try {
      const listResp = await fetchWithTimeout(
        `${supabaseUrl}/storage/v1/list/deal-documents`,
        {
          method: 'POST',
          headers: { ...writeHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefix: `${id}/`, limit: 1000 }),
        },
      );
      if (listResp.ok) {
        const files = await listResp.json().catch(() => []);
        const paths = (files || []).map((f) => `${id}/${f.name}`).filter(Boolean);
        if (paths.length) {
          await fetchWithTimeout(
            `${supabaseUrl}/storage/v1/object/deal-documents`,
            {
              method: 'DELETE',
              headers: { ...writeHeaders, 'Content-Type': 'application/json' },
              body: JSON.stringify({ prefixes: paths }),
            },
          );
        }
      }
    } catch (e) {
      logger.warn('Deal delete: storage cleanup failed (continuing)', { dealId: id, error: e.message });
    }

    // 1. Chat messages + sessions. chat_artefacts table dropped in the
    //    living-workspace migration — sessions own messages via session_id.
    try {
      const sessResp = await fetchWithTimeout(
        `${supabaseUrl}/rest/v1/chat_sessions?deal_id=eq.${encodeURIComponent(id)}&select=id`,
        { method: 'GET', headers },
      );
      const sessIds = sessResp.ok ? (await sessResp.json().catch(() => [])).map((r) => r.id) : [];
      if (sessIds.length) {
        const inList = sessIds.map(encodeURIComponent).join(',');
        await fetchWithTimeout(
          `${supabaseUrl}/rest/v1/chat_messages?session_id=in.(${inList})`,
          { method: 'DELETE', headers: writeHeaders },
        );
      }
      await fetchWithTimeout(
        `${supabaseUrl}/rest/v1/chat_sessions?deal_id=eq.${encodeURIComponent(id)}`,
        { method: 'DELETE', headers: writeHeaders },
      );
    } catch (e) {
      logger.warn('Deal delete: chat cleanup failed (continuing)', { dealId: id, error: e.message });
    }

    // 2. Living-workspace migration: deal_analyses dropped — removed
    //    from the cleanup list. Findings / reviews / comments now hang
    //    directly on (deal_id, finding_key) so they still need cleaning
    //    in the same order.
    const cleanupOrder = [
      'deal_finding_comments',
      'deal_finding_reviews',
      'deal_findings',
      'deal_qa_items',
      'deal_document_chunks',
      'deal_documents',
      'deal_connector_bindings',
      'deal_flows',
      'deal_participants',
    ];
    for (const table of cleanupOrder) {
      try {
        await fetchWithTimeout(
          `${supabaseUrl}/rest/v1/${table}?deal_id=eq.${encodeURIComponent(id)}`,
          { method: 'DELETE', headers: writeHeaders },
        );
      } catch (e) {
        logger.warn(`Deal delete: ${table} cleanup failed (continuing)`, { dealId: id, error: e.message });
      }
    }

    // 3. Unlink (don't delete) any processes tied to this deal.
    //    Processes are the participants' own work and outlive the deal.
    //    Living-workspace migration: table renamed, deal_role column gone.
    try {
      await fetchWithTimeout(
        `${supabaseUrl}/rest/v1/processes?deal_id=eq.${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: { ...writeHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify({ deal_id: null }),
        },
      );
    } catch (e) {
      logger.warn('Deal delete: process unlink failed (continuing)', { dealId: id, error: e.message });
    }

    // 4. The deal itself.
    const delResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/deals?id=eq.${encodeURIComponent(id)}`,
      { method: 'DELETE', headers: writeHeaders },
    );
    if (!delResp.ok && delResp.status !== 204) {
      logger.error('Deal delete failed at final step', { dealId: id, status: delResp.status });
      return NextResponse.json({ error: 'Failed to delete deal.' }, { status: 502 });
    }
    return NextResponse.json({ success: true, deleted: { ...impact, dealName: dealRow.name } });
  } catch (err) {
    logger.error('Delete deal error', { requestId: getRequestId(request), error: err.message, stack: err.stack });
    return NextResponse.json({ error: 'Failed to delete deal.' }, { status: 500 });
  }
}

/**
 * Compute deal-level aggregate metrics from enriched participants.
 * Returned alongside the deal to avoid a second round-trip in the portal.
 */
/**
 * Counts that aren't derivable from the participant list — documents in
 * the data room and the latest analysis status. Best-effort: any failure
 * returns null fields so the deal page still renders.
 */
async function buildDealAuxiliaryStats({ dealId, supabaseUrl, supabaseKey }) {
  try {
    const headers = getSupabaseHeaders(supabaseKey);
    // Living-workspace migration: deal_analyses table dropped. No more
    // latest-run status to surface; findings are live editable rows on
    // the deal directly.
    const docsResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/deal_documents?deal_id=eq.${dealId}&select=id,status`,
      { method: 'GET', headers },
    );
    const docs = docsResp.ok ? await docsResp.json() : [];
    return {
      documentsTotal: docs.length,
      documentsReady: docs.filter((d) => d.status === 'ready').length,
      latestAnalysisMode: null,
      latestAnalysisStatus: null,
    };
  } catch {
    return { documentsTotal: null, documentsReady: null, latestAnalysisMode: null, latestAnalysisStatus: null };
  }
}

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
