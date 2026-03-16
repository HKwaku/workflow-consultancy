import { NextResponse } from 'next/server';
import { getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase, checkOrigin, getRequestId, isValidUUID } from '@/lib/api-helpers';
import { verifySupabaseSession } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export async function GET(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const sp = request.nextUrl.searchParams;
  const id = sp.get('id');
  const token = sp.get('token');

  if (!id || !isValidUUID(id)) return NextResponse.json({ error: 'Valid report ID required.' }, { status: 400 });

  const sbConfig = requireSupabase();
  if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const { url: supabaseUrl, key: supabaseKey } = sbConfig;

  const sbResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${id}&select=id,contact_email,diagnostic_data`, { method: 'GET', headers: getSupabaseHeaders(supabaseKey) });
  if (!sbResp.ok) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });
  const rows = await sbResp.json();
  if (!rows?.length) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });

  const report = rows[0];
  const dd = report.diagnostic_data || {};
  const storedToken = dd.costAnalysisToken || '';
  const session = await verifySupabaseSession(request);
  const isOwner = session && report.contact_email && report.contact_email.toLowerCase() === session.email.toLowerCase();
  const hasValidToken = token && storedToken && token === storedToken;

  if (!isOwner && !hasValidToken) {
    return NextResponse.json({ error: 'Access denied. Use the link assigned to you by the report owner.', needsAuth: !session }, { status: 403 });
  }

  if (dd.costAnalysisStatus === 'complete' && !hasValidToken && !isOwner) {
    return NextResponse.json({ success: true, report: { id, costAnalysisStatus: 'complete', diagnosticData: dd }, redirectToReport: true });
  }

  const rawProcesses = dd.rawProcesses || dd.processes || [];
  const departments = [...new Set(rawProcesses.flatMap((p) => (p.steps || []).map((s) => s.department).filter(Boolean)))];
  const processes = (dd.processes || []).map((p, i) => {
    const raw = rawProcesses[i] || {};
    const costs = raw.costs || {};
    return {
      name: p.name || raw.processName,
      hoursPerInstance: costs.hoursPerInstance ?? 4,
      teamSize: costs.teamSize ?? 1,
      annual: costs.annual ?? (raw.frequency?.annual ?? 12),
      departments: [...new Set((raw.steps || []).map((s) => s.department).filter(Boolean))],
    };
  });

  const existingCost = dd.costAnalysis || null;
  const departmentsList = existingCost?.labourRates?.length
    ? existingCost.labourRates.map((r) => r.department)
    : [...new Set(rawProcesses.flatMap((p) => (p.steps || []).map((s) => s.department).filter(Boolean)))];
  const finalDepartments = departmentsList.length > 0 ? departmentsList : ['Default'];

  return NextResponse.json({
    success: true,
    report: { id, costAnalysisStatus: dd.costAnalysisStatus || 'pending', diagnosticData: dd },
    processes,
    departments: finalDepartments,
    existingCostAnalysis: existingCost || undefined,
  });
}

export async function POST(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  const { reportId, token, costAnalysis } = body;
  if (!reportId || !isValidUUID(reportId)) return NextResponse.json({ error: 'Valid report ID required.' }, { status: 400 });
  if (!costAnalysis || typeof costAnalysis !== 'object') return NextResponse.json({ error: 'Cost analysis data required.' }, { status: 400 });

  const sbConfig = requireSupabase();
  if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const { url: supabaseUrl, key: supabaseKey } = sbConfig;

  const readResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}&select=id,contact_email,diagnostic_data`, { method: 'GET', headers: getSupabaseHeaders(supabaseKey) });
  if (!readResp.ok) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });
  const rows = await readResp.json();
  if (!rows?.length) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });

  const report = rows[0];
  const dd = JSON.parse(JSON.stringify(report.diagnostic_data || {}));

  const storedToken = dd.costAnalysisToken || '';
  const session = await verifySupabaseSession(request);
  const isOwner = session && report.contact_email && report.contact_email.toLowerCase() === session.email.toLowerCase();
  const hasValidToken = token && storedToken && token === storedToken;

  if (!isOwner && !hasValidToken) {
    return NextResponse.json({ error: 'Access denied. Use the link assigned to you by the report owner.' }, { status: 403 });
  }

  const { labourRates, blendedRate, onCostMultiplier, nonLabour } = costAnalysis;
  const rawProcesses = dd.rawProcesses || dd.processes || [];

  let totalAnnualCost = 0;
  let totalPotentialSavings = 0;

  const rateByDept = (labourRates || []).reduce((acc, r) => {
    if (r.department && r.hourlyRate > 0) acc[r.department] = (r.hourlyRate || 0) * (r.utilisation ?? 1);
    return acc;
  }, {});
  const defaultRate = (blendedRate || 50) * (onCostMultiplier || 1.25);

  const updatedProcesses = (dd.processes || []).map((p, i) => {
    const raw = rawProcesses[i] || {};
    const costs = raw.costs || {};
    const hoursPerInstance = costs.hoursPerInstance ?? 4;
    const teamSize = costs.teamSize ?? 1;
    const annual = costs.annual ?? (raw.frequency?.annual ?? 12);
    const depts = (raw.steps || []).map((s) => s.department).filter(Boolean);
    const avgRate = depts.length > 0
      ? depts.reduce((sum, d) => sum + (rateByDept[d] ?? defaultRate), 0) / depts.length
      : defaultRate;
    const instanceCost = hoursPerInstance * avgRate;
    const annualCost = instanceCost * annual * teamSize;
    const savingsPct = (raw.savings?.percent ?? 30);
    const potentialSavings = annualCost * (savingsPct / 100);

    totalAnnualCost += annualCost;
    totalPotentialSavings += potentialSavings;

    const updatedCosts = { ...costs, hourlyRate: avgRate, instanceCost, annualUserCost: instanceCost * annual, totalAnnualCost: annualCost, teamSize, hoursPerInstance, annual };
    const updatedRaw = { ...raw, costs: updatedCosts, savings: { ...(raw.savings || {}), percent: savingsPct, potential: potentialSavings } };

    if (rawProcesses[i]) rawProcesses[i] = updatedRaw;

    return {
      ...p,
      annualCost,
      elapsedDays: p.elapsedDays ?? raw.lastExample?.elapsedDays ?? 0,
    };
  });

  const totalInstances = rawProcesses.reduce((sum, r) => sum + ((r.costs?.annual ?? r.frequency?.annual ?? 12) * (r.costs?.teamSize ?? 1)), 0);
  const systemsAnnual = (nonLabour?.systemsAnnual ?? 0) || 0;
  const externalAnnual = (nonLabour?.externalPerInstance ?? 0) * Math.max(totalInstances, 1);
  const complianceAnnual = (nonLabour?.complianceAnnual ?? 0) || 0;
  totalAnnualCost += systemsAnnual + externalAnnual + complianceAnnual;

  dd.processes = updatedProcesses;
  dd.rawProcesses = rawProcesses;
  dd.summary = { ...(dd.summary || {}), totalAnnualCost, potentialSavings: totalPotentialSavings, totalProcesses: updatedProcesses.length };
  dd.costAnalysisStatus = 'complete';
  dd.costAnalysis = { labourRates, blendedRate, onCostMultiplier, nonLabour, completedAt: new Date().toISOString() };
  dd.costCompletedByManager = !isOwner;

  const patchResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}`, {
    method: 'PATCH',
    headers: getSupabaseWriteHeaders(supabaseKey),
    body: JSON.stringify({ diagnostic_data: dd, updated_at: new Date().toISOString() }),
  });

  if (!patchResp.ok) {
    logger.error('Cost analysis save failed', { requestId: getRequestId(request), status: patchResp.status });
    return NextResponse.json({ error: 'Failed to save cost analysis.' }, { status: 502 });
  }

  const reportUrl = token ? `/report?id=${reportId}&token=${encodeURIComponent(token)}` : `/report?id=${reportId}`;
  return NextResponse.json({ success: true, reportId, reportUrl });
}
