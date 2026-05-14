/**
 * Save the canvas state to the live `processes` row.
 *
 * Living-workspace contract: this used to be the "generate the diagnostic
 * report" pipeline — SSE analysis → bundle summary / recommendations /
 * automationScore → POST a one-shot submission. Gone. The function now
 * just writes the live canvas state (rawProcesses + contact + segment +
 * department metadata) through the upsert endpoint. Cost, savings,
 * automation are derived on read; recommendations are surfaced live by
 * the chat agent on demand. There is no "analysis moment".
 *
 * No React, no context access — all inputs passed as parameters.
 */

import { computeDurationFromSteps } from './index.js';

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

/**
 * Persist the canvas state. Same call shape as before so existing call
 * sites don't have to change, but the heavy "analyse first" step is
 * gone. The returned object only carries the row id + storage status.
 */
export async function generateReportInline(input, deps) {
  const {
    processes,
    contact,
    moduleId,
    editingReportId = null,
    customDepartments = [],
    auditTrail = [],
    authUser,
    sessionUser,
    accessToken,
    dealId = null,
  } = input || {};

  const { sendDiagnosticReport, onProgress } = deps || {};
  if (typeof sendDiagnosticReport !== 'function') {
    throw new Error('generateReportInline: sendDiagnosticReport is required');
  }

  onProgress?.('Saving your process…');

  const enrichedProcesses = (processes || []).filter(Boolean).map(enrichProcessCosts);
  if (enrichedProcesses.length === 0) throw new Error('No process data to save.');

  // The save endpoint is an upsert into `processes`. The payload is
  // the canvas state itself — no summary, no recommendations, no
  // automationScore. Those derive live from steps via processMetrics.
  const reportPayload = {
    editingReportId: editingReportId || null,
    contact,
    fallbackEmail: sessionUser?.email || undefined,
    authToken: accessToken || undefined,
    processes: enrichedProcesses.map((p) => {
      const steps = (p.steps || []).map((s, si) => ({
        number: si + 1,
        name: s.name || '',
        department: s.department || '',
        isDecision: !!s.isDecision,
        isExternal: !!s.isExternal,
        branches: s.branches || [],
      }));
      const handoffs = p.handoffs || [];
      const departments = [...new Set(steps.map((s) => s.department).filter(Boolean))];
      return { ...p, steps, handoffs, handoffCount: handoffs.length, departments };
    }),
    rawProcesses: JSON.parse(JSON.stringify(enrichedProcesses)),
    customDepartments,
    // auditTrail intentionally NOT included in the wire payload — the
    // `changes` relational table is the canonical audit log now. The
    // in-memory tail is still kept by DiagnosticContext for UI display.
    dealParticipantToken: authUser?.dealParticipantToken || null,
    dealCode: authUser?.dealCode || null,
    dealId: dealId || null,
  };

  const reportData = await sendDiagnosticReport(reportPayload, {
    accessToken: accessToken || undefined,
  });

  return {
    reportId: reportData?.reportId || null,
    storedInSupabase: !!reportData?.storedInSupabase,
    supabaseError: reportData?.supabaseError || null,
    reportData,
  };
}
