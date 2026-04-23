/**
 * Pure async helper that runs the full diagnostic → save-report pipeline.
 *
 * Extracted from Screen6Complete.jsx so it can be reused by inline
 * "Generate full report" controls on the canvas without duplicating the SSE
 * reader, cost enrichment, and report-payload shaping.
 *
 * No React, no context access - all inputs passed as parameters.
 */

import { buildLocalResults, computeDurationFromSteps } from './index.js';

function inferBottleneck(steps, handoffs) {
  const approvals = steps.filter((s) => s.isApproval || s.isDecision).length;
  const multiSys  = steps.filter((s) => (s.systems || []).length >= 2).length;
  const external  = steps.filter((s) => s.isExternal).length;
  const flagged   = steps.filter((s) => s.isBottleneck).length;
  const poorHoffs = (handoffs || []).filter((h) =>
    ['yes-multiple', 'yes-major', 'confusing', 'unclear'].includes(h.clarity)
  ).length;
  const scores = {
    approvals,
    systems: multiSys * 2,
    handoffs: external + poorHoffs * 2,
    'manual-work': flagged * 2,
  };
  const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return top && top[1] > 0 ? top[0] : 'manual-work';
}

function enrichProcessCosts(p) {
  const steps = p.steps || [];
  const handoffs = p.handoffs || [];
  const computed = computeDurationFromSteps(steps);
  const depts = new Set(steps.filter((s) => !s.isExternal && s.department).map((s) => s.department));
  const teamSize = depts.size > 0 ? depts.size : (p.costs?.teamSize ?? 1);
  const hoursPerInstance =
    (computed?.hoursPerInstance > 0 ? computed.hoursPerInstance : null) ??
    p.costs?.hoursPerInstance ?? 4;
  const annual = p.frequency?.annual ?? p.costs?.annual ?? 12;
  const bottleneckReason = p.bottleneck?.reason || inferBottleneck(steps, handoffs);
  return {
    ...p,
    costs: { ...p.costs, hoursPerInstance, teamSize, annual },
    bottleneck: { ...p.bottleneck, reason: bottleneckReason },
    savings: p.savings?.percent ? p.savings : { percent: 20 },
  };
}

async function readDiagnosticStream(payload, onProgress) {
  const resp = await fetch('/api/process-diagnostic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) throw new Error('Analysis failed');

  const contentType = resp.headers.get('content-type') || '';

  if (!contentType.includes('text/event-stream')) {
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || 'Analysis failed');
    return data;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let result = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);

      let eventName = 'message';
      let dataStr = '';
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event: ')) eventName = line.slice(7).trim();
        else if (line.startsWith('data: ')) dataStr = line.slice(6).trim();
      }
      if (!dataStr) continue;

      let parsed;
      try { parsed = JSON.parse(dataStr); } catch { continue; }

      if (eventName === 'progress') {
        onProgress?.(parsed.message || '');
      } else if (eventName === 'done') {
        result = parsed;
      } else if (eventName === 'error') {
        throw new Error(parsed.error || 'Analysis failed');
      }
    }
  }

  if (!result?.success) throw new Error('Analysis failed');
  return result;
}

/**
 * Build the analyse payload for /api/process-diagnostic.
 * Exposed so callers can preview/override fields before sending.
 */
export function buildAnalysePayload({ processes, contact, moduleId, diagnosticMode }) {
  const sanitizedProcesses = (processes || []).filter(Boolean).map((p) => {
    const enriched = enrichProcessCosts(p);
    return {
      processName: enriched.processName || enriched.name || 'Process',
      processType: enriched.processType || enriched.type || 'other',
      steps: enriched.steps || [],
      handoffs: enriched.handoffs || [],
      definition: enriched.definition,
      lastExample: enriched.lastExample,
      costs: enriched.costs,
      frequency: enriched.frequency,
      bottleneck: enriched.bottleneck,
      savings: enriched.savings,
      userTime: enriched.userTime,
    };
  });

  return {
    sanitizedProcesses,
    payload: {
      processes: sanitizedProcesses,
      contact: contact?.email ? contact : undefined,
      moduleId: moduleId || undefined,
      qualityScore: { averageScore: 70 },
      diagnosticMode: diagnosticMode || 'comprehensive',
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Run the full diagnostic pipeline inline.
 *
 * @param {Object} input
 * @param {Array}  input.processes               Process objects from context.
 * @param {Object} input.contact                 Effective contact (name, email, segment, ...).
 * @param {string} input.moduleId                Canonical module id (pe, ma, scaling, ...).
 * @param {string} input.diagnosticMode          'map-only' | 'comprehensive'.
 * @param {string} [input.editingReportId]       If editing an existing report.
 * @param {Array}  [input.customDepartments]
 * @param {Array}  [input.auditTrail]
 * @param {Object} [input.authUser]              From DiagnosticContext.
 * @param {Object} [input.sessionUser]           Supabase auth user.
 * @param {string} [input.accessToken]
 * @param {string} [input.costAnalystEmail]
 *
 * @param {Object} deps
 * @param {Function} deps.sendDiagnosticReport   From DiagnosticContext.
 * @param {Function} [deps.onProgress]           (message: string) => void.
 *
 * @returns {Promise<{ reportId, findings, costAnalysisUrl, storedInSupabase, result, reportData }>}
 */
export async function generateReportInline(input, deps) {
  const {
    processes,
    contact,
    moduleId,
    diagnosticMode = 'comprehensive',
    editingReportId = null,
    customDepartments = [],
    auditTrail = [],
    authUser,
    sessionUser,
    accessToken,
    costAnalystEmail = null,
  } = input || {};

  const { sendDiagnosticReport, onProgress } = deps || {};
  if (typeof sendDiagnosticReport !== 'function') {
    throw new Error('generateReportInline: sendDiagnosticReport is required');
  }

  onProgress?.('Starting analysis…');

  const { sanitizedProcesses, payload } = buildAnalysePayload({
    processes, contact, moduleId, diagnosticMode,
  });
  if (sanitizedProcesses.length === 0) throw new Error('No process data to analyse.');

  let result;
  try {
    result = await readDiagnosticStream(payload, (msg) => onProgress?.(msg));
  } catch (apiErr) {
    result = buildLocalResults({ processes, contact });
    if (!result.success) throw apiErr;
  }

  onProgress?.('Saving your report…');

  const reportPayload = {
    editingReportId: editingReportId || null,
    diagnosticMode,
    contact,
    fallbackEmail: sessionUser?.email || undefined,
    authToken: accessToken || undefined,
    summary: {
      totalProcesses: (result.processes || []).length,
      totalAnnualCost: result.totalCost || 0,
      potentialSavings: result.potentialSavings || 0,
      analysisType: result.analysisType || 'rule-based',
      qualityScore: result.qualityScore?.averageScore || 0,
    },
    recommendations: result.recommendations || [],
    automationScore: result.automationScore || {},
    roadmap: {},
    processes: (result.processes || []).map((p, idx) => {
      const raw = processes[idx] || {};
      const steps = (raw.steps || []).map((s, si) => ({
        number: si + 1,
        name: s.name || '',
        department: s.department || '',
        isDecision: !!s.isDecision,
        isExternal: !!s.isExternal,
        branches: s.branches || [],
      }));
      const handoffs = raw.handoffs || [];
      const departments = [...new Set(steps.map((s) => s.department).filter(Boolean))];
      return { ...p, steps, handoffs, handoffCount: handoffs.length, departments };
    }),
    rawProcesses: JSON.parse(JSON.stringify(processes)),
    customDepartments,
    auditTrail: (auditTrail || []).slice(-50),
    costAnalystEmail: costAnalystEmail || null,
    dealParticipantToken: authUser?.dealParticipantToken || null,
    dealCode: authUser?.dealCode || null,
  };

  const reportData = await sendDiagnosticReport(reportPayload, {
    accessToken: accessToken || undefined,
  });

  if (reportData?.costAnalysisUrl && reportData?.reportId && typeof window !== 'undefined') {
    try {
      sessionStorage.setItem('costAnalysisUrl_' + reportData.reportId, reportData.costAnalysisUrl);
      localStorage.setItem('costAnalysisUrl_' + reportData.reportId, reportData.costAnalysisUrl);
    } catch { /* ignore */ }
  }

  const recs = result.recommendations || [];
  const findings = recs.slice(0, 3).map((r) =>
    typeof r === 'string' ? r : (r.title || r.description || r.text || JSON.stringify(r))
  ).filter(Boolean);

  return {
    reportId: reportData?.reportId || null,
    costAnalysisUrl: reportData?.costAnalysisUrl || null,
    storedInSupabase: !!reportData?.storedInSupabase,
    findings,
    result,
    reportData,
  };
}
