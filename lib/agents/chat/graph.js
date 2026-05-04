import Anthropic from '@anthropic-ai/sdk';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';
import officeParser from 'officeparser';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { chatSystemPrompt } from '../../prompts.js';
import { ALL_CHAT_TOOLS } from './tools.js';
import { CHAT_MODEL_ID } from '../models.js';
import { getSignificantBottlenecks } from '../../diagnostic/detectBottlenecks.js';
import { getWaitProfile } from '../../flows/flowModel.js';
import { getSupabaseHeaders, fetchWithTimeout, requireSupabase } from '../../api-helpers.js';
import { getSupabaseAdmin } from '../../supabase.js';

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
      `${sbConfig.url}/rest/v1/diagnostic_reports?id=eq.${encodeURIComponent(reportId)}&select=diagnostic_data,financial_model`,
      { method: 'GET', headers: getSupabaseHeaders(sbConfig.key) },
      5000,
    );
    if (!resp.ok) return null;
    const rows = await resp.json();
    return rows?.[0] || null;
  } catch {
    return null;
  }
}

function formatMoney(n, currency) {
  if (n == null || !Number.isFinite(n)) return '-';
  const sym = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '£';
  return `${sym}${Math.round(n).toLocaleString()}`;
}

function computeCostSummaryFromBlob(blob) {
  const dd = blob?.diagnostic_data || {};
  const ca = dd.costAnalysis;
  if (!ca) return 'Cost analysis has not been saved for this report yet.';
  const fm = blob.financial_model || dd.financialModel || {};
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
  if (fm.totalCurrentCost != null) parts.push(`Annual cost today: ${formatMoney(fm.totalCurrentCost, currency)}`);
  if (fm.totalSavings != null) parts.push(`Estimated annual savings: ${formatMoney(fm.totalSavings, currency)} (${Math.round((fm.overallSavingsPct || 0) * 100)}%)`);
  if (fm.paybackMonths != null) parts.push(`Payback: ${fm.paybackMonths.toFixed ? fm.paybackMonths.toFixed(1) : fm.paybackMonths} months`);
  if (fm.roiYear1 != null) parts.push(`Year-1 ROI: ${Math.round(fm.roiYear1 * 100)}%`);
  return parts.length ? parts.join('\n') : 'Cost analysis exists but has no financial figures yet.';
}

async function listUserReports({ userId, email }, limit = 8) {
  if (!userId && !email) return null;
  const cap = Math.min(Math.max(limit || 8, 1), 20);
  try {
    const sb = getSupabaseAdmin();
    const q = sb
      .from('diagnostic_reports')
      .select('id,company,contact_name,diagnostic_data,total_annual_cost,potential_savings,automation_percentage,created_at')
      .order('created_at', { ascending: false })
      .limit(cap);
    const emailLower = (email || '').toLowerCase().trim();
    if (userId) q.or(`user_id.eq.${userId},contact_email.eq.${emailLower}`);
    else q.eq('contact_email', emailLower);
    const { data, error } = await q;
    if (error) return null;
    return data || [];
  } catch {
    return null;
  }
}

async function fetchUserReportById({ userId, email }, reportId) {
  if (!reportId || (!userId && !email)) return null;
  try {
    const sb = getSupabaseAdmin();
    const q = sb
      .from('diagnostic_reports')
      .select('id,company,contact_name,contact_email,user_id,diagnostic_data,financial_model,total_annual_cost,potential_savings,automation_percentage,automation_grade,created_at')
      .eq('id', reportId)
      .limit(1);
    const { data, error } = await q;
    if (error || !data?.length) return null;
    const row = data[0];
    // Enforce ownership - only return if row belongs to the signed-in user.
    const emailLower = (email || '').toLowerCase().trim();
    const belongs =
      (userId && row.user_id === userId) ||
      (emailLower && (row.contact_email || '').toLowerCase() === emailLower);
    return belongs ? row : null;
  } catch {
    return null;
  }
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

function computeRecommendationsFromBlob(blob) {
  const dd = blob?.diagnostic_data || {};
  const recs = dd.recommendations || dd.aiRecommendations;
  if (!recs || (Array.isArray(recs) && !recs.length)) return 'No recommendations have been generated for this report yet.';
  const list = Array.isArray(recs) ? recs : Array.isArray(recs.items) ? recs.items : [];
  if (!list.length) return 'Recommendations block is empty.';
  const lines = list.slice(0, 6).map((r, i) => {
    const title = r.title || r.name || `Recommendation ${i + 1}`;
    const impact = r.impact || r.expectedImpact || r.savings || '';
    const rationale = (r.rationale || r.description || '').slice(0, 180);
    return `- ${title}${impact ? ` - ${impact}` : ''}${rationale ? `\n  ${rationale}` : ''}`;
  });
  return `Top recommendations:\n${lines.join('\n')}`;
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
    case 'trigger_redesign':
      return 'Triggered AI redesign (client will run analysis).';
    case 'pin_flow_snapshot':
      return input.label ? `Pinned snapshot "${input.label}".` : 'Pinned current flow snapshot.';

    // Reads
    case 'get_bottlenecks':
      return computeBottlenecks(ctx);
    case 'get_critical_path':
      return computeCriticalPath(ctx);
    case 'get_step_metrics':
      return computeStepMetrics(ctx, input);
    case 'get_cost_summary': {
      if (!ctx.editingReportId) return 'No report is being edited, so no cost analysis is loaded. Ask the user to open a saved report first.';
      const blob = await fetchReportBlob(ctx.editingReportId);
      return computeCostSummaryFromBlob(blob);
    }
    case 'get_recommendations': {
      if (!ctx.editingReportId) return 'No report is being edited, so no recommendations are loaded.';
      const blob = await fetchReportBlob(ctx.editingReportId);
      return computeRecommendationsFromBlob(blob);
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

    case 'propose_finding_review': {
      if (!ctx.dealAccessVerified || !ctx.dealId) {
        return 'No deal context on this chat session - propose_finding_review only works on deal-bound conversations.';
      }
      const VALID = new Set(['approved', 'rejected', 'needs_revision']);
      const status = String(input.status || '').trim();
      const findingKey = String(input.findingKey || '').trim();
      if (!findingKey) return 'Cannot propose review: findingKey is required.';
      if (!VALID.has(status)) return `Cannot propose review: status must be one of ${[...VALID].join(', ')}.`;

      // Resolve the latest completed analysis + verify the finding exists on it.
      const { requireSupabase, getSupabaseHeaders, fetchWithTimeout } = await import('../../api-helpers.js');
      const sb = requireSupabase();
      if (!sb) return 'Storage not configured.';
      const headers = getSupabaseHeaders(sb.key);
      const aResp = await fetchWithTimeout(
        `${sb.url}/rest/v1/deal_analyses?deal_id=eq.${ctx.dealId}&status=eq.complete&select=id,mode,created_at&order=created_at.desc&limit=1`,
        { headers },
      );
      const [latest] = aResp.ok ? await aResp.json() : [];
      if (!latest) return 'No completed analysis on this deal — nothing to review yet.';

      const fResp = await fetchWithTimeout(
        `${sb.url}/rest/v1/deal_findings?analysis_id=eq.${latest.id}&finding_key=eq.${encodeURIComponent(findingKey)}&select=finding_key,title,severity,section,category&limit=1`,
        { headers },
      );
      const [finding] = fResp.ok ? await fResp.json() : [];
      if (!finding) return `No finding with key "${findingKey}" on the latest ${latest.mode} analysis. Run list_deal_findings to see valid keys.`;

      const note = input.note ? String(input.note).slice(0, 500) : null;

      try {
        ctx?.onEmit?.('deal_proposal', {
          kind: 'finding_review',
          dealId: ctx.dealId,
          analysisId: latest.id,
          findingKey,
          findingTitle: finding.title,
          findingSection: finding.section || finding.category || null,
          findingSeverity: finding.severity || null,
          status,
          note,
        });
      } catch { /* never break the loop */ }

      return `Staged "${status}" review for "${finding.title}" (key=${findingKey}). The user will see an Apply button; the change is NOT yet persisted.`;
    }

    case 'propose_run_analysis': {
      if (!ctx.dealAccessVerified || !ctx.dealId) {
        return 'No deal context on this chat session - propose_run_analysis only works on deal-bound conversations.';
      }
      const VALID = new Set(['comparison', 'synergy', 'redesign', 'diligence']);
      const mode = String(input.mode || '').trim();
      if (!VALID.has(mode)) return `Invalid mode "${mode}". Must be one of ${[...VALID].join(', ')}.`;
      try {
        ctx?.onEmit?.('deal_proposal', {
          kind: 'run_analysis',
          dealId: ctx.dealId,
          mode,
          reason: input.reason ? String(input.reason).slice(0, 280) : null,
        });
      } catch { /* never break the loop */ }
      return `Staged a "${mode}" analysis. The user will see an Apply button; the analysis is NOT yet started.`;
    }

    case 'propose_export_pptx': {
      if (!ctx.dealAccessVerified || !ctx.dealId) {
        return 'No deal context on this chat session - propose_export_pptx only works on deal-bound conversations.';
      }
      // Validate: latest diligence analysis exists + has at least one approved
      // review. Without an approved finding the export endpoint produces an
      // empty deck, so we save the user a click.
      const { requireSupabase, getSupabaseHeaders, fetchWithTimeout } = await import('../../api-helpers.js');
      const sb = requireSupabase();
      if (!sb) return 'Storage not configured.';
      const headers = getSupabaseHeaders(sb.key);
      const aResp = await fetchWithTimeout(
        `${sb.url}/rest/v1/deal_analyses?deal_id=eq.${ctx.dealId}&mode=eq.diligence&status=eq.complete&select=id,created_at&order=created_at.desc&limit=1`,
        { headers },
      );
      const [latest] = aResp.ok ? await aResp.json() : [];
      if (!latest) return 'No completed diligence analysis on this deal — nothing to export. Run a diligence analysis first.';

      const rResp = await fetchWithTimeout(
        `${sb.url}/rest/v1/deal_finding_reviews?analysis_id=eq.${latest.id}&status=eq.approved&select=finding_key`,
        { headers },
      );
      const approved = rResp.ok ? await rResp.json() : [];
      if (!approved.length) return 'The latest diligence analysis has no approved findings. Approve at least one finding before exporting.';

      try {
        ctx?.onEmit?.('deal_proposal', {
          kind: 'export_pptx',
          dealId: ctx.dealId,
          analysisId: latest.id,
          approvedCount: approved.length,
        });
      } catch { /* never break the loop */ }

      return `Staged PowerPoint export for the latest diligence analysis (${approved.length} approved finding${approved.length === 1 ? '' : 's'}). The user will see an Apply button; nothing is downloaded yet.`;
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

      try {
        ctx?.onEmit?.('deal_proposal', {
          kind: 'invite_participant',
          dealId: ctx.dealId,
          role,
          companyName,
          email,
          name,
          sendInviteEmail,
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

      try {
        ctx?.onEmit?.('deal_proposal', {
          kind: 'reprocess_document',
          dealId: ctx.dealId,
          documentId: doc.id,
          filename: doc.filename,
          currentStatus: doc.status,
          wipe,
          reason: input.reason ? String(input.reason).slice(0, 280) : null,
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
        `${sb.url}/rest/v1/diagnostic_reports?id=eq.${encodeURIComponent(reportId)}&select=id&limit=1`,
        { headers },
      );
      const [report] = rResp.ok ? await rResp.json() : [];
      if (!report) return `No diagnostic report with id "${reportId}". Run list_reports to see what's available.`;

      try {
        ctx?.onEmit?.('deal_proposal', {
          kind: 'link_participant_report',
          dealId: ctx.dealId,
          participantId,
          participantCompany: participant.company_name,
          participantRole: participant.role,
          participantStatus: participant.status,
          reportId,
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
      const VALID = new Set(['finding_review', 'link_participant_report']);
      const undoKind = String(input.kind || '').trim();
      if (!VALID.has(undoKind)) {
        return `Cannot stage undo: kind must be one of ${[...VALID].join(', ')}. Other actions (analysis, export, invite, upload, reprocess) are not undoable from chat — they have side effects (token spend, sent emails, queued workers) that need a deliberate process.`;
      }

      const { requireSupabase, getSupabaseHeaders, fetchWithTimeout } = await import('../../api-helpers.js');
      const sb = requireSupabase();
      if (!sb) return 'Storage not configured.';
      const headers = getSupabaseHeaders(sb.key);

      if (undoKind === 'finding_review') {
        const findingKey = String(input.findingKey || '').trim();
        if (!findingKey) return 'findingKey is required for undoing a finding review.';
        // Confirm a non-pending review exists for this finding on the latest analysis.
        const aResp = await fetchWithTimeout(
          `${sb.url}/rest/v1/deal_analyses?deal_id=eq.${ctx.dealId}&status=eq.complete&select=id&order=created_at.desc&limit=1`,
          { headers },
        );
        const [latest] = aResp.ok ? await aResp.json() : [];
        if (!latest) return 'No completed analysis on this deal — nothing to undo.';
        const rResp = await fetchWithTimeout(
          `${sb.url}/rest/v1/deal_finding_reviews?analysis_id=eq.${latest.id}&finding_key=eq.${encodeURIComponent(findingKey)}&select=finding_key,status&limit=1`,
          { headers },
        );
        const [review] = rResp.ok ? await rResp.json() : [];
        if (!review) return `No review row for finding "${findingKey}" — nothing to undo.`;
        if (review.status === 'pending') return `Review for "${findingKey}" is already pending — nothing to undo.`;

        try {
          ctx?.onEmit?.('deal_proposal', {
            kind: 'undo_finding_review',
            dealId: ctx.dealId,
            analysisId: latest.id,
            findingKey,
            previousStatus: review.status,
          });
        } catch { /* never break the loop */ }

        return `Staged undo: revert "${findingKey}" review from "${review.status}" back to "pending". The user will see an Apply button.`;
      }

      if (undoKind === 'link_participant_report') {
        const participantId = String(input.participantId || '').trim();
        if (!participantId) return 'participantId is required for undoing a participant report link.';
        const pResp = await fetchWithTimeout(
          `${sb.url}/rest/v1/deal_participants?id=eq.${encodeURIComponent(participantId)}&deal_id=eq.${ctx.dealId}&select=id,company_name,report_id,status&limit=1`,
          { headers },
        );
        const [participant] = pResp.ok ? await pResp.json() : [];
        if (!participant) return `No participant with id "${participantId}" on this deal.`;
        if (!participant.report_id) return `Participant "${participant.company_name}" has no linked report — nothing to undo.`;

        try {
          ctx?.onEmit?.('deal_proposal', {
            kind: 'undo_link_participant_report',
            dealId: ctx.dealId,
            participantId,
            participantCompany: participant.company_name,
            previousReportId: participant.report_id,
          });
        } catch { /* never break the loop */ }

        return `Staged undo: unlink the report from "${participant.company_name}". The user will see an Apply button.`;
      }

      return 'Unknown undo kind.';
    }

    case 'propose_generate_report': {
      if (!ctx.dealAccessVerified || !ctx.dealId) {
        return 'No deal context on this chat session - propose_generate_report only works on deal-bound conversations.';
      }
      const VALID = new Set(['process_per_company', 'company_rollup', 'process_across_companies', 'multi_company_multi_process']);
      const scope = String(input.scope || '').trim();
      if (!VALID.has(scope)) return `Invalid scope "${scope}". Must be one of ${[...VALID].join(', ')}.`;

      const requestedPartIds = Array.isArray(input.participantIds) ? input.participantIds.map(String) : [];
      const requestedProcs   = Array.isArray(input.processNames)   ? input.processNames.map((s) => String(s).trim()).filter(Boolean) : [];
      const mode = ['comparison', 'synergy', 'redesign'].includes(input.mode) ? input.mode : null;

      const { requireSupabase, getSupabaseHeaders, fetchWithTimeout } = await import('../../api-helpers.js');
      const sb = requireSupabase();
      if (!sb) return 'Storage not configured.';
      const headers = getSupabaseHeaders(sb.key);

      // Resolve participants — narrowed by requestedPartIds if provided.
      const partResp = await fetchWithTimeout(
        `${sb.url}/rest/v1/deal_participants?deal_id=eq.${ctx.dealId}&select=id,role,company_name,status,report_id,completed_at&order=created_at.asc`,
        { headers },
      );
      let participants = partResp.ok ? await partResp.json() : [];
      if (requestedPartIds.length) {
        participants = participants.filter((p) => requestedPartIds.includes(p.id));
      }
      if (!participants.length) return 'No participants matched the request — pick at least one company.';

      // For each participant with a report, fetch the report's raw process names
      // so the picker can display per-company / per-process rows + completion %.
      const reportIds = participants.map((p) => p.report_id).filter(Boolean);
      const reportsByParticipant = {};
      if (reportIds.length) {
        const repResp = await fetchWithTimeout(
          `${sb.url}/rest/v1/diagnostic_reports?id=in.(${reportIds.map(encodeURIComponent).join(',')})&select=id,diagnostic_data`,
          { headers },
        );
        const reports = repResp.ok ? await repResp.json() : [];
        const byId = Object.fromEntries(reports.map((r) => [r.id, r]));
        for (const p of participants) {
          const r = byId[p.report_id];
          const dd = r?.diagnostic_data || {};
          const procs = Array.isArray(dd.rawProcesses) ? dd.rawProcesses : (Array.isArray(dd.processes) ? dd.processes : []);
          reportsByParticipant[p.id] = {
            reportId: r?.id || null,
            processes: procs.map((rp) => {
              const name = rp.processName || rp.name || 'Untitled process';
              const stepCount = Array.isArray(rp.steps) ? rp.steps.length : 0;
              const namedStepCount = Array.isArray(rp.steps) ? rp.steps.filter((s) => (s.name || '').trim()).length : 0;
              const completionPct = stepCount ? Math.round((namedStepCount / stepCount) * 100) : 0;
              return { name, stepCount, namedStepCount, completionPct };
            }),
          };
        }
      }

      const items = participants.map((p) => {
        const r = reportsByParticipant[p.id];
        const procs = r?.processes || [];
        // Filter processes by requested names if provided.
        const filtered = requestedProcs.length
          ? procs.filter((proc) => requestedProcs.some((q) => proc.name.toLowerCase().includes(q.toLowerCase())))
          : procs;
        return {
          participantId: p.id,
          companyName: p.company_name,
          role: p.role,
          status: p.status,                       // 'invited' | 'in_progress' | 'complete'
          reportId: r?.reportId || null,
          processes: filtered,
          isComplete: p.status === 'complete' && Boolean(r?.reportId) && filtered.length > 0,
        };
      });

      const incomplete = items.filter((i) => !i.isComplete);
      const incompleteSummary = incomplete.length
        ? `${incomplete.length} of ${items.length} ${items.length === 1 ? 'company is' : 'companies are'} not fully mapped — the report will be partial.`
        : null;

      try {
        ctx?.onEmit?.('deal_proposal', {
          kind: 'generate_report',
          dealId: ctx.dealId,
          scope,
          mode,
          requestedProcessNames: requestedProcs,
          items,
          incompleteSummary,
        });
      } catch { /* never break the loop */ }

      return `Staged a ${scope.replace(/_/g, ' ')} report covering ${items.length} ${items.length === 1 ? 'company' : 'companies'}. The user will see a picker to confirm or adjust.`;
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
    const [dealResp, partsResp, docsResp, anaResp] = await Promise.all([
      fetchWithTimeout(`${sb.url}/rest/v1/deals?id=eq.${dealId}&select=id,deal_code,type,name,process_name,status,owner_email,created_at,updated_at`, { headers }),
      fetchWithTimeout(`${sb.url}/rest/v1/deal_participants?deal_id=eq.${dealId}&select=id,role,company_name,status`, { headers }),
      fetchWithTimeout(`${sb.url}/rest/v1/deal_documents?deal_id=eq.${dealId}&select=id,status`, { headers }),
      fetchWithTimeout(`${sb.url}/rest/v1/deal_analyses?deal_id=eq.${dealId}&select=id,mode,status,created_at,completed_at&order=created_at.desc&limit=1`, { headers }),
    ]);
    const [deal] = dealResp.ok ? await dealResp.json() : [];
    const parts = partsResp.ok ? await partsResp.json() : [];
    const docs  = docsResp.ok  ? await docsResp.json()  : [];
    const ana   = anaResp.ok   ? await anaResp.json()   : [];
    if (!deal) return 'Deal not found.';
    const docsByStatus = docs.reduce((acc, d) => { acc[d.status] = (acc[d.status] || 0) + 1; return acc; }, {});
    const docsLine = Object.entries(docsByStatus).map(([s, n]) => `${n} ${s}`).join(', ') || '0';
    const a = ana[0] || null;
    return [
      `Deal: ${deal.name} (${deal.deal_code})`,
      `Type: ${deal.type} · Status: ${deal.status}`,
      `Process: ${deal.process_name || '(not set)'}`,
      `Owner: ${deal.owner_email}`,
      `Participants: ${parts.length} (${parts.filter((p) => p.status === 'complete').length} complete)`,
      `Documents: ${docs.length} total — ${docsLine}`,
      a ? `Latest analysis: ${a.mode} · ${a.status}${a.completed_at ? ` (completed ${a.completed_at.slice(0, 10)})` : ''}` : 'No analyses run yet.',
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
    const [analysesResp] = await Promise.all([
      fetchWithTimeout(
        `${sb.url}/rest/v1/deal_analyses?deal_id=eq.${dealId}&status=eq.complete&select=id,mode,created_at&order=created_at.desc&limit=1`,
        { headers },
      ),
    ]);
    const [latest] = analysesResp.ok ? await analysesResp.json() : [];
    if (!latest) return 'No completed analyses on this deal yet — run one first to surface findings.';
    // Real columns on deal_findings: finding_key, section, order_index, title,
    // category, severity, evidence (jsonb array). The user-facing "area" maps
    // to `category` (high-level) or `section` (the diligence section bucket);
    // we filter by either when an `area` arg is provided.
    const areaFilter = opts.area
      ? `&or=(category.ilike.*${encodeURIComponent(opts.area)}*,section.ilike.*${encodeURIComponent(opts.area)}*)`
      : '';
    const findResp = await fetchWithTimeout(
      `${sb.url}/rest/v1/deal_findings?analysis_id=eq.${latest.id}${areaFilter}&select=finding_key,title,section,category,severity,evidence,order_index&order=section.asc,order_index.asc&limit=${opts.limit}`,
      { headers },
    );
    const finds = findResp.ok ? await findResp.json() : [];
    if (!finds.length) return `No findings${opts.area ? ` in area "${opts.area}"` : ''} for the latest ${latest.mode} analysis.`;

    const reviewResp = await fetchWithTimeout(
      `${sb.url}/rest/v1/deal_finding_reviews?analysis_id=eq.${latest.id}&select=finding_key,status,decided_by_email,decided_at`,
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
      `${finds.length} finding${finds.length === 1 ? '' : 's'} from ${latest.mode} analysis (${latest.created_at.slice(0, 10)}):`,
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
  if (/^(?:validate|generate|submit|review|send|check|route|log|create|approve|reject|escalate|reconcile|allocate|assign|notify|update|enter|enter\s+into|input|capture|extract|parse|forward|process|handle|prepare|draft|sign|countersign|file|file\s+with|publish|post|email|call|chase|monitor|track|verify|confirm|investigate|resolve|close)\b/i.test(trimmed)) {
    return false;
  }
  return TRIGGER_PATTERNS.some((p) => p.test(trimmed));
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
    // Strip leading trigger steps (sometimes the agent emits two
    // "received" steps in a row). Capture the first as startsWhen.
    let startsWhen = null;
    let stepsCopy = [...input.steps];
    while (stepsCopy.length > 0 && looksLikeTrigger(stepsCopy[0]?.name)) {
      const triggerStep = stepsCopy.shift();
      if (!startsWhen) startsWhen = triggerStep.name;
    }
    if (startsWhen) {
      // Inject a set_process_definition side-effect so the trigger
      // surfaces on the process boundary (Screen 1) where it belongs.
      sideEffects.push({
        name: 'set_process_definition',
        input: { startsWhen },
      });
      // Rewrite branch targets — any branch pointing at "Step 1" now
      // points at "Step 0" which is invalid; shift every numeric target
      // down by 1 to account for the removed step.
      const removedCount = input.steps.length - stepsCopy.length;
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
    // trigger gets demoted, regardless of afterStep. The trigger
    // pattern is the strongest signal — even if the agent claims
    // "afterStep: 5", a "Service is delivered" step is wrong at any
    // position because it's not work the team performs.
    return {
      sanitised: null, // signal: drop this tool call
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
    case 'pin_flow_snapshot':     return `Pinning current flow as an artefact…`;
    case 'set_bottleneck':        return `Setting the bottleneck…`;
    case 'set_frequency_details': return `Setting frequency details…`;
    case 'set_pe_context':        return `Setting PE context…`;
    case 'add_step_system':       return `Adding "${i.system || 'system'}" to step ${i.stepNumber}…`;
    case 'remove_step_system':    return `Removing "${i.system || 'system'}" from step ${i.stepNumber}…`;
    case 'add_checklist_item':    return `Adding checklist item to step ${i.stepNumber}…`;
    case 'toggle_checklist_item': return `Toggling checklist on step ${i.stepNumber}…`;
    case 'remove_checklist_item': return `Removing checklist item from step ${i.stepNumber}…`;
    case 'remove_custom_department': return `Removing department "${i.name || ''}"…`;
    case 'trigger_redesign':      return `Running the AI redesign analysis…`;
    case 'highlight_step':        return `Highlighting step ${i.stepNumber}…`;
    case 'open_panel':             return `Opening the ${i.panel || 'panel'}…`;
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
    case 'propose_diligence_analysis':
    case 'propose_redesign_analysis':
    case 'propose_combine_workflows':
    case 'propose_generate_report':
                                  return `Staging the analysis…`;
    case 'list_user_reports':     return `Pulling your reports…`;
    case 'open_user_report':      return `Opening a report…`;
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
      tools: ALL_CHAT_TOOLS,
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
      const { sanitised, sideEffects } = sanitiseStepInput(tu.name, tu.input);
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
      return { type: 'tool_result', tool_use_id: tu.id, content };
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
  let reordered = 0, renamedProcess = false, definitionEdits = 0, detailEdits = 0, costEdits = 0, pinned = 0;
  let bottleneckEdits = 0, freqDetailEdits = 0, peEdits = 0, sysAdded = 0, sysRemoved = 0, redesignTriggered = false;
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
    else if (a.name === 'pin_flow_snapshot') pinned++;
    else if (a.name === 'set_bottleneck') bottleneckEdits++;
    else if (a.name === 'set_frequency_details') freqDetailEdits++;
    else if (a.name === 'set_pe_context') peEdits++;
    else if (a.name === 'add_step_system') sysAdded++;
    else if (a.name === 'remove_step_system') sysRemoved++;
    else if (a.name === 'trigger_redesign') redesignTriggered = true;
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
  if (pinned) parts.push(`pinned ${pinned} snapshot${pinned > 1 ? 's' : ''}`);
  if (bottleneckEdits) parts.push('updated bottleneck');
  if (freqDetailEdits) parts.push('updated frequency details');
  if (peEdits) parts.push('updated PE context');
  if (sysAdded) parts.push(`added ${sysAdded} system${sysAdded > 1 ? 's' : ''}`);
  if (sysRemoved) parts.push(`removed ${sysRemoved} system${sysRemoved > 1 ? 's' : ''}`);
  if (redesignTriggered) parts.push('triggered redesign');
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
  incompleteInfo, phaseState, attachments, editingReportId, editingRedesign, redesignContext,
  sessionContext, session, dealId, dealAccessVerified, apiKey, modelOverride,
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
  const editingMode = editingReportId ? (editingRedesign ? 'redesign' : 'original') : null;
  const system = chatSystemPrompt({
    processName, stepsDesc, incompleteBlock, phaseState, editingMode, redesignContext, sessionContext,
    dealId: dealAccessVerified ? dealId : null,
    sessionEmail: session?.email || null,
  });

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
    session: session || null,
    apiKey: apiKey || null,
    model: modelOverride || null,
    onEmit: emit,
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
        surface: editingRedesign ? 'diagnostic_chat:redesign' : 'diagnostic_chat',
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
