/**
 * intros — server-side opening message generators for the Model and Deal
 * agents. Computed from real data (no LLM call), so the user's first turn
 * lands instantly with actual numbers.
 */

import { loadOperatingModel, loadModelRollup } from '../../operatingModel/repo.js';
import { loadAnalysis } from '../../operatingModel/analysis.js';
import { getSupabaseHeaders, fetchWithTimeout, requireSupabase } from '../../api-helpers.js';

function money(n) {
  if (n == null || !Number.isFinite(n) || n === 0) return null;
  if (Math.abs(n) >= 1_000_000) return `£${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000)     return `£${(n / 1_000).toFixed(0)}k`;
  return `£${Math.round(n)}`;
}

/* ── Standard model intro ────────────────────────────────────────── */

export async function computeModelIntro({ operatingModelId, operatingModelName }) {
  if (!operatingModelId) return null;
  let model = null;
  let rollup = null;
  let analysis = null;
  try {
    [model, rollup, analysis] = await Promise.all([
      loadOperatingModel(operatingModelId),
      loadModelRollup(operatingModelId),
      loadAnalysis(operatingModelId),
    ]);
  } catch { /* fall through with whatever loaded */ }

  const name = operatingModelName || model?.model?.name || 'this operating model';
  const fCount = Array.isArray(model?.functions) ? model.functions.length : 0;
  const t = rollup?.totals || {};
  const procCount = t.processes ?? 0;
  const unfiled   = rollup?.unfiledProcesses || 0;
  const annual    = money(t.annualCost);
  const savings   = money(t.potentialSavings);
  const ratio     = (t.annualCost && t.potentialSavings)
    ? Math.round((t.potentialSavings / t.annualCost) * 100)
    : null;

  // Find the function with the biggest savings — frames the headline ask.
  let topFunctionLine = '';
  if (analysis?.automationPipeline?.length) {
    const byFunc = new Map();
    for (const r of analysis.automationPipeline) {
      const k = r.functionId || '_';
      byFunc.set(k, (byFunc.get(k) || 0) + (r.savings || 0));
    }
    let best = null;
    for (const [k, v] of byFunc) if (!best || v > best.v) best = { k, v };
    if (best && best.v > 0) {
      const fn = (model?.functions || []).find((f) => f.id === best.k);
      const fname = fn?.name || 'Unfiled';
      topFunctionLine = ` The biggest opportunity sits in **${fname}** (~${money(best.v)}).`;
    }
  }

  const recs = analysis?.topRecommendations?.length || 0;
  const bots = analysis?.bottlenecks?.length || 0;

  const summaryParts = [];
  summaryParts.push(`Here's what I see in **${name}**:`);
  const facts = [];
  if (fCount)    facts.push(`${fCount} function${fCount === 1 ? '' : 's'}`);
  if (procCount) facts.push(`${procCount} process${procCount === 1 ? '' : 'es'} mapped`);
  if (unfiled)   facts.push(`${unfiled} unfiled`);
  if (facts.length) summaryParts.push(facts.join(', ') + '.');
  const money_line = [];
  if (annual)  money_line.push(`Annual cost ${annual}`);
  if (savings) money_line.push(`addressable savings ~${savings}${ratio != null ? ` (${ratio}%)` : ''}`);
  if (money_line.length) summaryParts.push(money_line.join('; ') + '.');
  if (topFunctionLine) summaryParts.push(topFunctionLine.trim());
  if (recs || bots) {
    const list = [];
    if (recs) list.push(`${recs} open recommendation${recs === 1 ? '' : 's'}`);
    if (bots) list.push(`${bots} bottleneck step${bots === 1 ? '' : 's'}`);
    summaryParts.push(list.join(' and ') + '.');
  }

  const lines = [
    summaryParts.join(' '),
    '',
    'What would you like to do? I can:',
    '- Walk you through the **insights** or **analysis** tab',
    '- Drill into a specific function',
    '- Open a process to review or edit it',
    '- Propose a new function, role, or system',
    '- Surface the highest-impact recommendations',
  ];
  return lines.join('\n');
}

/* ── Deal intro ──────────────────────────────────────────────────── */

async function loadDealOverview(dealId) {
  const sb = requireSupabase();
  if (!sb || !dealId) return null;
  try {
    const headers = getSupabaseHeaders(sb.key);
    const select = 'id,name,deal_code,type,status,process_name,deal_participants(id,role,company_name,email,access_mode,status)';
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/deals?id=eq.${encodeURIComponent(dealId)}&select=${encodeURIComponent(select)}&limit=1`,
      { method: 'GET', headers },
    );
    if (!resp.ok) return null;
    const rows = await resp.json();
    return rows?.[0] || null;
  } catch { return null; }
}

async function loadDealFindingCount(dealId) {
  const sb = requireSupabase();
  if (!sb || !dealId) return { findings: 0, processes: 0 };
  try {
    const headers = { ...getSupabaseHeaders(sb.key), Prefer: 'count=exact' };
    const [findResp, procResp] = await Promise.all([
      fetchWithTimeout(
        `${sb.url}/rest/v1/deal_analysis_findings?deal_id=eq.${encodeURIComponent(dealId)}&select=key&limit=1`,
        { method: 'GET', headers },
      ),
      fetchWithTimeout(
        `${sb.url}/rest/v1/processes?deal_id=eq.${encodeURIComponent(dealId)}&select=id&limit=1`,
        { method: 'GET', headers },
      ),
    ]);
    const parseRange = (resp) => {
      const range = resp.headers?.get?.('content-range') || '';
      const m = /\/(\d+)$/.exec(range);
      return m ? parseInt(m[1], 10) : 0;
    };
    return { findings: parseRange(findResp), processes: parseRange(procResp) };
  } catch { return { findings: 0, processes: 0 }; }
}

const DEAL_TYPE_LABEL = {
  ma: 'M&A',
  pe_rollup: 'PE roll-up',
  scaling: 'Scaling',
};
const STATUS_LABEL = {
  collecting: 'Collecting',
  analyzing: 'Analyzing',
  complete: 'Complete',
  archived: 'Archived',
};

export async function computeDealIntro({ dealId, dealName }) {
  if (!dealId) return null;
  const deal = await loadDealOverview(dealId);
  const counts = await loadDealFindingCount(dealId);
  const name = deal?.name || dealName || 'this deal';
  const typeLabel = DEAL_TYPE_LABEL[deal?.type] || (deal?.type ?? '');
  const statusLabel = STATUS_LABEL[deal?.status] || (deal?.status ?? '');
  const participants = Array.isArray(deal?.deal_participants) ? deal.deal_participants : [];
  const total = participants.length;
  const completed = participants.filter((p) => p.status === 'complete' || p.status === 'submitted').length;
  const outstanding = Math.max(0, total - completed);

  const headerBits = [`**${name}**`];
  if (typeLabel) headerBits.push(typeLabel);
  if (statusLabel) headerBits.push(`status *${statusLabel}*`);
  const header = headerBits.join(' — ');

  const factBits = [];
  if (total)             factBits.push(`${completed}/${total} participant${total === 1 ? '' : 's'} submitted`);
  if (counts.processes)  factBits.push(`${counts.processes} process${counts.processes === 1 ? '' : 'es'} mapped`);
  if (counts.findings)   factBits.push(`${counts.findings} finding${counts.findings === 1 ? '' : 's'} open`);
  const factsLine = factBits.length ? factBits.join(', ') + '.' : '';

  const lines = [
    factsLine ? `${header}. ${factsLine}` : `${header}.`,
    '',
    'What would you like to do? I can:',
    '- Open the deal workspace (combined or per-participant)',
    '- Run analysis across participants',
    outstanding > 0 ? `- Chase a missing participant (${outstanding} outstanding)` : null,
    '- Upload a document for a participant',
    '- Generate a deliverable (PPTX or memo)',
    '- Review findings',
  ].filter(Boolean);
  return lines.join('\n');
}

/* ── Router-aware entry point ────────────────────────────────────── */

export async function computeAgentIntro(mode, ctx) {
  if (mode === 'model') return computeModelIntro(ctx || {});
  if (mode === 'deal')  return computeDealIntro(ctx  || {});
  return null;
}
