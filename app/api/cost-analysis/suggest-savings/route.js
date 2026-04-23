import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseHeaders, requireSupabase, fetchWithTimeout, checkOrigin, isValidUUID } from '@/lib/api-helpers';
import { verifySupabaseSession } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { calculateProcessSavings } from '@/lib/costSavingsCalculator';
import { isPlatformAdminEmail, userHasEntitlement } from '@/lib/orgAdmin';
import { ENTITLEMENT_KEYS } from '@/lib/entitlements';

export async function POST(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  const { reportId, token } = body;
  if (!reportId || !isValidUUID(reportId)) return NextResponse.json({ error: 'Valid report ID required.' }, { status: 400 });

  const sbConfig = requireSupabase();
  if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const { url: supabaseUrl, key: supabaseKey } = sbConfig;

  const sbResp = await fetchWithTimeout(
    `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}&select=id,contact_email,diagnostic_data`,
    { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
  );
  if (!sbResp.ok) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });
  const rows = await sbResp.json();
  if (!rows?.length) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });

  const report = rows[0];
  const dd = report.diagnostic_data || {};
  const storedToken = report.cost_analysis_token || dd.costAnalysisToken || '';
  const session = await verifySupabaseSession(request);
  const costAuthorizedEmails = (dd.costAuthorizedEmails || []).map(e => e.toLowerCase());
  const isCostAuthorized = session && costAuthorizedEmails.includes(session.email.toLowerCase());
  const hasValidToken = token && storedToken && token === storedToken;
  const isPlatformAdmin = session ? isPlatformAdminEmail(session.email) : false;
  let hasCostEntitlement = false;
  if (session && !isPlatformAdmin) {
    const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
    hasCostEntitlement = await userHasEntitlement(sb, session.userId, ENTITLEMENT_KEYS.COST_ANALYST);
  }

  if (!isCostAuthorized && !hasValidToken && !isPlatformAdmin && !hasCostEntitlement) {
    return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
  }

  const rawProcesses = dd.rawProcesses || dd.processes || [];

  const suggestions = rawProcesses.map((raw, i) => {
    const { reasoning, confidence, breakdown } =
      calculateProcessSavings(raw);

    // Derive automation approach description from actual step data
    const steps = raw.steps || [];
    const automatableSteps = steps.filter(s => !s.isDecision && !s.isMerge && !s.isAutomated);
    const systems = [...new Set(steps.flatMap(s => s.systems || []).filter(Boolean))];
    const emailHandoffs = (raw.handoffs || []).filter(h => h.method === 'email').length;
    const approvalCount = steps.filter(s => s.isDecision).length;

    const approaches = [];
    if (automatableSteps.length > 0 && systems.length > 0)
      approaches.push(`Automate ${automatableSteps.length} manual step${automatableSteps.length !== 1 ? 's' : ''} using ${systems.slice(0, 2).join(' + ')}`);
    else if (automatableSteps.length > 0)
      approaches.push(`Automate ${automatableSteps.length} manual step${automatableSteps.length !== 1 ? 's' : ''}`);
    if (emailHandoffs >= 2)
      approaches.push(`replace ${emailHandoffs} email handoffs with structured notifications`);
    if (approvalCount > 2)
      approaches.push(`consolidate ${approvalCount} approval gates into a single rule-based decision`);
    if (breakdown.totalWaitMins > breakdown.totalWorkMins * 0.2)
      approaches.push(`eliminate ${Math.round(breakdown.waitReductionMins)}min of queue wait via automated status tracking`);

    const automationApproach = approaches.length > 0
      ? approaches.join('; ') + '.'
      : 'Streamline manual steps and reduce handoff delays.';

    // Complexity based on step count + system integrations + approval chains
    const complexity = (steps.length > 15 || systems.length > 3 || approvalCount > 3) ? 'high'
      : (steps.length > 8 || systems.length > 1 || approvalCount > 1) ? 'medium'
      : 'low';

    // Hidden cost flags from actual data
    const hiddenCostFlags = [];
    if (breakdown.totalWaitMins > breakdown.totalWorkMins * 0.3)
      hiddenCostFlags.push('high wait ratio - significant idle time per run');
    if (emailHandoffs >= 2)
      hiddenCostFlags.push('email handoffs - coordination overhead and delay');
    if (approvalCount > 2)
      hiddenCostFlags.push('multiple approval gates - SLA risk and exception overhead');
    const multiSystemSteps = steps.filter(s => (s.systems || []).length >= 2).length;
    if (multiSystemSteps > 0)
      hiddenCostFlags.push(`${multiSystemSteps} multi-system step${multiSystemSteps !== 1 ? 's' : ''} - manual re-entry error cost`);
    const errorRate = Number(raw.costs?.errorRate) || 0;
    if (errorRate > 0)
      hiddenCostFlags.push(`${Math.round(errorRate * 100)}% error rate - hidden rework and double-handling cost`);

    return {
      processIndex: i,
      reasoning,
      confidence,
      automationApproach,
      implementationComplexity: complexity,
      hiddenCostFlags: hiddenCostFlags.slice(0, 4),
      breakdown,
    };
  });

  return NextResponse.json({ success: true, suggestions });
}
