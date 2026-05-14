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

    if (!id) return NextResponse.json({ error: 'Report ID is required. Use ?id=xxx' }, { status: 400 });
    if (!isValidUUID(id)) return NextResponse.json({ error: 'Invalid report ID format.' }, { status: 400 });

    const rl = await checkRateLimit(getRateLimitKey(request));
    if (!rl.allowed) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

    const sbConfig = requireSupabase();
    if (!sbConfig) return NextResponse.json({ error: 'Report storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;

    if (editable === 'true') {
      const session = await verifySupabaseSession(request);
      if (!session) return NextResponse.json({ error: 'Authentication required for editing.' }, { status: 401 });
      const email = session.email;
      const editHeaders = getSupabaseHeaders(supabaseKey);
      // Living-workspace migration: target_data + state_kind dropped.
      // A process is a single living thing — no separate target surface.
      // We keep the `surface` echo for client back-compat but always
      // serve the live flow.
      const surface = sp.get('surface') === 'target' ? 'target' : 'current';
      const url = `${supabaseUrl}/rest/v1/processes?id=eq.${id}&select=id,contact_email,contact_name,company,flow_data,created_at`;
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
      const diagData = report.flow_data || {};
      let rawProcesses = diagData.rawProcesses;

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
              return { number: si + 1, name: s.name || 'Step ' + (si + 1), department: s.department || 'Operations', isDecision: s.isDecision || false, isMerge: s.isMerge || false, parallel: s.parallel || false, inclusive: s.inclusive || false, isExternal: s.isExternal || false, branches: s.branches || [] };
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
          // Surface echo kept for client back-compat — target_data is
          // gone, so there's never a "target" to flip to.
          surface,
          stateKind: null,
          hasTarget: false,
        }
      });
    }

    // Read-only view: public by design for shareable links (UUID is unguessable).
    // Living-workspace migration: lead_score, lead_grade, and diagnostic_mode
    // are dropped columns. implementation_status still exists on the table
    // but the surface that consumed it (ImplementationTracker) is gone, so
    // we deliberately don't pull it. Pull only what survives + is used.
    const sbHeaders = getSupabaseHeaders(supabaseKey);
    const url = `${supabaseUrl}/rest/v1/processes?id=eq.${id}&select=id,contact_email,contact_name,company,flow_data,parent_report_id,created_at,updated_at`;
    let sbResp = await fetchWithTimeout(url, { method: 'GET', headers: sbHeaders });

    if (sbResp.status === 400) {
      const errBody = await sbResp.text().catch(() => '');
      logger.warn('Get diagnostic: column error, falling back to minimal query', { requestId: getRequestId(request), sbError: errBody.slice(0, 200) });
      const fallbackUrl = `${supabaseUrl}/rest/v1/processes?id=eq.${id}&select=id,contact_email,contact_name,company,flow_data,created_at,updated_at`;
      sbResp = await fetchWithTimeout(fallbackUrl, { method: 'GET', headers: sbHeaders });
    }

    if (!sbResp.ok) {
      const errBody = await sbResp.text().catch(() => '');
      logger.error('Get diagnostic: Supabase error', { requestId: getRequestId(request), status: sbResp.status, sbError: errBody.slice(0, 300) });
      return NextResponse.json({ error: 'Failed to fetch report from storage.' }, { status: 502 });
    }
    let rows;
    try { rows = await sbResp.json(); } catch (e) { logger.error('Get diagnostic: Supabase parse error', { requestId: getRequestId(request), error: e.message }); return NextResponse.json({ error: 'Failed to fetch report from storage.' }, { status: 502 }); }
    if (!rows || rows.length === 0) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });

    const report = rows[0];
    const diagData = report.flow_data || {};

    // Living-workspace migration: report_redesigns dropped. Any redesign
    // captured before the cut still lives on flow_data.redesign; new
    // suggestions are inline `changes` rows.

    // The cost-analyst handoff (token-gated read access for a consultant)
    // is gone — owners always edit costs directly on the canvas. The
    // costAuthorizedEmails / costAnalysisToken gating that used to scrub
    // cost data for non-authorised viewers is removed; access control
    // happens at the RLS / contact_email level on the row itself.

    return NextResponse.json({
      success: true,
      report: {
        id: report.id, contactEmail: report.contact_email, contactName: report.contact_name,
        company: report.company,
        diagnosticData: diagData, createdAt: report.created_at, updatedAt: report.updated_at,
        parentReportId: report.parent_report_id || null,
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

    const rl = await checkRateLimit(getRateLimitKey(request));
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

    const readResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/processes?id=eq.${id}&select=id,contact_email,flow_data`, { method: 'GET', headers: getSupabaseHeaders(supabaseKey) });
    if (!readResp.ok) return NextResponse.json({ error: 'Failed to read report.' }, { status: 502 });
    let rows;
    try { rows = await readResp.json(); } catch (e) { logger.error('PATCH diagnostic: Supabase parse error', { requestId: getRequestId(request), error: e.message }); return NextResponse.json({ error: 'Failed to read report.' }, { status: 502 }); }
    if (!rows || rows.length === 0) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });

    const row = rows[0];
    const reportEmail = (row.contact_email || '').toString().toLowerCase();
    if (reportEmail !== auth.email.toLowerCase()) {
      return NextResponse.json({ error: 'You do not have permission to edit this report.' }, { status: 403 });
    }

    const dd = row.flow_data || {};
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
        return { number: si + 1, name: s.name || '', department: s.department || '', isDecision: !!s.isDecision, isMerge: !!s.isMerge, parallel: !!s.parallel, inclusive: !!s.inclusive, isExternal: !!s.isExternal, branches: s.branches || [] };
      });
    }

    const writeResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/processes?id=eq.${id}`, {
      method: 'PATCH', headers: getSupabaseWriteHeaders(supabaseKey),
      body: JSON.stringify({ flow_data: dd, updated_at: new Date().toISOString() })
    });
    if (!writeResp.ok) { const t = await writeResp.text(); return NextResponse.json({ error: 'Write failed: ' + t }, { status: 502 }); }
    return NextResponse.json({ success: true, stepsCount: steps.length });
  } catch (e) {
    logger.error('PATCH diagnostic error', { requestId: getRequestId(request), error: e.message, stack: e.stack });
    return NextResponse.json({ error: e.message || 'Failed to update report.' }, { status: 500 });
  }
}
