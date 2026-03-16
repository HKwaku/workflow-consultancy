import { NextResponse } from 'next/server';
import { getSupabaseHeaders, getSupabaseWriteHeaders, isValidUUID, requireSupabase, fetchWithTimeout, getRequestId, checkOrigin } from '@/lib/api-helpers';
import { GetDiagnosticPatchSchema } from '@/lib/ai-schemas';
import { verifySupabaseSession, requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export async function GET(request) {
  try {
    const sp = request.nextUrl.searchParams;
    const id = sp.get('id');
    const redesignId = sp.get('redesignId');
    const editable = sp.get('editable');
    const editRedesign = sp.get('editRedesign') === '1';

    if (!id) return NextResponse.json({ error: 'Report ID is required. Use ?id=xxx' }, { status: 400 });
    if (!isValidUUID(id)) return NextResponse.json({ error: 'Invalid report ID format.' }, { status: 400 });

    const rl = checkRateLimit(getRateLimitKey(request));
    if (!rl.allowed) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

    const sbConfig = requireSupabase();
    if (!sbConfig) return NextResponse.json({ error: 'Report storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;

    if (editable === 'true') {
      const session = await verifySupabaseSession(request);
      if (!session) return NextResponse.json({ error: 'Authentication required for editing.' }, { status: 401 });
      const email = session.email;
      const editHeaders = getSupabaseHeaders(supabaseKey);
      const url = `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${id}&select=id,contact_email,contact_name,company,diagnostic_data,created_at`;
      const sbResp = await fetchWithTimeout(url, { method: 'GET', headers: editHeaders });
      if (!sbResp.ok) return NextResponse.json({ error: 'Failed to fetch report.' }, { status: 502 });
      let rows;
      try { rows = await sbResp.json(); } catch (e) { logger.error('Get diagnostic (editable): Supabase parse error', { requestId: getRequestId(request), error: e.message }); return NextResponse.json({ error: 'Failed to fetch report.' }, { status: 502 }); }
      if (!rows || rows.length === 0) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });

    const report = rows[0];
    const editReportEmail = (report.contact_email || '').toString().toLowerCase();
    if (editReportEmail !== email.toLowerCase()) {
        return NextResponse.json({ error: 'You do not have permission to edit this diagnostic.' }, { status: 403 });
      }
      const diagData = report.diagnostic_data || {};
      let rawProcesses = diagData.rawProcesses;

      if (editRedesign) {
        const rdUrl = `${supabaseUrl}/rest/v1/report_redesigns?report_id=eq.${encodeURIComponent(id)}&select=redesign_data,status,accepted_at&order=created_at.desc&limit=1`;
        const rdResp = await fetchWithTimeout(rdUrl, { method: 'GET', headers: editHeaders });
        let rdRows = [];
        if (rdResp.ok) {
          try { rdRows = await rdResp.json(); } catch (e) { rdRows = []; }
        }
        const rd = rdRows?.[0];
        const rdData = rd?.redesign_data || diagData.redesign || {};
        const redesignProcs = rdData.acceptedProcesses ?? rdData.optimisedProcesses ?? [];
        if (redesignProcs && redesignProcs.length > 0) {
          rawProcesses = redesignProcs.map((op) => ({
            processName: op.processName || op.name,
            processType: op.processType || 'other',
            steps: (op.steps || [])
              .filter((s) => s.status !== 'removed')
              .map((s, si) => ({
                number: s.number ?? si + 1,
                name: s.name || s.stepName || `Step ${si + 1}`,
                department: s.department || '',
                isDecision: !!s.isDecision,
                isExternal: !!s.isExternal,
                branches: s.branches || [],
              })),
            handoffs: op.handoffs || [],
          }));
        } else if (editRedesign) {
          return NextResponse.json({ error: 'No redesign found to edit. Generate an AI redesign first.' }, { status: 404 });
        }
      }

      if (!rawProcesses || rawProcesses.length === 0) {
        const processes = diagData.processes || [];
        rawProcesses = processes.map(function (p) {
          return {
            processName: p.name || 'Process', processType: p.type || 'other',
            definition: { startsWhen: '', completesWhen: '', complexity: 'complex', departments: [] },
            lastExample: { name: '', startDate: '', endDate: '', elapsedDays: p.elapsedDays || 0 },
            userTime: { meetings: 0, emails: 0, execution: 0, waiting: 0, total: 0 },
            timeAccuracy: 'confident', performance: 'typical', issues: [], biggestDelay: '', delayDetails: '',
            steps: (p.steps || []).map(function (s, si) {
              return { number: si + 1, name: s.name || 'Step ' + (si + 1), department: s.department || 'Operations', isDecision: s.isDecision || false, isExternal: s.isExternal || false, branches: s.branches || [] };
            }),
            handoffs: [], systems: [], approvals: [], knowledge: {}, newHire: {},
            frequency: { type: 'monthly', annual: 12, inFlight: 0, progressing: 0, stuck: 0, waiting: 0 },
            costs: { hourlyRate: 50, instanceCost: 0, annualUserCost: 0, totalAnnualCost: p.annualCost || 0, teamSize: p.teamSize || 1 },
            savings: {}, priority: {}, bottleneck: {}
          };
        });
      }
      return NextResponse.json({
        success: true,
        report: {
          id: report.id, contactEmail: report.contact_email, contactName: report.contact_name,
          company: report.company, createdAt: report.created_at,
          contact: diagData.contact || {}, rawProcesses, customDepartments: diagData.customDepartments || [],
          editRedesign: editRedesign || undefined,
        }
      });
    }

    // Read-only view: public by design for shareable links (UUID is unguessable)
    const sbHeaders = getSupabaseHeaders(supabaseKey);
    const url = `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${id}&select=id,contact_email,contact_name,company,lead_score,lead_grade,diagnostic_data,diagnostic_mode,created_at,updated_at`;
    const sbResp = await fetchWithTimeout(url, { method: 'GET', headers: sbHeaders });
    if (!sbResp.ok) return NextResponse.json({ error: 'Failed to fetch report from storage.' }, { status: 502 });
    let rows;
    try { rows = await sbResp.json(); } catch (e) { logger.error('Get diagnostic: Supabase parse error', { requestId: getRequestId(request), error: e.message }); return NextResponse.json({ error: 'Failed to fetch report from storage.' }, { status: 502 }); }
    if (!rows || rows.length === 0) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });

    const report = rows[0];
    const diagData = report.diagnostic_data || {};

    // Fetch redesign from dedicated table (fall back to diagnostic_data)
    let redesign = diagData.redesign || null;
    try {
      const rdUrl = redesignId
        ? `${supabaseUrl}/rest/v1/report_redesigns?report_id=eq.${id}&id=eq.${redesignId}&select=redesign_data,decisions,status,accepted_at`
        : `${supabaseUrl}/rest/v1/report_redesigns?report_id=eq.${id}&select=redesign_data,decisions,status,accepted_at&order=created_at.desc&limit=1`;
      const rdResp = await fetchWithTimeout(rdUrl, { method: 'GET', headers: sbHeaders });
      let rdRows;
      try { rdRows = rdResp.ok ? await rdResp.json() : []; } catch (e) { rdRows = []; }
      if (rdRows.length > 0) {
        const rd = rdRows[0];
        redesign = { ...rd.redesign_data, decisions: rd.decisions || {}, acceptedAt: rd.accepted_at };
        if (rd.status === 'accepted' && rd.redesign_data?.acceptedProcesses) {
          redesign.acceptedProcesses = rd.redesign_data.acceptedProcesses;
        }
      }
    } catch { /* fall back to diagnostic_data.redesign */ }

    if (redesign) diagData.redesign = redesign;

    const session = await verifySupabaseSession(request);
    const isOwner = session && report.contact_email && report.contact_email.toLowerCase() === session.email.toLowerCase();
    if (!isOwner && diagData.costAnalysisToken) {
      const { costAnalysisToken, ...rest } = diagData;
      Object.assign(diagData, rest);
      delete diagData.costAnalysisToken;
    }

    let costDataHiddenToOwner = false;
    if (isOwner && diagData.costCompletedByManager) {
      costDataHiddenToOwner = true;
      delete diagData.costAnalysisToken;
      if (diagData.summary) {
        diagData.summary = { ...diagData.summary, totalAnnualCost: 0, potentialSavings: 0 };
      }
      if (Array.isArray(diagData.processes)) {
        diagData.processes = diagData.processes.map((p) => ({ ...p, annualCost: 0 }));
      }
      if (Array.isArray(diagData.rawProcesses)) {
        diagData.rawProcesses = diagData.rawProcesses.map((rp) => {
          const { costs, ...rest } = rp;
          return costs ? { ...rest, costs: {} } : rest;
        });
      }
      if (diagData.redesign?.costSummary) {
        diagData.redesign = { ...diagData.redesign, costSummary: null };
      }
    }

    return NextResponse.json({
      success: true,
      report: {
        id: report.id, contactEmail: report.contact_email, contactName: report.contact_name,
        company: report.company, leadScore: report.lead_score, leadGrade: report.lead_grade,
        diagnosticMode: report.diagnostic_mode,
        diagnosticData: diagData, createdAt: report.created_at, updatedAt: report.updated_at,
        costDataHiddenToOwner: costDataHiddenToOwner || undefined,
      }
    });
  } catch (error) {
    logger.error('Get diagnostic error', { requestId: getRequestId(request), error: error.message, stack: error.stack });
    return NextResponse.json({ error: 'Failed to retrieve diagnostic report.' }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const originErr = checkOrigin(request);
    if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });
    const auth = await requireAuth(request);
    if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

    const rl = checkRateLimit(getRateLimitKey(request));
    if (!rl.allowed) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

    const sp = request.nextUrl.searchParams;
    const id = sp.get('id');
    if (!id || !isValidUUID(id)) return NextResponse.json({ error: 'Valid report ID required.' }, { status: 400 });

    const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
    if (contentLength > 2 * 1024 * 1024) return NextResponse.json({ error: 'Request body too large.' }, { status: 413 });

    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
    const parsed = GetDiagnosticPatchSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'steps array is required (1-500 steps).' }, { status: 400 });
    const { steps, processIndex } = parsed.data;

    const sbConfig = requireSupabase();
    if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;

    const readResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${id}&select=id,contact_email,diagnostic_data`, { method: 'GET', headers: getSupabaseHeaders(supabaseKey) });
    if (!readResp.ok) return NextResponse.json({ error: 'Failed to read report.' }, { status: 502 });
    let rows;
    try { rows = await readResp.json(); } catch (e) { logger.error('PATCH diagnostic: Supabase parse error', { requestId: getRequestId(request), error: e.message }); return NextResponse.json({ error: 'Failed to read report.' }, { status: 502 }); }
    if (!rows || rows.length === 0) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });

    const row = rows[0];
    const reportEmail = (row.contact_email || '').toString().toLowerCase();
    if (reportEmail !== auth.email.toLowerCase()) {
      return NextResponse.json({ error: 'You do not have permission to edit this report.' }, { status: 403 });
    }

    const dd = row.diagnostic_data || {};
    const pi = processIndex || 0;

    if (!dd.rawProcesses) dd.rawProcesses = [];
    if (dd.rawProcesses.length > pi && dd.rawProcesses[pi]) {
      dd.rawProcesses[pi].steps = steps;
    } else {
      const procName = (dd.processes && dd.processes[pi]) ? dd.processes[pi].name : 'Process';
      while (dd.rawProcesses.length <= pi) dd.rawProcesses.push({ processName: procName, steps: [] });
      dd.rawProcesses[pi].steps = steps;
      dd.rawProcesses[pi].processName = procName;
    }

    if (dd.processes && dd.processes[pi]) {
      dd.processes[pi].steps = steps.map(function(s, si) {
        return { number: si + 1, name: s.name || '', department: s.department || '', isDecision: !!s.isDecision, isExternal: !!s.isExternal, branches: s.branches || [] };
      });
    }

    const writeResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${id}`, {
      method: 'PATCH', headers: getSupabaseWriteHeaders(supabaseKey),
      body: JSON.stringify({ diagnostic_data: dd, updated_at: new Date().toISOString() })
    });
    if (!writeResp.ok) { const t = await writeResp.text(); return NextResponse.json({ error: 'Write failed: ' + t }, { status: 502 }); }
    return NextResponse.json({ success: true, stepsCount: steps.length });
  } catch (e) {
    logger.error('PATCH diagnostic error', { requestId: getRequestId(request), error: e.message, stack: e.stack });
    return NextResponse.json({ error: e.message || 'Failed to update report.' }, { status: 500 });
  }
}
