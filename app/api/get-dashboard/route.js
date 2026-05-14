import { NextResponse } from 'next/server';
import { isValidEmail, requireSupabase, getRequestId, checkOrigin } from '@/lib/api-helpers';
import { GetDashboardDeleteSchema } from '@/lib/ai-schemas';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { deriveProcessMetrics } from '@/lib/processMetrics';
export async function GET(request) {
  try {
    const originErr = checkOrigin(request);
    if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });
    const auth = await requireAuth(request);
    if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
    const email = auth.email;

    const rl = await checkRateLimit(getRateLimitKey(request));
    if (!rl.allowed) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

    const sbConfig = requireSupabase();
    if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;

    const supabase = createClient(supabaseUrl, supabaseKey);
    const emailLower = email.toLowerCase().trim();

    const limit = Math.min(100, Math.max(10, parseInt(request.nextUrl.searchParams.get('limit') || '50', 10)));
    const offset = Math.max(0, parseInt(request.nextUrl.searchParams.get('offset') || '0', 10));

    // Living-workspace migration: dropped columns (display_code,
    // lead_score, lead_grade, diagnostic_mode, cost_analysis_*,
    // total_annual_cost, potential_savings, automation_percentage,
    // automation_grade, contributor_emails) plus renamed table
    // (diagnostic_reports → processes) and column (diagnostic_data →
    // flow_data). Cost / savings / automation are derived live from the
    // flow_data JSONB, so we read those out below.
    const { data: rows, error: sbError } = await supabase
      .from('processes')
      .select('id,contact_email,contact_name,company,flow_data,created_at,updated_at')
      .ilike('contact_email', emailLower)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (sbError) {
      logger.error('Supabase error', { requestId: getRequestId(request), error: sbError.message, route: 'get-dashboard' });
      return NextResponse.json({ error: 'Failed to fetch processes.' }, { status: 502 });
    }

    // team_diagnostics table dropped in the migration. No surface
    // surfaces this anymore.
    const teamSessions = [];

    if (!rows || rows.length === 0) {
      return NextResponse.json({ success: true, email: emailLower, totalReports: 0, reports: [], teamSessions, deltas: null });
    }

    const reports = rows.map(row => {
      const d = row.flow_data || {};
      const procs = d.processes || [];
      // Living-workspace contract: cost / savings / automation derive
      // from rawProcesses[].steps[] every read. The previous snapshot
      // fields (flow_data.summary.*, flow_data.automationScore.*) are
      // no longer written, so reading them returns zero. deriveProcessMetrics
      // walks the steps directly, matching what the chat agent does.
      // The old costAuthorizedEmails gate that let a consultant see
      // costs the owner couldn't is gone — owners always see their own
      // cost data on the canvas.
      const derived = deriveProcessMetrics(d);
      const metricsTotalCost = derived.total_annual_cost;
      const metricsSavings   = derived.potential_savings;
      const metricsAutoPerc  = derived.automation_percentage ?? 0;
      const metricsAutoGrade = derived.automation_grade;

      const totalProcesses = Array.isArray(d.rawProcesses) ? d.rawProcesses.length : procs.length;

      const isContributor = row.contact_email?.toLowerCase() !== emailLower;
      return {
        id: row.id, displayCode: null,
        company: row.company || d.contact?.company || '',
        contactName: row.contact_name || d.contact?.name || '',
        leadScore: null, leadGrade: null,
        segment: d.contact?.segment || null,
        isContributor,
        createdAt: row.created_at, updatedAt: row.updated_at,
        metrics: {
          totalProcesses,
          totalAnnualCost: metricsTotalCost,
          potentialSavings: metricsSavings,
          automationPercentage: metricsAutoPerc,
          automationGrade: metricsAutoGrade,
        },
        processes: procs.map(p => ({ name: p.name || '', type: p.type || '', annualCost: p.annualCost || 0, elapsedDays: p.elapsedDays || 0, stepsCount: p.stepsCount || 0 })),
        rawProcesses: (d.rawProcesses || []).map(rp => ({
          processName: rp.processName,
          steps: (rp.steps || []).map(s => ({ name: s.name, department: s.department, isDecision: s.isDecision || false, isMerge: s.isMerge || false, parallel: s.parallel || false, inclusive: s.inclusive || false, branches: s.branches || [] })),
          handoffs: (rp.handoffs || []).map(h => ({ method: h.method, clarity: h.clarity })),
          flowNodePositions: rp.flowNodePositions || undefined,
          flowCustomEdges: rp.flowCustomEdges || undefined,
          flowDeletedEdges: rp.flowDeletedEdges || undefined,
        })),
        // Redesign-as-snapshot is gone. AI suggestions are inline `changes`
        // rows now; nothing writes `flow_data.redesign` anymore, so we don't
        // surface a redesign shape from this endpoint.
        redesignStatus: null,
        redesignVersions: [],
        acceptedRedesign: null,
        pendingRedesign: null,
        // recommendations + roadmap were submission-time snapshots. Clients
        // that need live opportunities call the chat agent's
        // get_recommendations, which derives from current step structure.
        recommendations: [],
        roadmap: null,
        // auditTrail no longer persisted to flow_data — the `changes`
        // relational table is the canonical audit log. Legacy rows that
        // still carry one are read on a best-effort basis.
        auditTrail: (d.auditTrail || []).slice(-50),
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

    const rl = await checkRateLimit(getRateLimitKey(request));
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

    const { data: checkRows, error: checkErr } = await supabase.from('processes').select('id,contact_email').eq('id', reportId).limit(1);
    if (checkErr || !checkRows || checkRows.length === 0) return NextResponse.json({ error: 'Process not found or already deleted.' }, { status: 404 });
    if (checkRows[0].contact_email?.toLowerCase() !== normalEmail) return NextResponse.json({ error: 'You can only delete your own processes.' }, { status: 403 });

    const { error: delErr } = await supabase.from('processes').delete().eq('id', reportId);
    if (delErr) return NextResponse.json({ error: 'Failed to delete process.' }, { status: 502 });
    return NextResponse.json({ success: true, message: 'Process deleted.' });
  } catch (err) {
    logger.error('Delete report error', { requestId: getRequestId(request), error: err.message, stack: err.stack });
    return NextResponse.json({ error: 'Failed to delete report.' }, { status: 500 });
  }
}
