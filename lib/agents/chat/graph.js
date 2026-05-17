import Anthropic from '@anthropic-ai/sdk';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';
import officeParser from 'officeparser';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { chatSystemPrompt, modelChatSystemPrompt, dealChatSystemPrompt } from '../../prompts.js';
import { ALL_CHAT_TOOLS, MODEL_AGENT_TOOLS, DEAL_AGENT_TOOLS } from './tools.js';
import { pickAgent } from './router.js';
import { computeAgentIntro } from './intros.js';
import { CHAT_MODEL_ID } from '../models.js';
import { getSignificantBottlenecks } from '../../diagnostic/detectBottlenecks.js';
import { getWaitProfile } from '../../flows/flowModel.js';
import { getSupabaseHeaders, fetchWithTimeout, requireSupabase } from '../../api-helpers.js';
import { getSupabaseAdmin } from '../../supabase.js';
import { recordDealProposal } from '../../changes/dealProposals.js';
import { recordWorkspaceProposal } from '../../changes/workspaceProposals.js';

// Default platform-key client. Used when no customer key is in scope (anon
// flows, marketing). Each call site that has access to an org context should
// resolve via lib/customerKey.js -> resolveActiveKey() and pass apiKey through
// to runChatAgent (see ctx.apiKey threading below).
const _platformClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function getAnthropicClient(apiKey) {
  if (apiKey && typeof apiKey === 'string' && apiKey.length > 0 && apiKey !== process.env.ANTHROPIC_API_KEY) {
    // Per-call client with the customer key. Cheap to construct.
    return new Anthropic({ apiKey });
  }
  return _platformClient;
}

/* ── Read-tool computations ───────────────────────────────────────── */

function toProcessShape({ steps, handoffs, processName }) {
  return { processName: processName || '', steps: steps || [], handoffs: handoffs || [] };
}

function computeBottlenecks(ctx) {
  const process = toProcessShape(ctx);
  if (!process.steps.length) return 'No steps in the flow yet.';
  const bns = getSignificantBottlenecks(process);
  if (!bns?.length) return 'No significant bottlenecks detected - no steps have material wait time.';
  const lines = bns.slice(0, 5).map((b) => {
    const riskLabel = b.risk ? b.risk.toUpperCase() : 'FLAGGED';
    const reasons = (b.reasons || []).slice(0, 3).join('; ');
    return `- Step ${b.stepIndex + 1} "${b.stepName}" [${riskLabel}, score ${b.score}, wait ${b.waitMinutes || 0}m] - ${reasons}`;
  });
  return `Bottlenecks (ranked by severity):\n${lines.join('\n')}`;
}

function computeCriticalPath(ctx) {
  const process = toProcessShape(ctx);
  const steps = process.steps;
  if (!steps.length) return 'No steps in the flow yet.';

  // Linear critical path: for each step add work + effective wait. Branches
  // make this approximate - we walk the "main" path (branch 0 / first target)
  // and fall back to sequential order when no branch is set.
  const waitProfile = getWaitProfile(process);
  const path = [];
  let idx = 0;
  let guard = 0;
  const visited = new Set();
  while (idx >= 0 && idx < steps.length && guard < steps.length * 2) {
    if (visited.has(idx)) break;
    visited.add(idx);
    const s = steps[idx];
    const work = s.workMinutes || 0;
    const wait = waitProfile[idx]?.effective || 0;
    path.push({ idx, name: s.name || `Step ${idx + 1}`, work, wait, total: work + wait });

    if (s.isDecision && s.branches?.length) {
      const target = s.branches[0]?.target || '';
      const m = /Step\s+(\d+)/i.exec(target);
      idx = m ? parseInt(m[1], 10) - 1 : idx + 1;
    } else {
      idx = idx + 1;
    }
    guard++;
  }

  const totalWork = path.reduce((a, p) => a + p.work, 0);
  const totalWait = path.reduce((a, p) => a + p.wait, 0);
  const totalMin = totalWork + totalWait;
  const topContributors = [...path].sort((a, b) => b.total - a.total).slice(0, 3);
  const contribLines = topContributors.map((p) => `  - Step ${p.idx + 1} "${p.name}": ${p.total}m (${p.work}m work + ${p.wait}m wait)`);
  return [
    `Critical path: ${path.length} steps, total ${totalMin}m (${totalWork}m work + ${totalWait}m wait).`,
    'Top contributors:',
    ...contribLines,
  ].join('\n');
}

function computeStepMetrics(ctx, input) {
  const steps = ctx.steps || [];
  if (!steps.length) return 'No steps in the flow yet.';
  const handoffs = ctx.handoffs || [];

  const stepLine = (s, i) => {
    const warnings = [];
    if (!s.department) warnings.push('no department');
    if (!(s.systems || []).length) warnings.push('no systems');
    const h = handoffs[i];
    if (i < steps.length - 1 && !h?.method) warnings.push('no handoff method');
    const parts = [`Step ${i + 1} "${s.name || '(unnamed)'}"`];
    if (s.department) parts.push(`dept: ${s.department}`);
    if (s.workMinutes != null) parts.push(`work ${s.workMinutes}m`);
    if (s.waitMinutes != null) parts.push(`wait ${s.waitMinutes}m`);
    if (s.isDecision) parts.push('decision');
    if (s.isMerge) parts.push('merge');
    if (warnings.length) parts.push(`⚠ ${warnings.join(', ')}`);
    return `- ${parts.join(' · ')}`;
  };

  if (typeof input?.stepNumber === 'number') {
    const i = input.stepNumber - 1;
    if (i < 0 || i >= steps.length) return `Step ${input.stepNumber} does not exist (have ${steps.length} steps).`;
    return stepLine(steps[i], i);
  }

  const totals = steps.reduce(
    (acc, s) => {
      acc.work += s.workMinutes || 0;
      acc.wait += s.waitMinutes || 0;
      if (s.isDecision) acc.decisions++;
      if (s.isMerge) acc.merges++;
      return acc;
    },
    { work: 0, wait: 0, decisions: 0, merges: 0 },
  );
  const header = `${steps.length} steps · ${totals.work}m work · ${totals.wait}m wait · ${totals.decisions} decisions · ${totals.merges} merges`;
  return [header, ...steps.map((s, i) => stepLine(s, i))].join('\n');
}

async function fetchReportBlob(reportId) {
  if (!reportId) return null;
  const sbConfig = requireSupabase();
  if (!sbConfig) return null;
  try {
    const resp = await fetchWithTimeout(
      `${sbConfig.url}/rest/v1/processes?id=eq.${encodeURIComponent(reportId)}&select=flow_data,financial_model`,
      { method: 'GET', headers: getSupabaseHeaders(sbConfig.key) },
      5000,
    );
    if (!resp.ok) return null;
    const rows = await resp.json();
    const row = rows?.[0];
    if (!row) return null;
    // Echo legacy `diagnostic_data` key so older call sites that read
    // it keep working.
    return { ...row, diagnostic_data: row.flow_data };
  } catch {
    return null;
  }
}

function formatMoney(n, currency) {
  if (n == null || !Number.isFinite(n)) return '-';
  const sym = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '£';
  return `${sym}${Math.round(n).toLocaleString()}`;
}

// Live cost summary computed from the current canvas state, not a
// captured-at-save snapshot. Reads costAnalysis (the user's rate
// inputs — config, not snapshot) and derives totals via processMetrics
// which walks rawProcesses[].steps[] every call.
async function computeCostSummaryFromBlob(blob) {
  const dd = blob?.diagnostic_data || {};
  const ca = dd.costAnalysis || {};
  const currency = ca.currency || 'GBP';
  const parts = [];

  if (Array.isArray(ca.labourRates) && ca.labourRates.length) {
    parts.push('Labour rates:');
    for (const r of ca.labourRates) {
      const unit = r.rateType === 'annual' ? '/yr' : '/hr';
      parts.push(`- ${r.department}: ${formatMoney(r.rateInput, currency)}${unit} (util ${Math.round((r.utilisation ?? 0.85) * 100)}%)`);
    }
  }
  if (ca.blendedRate != null) parts.push(`Blended rate: ${formatMoney(ca.blendedRate, currency)}/hr`);
  if (ca.onCostMultiplier != null) parts.push(`On-cost multiplier: ${ca.onCostMultiplier}`);
  if (ca.nonLabour?.systemsAnnual != null) parts.push(`Systems (annual): ${formatMoney(ca.nonLabour.systemsAnnual, currency)}`);
  if (ca.implementationCost != null) parts.push(`Implementation investment: ${formatMoney(ca.implementationCost, currency)}`);

  // Totals: derived live, never read from any frozen blob.
  try {
    const { deriveProcessMetrics } = await import('../../processMetrics.js');
    const m = deriveProcessMetrics(dd);
    if (m.total_annual_cost) parts.push(`Annual cost today: ${formatMoney(m.total_annual_cost, currency)} (derived live from steps)`);
    if (m.potential_savings) parts.push(`Potential annual savings: ${formatMoney(m.potential_savings, currency)} (derived live from steps)`);
    if (m.automation_percentage != null) parts.push(`Automation: ${m.automation_percentage}% (grade ${m.automation_grade})`);
  } catch { /* derivation is best-effort */ }

  return parts.length
    ? parts.join('\n')
    : 'No cost data yet. Set labour rates, system costs and step durations to populate the figures — everything derives live from the canvas as you edit.';
}

async function listUserReports({ userId, email }, limit = 8) {
  if (!userId && !email) return null;
  const cap = Math.min(Math.max(limit || 8, 1), 20);
  try {
    const sb = getSupabaseAdmin();
    const q = sb
      .from('processes')
      .select('id,company,contact_name,flow_data,created_at')
      .order('created_at', { ascending: false })
      .limit(cap);
    const emailLower = (email || '').toLowerCase().trim();
    if (userId) q.or(`user_id.eq.${userId},contact_email.eq.${emailLower}`);
    else q.eq('contact_email', emailLower);
    const { data, error } = await q;
    if (error) return null;
    const { attachDerivedMetrics } = await import('../../processMetrics.js');
    return (data || []).map((r) => attachDerivedMetrics({ ...r, diagnostic_data: r.flow_data }));
  } catch {
    return null;
  }
}

async function fetchUserReportById({ userId, email }, reportId) {
  if (!reportId || (!userId && !email)) return null;
  try {
    const sb = getSupabaseAdmin();
    const q = sb
      .from('processes')
      .select('id,company,contact_name,contact_email,user_id,flow_data,financial_model,created_at')
      .eq('id', reportId)
      .limit(1);
    const { data, error } = await q;
    if (error || !data?.length) return null;
    const row = data[0];
    const emailLower = (email || '').toLowerCase().trim();
    const belongs =
      (userId && row.user_id === userId) ||
      (emailLower && (row.contact_email || '').toLowerCase() === emailLower);
    if (!belongs) return null;
    const { attachDerivedMetrics } = await import('../../processMetrics.js');
    return attachDerivedMetrics({ ...row, diagnostic_data: row.flow_data });
  } catch {
    return null;
  }
}

/**
 * Resolve which operating model this chat turn binds to, so every
 * model-scoped tool (emit_artefact, get_model_summary, …) sees a
 * consistent id even when the session entry point (a process chat, a
 * deal chat, onboarding) never threaded one.
 *
 * Order, most-specific first:
 *   1. the id the client sent (explicit pick / canvas model)
 *   2. the open process's operating model (process chats) — only if
 *      the caller owns that process, so we never bind an artefact to
 *      a model the user can't see
 *   3. the user's default operating model (same model the Outputs tab
 *      resolves to on /workspace)
 */
async function resolveActiveModelId({ operatingModelId, reportId, session }) {
  if (operatingModelId) return operatingModelId;

  if (reportId && (session?.userId || session?.email)) {
    try {
      const sb = getSupabaseAdmin();
      const { data } = await sb
        .from('processes')
        .select('operating_model_id,user_id,contact_email')
        .eq('id', reportId)
        .limit(1);
      const row = data?.[0];
      if (row?.operating_model_id) {
        const emailLower = (session.email || '').toLowerCase().trim();
        const owns =
          (session.userId && row.user_id === session.userId) ||
          (emailLower && (row.contact_email || '').toLowerCase() === emailLower);
        if (owns) return row.operating_model_id;
      }
    } catch { /* fall through to the default-model resolve */ }
  }

  if (session?.email || session?.userId) {
    try {
      const { resolveDefaultModelForUser } = await import('../../operatingModel/auth.js');
      const r = await resolveDefaultModelForUser({ email: session.email, userId: session.userId });
      if (r?.modelId) return r.modelId;
    } catch { /* no model — leave null */ }
  }
  return null;
}

function summariseReportRow(row) {
  const dd = row.diagnostic_data || {};
  const name = dd.processes?.[0]?.name || dd.rawProcesses?.[0]?.processName || 'Untitled process';
  const steps = dd.rawProcesses?.[0]?.steps?.length ?? dd.processes?.[0]?.steps?.length ?? 0;
  const bits = [`id: ${row.id}`, name];
  if (row.company) bits.push(row.company);
  if (steps) bits.push(`${steps} steps`);
  if (row.total_annual_cost) bits.push(`annual cost £${Math.round(row.total_annual_cost).toLocaleString()}`);
  if (row.potential_savings) bits.push(`savings £${Math.round(row.potential_savings).toLocaleString()}`);
  if (row.automation_percentage != null) bits.push(`${row.automation_percentage}% automation`);
  if (row.created_at) bits.push(new Date(row.created_at).toISOString().slice(0, 10));
  return bits.join(' · ');
}

function detailedReportSummary(row) {
  const dd = row.diagnostic_data || {};
  const fm = row.financial_model || dd.financialModel || {};
  const name = dd.processes?.[0]?.name || dd.rawProcesses?.[0]?.processName || 'Untitled process';
  const steps = dd.rawProcesses?.[0]?.steps?.length ?? dd.processes?.[0]?.steps?.length ?? 0;
  const lines = [`Report ${row.id} - ${name}`];
  if (row.company) lines.push(`Company: ${row.company}`);
  if (steps) lines.push(`Steps: ${steps}`);
  if (row.total_annual_cost != null) lines.push(`Annual cost: £${Math.round(row.total_annual_cost).toLocaleString()}`);
  if (row.potential_savings != null) lines.push(`Potential savings: £${Math.round(row.potential_savings).toLocaleString()}`);
  if (row.automation_percentage != null) lines.push(`Automation: ${row.automation_percentage}% (grade ${row.automation_grade || '-'})`);
  if (fm.paybackMonths != null) lines.push(`Payback: ${typeof fm.paybackMonths === 'number' ? fm.paybackMonths.toFixed(1) : fm.paybackMonths} months`);
  if (fm.roiYear1 != null) lines.push(`Year-1 ROI: ${Math.round(fm.roiYear1 * 100)}%`);
  if (row.created_at) lines.push(`Created: ${new Date(row.created_at).toISOString().slice(0, 10)}`);
  return lines.join('\n');
}

// Live recommendations derived from the current canvas state. The
// old implementation read dd.recommendations — a frozen list captured
// at "generate report" time. That's gone. Now we walk the live steps
// and surface the biggest savings drivers via calculateProcessSavings.
async function computeRecommendationsFromBlob(blob) {
  const dd = blob?.diagnostic_data || {};
  const rawProcesses = Array.isArray(dd.rawProcesses) ? dd.rawProcesses
                     : Array.isArray(dd.processes)    ? dd.processes
                     : [];
  if (!rawProcesses.length) {
    return 'No process steps to analyse yet. Map a few steps and I can surface bottlenecks, automation opportunities and the biggest savings drivers live.';
  }

  let calculateProcessSavings;
  try {
    ({ calculateProcessSavings } = await import('../../costSavingsCalculator.js'));
  } catch {
    return 'Live recommendation analysis is unavailable right now.';
  }

  const items = [];
  rawProcesses.forEach((raw, pi) => {
    const procName = raw.processName || raw.name || `Process ${pi + 1}`;
    const sav = calculateProcessSavings(raw);
    if (!sav?.breakdown) return;
    const b = sav.breakdown;
    if (b.automationMins > 0) items.push({ proc: procName, kind: 'Automation', mins: b.automationMins, note: 'Manual steps that can be automated.' });
    if (b.bottleneckMins > 0) items.push({ proc: procName, kind: 'Bottleneck', mins: b.bottleneckMins, note: 'Wait time on the constraint step.' });
    if (b.redundancyMins > 0) items.push({ proc: procName, kind: 'Redundancy',  mins: b.redundancyMins, note: 'Excess approval / decision steps that could consolidate.' });
    if (b.workReductionMins > 0) items.push({ proc: procName, kind: 'Coordination', mins: b.workReductionMins, note: 'Email-based handoffs and external steps adding overhead.' });
  });

  if (!items.length) {
    return 'No standout opportunities found in the current flow. Bottlenecks, manual steps and excess approvals would show up here if there were any.';
  }

  items.sort((a, b) => b.mins - a.mins);
  const lines = items.slice(0, 6).map((it) => `- ${it.kind} in "${it.proc}" — ${Math.round(it.mins)}min per instance. ${it.note}`);
  return `Top opportunities (live from canvas):\n${lines.join('\n')}`;
}

/* ── Tool execution (returns result string for the model) ─────────── */

// Exposed for unit tests via __executeToolForTests below. Do not call directly
// from production code — runStreamingLoop is the only legitimate caller.
async function executeTool(name, input, ctx) {
  switch (name) {
    case 'add_step':
      return `Added step "${input.name}"${input.afterStep != null ? ` after step ${input.afterStep}` : ' at end'}.`;
    case 'update_step': {
      const fields = Object.keys(input).filter(k => k !== 'stepNumber');
      return `Updated step ${input.stepNumber}: ${fields.join(', ')}.`;
    }
    case 'remove_step':
      return `Removed step ${input.stepNumber}.`;
    case 'set_handoff':
      return `Set handoff from step ${input.fromStep}: ${input.method}.`;
    case 'add_custom_department':
      return `Added custom department "${input.name}".`;
    case 'replace_all_steps':
      return `Replaced entire flow with ${input.steps?.length || 0} steps.`;

    // Connector mutations
    case 'add_connector':
      return `Connected step ${input.fromStep} → step ${input.toStep}.`;
    case 'remove_connector':
      return `Removed connector ${input.fromStep} → ${input.toStep}.`;
    case 'redirect_connector': {
      const src = input.newFromStep ?? input.fromStep;
      const tgt = input.newToStep ?? input.toStep;
      return `Rewired connector ${input.fromStep}→${input.toStep} to ${src}→${tgt}.`;
    }
    case 'insert_step_between':
      return `Inserted "${input.name}" between step ${input.fromStep} and step ${input.toStep}.`;

    // Branch-level mutations
    case 'set_branch_target': {
      const which = input.branchIndex != null ? `branch ${input.branchIndex}` : input.branchLabel ? `"${input.branchLabel}"` : 'branch';
      return `Set ${which} on step ${input.stepNumber} → step ${input.newTargetStep}.`;
    }
    case 'set_branch_probability': {
      const which = input.branchIndex != null ? `branch ${input.branchIndex}` : input.branchLabel ? `"${input.branchLabel}"` : 'branch';
      const v = input.probability == null ? 'cleared' : `${input.probability}%`;
      return `Set ${which} probability on step ${input.stepNumber} to ${v}.`;
    }
    case 'set_branch_label': {
      const which = input.branchIndex != null ? `branch ${input.branchIndex}` : input.branchLabel ? `"${input.branchLabel}"` : 'branch';
      return `Renamed ${which} on step ${input.stepNumber} to "${input.newLabel}".`;
    }
    case 'remove_branch': {
      const which = input.branchIndex != null ? `branch ${input.branchIndex}` : input.branchLabel ? `"${input.branchLabel}"` : 'branch';
      return `Removed ${which} from step ${input.stepNumber}.`;
    }
    case 'add_branch': {
      const lbl = input.label ? `"${input.label}"` : 'new branch';
      const tgt = input.target ? ` → ${input.target}` : '';
      return `Added ${lbl}${tgt} to step ${input.stepNumber}.`;
    }

    // Step ordering / metadata / inputs
    case 'reorder_step':
      return `Moved step ${input.stepNumber} to position ${input.position}.`;
    case 'set_process_name':
      return `Renamed process to "${input.name}".`;
    case 'set_process_definition': {
      const fields = ['startsWhen', 'completesWhen', 'complexity'].filter((k) => input[k] != null);
      return fields.length ? `Updated process definition: ${fields.join(', ')}.` : 'No definition fields supplied.';
    }
    case 'set_step_details': {
      const fields = ['waitType', 'waitNote', 'capacity', 'description'].filter((k) => input[k] !== undefined);
      return fields.length ? `Updated step ${input.stepNumber}: ${fields.join(', ')}.` : `No detail fields supplied for step ${input.stepNumber}.`;
    }
    case 'set_cost_input': {
      const parts = [];
      if (input.frequency) parts.push(`frequency=${input.frequency}`);
      if (input.teamSize != null) parts.push(`teamSize=${input.teamSize}`);
      if (input.hoursPerInstance != null) parts.push(`hoursPerInstance=${input.hoursPerInstance}`);
      return parts.length ? `Set cost inputs: ${parts.join(', ')}.` : 'No cost fields supplied.';
    }
    case 'set_bottleneck': {
      const parts = [];
      if (input.reason) parts.push(`reason=${input.reason}`);
      if (input.why) parts.push(`why="${input.why}"`);
      return parts.length ? `Set bottleneck: ${parts.join(', ')}.` : 'No bottleneck fields supplied.';
    }
    case 'set_frequency_details': {
      const parts = [];
      if (input.inFlight != null) parts.push(`inFlight=${input.inFlight}`);
      return parts.length ? `Set frequency details: ${parts.join(', ')}.` : 'No frequency fields supplied.';
    }
    case 'set_pe_context': {
      const parts = [];
      if (input.peSopStatus) parts.push(`SOP=${input.peSopStatus}`);
      if (input.peKeyPerson) parts.push(`keyPerson=${input.peKeyPerson}`);
      if (input.peReportingImpact) parts.push(`reporting=${input.peReportingImpact}`);
      return parts.length ? `Set PE context: ${parts.join(', ')}.` : 'No PE context fields supplied.';
    }
    case 'add_step_system':
      return `Added "${input.system}" to step ${input.stepNumber} systems.`;
    case 'remove_step_system':
      return `Removed "${input.system}" from step ${input.stepNumber} systems.`;
    case 'add_checklist_item':
      return `Added checklist item "${input.text}" to step ${input.stepNumber}.`;
    case 'toggle_checklist_item': {
      const which = input.itemIndex != null ? `item ${input.itemIndex}` : input.text ? `"${input.text}"` : 'item';
      const state = input.checked == null ? 'toggled' : (input.checked ? 'checked' : 'unchecked');
      return `${state[0].toUpperCase()}${state.slice(1)} ${which} on step ${input.stepNumber}.`;
    }
    case 'remove_checklist_item': {
      const which = input.itemIndex != null ? `item ${input.itemIndex}` : input.text ? `"${input.text}"` : 'item';
      return `Removed checklist ${which} from step ${input.stepNumber}.`;
    }
    case 'remove_custom_department':
      return `Removed custom department "${input.name}".`;
    // trigger_redesign / pin_flow_snapshot removed in living-workspace
    // migration. The agent no longer has these tools registered.

    // Reads
    case 'get_bottlenecks':
      return computeBottlenecks(ctx);
    case 'get_critical_path':
      return computeCriticalPath(ctx);
    case 'get_step_metrics':
      return computeStepMetrics(ctx, input);
    case 'get_cost_summary': {
      if (!ctx.editingReportId) return 'No process is open on the canvas yet — open or map one first and cost figures will derive live from the steps.';
      const blob = await fetchReportBlob(ctx.editingReportId);
      return await computeCostSummaryFromBlob(blob);
    }
    case 'get_recommendations': {
      if (!ctx.editingReportId) return 'No process is open on the canvas yet — open or map one first and I can surface live opportunities from the steps.';
      const blob = await fetchReportBlob(ctx.editingReportId);
      return await computeRecommendationsFromBlob(blob);
    }
    case 'list_reports': {
      if (!ctx.session?.userId && !ctx.session?.email) {
        return 'User is not signed in, so prior reports cannot be listed. Ask them to sign in to the dashboard.';
      }
      const rows = await listUserReports(ctx.session, input?.limit);
      if (!rows) return 'Could not load reports right now.';
      const filtered = rows.filter((r) => r.id !== ctx.editingReportId);
      if (!filtered.length) return 'This user has no other saved reports.';
      return [`Saved reports (${filtered.length}):`, ...filtered.map((r) => `- ${summariseReportRow(r)}`)].join('\n');
    }
    case 'load_report_summary': {
      if (!ctx.session?.userId && !ctx.session?.email) {
        return 'User is not signed in, so other reports cannot be loaded.';
      }
      const row = await fetchUserReportById(ctx.session, input?.reportId);
      if (!row) return `Report ${input?.reportId || '(no id)'} was not found or does not belong to this user.`;
      return detailedReportSummary(row);
    }

    // Cost proposals - client renders an apply button; no server effect.
    case 'set_labour_rate':
      return `Proposed: ${input.department} → ${input.rateInput}${input.rateType === 'annual' ? '/yr' : '/hr'}${input.reason ? ` (${input.reason})` : ''}. Shown as apply button.`;
    case 'set_non_labour_cost':
      return `Proposed: ${input.key} → ${input.amount}${input.reason ? ` (${input.reason})` : ''}. Shown as apply button.`;
    case 'set_investment':
      return `Proposed: implementation investment → ${input.amount}${input.reason ? ` (${input.reason})` : ''}. Shown as apply button.`;

    // Navigation
    case 'highlight_step':
      return `Highlighted step ${input.stepNumber}.`;
    case 'open_panel':
      return `Opened ${input.panel} panel.`;

    // Undo
    case 'undo_last_action':
      return 'Reverted last chat action (client-side).';

    // Proposal / discovery
    case 'propose_change': {
      const lines = [`**${input.title}**`, '', input.rationale];
      if (input.steps_affected?.length) lines.push('', `Steps affected: ${input.steps_affected.join(', ')}`);
      if (input.expected_impact) lines.push(`Expected impact: ${input.expected_impact}`);
      return lines.join('\n');
    }
    case 'ask_discovery':
      return input.question;

    case 'search_deal_documents': {
      // SECURITY: refuse unless the route handler has verified the caller
      // has access to ctx.dealId. The route does this via resolveDealAccess
      // before calling runChatAgent. Without this guard, a user could pass
      // an arbitrary dealId in the request body and read its document chunks
      // (the search RPC runs under the service-role key, bypassing RLS).
      if (!ctx.dealAccessVerified || !ctx.dealId) {
        return 'No deal context on this chat session - search_deal_documents only works on deal-bound conversations where you have access to the deal.';
      }
      const sb = (await import('../../api-helpers.js')).requireSupabase();
      if (!sb) return 'Storage not configured; cannot search documents.';
      const { searchDealChunks } = await import('../../deal-analysis/chunkSearch.js');
      const rows = await searchDealChunks({
        supabaseUrl: sb.url,
        supabaseKey: sb.key,
        dealId: ctx.dealId,
        queryText: String(input.query || '').slice(0, 500),
        limit: Math.max(1, Math.min(Number(input.limit) || 12, 30)),
        party: input.party || null,
      });
      if (!rows.length) {
        return `No document chunks matched "${input.query}". The data room may be empty or still processing.`;
      }
      // Surface chunks to the client so they render as source cards under the
      // assistant's reply. Side-effect only — the model still gets the same
      // text payload below for citation/grounding.
      try {
        ctx?.onEmit?.('deal_documents', {
          dealId: ctx.dealId,
          query: String(input.query || '').slice(0, 200),
          chunks: rows.map((r) => ({
            chunkId: r.chunk_id,
            documentId: r.document_id,
            filename: r.filename || null,
            page: r.page_number || null,
            slide: r.slide_number || null,
            sheet: r.sheet_name || null,
            cellRange: r.cell_range || null,
            section: r.section_path || null,
            snippet: String(r.content || '').replace(/\s+/g, ' ').slice(0, 280),
          })),
        });
      } catch { /* never let UI emission break the agent loop */ }
      return [
        `Found ${rows.length} relevant chunks. Cite chunk_id in finding.evidence[].`,
        '',
        ...rows.map((r, i) => {
          const loc = [
            r.filename,
            r.page_number ? `p.${r.page_number}` : null,
            r.slide_number ? `slide ${r.slide_number}` : null,
            r.sheet_name ? `sheet ${r.sheet_name}` : null,
            r.cell_range ? `range ${r.cell_range}` : null,
            r.section_path,
          ].filter(Boolean).join(' · ');
          const snippet = String(r.content || '').replace(/\s+/g, ' ').slice(0, 500);
          return `[${i + 1}] chunk_id=${r.chunk_id} document_id=${r.document_id} (${loc})\n    ${snippet}`;
        }),
      ].join('\n');
    }

    case 'get_deal_summary': {
      if (!ctx.dealAccessVerified || !ctx.dealId) {
        return 'No deal context on this chat session - get_deal_summary only works on deal-bound conversations.';
      }
      return await runDealMetadataTool('summary', ctx, {});
    }

    case 'list_deal_participants': {
      if (!ctx.dealAccessVerified || !ctx.dealId) {
        return 'No deal context on this chat session - list_deal_participants only works on deal-bound conversations.';
      }
      return await runDealMetadataTool('participants', ctx, {});
    }

    case 'list_deal_documents': {
      if (!ctx.dealAccessVerified || !ctx.dealId) {
        return 'No deal context on this chat session - list_deal_documents only works on deal-bound conversations.';
      }
      return await runDealMetadataTool('documents', ctx, {
        limit: Math.max(1, Math.min(Number(input.limit) || 50, 200)),
        party: input.party || null,
      });
    }

    case 'list_deal_findings': {
      if (!ctx.dealAccessVerified || !ctx.dealId) {
        return 'No deal context on this chat session - list_deal_findings only works on deal-bound conversations.';
      }
      return await runDealMetadataTool('findings', ctx, {
        limit: Math.max(1, Math.min(Number(input.limit) || 30, 100)),
        area: input.area || null,
      });
    }

    case 'list_deal_changes': {
      if (!ctx.dealAccessVerified || !ctx.dealId) {
        return 'No deal context on this chat session - list_deal_changes only works on deal-bound conversations.';
      }
      return await runDealMetadataTool('changes', ctx, {
        limit: Math.max(1, Math.min(Number(input.limit) || 30, 100)),
        state: input.state || 'all',
      });
    }

    case 'propose_add_function': {
      if (!ctx.operatingModelId) {
        return 'No workspace context on this chat session — propose_add_function only works when the user is inside a workspace.';
      }
      const name = String(input.name || '').trim();
      if (!name) return 'name is required.';
      if (name.length > 200) return 'name must be 200 characters or fewer.';
      const parent_function_id = input.parent_function_id ? String(input.parent_function_id).trim() : null;
      const description = input.description ? String(input.description).slice(0, 1000) : null;

      const payload = { name, parent_function_id, description };
      const changeId = await recordWorkspaceProposal({
        ctx, sseKind: 'add_function',
        subject_ref: { ...payload, operating_model_id: ctx.operatingModelId },
      }).catch(() => null);

      try {
        ctx?.onEmit?.('workspace_proposal', {
          kind: 'add_function',
          operatingModelId: ctx.operatingModelId,
          payload,
          changeId,
        });
      } catch { /* never break the loop */ }
      return `Staged a function "${name}". The user will see a Confirm button; nothing has been written yet.`;
    }

    case 'propose_add_role': {
      if (!ctx.operatingModelId) {
        return 'No workspace context on this chat session — propose_add_role only works when the user is inside a workspace.';
      }
      const name = String(input.name || '').trim();
      if (!name) return 'name is required.';
      if (name.length > 200) return 'name must be 200 characters or fewer.';
      const headcountRaw = input.headcount != null ? Number(input.headcount) : null;
      const headcount = Number.isFinite(headcountRaw) && headcountRaw >= 0 ? headcountRaw : null;
      const owner_email = input.owner_email ? String(input.owner_email).toLowerCase().trim() : null;
      const function_ids = Array.isArray(input.function_ids) ? input.function_ids.map(String) : [];
      const description = input.description ? String(input.description).slice(0, 1000) : null;

      // The role table uses function_ids today (rename pending). Send the
      // payload through under both names so the apply endpoint just works.
      const payload = { name, headcount, owner_email, function_ids: function_ids, description };
      const changeId = await recordWorkspaceProposal({
        ctx, sseKind: 'add_role',
        subject_ref: { ...payload, operating_model_id: ctx.operatingModelId },
      }).catch(() => null);

      try {
        ctx?.onEmit?.('workspace_proposal', {
          kind: 'add_role',
          operatingModelId: ctx.operatingModelId,
          payload,
          changeId,
        });
      } catch { /* never break the loop */ }
      return `Staged a role "${name}". The user will see a Confirm button; nothing has been written yet.`;
    }

    case 'propose_add_system': {
      if (!ctx.operatingModelId) {
        return 'No workspace context on this chat session — propose_add_system only works when the user is inside a workspace.';
      }
      const name = String(input.name || '').trim();
      if (!name) return 'name is required.';
      if (name.length > 200) return 'name must be 200 characters or fewer.';
      const VALID_LAYER = new Set(['system_of_record', 'system_of_engagement', 'system_of_intelligence', 'integration', 'other']);
      const vendor      = input.vendor      ? String(input.vendor).slice(0, 200)      : null;
      const category    = input.category    ? String(input.category).slice(0, 80)     : null;
      const layer       = VALID_LAYER.has(input.layer) ? input.layer : null;
      const owner_email = input.owner_email ? String(input.owner_email).toLowerCase().trim() : null;
      const description = input.description ? String(input.description).slice(0, 1000) : null;

      const payload = { name, vendor, category, layer, owner_email, description };
      const changeId = await recordWorkspaceProposal({
        ctx, sseKind: 'add_system',
        subject_ref: { ...payload, operating_model_id: ctx.operatingModelId },
      }).catch(() => null);

      try {
        ctx?.onEmit?.('workspace_proposal', {
          kind: 'add_system',
          operatingModelId: ctx.operatingModelId,
          payload,
          changeId,
        });
      } catch { /* never break the loop */ }
      return `Staged a system "${name}". The user will see a Confirm button; nothing has been written yet.`;
    }

    case 'propose_workspace_bulk_setup': {
      if (!ctx.operatingModelId) {
        return 'No workspace context on this chat session — propose_workspace_bulk_setup only works when the user is inside a workspace.';
      }
      const cleanStr = (v, max = 200) => v ? String(v).slice(0, max).trim() : null;
      const VALID_LAYER = new Set(['system_of_record', 'system_of_engagement', 'system_of_intelligence', 'integration', 'other']);

      const functions = Array.isArray(input.functions) ? input.functions : [];
      const roles     = Array.isArray(input.roles)     ? input.roles     : [];
      const systems   = Array.isArray(input.systems)   ? input.systems   : [];

      const planFunctions = functions
        .map((f) => ({
          name:        cleanStr(f?.name),
          parent_path: cleanStr(f?.parent_path, 500),
          description: cleanStr(f?.description, 1000),
        }))
        .filter((f) => f.name);

      const planRoles = roles
        .map((r) => ({
          name:           cleanStr(r?.name),
          headcount:      Number.isFinite(Number(r?.headcount)) && Number(r?.headcount) >= 0 ? Number(r.headcount) : null,
          owner_email:    r?.owner_email ? String(r.owner_email).toLowerCase().trim() : null,
          function_names: Array.isArray(r?.function_names) ? r.function_names.map((s) => cleanStr(s)).filter(Boolean) : [],
          description:    cleanStr(r?.description, 1000),
        }))
        .filter((r) => r.name);

      const planSystems = systems
        .map((s) => ({
          name:        cleanStr(s?.name),
          vendor:      cleanStr(s?.vendor),
          category:    cleanStr(s?.category, 80),
          layer:       VALID_LAYER.has(s?.layer) ? s.layer : null,
          owner_email: s?.owner_email ? String(s.owner_email).toLowerCase().trim() : null,
          description: cleanStr(s?.description, 1000),
        }))
        .filter((s) => s.name);

      const total = planFunctions.length + planRoles.length + planSystems.length;
      if (total === 0) return 'Empty plan — nothing to stage. Re-extract the user input and call again with at least one function/role/system.';
      if (total > 200) return 'Plan too large (over 200 items). Ask the user to break it up.';

      const notes = cleanStr(input.notes, 2000);

      try {
        ctx?.onEmit?.('workspace_bulk_proposal', {
          operatingModelId: ctx.operatingModelId,
          functions: planFunctions,
          roles:     planRoles,
          systems:   planSystems,
          notes,
        });
      } catch { /* never break the loop */ }
      return `Staged ${planFunctions.length} function(s), ${planRoles.length} role(s), ${planSystems.length} system(s). The user will see a per-row review card; nothing has been written yet.`;
    }

    /* ── Process lifecycle (Tier 1) + model edit/delete (Tier 2) ─────
       All stage a workspace_proposal the user confirms inline; the
       Confirm card maps `kind` to the right POST/PATCH/DELETE. Nothing
       is written here. `id` targets come from list_model_processes /
       the workspace_tree, validated again server-side at apply. */
    case 'create_process':
    case 'duplicate_process':
    case 'file_process':
    case 'delete_process':
    case 'propose_update_function':
    case 'propose_move_function':
    case 'propose_delete_function':
    case 'propose_update_role':
    case 'propose_delete_role':
    case 'propose_update_system':
    case 'propose_delete_system': {
      if (!ctx.operatingModelId) {
        return `No workspace context on this chat session — ${name} only works when the user is inside a workspace.`;
      }
      const str = (v, max = 200) => (v != null && v !== '' ? String(v).slice(0, max).trim() : null);
      const lower = (v) => (v ? String(v).toLowerCase().trim() : null);
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const FN_LAYER = new Set(['value_chain', 'enabling', 'governance']);
      const FN_STATUS = new Set(['live', 'planned', 'retired']);
      const SYS_LAYER = new Set(['system_of_record', 'system_of_engagement', 'system_of_intelligence', 'integration', 'other']);

      // kind (client card key) + payload + the human echo. Each branch
      // pulls only the fields it needs and drops the rest.
      let kind; let payload; let echo;
      switch (name) {
        case 'create_process': {
          const nm = str(input.name);
          if (!nm) return 'name is required.';
          kind = 'create_process';
          payload = { name: nm, function_id: input.function_id && uuidRe.test(input.function_id) ? input.function_id : null };
          echo = `process "${nm}"`;
          break;
        }
        case 'duplicate_process': {
          const sid = str(input.source_process_id, 64);
          if (!sid) return 'source_process_id is required.';
          kind = 'duplicate_process';
          payload = { source_process_id: sid, name: str(input.name) };
          echo = `a copy of process ${sid}`;
          break;
        }
        case 'file_process': {
          const pid = str(input.process_id, 64);
          if (!pid) return 'process_id is required.';
          const fid = input.function_id == null ? null
            : (uuidRe.test(input.function_id) ? input.function_id : undefined);
          if (fid === undefined) return 'function_id must be a function id or null.';
          kind = 'file_process';
          payload = { process_id: pid, function_id: fid };
          echo = fid ? `filing process ${pid}` : `unfiling process ${pid}`;
          break;
        }
        case 'delete_process': {
          const pid = str(input.process_id, 64);
          if (!pid) return 'process_id is required.';
          kind = 'delete_process';
          payload = { process_id: pid, process_name: str(input.process_name) };
          echo = `deletion of process "${payload.process_name || pid}"`;
          break;
        }
        case 'propose_update_function': {
          const fid = str(input.function_id, 64);
          if (!fid) return 'function_id is required.';
          const p = {};
          if (input.name != null) p.name = str(input.name);
          if (input.description != null) p.description = str(input.description, 4000);
          if (input.layer && FN_LAYER.has(input.layer)) p.layer = input.layer;
          if (input.status && FN_STATUS.has(input.status)) p.status = input.status;
          if (input.owner_email != null) p.owner_email = lower(input.owner_email);
          if (Object.keys(p).length === 0) return 'Nothing to change — supply at least one field.';
          kind = 'update_function';
          payload = { function_id: fid, patch: p };
          echo = `edit to function ${fid}`;
          break;
        }
        case 'propose_move_function': {
          const fid = str(input.function_id, 64);
          if (!fid) return 'function_id is required.';
          const parent = input.parent_function_id == null ? null
            : (uuidRe.test(input.parent_function_id) ? input.parent_function_id : undefined);
          if (parent === undefined) return 'parent_function_id must be a function id or null.';
          if (parent === fid) return 'A function cannot be its own parent.';
          kind = 'update_function';
          payload = { function_id: fid, patch: { parent_function_id: parent } };
          echo = parent ? `re-nesting function ${fid}` : `moving function ${fid} to top level`;
          break;
        }
        case 'propose_delete_function': {
          const fid = str(input.function_id, 64);
          if (!fid) return 'function_id is required.';
          kind = 'delete_function';
          payload = { function_id: fid, function_name: str(input.function_name) };
          echo = `deletion of function "${payload.function_name || fid}"`;
          break;
        }
        case 'propose_update_role': {
          const rid = str(input.role_id, 64);
          if (!rid) return 'role_id is required.';
          const p = {};
          if (input.name != null) p.name = str(input.name);
          if (input.headcount != null && Number.isFinite(Number(input.headcount)) && Number(input.headcount) >= 0) p.headcount = Number(input.headcount);
          if (input.owner_email != null) p.owner_email = lower(input.owner_email);
          if (Array.isArray(input.function_ids)) p.function_ids = input.function_ids.map(String);
          if (input.description != null) p.description = str(input.description, 4000);
          if (Object.keys(p).length === 0) return 'Nothing to change — supply at least one field.';
          kind = 'update_role';
          payload = { role_id: rid, patch: p };
          echo = `edit to role ${rid}`;
          break;
        }
        case 'propose_delete_role': {
          const rid = str(input.role_id, 64);
          if (!rid) return 'role_id is required.';
          kind = 'delete_role';
          payload = { role_id: rid, role_name: str(input.role_name) };
          echo = `deletion of role "${payload.role_name || rid}"`;
          break;
        }
        case 'propose_update_system': {
          const sid = str(input.system_id, 64);
          if (!sid) return 'system_id is required.';
          const p = {};
          if (input.name != null) p.name = str(input.name);
          if (input.vendor != null) p.vendor = str(input.vendor);
          if (input.category != null) p.category = str(input.category, 80);
          if (input.layer && SYS_LAYER.has(input.layer)) p.layer = input.layer;
          if (input.owner_email != null) p.owner_email = lower(input.owner_email);
          if (input.description != null) p.description = str(input.description, 4000);
          if (Object.keys(p).length === 0) return 'Nothing to change — supply at least one field.';
          kind = 'update_system';
          payload = { system_id: sid, patch: p };
          echo = `edit to system ${sid}`;
          break;
        }
        case 'propose_delete_system': {
          const sid = str(input.system_id, 64);
          if (!sid) return 'system_id is required.';
          kind = 'delete_system';
          payload = { system_id: sid, system_name: str(input.system_name) };
          echo = `deletion of system "${payload.system_name || sid}"`;
          break;
        }
        default:
          return `Unhandled tool ${name}.`;
      }

      try {
        ctx?.onEmit?.('workspace_proposal', {
          kind,
          operatingModelId: ctx.operatingModelId,
          payload,
          changeId: null,
        });
      } catch { /* never break the loop */ }
      return `Staged ${echo}. The user will see a Confirm button; nothing has been written yet.`;
    }

    case 'emit_artefact': {
      // ctx.operatingModelId is resolved centrally (resolveActiveModelId)
      // so this works from process / deal / onboarding chats too. Only
      // truly model-less users (no org / default model) hit this guard.
      const modelId = ctx.operatingModelId || null;
      if (!modelId) {
        return "No workspace to save to — the Outputs panel is model-scoped and this user has no operating model. Give the user the content directly in the reply instead.";
      }
      const title = String(input.title || '').trim();
      if (!title) return 'title is required.';
      const skillId = String(input.skill || '').trim();
      if (!skillId) return 'skill is required (pick the closest artefact skill, or "custom"/"raw").';
      const summary = input.summary ? String(input.summary).slice(0, 500) : null;
      const supersedes = (input.supersedes && typeof input.supersedes === 'string')
        ? input.supersedes.trim() : null;

      const { getSkill, RAW_SKILL, validateForType } = await import('../artefacts/skills.js');

      // Meter sub-agent / code-execution spend into the org token
      // ledger so artefact generation isn't an invisible cost hole.
      // Best-effort: never block the artefact on a metering hiccup.
      const meterArtefact = async (usage, sk) => {
        try {
          const ut = (usage?.input_tokens || 0) + (usage?.output_tokens || 0);
          if (ut <= 0 || !(ctx.session?.email || ctx.session?.userId)) return;
          const { recordTokenUsage, getOrgIdForUser } = await import('../../costGuard.js');
          const orgId = await getOrgIdForUser({
            email: ctx.session?.email, userId: ctx.session?.userId,
          });
          await recordTokenUsage({
            orgId,
            vendor: 'anthropic',
            model: ctx.model || 'claude-opus-4-7',
            surface: `artefact:${sk}`,
            refId: modelId,
            inputTokens: usage.input_tokens || 0,
            outputTokens: usage.output_tokens || 0,
            userEmail: ctx.session?.email,
            userId: ctx.session?.userId,
          });
        } catch (e) {
          logger.warn('Artefact usage metering failed', { skill: sk, error: e.message });
        }
      };

      let type; let content; let language = null;

      if (skillId === RAW_SKILL) {
        // Trivial direct content the agent supplied itself — no sub-agent.
        const raw = typeof input.content === 'string' ? input.content : '';
        if (!raw.trim()) return 'For skill="raw" you must supply non-empty content.';
        if (raw.length > 200_000) return 'content is too large (over 200k chars). Split it.';
        language = input.language ? String(input.language).slice(0, 40) : null;
        type = language ? 'code' : 'markdown';
        const v = validateForType(type, raw);
        content = v.ok ? v.content : raw;
      } else {
        const skill = getSkill(skillId);
        if (!skill) return `Unknown skill "${skillId}". Use one of the documented skills, "custom", or "raw".`;
        const spec = String(input.spec || '').trim();
        if (!spec) return 'spec is required for a generated artefact — describe exactly what to produce (scope, sections/columns, parameters), not just a topic.';

        // Spec-bundle grounding: the specialist can't see the chat, so
        // pass what the agent already knows plus cheap session context.
        const ctxBits = [];
        if (input.context) ctxBits.push(String(input.context).slice(0, 20000));
        if (ctx.processName) ctxBits.push(`Current process in focus: ${ctx.processName}.`);
        ctxBits.push(`Operating model id: ${modelId}.`);

        if (skill.office) {
          // Binary deliverable (.pptx/.docx/.xlsx). The build (model +
          // code-execution sandbox) takes tens of seconds to minutes, so
          // it must NOT block the chat turn. Create a placeholder row
          // marked "building", surface it in Outputs immediately, and
          // hand the slow part to the buildOfficeArtefact Inngest worker.
          // The Outputs panel polls while anything is building, so the
          // finished file appears on its own — the user keeps chatting.
          const fmt = skill.format;
          const { createArtefact } = await import('../../operatingModel/artefacts.js');
          const meta = { skill: skillId, build: { status: 'building' } };
          if (summary) meta.summary = summary;
          if (supersedes) meta.supersedes = supersedes;
          const row = await createArtefact({
            operating_model_id: modelId,
            session_id: ctx.session?.chatSessionId || null,
            type: fmt,
            title: title.slice(0, 200),
            content: summary || `${skill.label}: ${title}`,
            language: null,
            source: 'agent',
            meta,
            created_by_email: ctx.session?.email || null,
          });
          if (!row) {
            return 'Storage was unavailable, so the document could not be queued. Tell the user to retry shortly.';
          }
          try {
            ctx?.onEmit?.('artefact', {
              id: row.id, type: fmt, title: row.title,
              language: null, summary, supersedes: supersedes || undefined,
              createdAt: row.created_at, building: true,
            });
          } catch { /* never break the loop */ }

          const buildArgs = {
            modelId, artefactId: row.id, skillId,
            title, spec, context: ctxBits.join('\n'),
            apiKey: ctx.apiKey,
            createdByEmail: ctx.session?.email || null,
            userId: ctx.session?.userId || null,
            summary, supersedes,
          };
          const { sendEvent } = await import('../../inngest/client.js');
          let queued;
          try {
            queued = await sendEvent({ name: 'artefact/office.requested', data: buildArgs });
          } catch (e) {
            queued = { skipped: true, reason: e.message };
          }
          if (queued?.skipped) {
            // No Inngest in this environment — fall back to building
            // inline so the file still completes (only this path waits).
            const { runOfficeArtefactBuild } = await import('../../operatingModel/officeArtefactBuild.js');
            const res = await runOfficeArtefactBuild(buildArgs).catch((e) => ({ ok: false, error: e.message }));
            if (!res?.ok) {
              return `The ${fmt.toUpperCase()} "${title}" failed to build: ${res?.error || 'unknown error'}. Tell the user it failed and offer to retry with a tighter brief. Do NOT substitute a markdown/json/text artefact.`;
            }
            return `Built the ${fmt.toUpperCase()} "${title}" — it's in the workspace Outputs panel (downloadable). Don't paste its contents into chat.`;
          }
          return `Started building the ${fmt.toUpperCase()} "${title}". It appears in the workspace Outputs panel as "Building…" and becomes downloadable there in about a minute — the user can keep working; it finishes on its own. Tell them that; do NOT paste document contents into chat, and do NOT emit a markdown/json/raw substitute.`;
        }

        const { generateArtefact } = await import('../artefacts/generate.js');
        const gen = await generateArtefact({
          skill,
          title,
          spec,
          context: ctxBits.join('\n'),
          apiKey: ctx.apiKey,
          // model omitted: the artefact specialist picks its own speed
          // tier per skill (most → Haiku-fast; heavy synthesis → Opus).
          // The chat session model is not the right tier for this.
        });
        if (gen.error) {
          return `The artefact specialist couldn't produce "${title}": ${gen.error}. Tell the user briefly and offer to retry with a tighter brief.`;
        }
        await meterArtefact(gen.usage, skillId);
        type = gen.type;
        content = gen.content;
        language = gen.language;
      }

      let saved = null;
      try {
        const { createArtefact } = await import('../../operatingModel/artefacts.js');
        const meta = {};
        if (summary) meta.summary = summary;
        meta.skill = skillId;
        // Version lineage. The chat route doesn't thread a chat-session
        // id into ctx, so artefacts group by model + time; supersedes
        // links a revision to the artefact it replaces (panel derives
        // the version chain — no migration, meta is jsonb).
        if (supersedes) meta.supersedes = supersedes;
        saved = await createArtefact({
          operating_model_id: modelId,
          session_id: ctx.session?.chatSessionId || null,
          type,
          title: title.slice(0, 200),
          content,
          language,
          source: 'agent',
          meta,
          created_by_email: ctx.session?.email || null,
        });
      } catch { /* fall through to the not-saved message */ }

      if (!saved) {
        return 'Could not save the artefact (storage unavailable). Tell the user the content is in the reply but was not pinned to the Outputs panel.';
      }

      try {
        ctx?.onEmit?.('artefact', {
          id: saved.id,
          type: saved.type,
          title: saved.title,
          language: saved.language,
          summary,
          supersedes: supersedes || undefined,
          createdAt: saved.created_at,
        });
      } catch { /* never break the loop */ }
      return supersedes
        ? `Saved a revised ${type} artefact "${title}" (new version) to the workspace Outputs panel. Tell the user the updated version is there; don't paste the full content into chat unless asked.`
        : `Saved a ${type} artefact "${title}" to the workspace Outputs panel. Tell the user it's available there; do not paste the full content back into chat unless they ask.`;
    }

    case 'propose_invite_participant': {
      if (!ctx.dealAccessVerified || !ctx.dealId) {
        return 'No deal context on this chat session - propose_invite_participant only works on deal-bound conversations.';
      }
      const VALID_ROLES = new Set(['platform_company', 'portfolio_company', 'acquirer', 'target', 'self']);
      const role = String(input.role || '').trim();
      const companyName = String(input.companyName || '').trim();
      const email = input.email ? String(input.email).trim().toLowerCase() : null;
      const name = input.name ? String(input.name).trim() : null;
      const sendInviteEmail = Boolean(input.sendInviteEmail);
      if (!VALID_ROLES.has(role)) return `Invalid role "${role}". Must be one of ${[...VALID_ROLES].join(', ')}.`;
      if (!companyName) return 'companyName is required.';
      if (companyName.length > 200) return 'companyName must be ≤ 200 chars.';
      if (email && !/^\S+@\S+\.\S+$/.test(email)) return `Invalid email "${email}".`;

      const changeId = await recordDealProposal({
        ctx, sseKind: 'invite_participant',
        subject_ref: { role, companyName, email, name, sendInviteEmail },
        rationale: `Invite "${companyName}" (${role})${email ? ` at ${email}` : ''}.`,
      }).catch(() => null);

      try {
        ctx?.onEmit?.('deal_proposal', {
          kind: 'invite_participant',
          dealId: ctx.dealId,
          role,
          companyName,
          email,
          name,
          sendInviteEmail,
          changeId,
        });
      } catch { /* never break the loop */ }

      return `Staged invite for "${companyName}" (${role})${email ? ` to ${email}` : ''}. The user will see an Apply button; nothing is created yet.`;
    }

    case 'propose_reprocess_document': {
      if (!ctx.dealAccessVerified || !ctx.dealId) {
        return 'No deal context on this chat session - propose_reprocess_document only works on deal-bound conversations.';
      }
      const documentId = String(input.documentId || '').trim();
      if (!documentId) return 'documentId is required.';
      const wipe = Boolean(input.wipe);

      // Validate the doc belongs to this deal + has bytes to re-process.
      const { requireSupabase, getSupabaseHeaders, fetchWithTimeout } = await import('../../api-helpers.js');
      const sb = requireSupabase();
      if (!sb) return 'Storage not configured.';
      const headers = getSupabaseHeaders(sb.key);
      const dResp = await fetchWithTimeout(
        `${sb.url}/rest/v1/deal_documents?id=eq.${encodeURIComponent(documentId)}&deal_id=eq.${ctx.dealId}&select=id,filename,status,storage_path&limit=1`,
        { headers },
      );
      const [doc] = dResp.ok ? await dResp.json() : [];
      if (!doc) return `No document with id "${documentId}" on this deal. Run list_deal_documents to see valid ids.`;
      if (!doc.storage_path) return `"${doc.filename}" has no stored bytes — it needs to be re-uploaded, not reprocessed.`;

      const reprocessReason = input.reason ? String(input.reason).slice(0, 280) : null;

      const changeId = await recordDealProposal({
        ctx, sseKind: 'reprocess_document',
        subject_ref: { document_id: doc.id, filename: doc.filename, wipe },
        rationale: reprocessReason || `Reprocess "${doc.filename}" (was ${doc.status})${wipe ? ' with chunk wipe' : ''}.`,
        evidence_refs: [{ kind: 'document', id: doc.id, snippet: doc.filename }],
      }).catch(() => null);

      try {
        ctx?.onEmit?.('deal_proposal', {
          kind: 'reprocess_document',
          dealId: ctx.dealId,
          documentId: doc.id,
          filename: doc.filename,
          currentStatus: doc.status,
          wipe,
          reason: reprocessReason,
          changeId,
        });
      } catch { /* never break the loop */ }

      return `Staged reprocess for "${doc.filename}" (current status: ${doc.status})${wipe ? ' with chunk wipe' : ''}. The user will see an Apply button.`;
    }

    case 'propose_link_participant_report': {
      if (!ctx.dealAccessVerified || !ctx.dealId) {
        return 'No deal context on this chat session - propose_link_participant_report only works on deal-bound conversations.';
      }
      const participantId = String(input.participantId || '').trim();
      const reportId = String(input.reportId || '').trim();
      if (!participantId) return 'participantId is required.';
      if (!reportId) return 'reportId is required.';

      const { requireSupabase, getSupabaseHeaders, fetchWithTimeout } = await import('../../api-helpers.js');
      const sb = requireSupabase();
      if (!sb) return 'Storage not configured.';
      const headers = getSupabaseHeaders(sb.key);

      const pResp = await fetchWithTimeout(
        `${sb.url}/rest/v1/deal_participants?id=eq.${encodeURIComponent(participantId)}&deal_id=eq.${ctx.dealId}&select=id,role,company_name,status&limit=1`,
        { headers },
      );
      const [participant] = pResp.ok ? await pResp.json() : [];
      if (!participant) return `No participant with id "${participantId}" on this deal. Run list_deal_participants to see valid ids.`;

      const rResp = await fetchWithTimeout(
        `${sb.url}/rest/v1/processes?id=eq.${encodeURIComponent(reportId)}&select=id&limit=1`,
        { headers },
      );
      const [report] = rResp.ok ? await rResp.json() : [];
      if (!report) return `No process with id "${reportId}". Run list_reports to see what's available.`;

      const changeId = await recordDealProposal({
        ctx, sseKind: 'link_participant_report',
        subject_ref: { participantId, reportId, company_name: participant.company_name, role: participant.role },
        rationale: `Link report ${reportId} to "${participant.company_name}" (${participant.role}).`,
      }).catch(() => null);

      try {
        ctx?.onEmit?.('deal_proposal', {
          kind: 'link_participant_report',
          dealId: ctx.dealId,
          participantId,
          participantCompany: participant.company_name,
          participantRole: participant.role,
          participantStatus: participant.status,
          reportId,
          changeId,
        });
      } catch { /* never break the loop */ }

      return `Staged linking report ${reportId} to participant "${participant.company_name}" (${participant.role}). The user will see an Apply button.`;
    }

    case 'propose_upload_document': {
      if (!ctx.dealAccessVerified || !ctx.dealId) {
        return 'No deal context on this chat session - propose_upload_document only works on deal-bound conversations.';
      }
      const docTypes = Array.isArray(input.docTypes) ? input.docTypes.map((s) => String(s).slice(0, 80)).filter(Boolean).slice(0, 12) : [];
      if (!docTypes.length) return 'docTypes is required (provide at least one document type to ask for).';
      const reason = input.reason ? String(input.reason).slice(0, 280) : null;

      try {
        ctx?.onEmit?.('deal_proposal', {
          kind: 'upload_document',
          dealId: ctx.dealId,
          docTypes,
          reason,
        });
      } catch { /* never break the loop */ }

      return `Staged upload request for ${docTypes.length} document type${docTypes.length === 1 ? '' : 's'}. The user clicks Apply to open the data-room upload UI.`;
    }

    case 'propose_undo_last_action': {
      if (!ctx.dealAccessVerified || !ctx.dealId) {
        return 'No deal context on this chat session - propose_undo_last_action only works on deal-bound conversations.';
      }
      const VALID = new Set(['link_participant_report']);
      const undoKind = String(input.kind || '').trim();
      if (!VALID.has(undoKind)) {
        return `Cannot stage undo: kind must be one of ${[...VALID].join(', ')}. Other actions (invite, upload, reprocess) are not undoable from chat - they have side effects (sent emails, queued workers) that need a deliberate process.`;
      }

      const { requireSupabase, getSupabaseHeaders, fetchWithTimeout } = await import('../../api-helpers.js');
      const sb = requireSupabase();
      if (!sb) return 'Storage not configured.';
      const headers = getSupabaseHeaders(sb.key);

      if (undoKind === 'link_participant_report') {
        const participantId = String(input.participantId || '').trim();
        if (!participantId) return 'participantId is required for undoing a participant report link.';
        const pResp = await fetchWithTimeout(
          `${sb.url}/rest/v1/deal_participants?id=eq.${encodeURIComponent(participantId)}&deal_id=eq.${ctx.dealId}&select=id,company_name,process_id,status&limit=1`,
          { headers },
        );
        const [participant] = pResp.ok ? await pResp.json() : [];
        if (!participant) return `No participant with id "${participantId}" on this deal.`;
        if (!participant.process_id) return `Participant "${participant.company_name}" has no linked process — nothing to undo.`;

        const changeId = await recordDealProposal({
          ctx, sseKind: 'undo_link_participant_report',
          subject_ref: { participantId, previous_process_id: participant.process_id, company_name: participant.company_name },
          rationale: `Unlink process ${participant.process_id} from "${participant.company_name}".`,
        }).catch(() => null);

        try {
          ctx?.onEmit?.('deal_proposal', {
            kind: 'undo_link_participant_report',
            dealId: ctx.dealId,
            participantId,
            participantCompany: participant.company_name,
            previousProcessId: participant.process_id,
            previousReportId:  participant.process_id,
            changeId,
          });
        } catch { /* never break the loop */ }

        return `Staged undo: unlink the report from "${participant.company_name}". The user will see an Apply button.`;
      }

      return 'Unknown undo kind.';
    }

    /* ── Model & Deal agent navigation + read tools ──────────────── */
    case 'open_workspace_view':
    case 'open_deal_view': {
      const view = String(input.view || '').trim();
      // Just acknowledge — the client picks this up by action name and
      // dispatches `vesno:set-workspace-view` / `vesno:set-deal-view`.
      return `Opening ${view} view.`;
    }

    case 'focus_function': {
      const fid = input.functionId || null;
      const label = input.functionName || (fid ? 'that function' : 'all functions');
      return fid ? `Filtering workspace to ${label}.` : 'Clearing function filter.';
    }

    case 'focus_participant': {
      const pid = input.participantId || null;
      const label = input.participantLabel || (pid ? 'that participant' : 'combined view');
      return pid ? `Scoping to ${label}.` : 'Switching to combined view.';
    }

    case 'open_process': {
      const reportId = String(input.reportId || '').trim();
      if (!reportId) return 'Cannot open process: reportId is required.';
      const intent = input.intent === 'edit' ? 'edit' : 'view';
      const label = input.processName || 'the process';
      return `Opening ${label} on the canvas (${intent} mode).`;
    }

    case 'get_model_summary': {
      if (!ctx.operatingModelId) return 'No operating model anchored on this chat session.';
      try {
        const { loadOperatingModel, loadModelRollup } = await import('../../operatingModel/repo.js');
        const [m, rollup] = await Promise.all([
          loadOperatingModel(ctx.operatingModelId),
          loadModelRollup(ctx.operatingModelId),
        ]);
        if (!m) return 'Could not load the operating model.';
        const t = rollup?.totals || {};
        const lines = [];
        lines.push(`Operating model: ${m.model?.name || '(unnamed)'}`);
        lines.push(`Functions: ${(m.functions || []).length}`);
        lines.push(`Processes: ${t.processes ?? 0}${rollup?.unfiledProcesses ? ` (${rollup.unfiledProcesses} unfiled)` : ''}`);
        if (t.fte != null)              lines.push(`FTE (modelled): ${t.fte}`);
        if (t.annualCost != null)       lines.push(`Annual cost: £${Math.round(t.annualCost).toLocaleString()}`);
        if (t.potentialSavings != null) lines.push(`Potential savings: £${Math.round(t.potentialSavings).toLocaleString()}`);
        if (t.avgAutomationPct != null) lines.push(`Avg automation: ${t.avgAutomationPct}%`);
        const fns = (m.functions || []).slice(0, 12).map((f) => `  - [${f.id}] ${f.name}`);
        if (fns.length) {
          lines.push('');
          lines.push('Functions (id, name):');
          lines.push(...fns);
        }
        return lines.join('\n');
      } catch (e) {
        return `Failed to load model summary: ${e.message}`;
      }
    }

    case 'get_function_heatmap': {
      if (!ctx.operatingModelId) return 'No operating model anchored on this chat session.';
      try {
        const { loadFunctionHeatmap } = await import('../../operatingModel/crossProcess.js');
        const heat = await loadFunctionHeatmap(ctx.operatingModelId);
        if (!heat || !heat.rows?.length) return 'No heatmap data — the model has no anchored processes yet.';
        const lines = ['Function heatmap (id · name · processes · cost · savings · automation):'];
        for (const r of heat.rows.slice(0, 25)) {
          const cost = r.totalCost ? `£${Math.round(r.totalCost).toLocaleString()}` : '—';
          const sav  = r.savings   ? `£${Math.round(r.savings).toLocaleString()}`   : '—';
          const auto = r.avgAutomationPct != null ? `${r.avgAutomationPct}%` : '—';
          lines.push(`  - [${r.id || '_'}] ${r.name} · ${r.processCount} · ${cost} · ${sav} · ${auto}`);
        }
        return lines.join('\n');
      } catch (e) {
        return `Failed to load heatmap: ${e.message}`;
      }
    }

    case 'get_top_recommendations': {
      if (!ctx.operatingModelId) return 'No operating model anchored on this chat session.';
      try {
        const { loadAnalysis } = await import('../../operatingModel/analysis.js');
        const a = await loadAnalysis(ctx.operatingModelId);
        let recs = a?.topRecommendations || [];
        if (input.functionId) recs = recs.filter((r) => r.functionId === input.functionId);
        const limit = Math.max(1, Math.min(Number(input.limit) || 8, 25));
        recs = recs.slice(0, limit);
        if (!recs.length) return 'No recommendations yet on this model.';
        const lines = recs.map((r, i) => {
          const impact = r.impactDollars > 0 ? `£${Math.round(r.impactDollars).toLocaleString()}` : (r.impactLabel || '');
          const src = r.sourceProcess || r.sourceCompany || '';
          return `${i + 1}. ${r.title}${impact ? ` — ${impact}` : ''}${src ? ` (${src}, processId=${r.sourceReportId})` : ''}`;
        });
        return `Top recommendations:\n${lines.join('\n')}`;
      } catch (e) {
        return `Failed to load recommendations: ${e.message}`;
      }
    }

    case 'list_model_processes': {
      if (!ctx.operatingModelId) return 'No operating model anchored on this chat session.';
      try {
        const { requireSupabase, getSupabaseHeaders, fetchWithTimeout } = await import('../../api-helpers.js');
        const sb = requireSupabase();
        if (!sb) return 'Storage not configured.';
        const limit = Math.max(1, Math.min(Number(input.limit) || 25, 100));
        let filter = `operating_model_id=eq.${encodeURIComponent(ctx.operatingModelId)}`;
        if (input.functionId) filter += `&function_id=eq.${encodeURIComponent(input.functionId)}`;
        const select = 'id,company,function_id,flow_data';
        const resp = await fetchWithTimeout(
          `${sb.url}/rest/v1/processes?${filter}&select=${encodeURIComponent(select)}&order=updated_at.desc&limit=${limit}`,
          { method: 'GET', headers: getSupabaseHeaders(sb.key) },
        );
        if (!resp.ok) return 'Failed to load model processes.';
        const rows = await resp.json();
        if (!rows.length) return 'No processes anchored to this operating model yet.';
        const { deriveProcessMetrics } = await import('../../processMetrics.js');
        const lines = rows.map((r) => {
          const dd = r.flow_data || {};
          const procs = Array.isArray(dd.rawProcesses) ? dd.rawProcesses
                      : Array.isArray(dd.processes)    ? dd.processes
                      : [];
          const name = procs[0]?.name || procs[0]?.processName || `Process (id ${r.id.slice(0, 8)})`;
          const stepCount = procs[0]?.steps?.length || 0;
          const m = deriveProcessMetrics(r);
          const cost = m.total_annual_cost ? ` · £${Math.round(m.total_annual_cost).toLocaleString()}` : '';
          const sav  = m.potential_savings ? ` · savings £${Math.round(m.potential_savings).toLocaleString()}` : '';
          const auto = m.automation_percentage != null ? ` · ${m.automation_percentage}% auto` : '';
          return `- ${name} [id=${r.id}, ${stepCount} step${stepCount === 1 ? '' : 's'}, functionId=${r.function_id || 'unfiled'}]${cost}${sav}${auto}`;
        });
        return `Processes in this operating model (${rows.length}):\n${lines.join('\n')}`;
      } catch (e) {
        return `Failed to list model processes: ${e.message}`;
      }
    }

    case 'get_top_bottlenecks': {
      if (!ctx.operatingModelId) return 'No operating model anchored on this chat session.';
      try {
        const { loadAnalysis } = await import('../../operatingModel/analysis.js');
        const a = await loadAnalysis(ctx.operatingModelId);
        let bots = a?.bottlenecks || [];
        if (input.functionId) bots = bots.filter((b) => b.functionId === input.functionId);
        const limit = Math.max(1, Math.min(Number(input.limit) || 8, 25));
        bots = bots.slice(0, limit);
        if (!bots.length) return 'No bottleneck steps detected.';
        const lines = bots.map((b, i) => {
          const flag = b.isSelfReported ? ' [flagged]' : '';
          return `${i + 1}. ${b.stepName} (${b.processName || 'process'}, processId=${b.sourceReportId}) — ${b.waitMinutes}m wait, risk ${b.risk}${flag}`;
        });
        return `Top bottlenecks:\n${lines.join('\n')}`;
      } catch (e) {
        return `Failed to load bottlenecks: ${e.message}`;
      }
    }

    default:
      return 'Done.';
  }
}

/**
 * Shared executor for the four deal-metadata tools. Reads via service-role
 * (RLS bypass) but only after the route handler verified deal access — the
 * `dealAccessVerified` flag on ctx is the gate. Returns the model-facing
 * text payload; for `documents` and `findings` it also pushes a
 * `deal_metadata` SSE event so the client can render structured cards.
 */
async function runDealMetadataTool(kind, ctx, opts) {
  const { requireSupabase, getSupabaseHeaders, fetchWithTimeout } = await import('../../api-helpers.js');
  const sb = requireSupabase();
  if (!sb) return 'Storage not configured.';
  const dealId = ctx.dealId;
  const headers = getSupabaseHeaders(sb.key);

  if (kind === 'summary') {
    const [dealResp, partsResp, docsResp] = await Promise.all([
      fetchWithTimeout(`${sb.url}/rest/v1/deals?id=eq.${dealId}&select=id,deal_code,type,name,process_name,status,owner_email,created_at,updated_at`, { headers }),
      fetchWithTimeout(`${sb.url}/rest/v1/deal_participants?deal_id=eq.${dealId}&select=id,role,company_name,status`, { headers }),
      fetchWithTimeout(`${sb.url}/rest/v1/deal_documents?deal_id=eq.${dealId}&select=id,status`, { headers }),
    ]);
    const [deal] = dealResp.ok ? await dealResp.json() : [];
    const parts = partsResp.ok ? await partsResp.json() : [];
    const docs  = docsResp.ok  ? await docsResp.json()  : [];
    if (!deal) return 'Deal not found.';
    const docsByStatus = docs.reduce((acc, d) => { acc[d.status] = (acc[d.status] || 0) + 1; return acc; }, {});
    const docsLine = Object.entries(docsByStatus).map(([s, n]) => `${n} ${s}`).join(', ') || '0';
    return [
      `Deal: ${deal.name} (${deal.deal_code})`,
      `Type: ${deal.type} · Status: ${deal.status}`,
      `Process: ${deal.process_name || '(not set)'}`,
      `Owner: ${deal.owner_email}`,
      `Participants: ${parts.length} (${parts.filter((p) => p.status === 'complete').length} complete)`,
      `Documents: ${docs.length} total — ${docsLine}`,
    ].join('\n');
  }

  if (kind === 'participants') {
    const r = await fetchWithTimeout(
      `${sb.url}/rest/v1/deal_participants?deal_id=eq.${dealId}&select=id,role,company_name,participant_email,status,invited_at,completed_at&order=created_at.asc`,
      { headers },
    );
    const parts = r.ok ? await r.json() : [];
    if (!parts.length) return 'No participants on this deal yet.';
    return [
      `${parts.length} participant${parts.length === 1 ? '' : 's'}:`,
      ...parts.map((p, i) => {
        const completed = p.completed_at ? ` · completed ${p.completed_at.slice(0, 10)}` : '';
        return `[${i + 1}] ${p.company_name} (${p.role}) — ${p.status}${completed}`;
      }),
    ].join('\n');
  }

  if (kind === 'documents') {
    const partyFilter = opts.party ? `&source_party=eq.${encodeURIComponent(opts.party)}` : '';
    const r = await fetchWithTimeout(
      `${sb.url}/rest/v1/deal_documents?deal_id=eq.${dealId}${partyFilter}&select=id,filename,mime_type,byte_size,status,label,source_party,page_count,created_at&order=created_at.desc&limit=${opts.limit}`,
      { headers },
    );
    const docs = r.ok ? await r.json() : [];
    if (!docs.length) return opts.party ? `No documents tagged "${opts.party}".` : 'Data room is empty.';
    try {
      ctx?.onEmit?.('deal_metadata', {
        dealId, kind: 'documents',
        items: docs.map((d) => ({
          id: d.id, filename: d.filename, status: d.status, label: d.label,
          sourceParty: d.source_party, pageCount: d.page_count, byteSize: d.byte_size,
        })),
      });
    } catch { /* never break the loop */ }
    return [
      `${docs.length} document${docs.length === 1 ? '' : 's'}${opts.party ? ` (party: ${opts.party})` : ''}:`,
      ...docs.map((d, i) => {
        const size = d.byte_size ? ` · ${(d.byte_size / 1024).toFixed(0)} KB` : '';
        const pages = d.page_count ? ` · ${d.page_count} pages` : '';
        const party = d.source_party ? ` · ${d.source_party}` : '';
        const label = d.label ? ` [${d.label}]` : '';
        return `[${i + 1}] ${d.filename} — ${d.status}${pages}${size}${party}${label}`;
      }),
    ].join('\n');
  }

  if (kind === 'findings') {
    // Living-workspace migration: findings hang on (deal_id, finding_key).
    const areaFilter = opts.area
      ? `&or=(category.ilike.*${encodeURIComponent(opts.area)}*,section.ilike.*${encodeURIComponent(opts.area)}*)`
      : '';
    const findResp = await fetchWithTimeout(
      `${sb.url}/rest/v1/deal_findings?deal_id=eq.${dealId}${areaFilter}&select=finding_key,title,section,category,severity,evidence,order_index&order=section.asc,order_index.asc&limit=${opts.limit}`,
      { headers },
    );
    const finds = findResp.ok ? await findResp.json() : [];
    if (!finds.length) return `No findings${opts.area ? ` in area "${opts.area}"` : ''} on this deal.`;

    const reviewResp = await fetchWithTimeout(
      `${sb.url}/rest/v1/deal_finding_reviews?deal_id=eq.${dealId}&select=finding_key,status,decided_by_email,decided_at`,
      { headers },
    );
    const reviews = reviewResp.ok ? await reviewResp.json() : [];
    const reviewByKey = Object.fromEntries(reviews.map((r) => [r.finding_key, r]));

    const evCount = (f) => Array.isArray(f.evidence) ? f.evidence.length : 0;

    try {
      ctx?.onEmit?.('deal_metadata', {
        dealId, kind: 'findings',
        items: finds.map((f) => ({
          key: f.finding_key,
          title: f.title,
          section: f.section,
          category: f.category,
          severity: f.severity,
          evidenceCount: evCount(f),
          reviewStatus: reviewByKey[f.finding_key]?.status || 'pending',
        })),
      });
    } catch { /* never break the loop */ }

    return [
      `${finds.length} finding${finds.length === 1 ? '' : 's'}:`,
      ...finds.map((f, i) => {
        const rev = reviewByKey[f.finding_key];
        const revBit = rev ? ` · review: ${rev.status}` : ' · review: pending';
        const sev = f.severity ? ` [${f.severity}]` : '';
        const area = f.section || f.category || 'general';
        const ev = ` · ${evCount(f)} evidence`;
        return `[${i + 1}] ${area}${sev}: ${f.title}${ev}${revBit} (key=${f.finding_key})`;
      }),
    ].join('\n');
  }

  if (kind === 'changes') {
    // Use the repo helper directly so the embedded `change_outcomes` shape
    // matches what the timeline reads — keeps two consumers honest.
    const { loadChanges } = await import('../../changes/repo.js');
    let rows = await loadChanges({ dealId, limit: opts.limit });
    const stateFilter = opts.state || 'all';
    if (stateFilter === 'open') {
      rows = rows.filter((c) => c.state === 'proposed' || c.state === 'accepted');
    } else if (stateFilter !== 'all') {
      rows = rows.filter((c) => c.state === stateFilter);
    }
    if (!rows.length) return `No changes${stateFilter === 'all' ? '' : ` in state "${stateFilter}"`} on this deal.`;

    // Compact summary of subject_ref for the agent's prose.
    const subjStr = (c) => {
      const r = c.subject_ref || {};
      if (r.stepName)     return `step "${r.stepName}"`;
      if (r.finding_key)  return `finding ${String(r.finding_key).slice(0, 12)}`;
      if (r.companyName || r.company_name) return `participant "${r.companyName || r.company_name}"`;
      if (r.filename)     return `document "${r.filename}"`;
      if (r.mode)         return `${r.mode} analysis`;
      return c.subject_type;
    };
    const outcomeStr = (c) => {
      const o = (c.change_outcomes || [])[0];
      if (!o || o.delta == null) return '';
      const sign = o.delta >= 0 ? '+' : '';
      return ` · ${o.metric} ${sign}${o.delta}${o.unit ? ' ' + o.unit : ''}`;
    };

    try {
      ctx?.onEmit?.('deal_metadata', {
        dealId, kind: 'changes',
        items: rows.map((c) => ({
          id: c.id,
          subjectType: c.subject_type,
          subjectSummary: subjStr(c),
          kind: c.kind,
          state: c.state,
          rationale: c.rationale,
          principle: c.principle,
          agentName: c.agent_name,
          actorEmail: c.actor_email,
          proposedAt: c.proposed_at || c.created_at,
          appliedAt: c.applied_at,
          liveAt: c.live_at,
          measuredAt: c.measured_at,
          outcomeSummary: outcomeStr(c).replace(/^ · /, '') || null,
          // Deep-link target. The client renders this as a button that opens
          // /workspace/map?deal=<id>&focusChange=<change_id>.
          deepLink: `/workspace/map?deal=${dealId}&focusChange=${c.id}`,
        })),
      });
    } catch { /* never break the loop */ }

    return [
      `${rows.length} change${rows.length === 1 ? '' : 's'}${stateFilter === 'all' ? '' : ` (state: ${stateFilter})`}:`,
      ...rows.map((c, i) => {
        const who = c.agent_name === 'redesign' ? 'Redesign'
                  : c.agent_name === 'chat'     ? 'Reina'
                  : (c.actor_email || 'system');
        return `[${i + 1}] [${c.state}] ${who} ${c.kind} ${subjStr(c)}${outcomeStr(c)} (id=${c.id})`;
      }),
    ].join('\n');
  }

  return 'Unknown deal-metadata kind.';
}

/* ── Streaming agent loop ─────────────────────────────────────────── */

// Pattern bank for "this is a trigger event, not a step". Detects by
// linguistic structure, not specific nouns — any subject-passive-verb
// or arrival-verb phrasing at the start of a step name marks it as a
// trigger that belongs on the process boundary, not in the step list.
const TRIGGER_VERBS_PASSIVE = [
  'received', 'submitted', 'created', 'placed', 'opened', 'raised',
  'logged', 'filed', 'generated', 'delivered', 'sent', 'completed',
  'finished', 'closed', 'initiated', 'triggered', 'started', 'begun',
  'kicked off', 'kicked-off', 'launched', 'reported',
].join('|');
const TRIGGER_VERBS_INTRANSITIVE = [
  'comes? in', 'arrives?', 'lands?', 'drops?', 'hits?', 'starts?',
  'begins?', 'kicks? off', 'kicks?-off', 'fires?',
].join('|');

const TRIGGER_PATTERNS = [
  // "<anything up to ~60 chars> is <passive-verb>" — catches "Service is
  // delivered", "Customer order is placed", "Application is submitted",
  // "Job is completed". The literal "is" / "are" / "gets" / "get" forces
  // the passive structure (not "Submit X" which is the action voice).
  new RegExp(`^[\\w\\s,()'\\-/&]{1,80}\\s+(?:is|are|gets?|was|were)\\s+(?:${TRIGGER_VERBS_PASSIVE})\\b`, 'i'),
  // "<anything> <intransitive trigger verb>" — "Order arrives", "Email
  // comes in", "Request lands", "Ticket fires", "Process starts".
  new RegExp(`^[\\w\\s,()'\\-/&]{1,80}\\s+(?:${TRIGGER_VERBS_INTRANSITIVE})\\b`, 'i'),
  // "<anything> <passive-verb-end>" with no helper verb — "Order received",
  // "Application submitted", "Invoice generated". Caps the noun phrase so
  // we don't sweep up legitimate action descriptions.
  new RegExp(`^[\\w\\s,()'\\-/&]{1,60}\\s+(?:${TRIGGER_VERBS_PASSIVE})\\s*$`, 'i'),
  // Generic process-boundary verbs as the whole step name
  /^(?:start|begin|process\s+(?:starts?|begins?|kicks?\s+off)|trigger(?:ed)?|kick[- ]?off|kickoff)\b/i,
  // "When <something>" / "Upon <something>" — explicit event clauses
  /^(?:when|upon|once|after)\s+/i,
];

const ACTION_VERB_PREFIX = /^(?:validate|generate|submit|review|send|check|route|log|create|approve|reject|escalate|reconcile|allocate|assign|notify|update|enter|enter\s+into|input|capture|extract|parse|forward|process|handle|prepare|draft|sign|countersign|file|file\s+with|publish|post|email|call|chase|monitor|track|verify|confirm|investigate|resolve|close)\b/i;

function looksLikeTrigger(name) {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (!trimmed) return false;
  // Quick pre-filter: action steps usually start with an imperative
  // verb (Validate, Generate, Submit, Review, Send, Check, Route, Log,
  // etc.) — those are NEVER triggers regardless of regex matches below.
  // This guards against false positives where the regex would otherwise
  // catch a phrase like "Submit completed report" because "completed"
  // is in the passive-verb list.
  if (ACTION_VERB_PREFIX.test(trimmed)) {
    return false;
  }
  return TRIGGER_PATTERNS.some((p) => p.test(trimmed));
}

// When a step name compounds a trigger clause AND an action clause
// joined by "and" / "; then" / ", and then" etc., we want to keep
// the action as the actual step and only put the trigger half on
// startsWhen. Returns { triggerPart, actionPart } when a clean split
// is detected; { triggerPart, actionPart: null } otherwise.
function splitCompoundTrigger(name) {
  if (!name || typeof name !== 'string') return { triggerPart: name || '', actionPart: null };
  const trimmed = name.trim();
  // Split on clause boundaries that typically join "trigger ... and
  // action ..." — we only split ONCE on the first occurrence so we
  // don't accidentally chop a single clause that happens to contain
  // multiple "and"s.
  const splitRegex = /\s*(?:,\s*then\s+|;\s*then\s+|\s+then\s+|\s+,\s+and\s+|\s+;\s+|\s+and\s+(?:then\s+)?)/i;
  const match = trimmed.match(splitRegex);
  if (!match) return { triggerPart: trimmed, actionPart: null };
  const head = trimmed.slice(0, match.index).trim();
  const tail = trimmed.slice(match.index + match[0].length).trim();
  if (!head || !tail) return { triggerPart: trimmed, actionPart: null };
  // Only treat as a compound if the head reads as a trigger AND the
  // tail reads as an action. If both halves are triggers (e.g. "X is
  // received and Y is submitted") we keep the whole thing as trigger.
  // If the tail doesn't look like an action, don't split.
  const headIsTrigger = TRIGGER_PATTERNS.some((p) => p.test(head));
  const tailLooksActionable = ACTION_VERB_PREFIX.test(tail)
    || /^(?:the\s+)?[\w\s]{1,40}\s+(?:submits?|sends?|generates?|creates?|reviews?|releases?|delivers?|processes?|posts?|emails?|files?|escalates?|forwards?|allocates?|reconciles?|notifies?|updates?|enters?|captures?|extracts?|parses?|handles?|prepares?|drafts?|signs?|countersigns?|publishes?|calls?|chases?|monitors?|tracks?|verifies?|confirms?|investigates?|resolves?|closes?)\b/i.test(tail);
  if (!headIsTrigger || !tailLooksActionable) return { triggerPart: trimmed, actionPart: null };
  return { triggerPart: head, actionPart: tail };
}

// ═══════════════════════════════════════════════════════════════════
// Schema enum constraints — match the CHECK constraints in supabase/.
// Tool inputs that violate these are coerced to a safe default before
// the action reaches the canvas. The model gets a tool_result naming
// what was changed so it learns the right values for next time.
// ═══════════════════════════════════════════════════════════════════
const ENUM_CONSTRAINTS = {
  set_bottleneck: {
    reason: ['waiting', 'approvals', 'manual-work', 'handoffs', 'systems', 'unclear', 'rework', 'other'],
  },
  set_cost_input: {
    frequency: ['daily', 'few-per-week', 'weekly', 'twice-monthly', 'monthly', 'quarterly', 'twice-yearly', 'yearly'],
  },
  set_pe_context: {
    peSopStatus: ['documented', 'partial', 'undocumented'],
    peKeyPerson: ['low', 'medium', 'high'],
    peReportingImpact: ['minimal', 'moderate', 'severe'],
  },
  set_step_details: {
    waitType: ['queue', 'approval', 'dependency', 'scheduling', 'rework', 'external', 'other'],
  },
  set_process_definition: {
    complexity: ['low', 'medium', 'high'],
  },
};

// Per-field synonym map → coerce common LLM mistakes to the canonical
// enum value before validation. Keys are lowercased trimmed inputs.
const ENUM_SYNONYMS = {
  reason: {
    'manual_work': 'manual-work', 'manual work': 'manual-work',
    'wait': 'waiting', 'waits': 'waiting', 'queue': 'waiting',
    'approval': 'approvals', 'sign-off': 'approvals',
    'handoff': 'handoffs', 'handover': 'handoffs', 'handovers': 'handoffs',
    'system': 'systems', 'tooling': 'systems',
    'rework loop': 'rework', 'errors': 'rework', 'fix': 'rework',
    'unclear scope': 'unclear', 'ambiguity': 'unclear',
  },
  frequency: {
    'twice a week': 'few-per-week', 'a few times a week': 'few-per-week',
    'bi-weekly': 'twice-monthly', 'biweekly': 'twice-monthly', 'fortnightly': 'twice-monthly',
    'twice a month': 'twice-monthly', 'twice a year': 'twice-yearly', 'biannual': 'twice-yearly', 'biannually': 'twice-yearly', 'semi-annual': 'twice-yearly', 'semi-annually': 'twice-yearly',
    'annual': 'yearly', 'annually': 'yearly', 'per year': 'yearly',
    'per quarter': 'quarterly', 'q1': 'quarterly', 'q2': 'quarterly',
    'monthly basis': 'monthly', 'each month': 'monthly',
    'weekly basis': 'weekly', 'each week': 'weekly',
    'daily basis': 'daily', 'each day': 'daily', 'every day': 'daily',
  },
  waitType: {
    'queueing': 'queue', 'waiting': 'queue', 'wait': 'queue',
    'approval wait': 'approval', 'sign-off': 'approval',
    'dependency wait': 'dependency', 'blocked': 'dependency',
    'schedule': 'scheduling', 'scheduled': 'scheduling',
    'rework loop': 'rework', 'errors': 'rework',
    'external party': 'external', 'third party': 'external',
  },
  complexity: { 'simple': 'low', 'easy': 'low', 'normal': 'medium', 'standard': 'medium', 'complex': 'high', 'difficult': 'high' },
  peSopStatus: { 'fully documented': 'documented', 'partially documented': 'partial', 'no documentation': 'undocumented', 'undocumented sop': 'undocumented' },
  peKeyPerson: { 'no risk': 'low', 'minor': 'low', 'moderate': 'medium', 'significant': 'high', 'critical': 'high' },
  peReportingImpact: { 'none': 'minimal', 'low': 'minimal', 'medium': 'moderate', 'high': 'severe', 'critical': 'severe' },
};

function coerceEnum(field, raw) {
  if (raw == null) return { value: null, action: 'unset' };
  if (typeof raw !== 'string') return { value: null, action: 'unset' };
  const trimmed = raw.trim();
  if (!trimmed) return { value: null, action: 'unset' };
  const lower = trimmed.toLowerCase();
  // Synonym pass first — gives us a canonical candidate to validate.
  const synonyms = ENUM_SYNONYMS[field] || {};
  return { value: synonyms[lower] || lower, original: raw };
}

function applyEnumValidation(name, input) {
  const constraints = ENUM_CONSTRAINTS[name];
  if (!constraints || !input || typeof input !== 'object') {
    return { sanitised: input, notes: [] };
  }
  const out = { ...input };
  const notes = [];
  for (const [field, allowed] of Object.entries(constraints)) {
    if (!Object.prototype.hasOwnProperty.call(out, field)) continue;
    const { value, original, action } = coerceEnum(field, out[field]);
    if (action === 'unset') { delete out[field]; continue; }
    if (allowed.includes(value)) {
      out[field] = value;
      if (original !== value) {
        notes.push(`Coerced ${field} "${original}" → "${value}"`);
      }
      continue;
    }
    // Out of enum — drop the field entirely. Don't pass invalid values
    // through to the canvas / DB (where they'd CHECK-violate).
    delete out[field];
    notes.push(`Dropped ${field}: "${original}" is not one of [${allowed.join(' | ')}]`);
  }
  return { sanitised: out, notes };
}

// Sanitise tool inputs that touch the step list, BEFORE they're applied
// to the canvas. The prompt tells Reina the trigger is not Step 1 — but
// the model still relapses on long descriptions. This guard catches any
// remaining trigger-as-Step-1 outputs and demotes them to the process
// boundary metadata (startsWhen). Returns { sanitised, sideEffects[] } —
// sideEffects are extra tool calls to inject (e.g. set_process_definition).
function sanitiseStepInput(name, input) {
  if (!input || typeof input !== 'object') return { sanitised: input, sideEffects: [] };
  const sideEffects = [];

  if (name === 'replace_all_steps' && Array.isArray(input.steps) && input.steps.length > 0) {
    let startsWhen = null;
    let stepsCopy = [...input.steps];
    let removedCount = 0;
    // Strip leading trigger steps. If a leading step has a compound
    // "trigger AND action" name, keep the action half as the step and
    // only put the trigger half on startsWhen — the previous version
    // dropped the action entirely, which is what produced the
    // "Service is delivered AND regional ops manager submits..." in
    // the Start node with no Step 1.
    while (stepsCopy.length > 0 && looksLikeTrigger(stepsCopy[0]?.name)) {
      const first = stepsCopy[0];
      const split = splitCompoundTrigger(first.name);
      if (split.actionPart) {
        // Keep the action half as Step 1, capture only the trigger.
        if (!startsWhen) startsWhen = split.triggerPart;
        stepsCopy[0] = { ...first, name: split.actionPart };
        break; // The remainder is now an action; stop stripping.
      }
      // Pure trigger — drop it entirely.
      const triggerStep = stepsCopy.shift();
      if (!startsWhen) startsWhen = triggerStep.name;
      removedCount += 1;
    }
    // Cap isMerge usage with three rules:
    //   1. The merge must have 2+ incoming paths. A merge with 1
    //      incoming path is structurally identical to a regular step
    //      and renders as a confusing teal circle with one arrow.
    //      Count: default sequence predecessor + branch targets across
    //      all upstream decisions that point at this step number.
    //   2. No two consecutive isMerge steps — the second is always
    //      redundant since the first already pulls in branch terminals.
    //   3. After each decision, keep only the FIRST downstream isMerge
    //      step. Multiple merges per decision render as duplicate
    //      rejoin nodes; the renderer needs exactly one.
    {
      // Pre-compute how many branch targets land on each 1-based step
      // number, by scanning every step's branches array.
      const branchTargetCounts = new Map(); // stepNumber → count
      for (const s of stepsCopy) {
        if (!Array.isArray(s?.branches)) continue;
        for (const b of s.branches) {
          if (!b?.target || typeof b.target !== 'string') continue;
          const m = b.target.match(/^Step\s+(\d+)$/i);
          if (!m) continue;
          const n = parseInt(m[1], 10);
          branchTargetCounts.set(n, (branchTargetCounts.get(n) || 0) + 1);
        }
      }
      let lastDecisionIdx = -1;
      let mergeTakenAfterDecision = false;
      stepsCopy = stepsCopy.map((s, i) => {
        if (s?.isDecision) {
          lastDecisionIdx = i;
          mergeTakenAfterDecision = false;
          return s;
        }
        if (!s?.isMerge) return s;
        // Rule 1 — count REAL incoming paths.
        //
        // The renderer (lib/flows/processToReactFlow.js:553) skips the
        // default sequence arrow when the predecessor is a decision —
        // decisions only flow through their explicit branches. So a
        // sequence predecessor only counts when the predecessor is a
        // regular step, not a decision.
        const prev = i > 0 ? stepsCopy[i - 1] : null;
        const prevIsDecision = !!(prev?.isDecision && Array.isArray(prev.branches) && prev.branches.length > 0);
        const hasSequencePredecessor = i > 0 && !prevIsDecision;
        // Branch targets landing here: 1-based step number = i+1.
        const branchInbound = branchTargetCounts.get(i + 1) || 0;
        const incoming = (hasSequencePredecessor ? 1 : 0) + branchInbound;
        if (incoming < 2) {
          // Single-input "merge" is meaningless — strip the flag.
          return { ...s, isMerge: false };
        }
        // Rule 2 — strip a merge that immediately follows another merge.
        if (prev?.isMerge) return { ...s, isMerge: false };
        // Rule 3 — strip a merge if a previous merge already exists
        // for this decision's window (no new decision between them).
        if (lastDecisionIdx >= 0 && mergeTakenAfterDecision) {
          return { ...s, isMerge: false };
        }
        mergeTakenAfterDecision = true;
        return s;
      });
    }

    if (startsWhen) {
      sideEffects.push({
        name: 'set_process_definition',
        input: { startsWhen },
      });
      // Shift branch targets to account for any fully-removed steps.
      stepsCopy = stepsCopy.map((s) => {
        if (!Array.isArray(s.branches)) return s;
        return {
          ...s,
          branches: s.branches.map((b) => {
            if (!b?.target || typeof b.target !== 'string') return b;
            const m = b.target.match(/^Step\s+(\d+)$/i);
            if (!m) return b;
            const n = parseInt(m[1], 10) - removedCount;
            return n > 0 ? { ...b, target: `Step ${n}` } : b;
          }),
        };
      });
      return { sanitised: { ...input, steps: stepsCopy }, sideEffects };
    }
  }

  if (name === 'add_step' && looksLikeTrigger(input.name)) {
    // Aggressive variant: ANY add_step where the name reads as a
    // trigger gets demoted, regardless of afterStep. If the name is
    // a compound "trigger AND action", split it — keep the action as
    // the step (rewriting the input.name) and demote only the trigger.
    const split = splitCompoundTrigger(input.name);
    if (split.actionPart) {
      return {
        sanitised: { ...input, name: split.actionPart },
        sideEffects: [{
          name: 'set_process_definition',
          input: { startsWhen: split.triggerPart },
        }],
      };
    }
    // Pure trigger — drop the add_step entirely.
    return {
      sanitised: null,
      sideEffects: [{
        name: 'set_process_definition',
        input: { startsWhen: input.name },
      }],
    };
  }

  return { sanitised: input, sideEffects: [] };
}

// Verbose present-tense description of what a tool is about to do, so
// the chat surface can show a specific "Reading the data room…" /
// "Adding step 3…" line instead of a stale "Reina is thinking…" cursor
// during long tool sequences. Pulls from input fields where helpful so
// the message names what the tool is touching.
function describeToolPresent(name, input) {
  const i = input || {};
  const stepRef = (n) => (n != null ? ` (step ${n})` : '');
  switch (name) {
    case 'add_step':              return `Adding step "${i.name || 'new step'}"…`;
    case 'update_step':           return `Updating step ${i.stepNumber}…`;
    case 'remove_step':           return `Removing step ${i.stepNumber}…`;
    case 'set_handoff':           return `Setting handoff from step ${i.fromStep}…`;
    case 'add_custom_department': return `Adding department "${i.name || ''}"…`;
    case 'replace_all_steps':     return `Rebuilding the flow with ${i.steps?.length || 0} steps…`;
    case 'add_connector':         return `Connecting step ${i.fromStep} → step ${i.toStep}…`;
    case 'remove_connector':      return `Removing connector ${i.fromStep} → ${i.toStep}…`;
    case 'redirect_connector':    return `Rewiring connector…`;
    case 'insert_step_between':   return `Inserting "${i.name || 'new step'}" between ${i.fromStep} and ${i.toStep}…`;
    case 'set_branch_target':     return `Updating branch on step ${i.stepNumber}…`;
    case 'set_branch_probability':return `Setting branch probability on step ${i.stepNumber}…`;
    case 'set_branch_label':      return `Renaming branch on step ${i.stepNumber}…`;
    case 'remove_branch':         return `Removing branch from step ${i.stepNumber}…`;
    case 'add_branch':             return `Adding branch to step ${i.stepNumber}…`;
    case 'reorder_step':          return `Moving step ${i.stepNumber} to position ${i.position}…`;
    case 'set_process_name':      return `Renaming process to "${i.name || ''}"…`;
    case 'set_process_definition':return `Updating process boundary…`;
    case 'set_step_details':      return `Updating step ${i.stepNumber} details…`;
    case 'set_cost_input':        return `Updating cost inputs…`;
    case 'set_bottleneck':        return `Setting the bottleneck…`;
    case 'set_frequency_details': return `Setting frequency details…`;
    case 'set_pe_context':        return `Setting PE context…`;
    case 'add_step_system':       return `Adding "${i.system || 'system'}" to step ${i.stepNumber}…`;
    case 'remove_step_system':    return `Removing "${i.system || 'system'}" from step ${i.stepNumber}…`;
    case 'add_checklist_item':    return `Adding checklist item to step ${i.stepNumber}…`;
    case 'toggle_checklist_item': return `Toggling checklist on step ${i.stepNumber}…`;
    case 'remove_checklist_item': return `Removing checklist item from step ${i.stepNumber}…`;
    case 'remove_custom_department': return `Removing department "${i.name || ''}"…`;
    case 'highlight_step':        return `Highlighting step ${i.stepNumber}…`;
    case 'undo_last_action':      return `Undoing the last action…`;
    case 'ask_discovery':         return `Drafting a discovery question…`;
    case 'propose_change':        return `Drafting a proposed change…`;
    case 'set_labour_rate':       return `Proposing a labour rate update…`;
    case 'set_non_labour_cost':   return `Proposing a non-labour cost update…`;
    case 'set_investment':        return `Proposing an investment line…`;
    case 'get_bottlenecks':       return `Looking up the biggest bottlenecks…`;
    case 'get_critical_path':     return `Tracing the critical path…`;
    case 'get_step_metrics':      return `Reading step-level metrics${stepRef(i.stepNumber)}…`;
    case 'get_cost_summary':      return `Reading the cost summary…`;
    case 'get_recommendations':   return `Reading the AI recommendations…`;
    case 'search_deal_documents': return `Searching the data room${i.query ? ` for "${i.query}"` : ''}…`;
    case 'list_deal_documents':   return `Listing the data room…`;
    case 'list_deal_participants':return `Listing the deal participants…`;
    case 'list_deal_findings':    return `Reading the latest findings…`;
    case 'open_deal_finding':     return `Opening a finding…`;
    case 'list_deal_qa':          return `Reading the deal Q&A…`;
    case 'add_deal_qa':           return `Adding a Q&A item…`;
    case 'list_user_reports':     return `Pulling your processes…`;
    case 'open_user_report':      return `Opening a process…`;
    case 'list_user_deals':       return `Pulling your deals…`;
    default:                      return `Running ${name.replace(/_/g, ' ')}…`;
  }
}

async function runStreamingLoop({ system, messages, onEmit, ctx, maxIterations = 10 }) {
  let currentMessages = [...messages];
  const allActions = [];
  const allTextParts = [];
  let iterations = 0;

  // Resolve which Anthropic client to use. ctx.apiKey is set by runChatAgent
  // when an org has a BYO key configured.
  const client = getAnthropicClient(ctx?.apiKey);

  const emit = (event, data) => { if (typeof onEmit === 'function') onEmit(event, data); };

  // Accumulate token usage across iterations of the agent loop. Multi-turn
  // tool calls produce one Anthropic call per iteration; we sum them and
  // record once at the end so the ledger has a single row per chat turn.
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Pick the model for this chat. ctx.model wins (org-allowed user pick);
  // fall back to the platform default (Sonnet 4.6).
  const activeModel = ctx?.model || CHAT_MODEL_ID;

  while (iterations < maxIterations) {
    emit('progress', { message: iterations === 0 ? 'Reina is reading your message…' : 'Working on the next step…' });

    let streamText = '';
    let firstTextDeltaSeen = false;
    let toolBlockStarted = false;
    const stream = client.messages.stream({
      model: activeModel,
      max_tokens: 16384,
      temperature: 0.3,
      system,
      messages: currentMessages,
      tools: ctx?.tools || ALL_CHAT_TOOLS,
    });

    for await (const event of stream) {
      // Switch the indicator to "Drafting reply…" the moment the model
      // starts producing visible text. Without this, long pre-text
      // pauses (model thinking before any output) leave the user
      // staring at a blinking cursor with no context.
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        if (!firstTextDeltaSeen) {
          firstTextDeltaSeen = true;
          emit('progress', { message: 'Drafting reply…' });
        }
        streamText += event.delta.text;
        emit('delta', { text: event.delta.text });
      }
      // The model has decided to use a tool. Emit a present-tense
      // message naming the tool BEFORE we execute, so the user knows
      // what's happening during the tool input streaming + execution
      // window (often the longest part of a turn).
      else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        toolBlockStarted = true;
        emit('progress', { message: describeToolPresent(event.content_block.name, {}) });
      }
    }

    const finalMessage = await stream.finalMessage();
    if (streamText.trim()) allTextParts.push(streamText.trim());

    // Anthropic's Messages API returns usage on every response.
    if (finalMessage?.usage) {
      totalInputTokens  += Number(finalMessage.usage.input_tokens  || 0);
      totalOutputTokens += Number(finalMessage.usage.output_tokens || 0);
    }

    if (finalMessage.stop_reason !== 'tool_use') break;

    const toolUses = finalMessage.content.filter(b => b.type === 'tool_use');
    if (toolUses.length === 0) break;

    // Now we have the full tool inputs (during streaming we only had
    // names). Re-emit per-tool progress with concrete inputs so the
    // user sees, e.g., "Adding step 'Validate invoice'…" instead of
    // the generic "Adding step 'new step'…" emitted on content_start.
    //
    // Server-side sanitiser pass: filter trigger-event-as-Step-1
    // mistakes AND noise add_connector calls before they ever reach
    // the canvas. The prompt tells Reina not to do this; the guards
    // here catch the remaining cases where the model relapses.
    //
    // add_connector suppression: if the same turn includes a
    // replace_all_steps OR add_step series, drop every add_connector
    // — branches in the steps already define every link the renderer
    // needs. Standalone add_connector calls (no concurrent step
    // mutation) still pass through, since those are the legitimate
    // "draw a manual arrow" use case.
    const turnHasStructuralBuild = toolUses.some((tu) =>
      tu.name === 'replace_all_steps' || tu.name === 'add_step'
    );
    const toolResults = await Promise.all(toolUses.map(async (tu, idx) => {
      // Drop any add_connector that's bundled with a structural build
      // — branches inside the new steps already define the links.
      if (tu.name === 'add_connector' && turnHasStructuralBuild) {
        return {
          type: 'tool_result',
          tool_use_id: tu.id,
          content: `Skipped add_connector ${tu.input?.fromStep} → ${tu.input?.toStep}: this turn includes a structural build (replace_all_steps / add_step). Branches in the steps array already define every link the renderer needs — manual connectors during a build produce crisscrossing duplicate arrows. Express decision links via update_step.branches / add_branch instead.`,
        };
      }
      // Enum-validate every tool input against the schema's CHECK
      // constraints. Coerces synonyms ("manual_work" → "manual-work",
      // "annually" → "yearly") and drops out-of-enum values so they
      // can't reach the DB. Notes are returned to the model in the
      // tool_result so it learns the canonical values.
      const enumValidated = applyEnumValidation(tu.name, tu.input);
      let workingInput = enumValidated.sanitised;
      const enumNotes = enumValidated.notes;
      const { sanitised, sideEffects } = sanitiseStepInput(tu.name, workingInput);
      // Apply side-effect tools first — they should run before the
      // sanitised mutation so the canvas sees boundary metadata before
      // the step list reshuffles.
      for (const se of sideEffects) {
        emit('progress', { message: describeToolPresent(se.name, se.input) });
        allActions.push({ name: se.name, input: se.input });
      }
      // Drop signal: the entire tool call was a trigger and got demoted
      // to a side-effect. Return a tool_result that tells the model what
      // happened so it doesn't keep retrying.
      if (sanitised === null) {
        return {
          type: 'tool_result',
          tool_use_id: tu.id,
          content: `Skipped: "${tu.input?.name || ''}" looks like a trigger event, not a step. Captured it on the process boundary via set_process_definition({ startsWhen }) instead. Step 1 must be the first ACTION the team performs after the trigger.`,
        };
      }
      // Fire a focused progress message right before this tool runs.
      // For multi-tool turns we cycle through them so the user sees
      // the actual sequence, not just the first one.
      emit('progress', {
        message: toolUses.length > 1
          ? `${describeToolPresent(tu.name, sanitised)} (${idx + 1}/${toolUses.length})`
          : describeToolPresent(tu.name, sanitised),
      });
      allActions.push({ name: tu.name, input: sanitised });
      const content = await executeTool(tu.name, sanitised, ctx || {});
      // Append enum notes so the model sees what got coerced and
      // doesn't keep emitting the same out-of-enum value next turn.
      const finalContent = enumNotes.length
        ? `${content}\n\nSchema note: ${enumNotes.join('; ')}.`
        : content;
      return { type: 'tool_result', tool_use_id: tu.id, content: finalContent };
    }));

    emit('progress', { message: 'Picking up where I left off…' });

    currentMessages = [
      ...currentMessages,
      { role: 'assistant', content: finalMessage.content },
      { role: 'user', content: toolResults },
    ];
    iterations++;
  }

  return {
    textParts: allTextParts,
    actions: allActions,
    usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
  };
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function summariseActions(actions) {
  const parts = [];
  let added = 0, updated = 0, removed = 0, handoffs = 0, depts = 0, replaced = false;
  let conAdded = 0, conRemoved = 0, conRedirected = 0, stepsInserted = 0;
  let brEdited = 0, brRemoved = 0, brAdded = 0;
  let reordered = 0, renamedProcess = false, definitionEdits = 0, detailEdits = 0, costEdits = 0;
  let bottleneckEdits = 0, freqDetailEdits = 0, peEdits = 0, sysAdded = 0, sysRemoved = 0;
  let chkAdded = 0, chkToggled = 0, chkRemoved = 0, deptsRemoved = 0;
  for (const a of actions) {
    if (a.name === 'add_step') added++;
    else if (a.name === 'update_step') updated++;
    else if (a.name === 'remove_step') removed++;
    else if (a.name === 'set_handoff') handoffs++;
    else if (a.name === 'add_custom_department') depts++;
    else if (a.name === 'replace_all_steps') replaced = true;
    else if (a.name === 'add_connector') conAdded++;
    else if (a.name === 'remove_connector') conRemoved++;
    else if (a.name === 'redirect_connector') conRedirected++;
    else if (a.name === 'insert_step_between') stepsInserted++;
    else if (a.name === 'set_branch_target' || a.name === 'set_branch_probability' || a.name === 'set_branch_label') brEdited++;
    else if (a.name === 'remove_branch') brRemoved++;
    else if (a.name === 'add_branch') brAdded++;
    else if (a.name === 'reorder_step') reordered++;
    else if (a.name === 'set_process_name') renamedProcess = true;
    else if (a.name === 'set_process_definition') definitionEdits++;
    else if (a.name === 'set_step_details') detailEdits++;
    else if (a.name === 'set_cost_input') costEdits++;
    else if (a.name === 'set_bottleneck') bottleneckEdits++;
    else if (a.name === 'set_frequency_details') freqDetailEdits++;
    else if (a.name === 'set_pe_context') peEdits++;
    else if (a.name === 'add_step_system') sysAdded++;
    else if (a.name === 'remove_step_system') sysRemoved++;
    else if (a.name === 'add_checklist_item') chkAdded++;
    else if (a.name === 'toggle_checklist_item') chkToggled++;
    else if (a.name === 'remove_checklist_item') chkRemoved++;
    else if (a.name === 'remove_custom_department') deptsRemoved++;
  }
  if (replaced) parts.push(`Set up ${actions.find(a => a.name === 'replace_all_steps')?.input?.steps?.length || 0} steps`);
  if (added) parts.push(`added ${added} step${added > 1 ? 's' : ''}`);
  if (stepsInserted) parts.push(`inserted ${stepsInserted} step${stepsInserted > 1 ? 's' : ''}`);
  if (updated) parts.push(`updated ${updated} step${updated > 1 ? 's' : ''}`);
  if (removed) parts.push(`removed ${removed} step${removed > 1 ? 's' : ''}`);
  if (handoffs) parts.push(`set ${handoffs} handoff${handoffs > 1 ? 's' : ''}`);
  if (conAdded) parts.push(`added ${conAdded} connector${conAdded > 1 ? 's' : ''}`);
  if (conRedirected) parts.push(`rewired ${conRedirected} connector${conRedirected > 1 ? 's' : ''}`);
  if (conRemoved) parts.push(`removed ${conRemoved} connector${conRemoved > 1 ? 's' : ''}`);
  if (brEdited) parts.push(`edited ${brEdited} branch${brEdited > 1 ? 'es' : ''}`);
  if (brAdded) parts.push(`added ${brAdded} branch${brAdded > 1 ? 'es' : ''}`);
  if (brRemoved) parts.push(`removed ${brRemoved} branch${brRemoved > 1 ? 'es' : ''}`);
  if (reordered) parts.push(`reordered ${reordered} step${reordered > 1 ? 's' : ''}`);
  if (renamedProcess) parts.push('renamed process');
  if (definitionEdits) parts.push('updated process definition');
  if (detailEdits) parts.push(`updated ${detailEdits} step detail${detailEdits > 1 ? 's' : ''}`);
  if (costEdits) parts.push('updated cost inputs');
  if (bottleneckEdits) parts.push('updated bottleneck');
  if (freqDetailEdits) parts.push('updated frequency details');
  if (peEdits) parts.push('updated PE context');
  if (sysAdded) parts.push(`added ${sysAdded} system${sysAdded > 1 ? 's' : ''}`);
  if (sysRemoved) parts.push(`removed ${sysRemoved} system${sysRemoved > 1 ? 's' : ''}`);
  if (chkAdded) parts.push(`added ${chkAdded} checklist item${chkAdded > 1 ? 's' : ''}`);
  if (chkToggled) parts.push(`toggled ${chkToggled} checklist item${chkToggled > 1 ? 's' : ''}`);
  if (chkRemoved) parts.push(`removed ${chkRemoved} checklist item${chkRemoved > 1 ? 's' : ''}`);
  if (depts) parts.push(`added ${depts} custom department${depts > 1 ? 's' : ''}`);
  if (deptsRemoved) parts.push(`removed ${deptsRemoved} custom department${deptsRemoved > 1 ? 's' : ''}`);
  return parts.length > 0 ? parts.join(', ') + '.' : '';
}

function describeAttachmentFile(a) {
  const t = (a.type || '').toLowerCase();
  const name = a.name || 'file';
  if (t.startsWith('image/')) return `image "${name}"`;
  if (t.includes('spreadsheet') || /application\/vnd\.ms-excel|spreadsheetml/.test(t) || /\.(xlsx?|csv)$/i.test(name)) return `spreadsheet "${name}"`;
  if (t === 'application/pdf' || /\.pdf$/i.test(name)) return `PDF "${name}"`;
  if (t.includes('presentation') || /\.pptx?$/i.test(name)) return `presentation "${name}"`;
  if (a.textContent) return `text file "${name}"`;
  if (t.includes('word') || t.includes('document') || /\.docx?$/i.test(name)) return `document "${name}"`;
  return `file "${name}"`;
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

function classifyAttachment(a) {
  const t = (a.type || '').toLowerCase();
  const name = (a.name || '').toLowerCase();
  if (IMAGE_TYPES.includes(t) || (t.startsWith('image/') && a.content)) return 'image';
  if (t === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (
    t.includes('spreadsheetml') ||
    t === 'application/vnd.ms-excel' ||
    name.endsWith('.xlsx') ||
    name.endsWith('.xls')
  ) return 'excel';
  if (
    t === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    name.endsWith('.docx')
  ) return 'docx';
  if (t === 'application/msword' || name.endsWith('.doc')) return 'doc';
  if (
    t === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    name.endsWith('.pptx')
  ) return 'pptx';
  if (t === 'application/vnd.ms-powerpoint' || name.endsWith('.ppt')) return 'ppt';
  if (a.textContent) return 'text';
  return 'unknown';
}

function truncateText(s, max = 80000) {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '\n[truncated]' : s;
}

function parseExcelBase64(base64) {
  try {
    const wb = XLSX.read(base64, { type: 'base64' });
    const parts = [];
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      if (csv.trim()) parts.push(`--- Sheet: ${sheetName} ---\n${csv}`);
    }
    return parts.join('\n\n');
  } catch (e) {
    return `[Failed to parse spreadsheet: ${e.message}]`;
  }
}

async function parseDocxBase64(base64) {
  try {
    const buffer = Buffer.from(base64, 'base64');
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  } catch (e) {
    return `[Failed to parse DOCX: ${e.message}]`;
  }
}

const wordExtractor = new WordExtractor();

async function parseDocBase64(base64) {
  const tmpPath = path.join(os.tmpdir(), `doc-${Date.now()}-${Math.random().toString(36).slice(2)}.doc`);
  try {
    await fs.writeFile(tmpPath, Buffer.from(base64, 'base64'));
    const doc = await wordExtractor.extract(tmpPath);
    return doc.getBody() || '';
  } catch (e) {
    return `[Failed to parse DOC: ${e.message}]`;
  } finally {
    fs.unlink(tmpPath).catch(() => {});
  }
}

async function parsePptxBase64(base64) {
  try {
    const buffer = Buffer.from(base64, 'base64');
    const text = await officeParser.parseOfficeAsync(buffer);
    return text || '';
  } catch (e) {
    return `[Failed to parse PPTX: ${e.message}]`;
  }
}

function parsePptBase64(base64) {
  try {
    const buf = Buffer.from(base64, 'base64');
    const strings = new Set();
    const pushIfValid = (s) => {
      if (s.length < 6) return;
      if (!/[a-zA-Z]/.test(s)) return;
      strings.add(s.trim());
    };
    let run = '';
    for (let i = 0; i < buf.length; i++) {
      const b = buf[i];
      if (b >= 32 && b <= 126) run += String.fromCharCode(b);
      else { pushIfValid(run); run = ''; }
    }
    pushIfValid(run);
    run = '';
    for (let i = 0; i < buf.length - 1; i += 2) {
      const lo = buf[i], hi = buf[i + 1];
      if (hi === 0 && lo >= 32 && lo <= 126) run += String.fromCharCode(lo);
      else { pushIfValid(run); run = ''; }
    }
    pushIfValid(run);
    return Array.from(strings).join('\n');
  } catch (e) {
    return `[Failed to parse PPT: ${e.message}]`;
  }
}

/* ── Public entry point ───────────────────────────────────────────── */

// Test-only export. The leading underscore + suffix discourages production use.
export const __executeToolForTests = executeTool;

export async function runChatAgent({
  message, currentSteps, currentHandoffs, processName, history,
  incompleteInfo, phaseState, attachments, editingReportId, viewOnlyProcessId,
  sessionContext, session, dealId, dealName, dealAccessVerified, activeParticipant, availableParticipants, apiKey, modelOverride,
  functionPath, operatingModelName, operatingModelId, chatScope,
  onProgress, onEmit,
}) {
  const emit = (event, data) => {
    if (typeof onEmit === 'function') onEmit(event, data);
    else if (event === 'progress' && typeof onProgress === 'function') onProgress(data?.message ?? data);
  };

  const handoffs = currentHandoffs || [];
  const stepsDesc = (currentSteps || [])
    .filter(s => s.name?.trim())
    .map((s, i) => {
      let d = `${i + 1}. ${s.name}`;
      if (s.department) d += ` [${s.department}]`;
      if (s.isMerge) d += ' (MERGE)';
      else if (s.isDecision) d += s.parallel ? ' (PARALLEL/AND gateway)' : s.inclusive ? ' (INCLUSIVE/OR gateway)' : ' (EXCLUSIVE/XOR decision)';
      if ((s.branches || []).length) {
        const bl = s.branches.map((b, bi) => `  ${bi === 0 ? 'Yes' : bi === 1 ? 'No' : `Branch ${bi + 1}`}${b.label ? ' "' + b.label + '"' : ''} → ${b.target || 'unlinked'}`).join('\n');
        d += `\n${bl}`;
      }
      if (s.workMinutes != null) d += ` (${s.workMinutes}m work${s.waitMinutes != null ? `, ${s.waitMinutes}m wait` : ''})`;
      if (s.owner) d += ` [owner: ${s.owner}]`;
      if ((s.systems || []).length) d += ` {${s.systems.join(', ')}}`;
      if (handoffs[i]?.method) d += ` → handoff: ${handoffs[i].method}`;
      return d;
    })
    .join('\n') || '(no steps yet)';

  const incompleteBlock = incompleteInfo
    ? `\n\nINCOMPLETE STEPS  -  proactively remind the user to fill these in:\n${incompleteInfo}`
    : '';
  const editingMode = editingReportId ? 'editing' : null;
  // View-only mode: the canvas shows a real flow but the user explicitly
  // opted out of edit chrome. Reina should answer questions about the
  // visible flow but refuse mutation tools (chat composer is disabled
  // anyway; this guards against tool calls slipping through history).
  const isViewOnly = !!(viewOnlyProcessId && !editingReportId);

  // Workspace tree — fetched per turn when the chat is scoped to an
  // operating model. Lets Reina dedupe against existing functions/roles/
  // systems and pass real ids to propose_add_function. Soft-fails: a
  // load failure just means no tree block, never a chat error.
  let workspaceTreeText = '';
  if (operatingModelId) {
    try {
      const { loadOperatingModel } = await import('../../operatingModel/repo.js');
      const { formatWorkspaceTree } = await import('../../prompts.js');
      const ws = await loadOperatingModel(operatingModelId);
      if (ws) workspaceTreeText = formatWorkspaceTree(ws);
    } catch { /* swallow — tree is supplemental */ }
  }

  // Pick which agent serves this turn. Three modes:
  //   process: a specific report is anchored — full step-editing toolset
  //   deal:    a deal is anchored, no process — deal workspace tools
  //   model:   a model is anchored, no deal, no process — model tools
  const agentMode = pickAgent({ editingReportId, viewOnlyProcessId, dealId, operatingModelId, chatScope });
  // Visible signal so we can verify which agent fired during a turn.
  // Emitted as a 'progress' SSE event — shows in the chat UI's status
  // line. Cheap. Remove (or gate behind a debug flag) once we're sure.
  try { onEmit && onEmit('progress', { message: `Reina (${agentMode} agent) is reading your message…` }); } catch { /* ignore */ }
  let system;
  let agentTools;
  if (agentMode === 'model' && !editingReportId && !viewOnlyProcessId) {
    const intro = await computeAgentIntro('model', {
      operatingModelId, operatingModelName,
    }).catch(() => null);
    system = modelChatSystemPrompt({
      operatingModelName: operatingModelName || null,
      workspaceTree: workspaceTreeText || null,
      sessionEmail: session?.email || null,
      intro,
    });
    agentTools = MODEL_AGENT_TOOLS;
  } else if (agentMode === 'deal' && !editingReportId && !viewOnlyProcessId) {
    const intro = await computeAgentIntro('deal', {
      dealId, dealName,
    }).catch(() => null);
    system = dealChatSystemPrompt({
      dealId,
      dealName: dealName || null,
      dealType: null,
      dealStatus: null,
      participants: dealAccessVerified ? (availableParticipants || []) : [],
      sessionEmail: session?.email || null,
      intro,
    });
    agentTools = DEAL_AGENT_TOOLS;
  } else {
    // Living workspace: no phase machinery and no "incomplete fields"
    // checklist injection — those drove Reina toward terminal
    // generate_* actions. Pass null so the prompt skips the blocks.
    system = chatSystemPrompt({
      processName, stepsDesc, incompleteBlock: '', phaseState: null, editingMode, viewOnlyMode: isViewOnly, viewOnlyProcessId, sessionContext,
      dealId: dealAccessVerified ? dealId : null,
      dealName: dealAccessVerified ? (dealName || null) : null,
      activeParticipant: dealAccessVerified ? (activeParticipant || null) : null,
      availableParticipants: dealAccessVerified ? (availableParticipants || null) : null,
      sessionEmail: session?.email || null,
      functionPath: functionPath || null,
      operatingModelName: operatingModelName || null,
      workspaceTree: workspaceTreeText || null,
    });
    agentTools = ALL_CHAT_TOOLS;
  }

  /* Build message history */
  const messages = [];
  if (history?.length) {
    for (const h of history.slice(-10)) {
      messages.push({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content });
    }
  }

  /* Handle attachments */
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
  const classified = hasAttachments
    ? attachments.map(a => ({ a, kind: classifyAttachment(a) }))
    : [];
  const hasRichContent = classified.some(({ kind }) => kind !== 'unknown');

  if (hasAttachments) {
    const list = attachments.map(a => a.name).filter(Boolean).join(', ') || `${attachments.length} file(s)`;
    emit('progress', { message: `Received ${attachments.length} file${attachments.length > 1 ? 's' : ''}: ${list}. Preparing for analysis…` });
  }

  let preAck = '';
  if (hasRichContent) {
    emit('progress', { message: 'Reading your attachments…' });
    const contentBlocks = [];
    if (message?.trim()) contentBlocks.push({ type: 'text', text: message.trim() });
    for (const { a, kind } of classified) {
      emit('progress', { message: `Loading ${describeAttachmentFile(a)}…` });
      if (kind === 'image' && a.content) {
        contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: a.type || 'image/png', data: a.content } });
      } else if (kind === 'pdf' && a.content) {
        contentBlocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.content } });
      } else if (kind === 'excel' && a.content) {
        emit('progress', { message: `Parsing spreadsheet "${a.name}"…` });
        const csv = parseExcelBase64(a.content);
        contentBlocks.push({ type: 'text', text: `File: ${a.name} (spreadsheet, converted to CSV)\n\n${truncateText(csv)}` });
      } else if (kind === 'docx' && a.content) {
        emit('progress', { message: `Extracting text from "${a.name}"…` });
        const text = await parseDocxBase64(a.content);
        contentBlocks.push({ type: 'text', text: `File: ${a.name} (Word document)\n\n${truncateText(text)}` });
      } else if (kind === 'doc' && a.content) {
        emit('progress', { message: `Extracting text from "${a.name}"…` });
        const text = await parseDocBase64(a.content);
        contentBlocks.push({ type: 'text', text: `File: ${a.name} (legacy Word document)\n\n${truncateText(text)}` });
      } else if (kind === 'pptx' && a.content) {
        emit('progress', { message: `Extracting slides from "${a.name}"…` });
        const text = await parsePptxBase64(a.content);
        contentBlocks.push({ type: 'text', text: `File: ${a.name} (PowerPoint)\n\n${truncateText(text)}` });
      } else if (kind === 'ppt' && a.content) {
        emit('progress', { message: `Extracting text from "${a.name}"…` });
        const text = parsePptBase64(a.content);
        contentBlocks.push({ type: 'text', text: `File: ${a.name} (legacy PowerPoint, best-effort text extraction - formatting lost)\n\n${truncateText(text)}` });
      } else if (a.textContent) {
        contentBlocks.push({ type: 'text', text: `File: ${a.name}\n\n${truncateText(a.textContent)}` });
      } else {
        emit('progress', { message: `Referencing "${a.name}" in your request…` });
        contentBlocks.push({ type: 'text', text: `[Attached: ${a.name}${a.type ? ` (${a.type})` : ''} - content could not be read server-side]` });
      }
    }
    messages.push({ role: 'user', content: contentBlocks });
  } else {
    if (hasAttachments) emit('progress', { message: 'Packaging your files for the assistant…' });
    const text = message?.trim() || (hasAttachments ? `Extract process steps from: ${attachments.map(a => a.name).join(', ')}` : '');
    messages.push({ role: 'user', content: text });
  }

  if (hasAttachments) {
    const fileDesc = attachments.length === 1 ? describeAttachmentFile(attachments[0]) : `${attachments.length} files`;
    preAck = `Got it - I can see you've shared ${fileDesc}. I'll read through it and extract your process steps now…\n\n`;
    emit('delta', { text: preAck });
  }

  // Thread the active model id onto this turn. pickAgent already ran
  // (above) off the raw client signals, so resolving here can't flip
  // the agent — it only gives model-scoped tools a home when the
  // session didn't carry one (process / onboarding chats).
  const resolvedOperatingModelId = await resolveActiveModelId({
    operatingModelId,
    reportId: editingReportId || viewOnlyProcessId || null,
    session,
  });

  const ctx = {
    steps: currentSteps || [],
    handoffs: currentHandoffs || [],
    processName: processName || '',
    editingReportId: editingReportId || null,
    // dealId is only honoured when the upstream route has verified access.
    // Defence in depth: even if a future code path forgets to validate,
    // the search_deal_documents tool refuses without dealAccessVerified.
    dealId: dealAccessVerified ? (dealId || null) : null,
    dealAccessVerified: !!dealAccessVerified,
    operatingModelId: resolvedOperatingModelId || null,
    session: session || null,
    apiKey: apiKey || null,
    model: modelOverride || null,
    onEmit: emit,
    tools: agentTools,
  };
  const { textParts, actions, usage } = await runStreamingLoop({ system, messages, onEmit: emit, ctx });

  let reply = textParts.join('\n').trim();
  if (!reply && actions.length > 0) reply = `Done  -  ${summariseActions(actions)}`;
  if (!reply) reply = 'Done.';
  if (preAck) reply = `${preAck}${reply}`;

  // Record token usage so the org admin's Usage panel reflects chat spend.
  // Soft-fail: never block the user from seeing the reply because metering
  // had a hiccup. Recorded on BOTH customer-key and platform-key calls.
  try {
    const total = (usage?.input_tokens || 0) + (usage?.output_tokens || 0);
    if (total > 0 && (session?.email || session?.userId)) {
      const { recordTokenUsage, getOrgIdForUser } = await import('../../costGuard.js');
      const orgId = await getOrgIdForUser({ email: session?.email, userId: session?.userId });
      await recordTokenUsage({
        orgId,
        vendor: 'anthropic',
        model: modelOverride || CHAT_MODEL_ID,
        surface: 'diagnostic_chat',
        refId: editingReportId || dealId || null,
        inputTokens:  usage.input_tokens  || 0,
        outputTokens: usage.output_tokens || 0,
        userEmail: session?.email,
        // userId is the trigger for the per-user trial bump in costGuard
        // when no orgId is in scope (signed-in trial users).
        userId: session?.userId,
      });
    }
  } catch (err) {
    // Logger imported lazily because graph.js is hot-path; avoid bundling cost.
    try {
      const { logger } = await import('../../logger.js');
      logger.warn('Chat token-usage record failed (non-fatal)', { error: err.message });
    } catch { /* ignore */ }
  }

  return { reply, actions: actions.length > 0 ? actions : undefined };
}
