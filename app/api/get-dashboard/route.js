import { NextResponse } from 'next/server';
import { isValidEmail, requireSupabase, getRequestId, checkOrigin } from '@/lib/api-helpers';
import { GetDashboardDeleteSchema } from '@/lib/ai-schemas';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { calculateAutomationScore } from '@/lib/diagnostic/buildLocalResults';
export async function GET(request) {
  try {
    const originErr = checkOrigin(request);
    if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });
    const auth = await requireAuth(request);
    if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
    const email = auth.email;

    const rl = checkRateLimit(getRateLimitKey(request));
    if (!rl.allowed) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

    const sbConfig = requireSupabase();
    if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;

    const supabase = createClient(supabaseUrl, supabaseKey);
    const emailLower = email.toLowerCase().trim();

    const limit = Math.min(100, Math.max(10, parseInt(request.nextUrl.searchParams.get('limit') || '50', 10)));
    const offset = Math.max(0, parseInt(request.nextUrl.searchParams.get('offset') || '0', 10));

    const { data: rows, error: sbError } = await supabase
      .from('diagnostic_reports')
      .select('id,display_code,contact_email,contact_name,company,lead_score,lead_grade,diagnostic_data,diagnostic_mode,created_at,updated_at')
      .ilike('contact_email', emailLower)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (sbError) {
      logger.error('Supabase error', { requestId: getRequestId(request), error: sbError.message, route: 'get-dashboard' });
      return NextResponse.json({ error: 'Failed to fetch reports.' }, { status: 502 });
    }

    // Fetch team diagnostics where user is creator
    const { data: teamRows } = await supabase
      .from('team_diagnostics')
      .select('id,team_code,process_name,company,status,created_at,closed_at')
      .ilike('created_by_email', emailLower)
      .order('created_at', { ascending: false })
      .limit(50);

    const teamSessions = (teamRows || []).map(t => ({
      id: t.id,
      teamCode: t.team_code,
      processName: t.process_name,
      company: t.company || '',
      status: t.status,
      createdAt: t.created_at,
      closedAt: t.closed_at,
    }));

    if (!rows || rows.length === 0) {
      return NextResponse.json({ success: true, email: emailLower, totalReports: 0, reports: [], teamSessions, deltas: null });
    }

    // Batch-fetch redesigns for all report IDs
    const reportIds = rows.map(r => r.id);
    let redesignRows = null;
    let rdError = null;
    const res = await supabase
      .from('report_redesigns')
      .select('id,report_id,name,redesign_data,decisions,status,accepted_at,created_at')
      .in('report_id', reportIds)
      .order('created_at', { ascending: true });
    redesignRows = res.data;
    rdError = res.error;
    if (rdError && (rdError.message?.includes('name') || rdError.message?.includes('column') || rdError.code === '42703')) {
      const fallback = await supabase
        .from('report_redesigns')
        .select('id,report_id,redesign_data,decisions,status,accepted_at,created_at')
        .in('report_id', reportIds)
        .order('created_at', { ascending: true });
      redesignRows = fallback.data;
      rdError = fallback.error;
    }
    if (rdError) {
      logger.error('Get dashboard: report_redesigns fetch failed', { requestId: getRequestId(request), error: rdError.message });
    }

    const rdWithName = (redesignRows || []).map((rd, i) => ({ ...rd, name: rd.name ?? `Redesign ${i + 1}` }));

    const redesignsByReport = {};
    (rdWithName || redesignRows || []).forEach(rd => {
      if (!redesignsByReport[rd.report_id]) redesignsByReport[rd.report_id] = [];
      redesignsByReport[rd.report_id].push(rd);
    });

    const reports = rows.map(row => {
      const d = row.diagnostic_data || {};
      const summary = d.summary || {};
      const procs = d.processes || [];
      const rawProcs = d.rawProcesses || [];
      const liveAuto = rawProcs.length > 0 ? calculateAutomationScore(rawProcs) : null;
      const auto = liveAuto || d.automationScore || {};
      const hideCostFromOwner = !!d.costCompletedByManager;

      const allRedesigns = redesignsByReport[row.id] || [];
      const acceptedRd = allRedesigns.find(rd => rd.status === 'accepted');
      const latestRd = allRedesigns[allRedesigns.length - 1];
      const redesign = latestRd
        ? { ...latestRd.redesign_data, decisions: latestRd.decisions, status: latestRd.status, acceptedAt: latestRd.accepted_at }
        : (d.redesign || null);

      const hasAcceptedRedesign = acceptedRd
        ? (acceptedRd.redesign_data?.acceptedProcesses?.length > 0)
        : !!(redesign?.acceptedAt && redesign?.acceptedProcesses?.length);

      const toProcesses = (rd) => {
        const src = rd?.redesign_data?.acceptedProcesses || rd?.redesign_data?.optimisedProcesses || [];
        return src.map(op => ({
          processName: op.processName || op.name,
          steps: (op.steps || []).filter(s => s.status !== 'removed').map(s => ({
            name: s.name, department: s.department, isDecision: s.isDecision || false, branches: s.branches || [],
          })),
          handoffs: (op.handoffs || []).map(h => ({ method: h.method, clarity: h.clarity })),
        }));
      };

      const activeSource = acceptedRd || latestRd;
      const activeProcesses = toProcesses(activeSource);
      const hasRedesignData = activeProcesses.length > 0;

      const metricsTotalCost = hideCostFromOwner ? 0 : (summary.totalAnnualCost || 0);
      const metricsSavings = hideCostFromOwner ? 0 : (summary.potentialSavings || 0);

      return {
        id: row.id, displayCode: row.display_code || null, company: row.company || d.contact?.company || '',
        contactName: row.contact_name || d.contact?.name || '',
        leadScore: row.lead_score, leadGrade: row.lead_grade,
        diagnosticMode: row.diagnostic_mode,
        createdAt: row.created_at, updatedAt: row.updated_at,
        metrics: {
          totalProcesses: summary.totalProcesses || procs.length || 0,
          totalAnnualCost: metricsTotalCost,
          potentialSavings: metricsSavings,
          automationPercentage: auto.percentage || 0,
          automationGrade: auto.grade || 'N/A',
          qualityScore: summary.qualityScore || 0,
          analysisType: summary.analysisType || 'rule-based'
        },
        processes: procs.map(p => ({ name: p.name || '', type: p.type || '', annualCost: hideCostFromOwner ? 0 : (p.annualCost || 0), elapsedDays: p.elapsedDays || 0, stepsCount: p.stepsCount || 0 })),
        rawProcesses: (d.rawProcesses || []).map(rp => ({
          processName: rp.processName,
          steps: (rp.steps || []).map(s => ({ name: s.name, department: s.department, isDecision: s.isDecision || false, branches: s.branches || [] })),
          handoffs: (rp.handoffs || []).map(h => ({ method: h.method, clarity: h.clarity })),
        })),
        redesignStatus: hasAcceptedRedesign ? 'accepted' : redesign ? 'pending' : null,
        redesignVersions: allRedesigns.map((rd, i) => ({
          id: rd.id,
          name: rd.name || `Redesign ${i + 1}`,
          version: i + 1,
          source: rd.redesign_data?.source || (i === 0 ? 'ai' : 'human'),
          costSummary: hideCostFromOwner ? null : (rd.redesign_data?.costSummary || null),
          processes: toProcesses(rd),
          createdAt: rd.created_at,
          status: rd.status,
        })),
        acceptedRedesign: hasAcceptedRedesign && activeSource ? {
          acceptedAt: activeSource.accepted_at,
          costSummary: hideCostFromOwner ? null : (activeSource.redesign_data?.costSummary || null),
          processes: activeProcesses,
        } : null,
        pendingRedesign: (!hasAcceptedRedesign && hasRedesignData) ? {
          costSummary: hideCostFromOwner ? null : (activeSource?.redesign_data?.costSummary || null),
          processes: activeProcesses,
        } : null,
        recommendations: (d.recommendations || []).slice(0, 5).map(r => ({ type: r.type || 'general', text: r.text || '' })),
        roadmap: d.roadmap ? { quickWins: d.roadmap.phases?.quick?.items?.length || 0, totalSavings: d.roadmap.totalSavings || 0 } : null,
        auditTrail: (d.auditTrail || []).slice(-50),
        costAnalysisStatus: d.costAnalysisStatus || 'complete',
        costAnalysisToken: hideCostFromOwner ? null : (d.costAnalysisToken || null),
      };
    });

    let deltas = null;
    if (reports.length >= 2) {
      const latest = reports[0].metrics;
      const previous = reports[1].metrics;
      deltas = {
        comparedTo: reports[1].createdAt,
        annualCost: { change: latest.totalAnnualCost - previous.totalAnnualCost, percentChange: previous.totalAnnualCost > 0 ? ((latest.totalAnnualCost - previous.totalAnnualCost) / previous.totalAnnualCost * 100) : 0, improved: latest.totalAnnualCost < previous.totalAnnualCost },
        potentialSavings: { change: latest.potentialSavings - previous.potentialSavings, percentChange: previous.potentialSavings > 0 ? ((latest.potentialSavings - previous.potentialSavings) / previous.potentialSavings * 100) : 0, improved: latest.potentialSavings > previous.potentialSavings },
        automationReadiness: { change: latest.automationPercentage - previous.automationPercentage, improved: latest.automationPercentage > previous.automationPercentage },
        processCount: { change: latest.totalProcesses - previous.totalProcesses },
        qualityScore: { change: latest.qualityScore - previous.qualityScore, improved: latest.qualityScore > previous.qualityScore }
      };
    }

    return NextResponse.json({ success: true, email: emailLower, totalReports: reports.length, reports, teamSessions, deltas, pagination: { limit, offset } });
  } catch (err) {
    logger.error('Get dashboard error', { requestId: getRequestId(request), error: err.message, stack: err.stack });
    return NextResponse.json({ error: 'Failed to retrieve reports.' }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const originErr = checkOrigin(request);
    if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });
    const auth = await requireAuth(request);
    if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
    const email = auth.email;

    const rl = checkRateLimit(getRateLimitKey(request));
    if (!rl.allowed) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

    const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
    if (contentLength > 2 * 1024 * 1024) return NextResponse.json({ error: 'Request body too large.' }, { status: 413 });

    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
    const parsed = GetDashboardDeleteSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid report ID.' }, { status: 400 });
    const { reportId } = parsed.data;

    const sbConfig = requireSupabase();
    if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;

    const supabase = createClient(supabaseUrl, supabaseKey);
    const normalEmail = email.toLowerCase().trim();

    const { data: checkRows, error: checkErr } = await supabase.from('diagnostic_reports').select('id,contact_email').eq('id', reportId).limit(1);
    if (checkErr || !checkRows || checkRows.length === 0) return NextResponse.json({ error: 'Report not found or already deleted.' }, { status: 404 });
    if (checkRows[0].contact_email?.toLowerCase() !== normalEmail) return NextResponse.json({ error: 'You can only delete your own reports.' }, { status: 403 });

    // report_redesigns will cascade-delete via FK
    const { error: delErr } = await supabase.from('diagnostic_reports').delete().eq('id', reportId);
    if (delErr) return NextResponse.json({ error: 'Failed to delete report.' }, { status: 502 });
    return NextResponse.json({ success: true, message: 'Report deleted.' });
  } catch (err) {
    logger.error('Delete report error', { requestId: getRequestId(request), error: err.message, stack: err.stack });
    return NextResponse.json({ error: 'Failed to delete report.' }, { status: 500 });
  }
}
