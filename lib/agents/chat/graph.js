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
import { getSignificantBottlenecks } from '../../diagnostic/detectBottlenecks.js';
import { getWaitProfile } from '../../flows/flowModel.js';
import { getSupabaseHeaders, fetchWithTimeout, requireSupabase } from '../../api-helpers.js';
import { getSupabaseAdmin } from '../../supabase.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

    default:
      return 'Done.';
  }
}

/* ── Streaming agent loop ─────────────────────────────────────────── */

async function runStreamingLoop({ system, messages, onEmit, ctx, maxIterations = 10 }) {
  let currentMessages = [...messages];
  const allActions = [];
  const allTextParts = [];
  let iterations = 0;

  const emit = (event, data) => { if (typeof onEmit === 'function') onEmit(event, data); };

  while (iterations < maxIterations) {
    emit('progress', { message: iterations === 0 ? 'Reina is thinking…' : 'Updating your process map…' });

    let streamText = '';
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 16384,
      temperature: 0.3,
      system,
      messages: currentMessages,
      tools: ALL_CHAT_TOOLS,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        streamText += event.delta.text;
        emit('delta', { text: event.delta.text });
      }
    }

    const finalMessage = await stream.finalMessage();
    if (streamText.trim()) allTextParts.push(streamText.trim());

    if (finalMessage.stop_reason !== 'tool_use') break;

    const toolUses = finalMessage.content.filter(b => b.type === 'tool_use');
    if (toolUses.length === 0) break;

    emit('progress', { message: 'Updating your process map…' });

    const toolResults = await Promise.all(toolUses.map(async (tu) => {
      allActions.push({ name: tu.name, input: tu.input });
      const content = await executeTool(tu.name, tu.input, ctx || {});
      return { type: 'tool_result', tool_use_id: tu.id, content };
    }));

    currentMessages = [
      ...currentMessages,
      { role: 'assistant', content: finalMessage.content },
      { role: 'user', content: toolResults },
    ];
    iterations++;
  }

  return { textParts: allTextParts, actions: allActions };
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function summariseActions(actions) {
  const parts = [];
  let added = 0, updated = 0, removed = 0, handoffs = 0, depts = 0, replaced = false;
  for (const a of actions) {
    if (a.name === 'add_step') added++;
    else if (a.name === 'update_step') updated++;
    else if (a.name === 'remove_step') removed++;
    else if (a.name === 'set_handoff') handoffs++;
    else if (a.name === 'add_custom_department') depts++;
    else if (a.name === 'replace_all_steps') replaced = true;
  }
  if (replaced) parts.push(`Set up ${actions.find(a => a.name === 'replace_all_steps')?.input?.steps?.length || 0} steps`);
  if (added) parts.push(`added ${added} step${added > 1 ? 's' : ''}`);
  if (updated) parts.push(`updated ${updated} step${updated > 1 ? 's' : ''}`);
  if (removed) parts.push(`removed ${removed} step${removed > 1 ? 's' : ''}`);
  if (handoffs) parts.push(`set ${handoffs} handoff${handoffs > 1 ? 's' : ''}`);
  if (depts) parts.push(`added ${depts} custom department${depts > 1 ? 's' : ''}`);
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

export async function runChatAgent({
  message, currentSteps, currentHandoffs, processName, history,
  incompleteInfo, phaseState, attachments, editingReportId, editingRedesign, redesignContext,
  sessionContext, session,
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
  const system = chatSystemPrompt({ processName, stepsDesc, incompleteBlock, phaseState, editingMode, redesignContext, sessionContext });

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
    session: session || null,
  };
  const { textParts, actions } = await runStreamingLoop({ system, messages, onEmit: emit, ctx });

  let reply = textParts.join('\n').trim();
  if (!reply && actions.length > 0) reply = `Done  -  ${summariseActions(actions)}`;
  if (!reply) reply = 'Done.';
  if (preAck) reply = `${preAck}${reply}`;

  return { reply, actions: actions.length > 0 ? actions : undefined };
}
