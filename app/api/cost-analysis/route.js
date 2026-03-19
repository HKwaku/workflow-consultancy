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
  const departments = [...new Set(rawProcesses.flatMap(p => (p.steps || []).map(s => s.department).filter(Boolean)))];
  const processes = (dd.processes || []).map((p, i) => {
    const raw = rawProcesses[i] || {};
    const costs = raw.costs || {};
    const steps = raw.steps || [];
    const autoScore = typeof dd.automationScore?.percentage === 'number'
      ? dd.automationScore.percentage
      : (() => {
          const total = steps.length;
          if (total === 0) return 50;
          const manual = steps.filter(s => !s.isAutomated && !s.isDecision).length;
          return Math.round((1 - manual / total) * 100);
        })();
    const suggestedSavingsPct = autoScore >= 75 ? 55
      : autoScore >= 60 ? 40
      : autoScore >= 40 ? 28
      : autoScore >= 20 ? 18
      : 12;
    return {
      name: p.name || raw.processName,
      hoursPerInstance: costs.hoursPerInstance ?? 4,
      teamSize: costs.teamSize ?? 1,
      annual: costs.annual ?? (raw.frequency?.annual ?? 12),
      departments: [...new Set(steps.map(s => s.department).filter(Boolean))],
      systems: [...new Set(steps.flatMap(s => s.systems || []).filter(Boolean))],
      suggestedSavingsPct,
    };
  });

  const existingCost = dd.costAnalysis || null;
  const departmentsList = existingCost?.labourRates?.length
    ? existingCost.labourRates.map(r => r.department)
    : [...new Set(rawProcesses.flatMap(p => (p.steps || []).map(s => s.department).filter(Boolean)))];
  const finalDepartments = departmentsList.length > 0 ? departmentsList : ['Default'];
  const allSystems = [...new Set(rawProcesses.flatMap(p => (p.steps || []).flatMap(s => s.systems || []).filter(Boolean)))];

  return NextResponse.json({
    success: true,
    report: { id, costAnalysisStatus: dd.costAnalysisStatus || 'pending', diagnosticData: dd },
    processes,
    departments: finalDepartments,
    allSystems,
    existingCostAnalysis: existingCost || undefined,
    financialModel: dd.financialModel || undefined,
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

  const {
    labourRates,
    blendedRate,
    onCostMultiplier,
    nonLabour,
    processSavings,           // backward compat: base scenario values
    scenarios,               // { conservative: {[i]: pct}, base: {[i]: pct}, optimistic: {[i]: pct} }
    activeScenario: activeScen,
    implementationCost: implCostInput,
    processCostDrivers,      // { [i]: { errorRate, waitCostPct } }
    growthRate: growthRateInput,
  } = costAnalysis;

  const growthRate = Math.min(0.5, Math.max(0, Number(growthRateInput) || 0.05));
  const activeScenario = ['conservative', 'base', 'optimistic'].includes(activeScen) ? activeScen : 'base';
  const implCost = implCostInput || {};
  const implTotal = (Number(implCost.platform) || 0) + (Number(implCost.setup) || 0) + (Number(implCost.training) || 0);
  const implMaintenance = Number(implCost.maintenanceAnnual) || 0;

  const rawProcesses = dd.rawProcesses || dd.processes || [];

  const rateByDept = (labourRates || []).reduce((acc, r) => {
    if (r.department && r.hourlyRate > 0) acc[r.department] = (r.hourlyRate || 0) * (r.utilisation ?? 1);
    return acc;
  }, {});
  const defaultRate = (blendedRate || 50) * (onCostMultiplier || 1.25);

  let totalTrueLabour = 0;
  let totalHiddenCost = 0;
  let totalPotentialSavings = 0;

  const updatedProcesses = (dd.processes || []).map((p, i) => {
    const raw = rawProcesses[i] || {};
    const costs = raw.costs || {};
    const hoursPerInstance = costs.hoursPerInstance ?? 4;
    const teamSize = costs.teamSize ?? 1;
    const annual = costs.annual ?? (raw.frequency?.annual ?? 12);
    const depts = (raw.steps || []).map(s => s.department).filter(Boolean);
    const avgRate = depts.length > 0
      ? depts.reduce((sum, d) => sum + (rateByDept[d] ?? defaultRate), 0) / depts.length
      : defaultRate;
    const annualLabour = hoursPerInstance * avgRate * annual * teamSize;

    // Hidden cost components
    const drivers = (processCostDrivers || {})[i] || {};
    const errorRate = Math.min(0.5, Math.max(0, Number(drivers.errorRate) || 0));
    const waitCostPct = Math.min(0.5, Math.max(0, Number(drivers.waitCostPct) || 0));
    const errorCost = annualLabour * errorRate * 0.5; // errors cause ~50% rework overhead
    const waitCost = annualLabour * waitCostPct;
    const trueAnnualCost = annualLabour + errorCost + waitCost;

    // Scenario-based savings (use active scenario; fall back to processSavings for compat)
    const baseSavingsPct = scenarios?.base?.[i] ?? processSavings?.[i] ?? raw.savings?.percent ?? 30;
    const conservativeSavingsPct = scenarios?.conservative?.[i] ?? Math.round(baseSavingsPct * 0.65);
    const optimisticSavingsPct = scenarios?.optimistic?.[i] ?? Math.min(80, Math.round(baseSavingsPct * 1.4));
    const activeSavingsPct = activeScenario === 'conservative' ? conservativeSavingsPct
      : activeScenario === 'optimistic' ? optimisticSavingsPct
      : baseSavingsPct;
    const potentialSavings = trueAnnualCost * (activeSavingsPct / 100);

    totalTrueLabour += annualLabour;
    totalHiddenCost += errorCost + waitCost;
    totalPotentialSavings += potentialSavings;

    const updatedCosts = {
      ...costs,
      hourlyRate: avgRate,
      instanceCost: hoursPerInstance * avgRate,
      annualUserCost: hoursPerInstance * avgRate * annual,
      totalAnnualCost: annualLabour,
      trueAnnualCost,
      errorCost,
      waitCost,
      teamSize, hoursPerInstance, annual,
    };
    const updatedRaw = {
      ...raw,
      costs: updatedCosts,
      savings: { ...(raw.savings || {}), percent: baseSavingsPct, potential: trueAnnualCost * (baseSavingsPct / 100) },
    };
    if (rawProcesses[i]) rawProcesses[i] = updatedRaw;

    return { ...p, annualCost: trueAnnualCost, elapsedDays: p.elapsedDays ?? raw.lastExample?.elapsedDays ?? 0 };
  });

  // Fixed costs
  const totalInstances = rawProcesses.reduce((sum, r) => sum + ((r.costs?.annual ?? r.frequency?.annual ?? 12) * (r.costs?.teamSize ?? 1)), 0);
  const systemCosts = nonLabour?.systemCosts || {};
  const systemsAnnual = Object.values(systemCosts).reduce((s, v) => s + (Number(v) || 0), 0) || (nonLabour?.systemsAnnual ?? 0) || 0;
  const externalAnnual = (nonLabour?.externalPerInstance ?? 0) * Math.max(totalInstances, 1);
  const complianceAnnual = nonLabour?.complianceAnnual ?? 0;
  const totalFixed = systemsAnnual + externalAnnual + complianceAnnual;
  const totalAnnualCost = totalTrueLabour + totalHiddenCost + totalFixed;

  // FTE equivalent: savings / (avg fully-loaded rate × 2080 annual working hours)
  const fteEquivalent = totalPotentialSavings > 0 ? +(totalPotentialSavings / (defaultRate * 2080)).toFixed(2) : 0;
  const costPerInstanceAvg = totalInstances > 0 ? Math.round(totalAnnualCost / totalInstances) : 0;

  // 3-year financial model (8% discount rate = corporate standard hurdle rate)
  const DISCOUNT = 0.08;
  const year1Savings = totalPotentialSavings;
  const year2Savings = year1Savings * (1 + growthRate);
  const year3Savings = year2Savings * (1 + growthRate);
  const year1Net = year1Savings - implTotal - implMaintenance;
  const year2Net = year2Savings - implMaintenance;
  const year3Net = year3Savings - implMaintenance;
  const npv3yr = Math.round(
    year1Net / (1 + DISCOUNT) +
    year2Net / Math.pow(1 + DISCOUNT, 2) +
    year3Net / Math.pow(1 + DISCOUNT, 3)
  );
  const totalNetBenefit = year1Net + year2Net + year3Net;
  const roi3yr = implTotal > 0 ? Math.round(totalNetBenefit / implTotal * 100) : null;
  const monthlyNetSavings = (totalPotentialSavings - implMaintenance) / 12;
  const paybackMonths = implTotal > 0 && monthlyNetSavings > 0 ? Math.ceil(implTotal / monthlyNetSavings) : 0;

  // Persist
  dd.processes = updatedProcesses;
  dd.rawProcesses = rawProcesses;
  dd.summary = {
    ...(dd.summary || {}),
    totalAnnualCost,
    potentialSavings: totalPotentialSavings,
    totalProcesses: updatedProcesses.length,
  };
  dd.costAnalysisStatus = 'complete';
  dd.costAnalysis = {
    labourRates,
    blendedRate,
    onCostMultiplier,
    nonLabour,
    processSavings: processSavings || scenarios?.base || {},
    scenarios: scenarios || {},
    activeScenario,
    implementationCost: implCost,
    processCostDrivers: processCostDrivers || {},
    growthRate,
    completedAt: new Date().toISOString(),
  };
  dd.financialModel = {
    scenario: activeScenario,
    totalAnnualCost,
    totalLabour: totalTrueLabour,
    totalHiddenCost,
    totalFixed,
    potentialSavings: totalPotentialSavings,
    fteEquivalent,
    costPerInstanceAvg,
    implTotal,
    implMaintenance,
    paybackMonths,
    npv3yr,
    roi3yr,
    year1Net,
    year2Net,
    year3Net,
    growthRate,
  };
  dd.costAnalysisHistory = [
    ...(dd.costAnalysisHistory || []),
    { savedAt: new Date().toISOString(), savedBy: hasValidToken ? 'manager' : 'owner' },
  ];
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
  return NextResponse.json({ success: true, reportId, reportUrl, financialModel: dd.financialModel });
}

export async function PATCH(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  const { reportId, token, shareWithOwner } = body;
  if (!reportId || !isValidUUID(reportId)) return NextResponse.json({ error: 'Valid report ID required.' }, { status: 400 });
  if (shareWithOwner !== true) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });

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
  const hasValidToken = token && storedToken && token === storedToken;
  const isOwner = session && report.contact_email && report.contact_email.toLowerCase() === session.email.toLowerCase();

  if (!hasValidToken && !isOwner) {
    return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
  }

  if (dd.costAnalysisStatus !== 'complete') {
    return NextResponse.json({ error: 'Cost analysis must be completed before sharing.' }, { status: 400 });
  }

  dd.costSharedWithOwner = true;
  dd.costSharedAt = new Date().toISOString();

  const patchResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}`, {
    method: 'PATCH',
    headers: getSupabaseWriteHeaders(supabaseKey),
    body: JSON.stringify({ diagnostic_data: dd, updated_at: new Date().toISOString() }),
  });

  if (!patchResp.ok) {
    logger.error('Cost analysis share failed', { requestId: getRequestId(request), status: patchResp.status });
    return NextResponse.json({ error: 'Failed to share cost analysis.' }, { status: 502 });
  }

  return NextResponse.json({ success: true });
}
