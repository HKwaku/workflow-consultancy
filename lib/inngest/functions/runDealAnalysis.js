/**
 * runDealAnalysis — Inngest function that does the heavy lift of a deal
 * analysis run. Replaces the old SSE-streaming pipeline in
 * /api/deals/[id]/analyse.
 *
 * Triggered by: `deal-analysis.requested`
 * Event payload: {
 *   analysis_id, deal_id, mode, requested_by_email, requested_by_user_id,
 *   org_id, api_key, using_customer_key, request_id
 * }
 *
 * Lifecycle (writes to deal_analyses.status + progress_message at each step):
 *   running:loading       → loading deal context
 *   running:companies     → fetching participant maps
 *   running:grounding     → fetching document excerpts
 *   running:llm           → calling Claude
 *   running:parsing       → parsing JSON / normalising findings
 *   running:verifying     → validating evidence pointers
 *   running:saving        → persisting findings + analysis JSONB
 *   complete              → done
 *   failed                → with `error` populated
 *
 * Each `step.run()` is independently durable. If the function crashes
 * mid-LLM, Inngest retries from the last completed step.
 *
 * The route's job is now reduced to: validate, insert pending row, send
 * this event, return analysis_id. The client polls
 * /api/deals/[id]/analyses/[analysisId]/status until status is terminal.
 */

import { inngest } from '../client';
import { logger } from '@/lib/logger';
import {
  getSupabaseHeaders, getSupabaseWriteHeaders, requireSupabase, fetchWithTimeout,
} from '@/lib/api-helpers';
import { getChatModel } from '@/lib/agents/models';
import { withRetry } from '@/lib/ai-retry';
import { buildAnalysisPrompt } from '@/lib/deal-analysis/prompts';
import {
  normaliseFindings, verifyEvidence, verifyEvidenceForFinding,
} from '@/lib/deal-analysis/findingsShape';
import { persistFindingsForAnalysis } from '@/lib/deal-analysis/findingsRepo';
import { searchDealChunks } from '@/lib/deal-analysis/chunkSearch';
import { recordTokenUsage } from '@/lib/costGuard';

export const runDealAnalysis = inngest.createFunction(
  {
    id: 'run-deal-analysis',
    name: 'Run cross-company deal analysis',
    retries: 1,                           // LLM calls are expensive; don't blast retries
    concurrency: { limit: 8 },           // Per-org concurrency would be nicer; flat global cap for now
  },
  { event: 'deal-analysis.requested' },
  async ({ event, step }) => {
    const {
      analysis_id, deal_id, mode,
      participant_ids, process_names,
      requested_by_email, org_id,
      api_key, using_customer_key,
      request_id,
    } = event.data || {};
    const filterParticipantIds = Array.isArray(participant_ids) ? participant_ids.filter(Boolean) : [];
    const filterProcessNames = Array.isArray(process_names)
      ? process_names.map((s) => String(s).toLowerCase().trim()).filter(Boolean)
      : [];

    if (!analysis_id || !deal_id || !mode) {
      throw new Error('Missing analysis_id / deal_id / mode in event payload');
    }
    if (!api_key) {
      throw new Error('Missing api_key in event payload — route should resolve before enqueueing');
    }

    const sb = requireSupabase();
    if (!sb) throw new Error('Supabase not configured');

    /* ── Helpers (closures over sb, analysis_id) ─────────────────── */

    const updateStatus = async (status, progressMessage = null, extra = {}) => {
      const body = { status, progress_message: progressMessage, ...extra };
      await fetchWithTimeout(
        `${sb.url}/rest/v1/deal_analyses?id=eq.${analysis_id}`,
        {
          method: 'PATCH',
          headers: { ...getSupabaseWriteHeaders(sb.key), 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
    };

    const failWith = async (errMsg) => {
      logger.warn('runDealAnalysis failing analysis', { analysis_id, deal_id, mode, error: errMsg });
      await updateStatus('failed', null, { error: errMsg, completed_at: new Date().toISOString() });
      // Returning instead of throwing because we've already recorded the failure
      // in the row — re-throwing would also trigger Inngest's retry, which is
      // wasteful for "no, the data really doesn't support an analysis" failures.
      return { ok: false, error: errMsg };
    };

    // Wrap the whole pipeline so any uncaught throw flips the row to
    // 'failed' for the polling client. Without this, an Inngest retry
    // failure would leave deal_analyses stuck at 'running' indefinitely.
    try {
      return await runPipeline();
    } catch (err) {
      logger.error('runDealAnalysis fatal', { analysis_id, deal_id, mode, error: err.message, stack: err.stack });
      await updateStatus('failed', null, {
        error: (err?.message || 'Analysis failed.').slice(0, 500),
        completed_at: new Date().toISOString(),
      });
      // Re-throw so Inngest still records the failure event for ops visibility.
      throw err;
    }

    /* ── Pipeline (split out so the try/catch above can wrap it) ─── */

    async function runPipeline() {

    /* ── Step 1: load deal + participants + reports ──────────────── */

    const ctx = await step.run('load-deal-context', async () => {
      await updateStatus('running', 'Loading deal context…');

      const dealResp = await fetchWithTimeout(
        `${sb.url}/rest/v1/deals?id=eq.${deal_id}&select=id,type,name,process_name,owner_email,collaborator_emails,status,settings`,
        { method: 'GET', headers: getSupabaseHeaders(sb.key) },
      );
      const [deal] = dealResp.ok ? await dealResp.json() : [];
      if (!deal) throw new Error('Deal not found');

      const partResp = await fetchWithTimeout(
        `${sb.url}/rest/v1/deal_participants?deal_id=eq.${deal_id}&select=id,role,company_name,status,report_id&order=created_at.asc`,
        { method: 'GET', headers: getSupabaseHeaders(sb.key) },
      );
      let participants = partResp.ok ? await partResp.json() : [];

      // Honour the picker's participant filter (when present). Skipping
      // companies the user explicitly excluded keeps the analysis focused.
      if (filterParticipantIds.length > 0) {
        const allowed = new Set(filterParticipantIds);
        participants = participants.filter((p) => allowed.has(p.id));
      }

      return { deal, participants };
    });

    const { deal, participants } = ctx;
    const isDiligence = mode === 'diligence';

    // Validate participant readiness — non-diligence modes need maps.
    const incomplete = participants.filter((p) => p.status !== 'complete' || !p.report_id);
    if (!isDiligence && incomplete.length > 0) {
      const names = incomplete.map((p) => p.company_name).join(', ');
      return failWith(`Not all companies have completed their process map. Waiting on: ${names}`);
    }
    if (!isDiligence && participants.length < 2) {
      return failWith('At least 2 companies must have completed their process maps.');
    }

    /* ── Step 2: load reports + build company → steps ────────────── */

    const companyData = await step.run('load-reports', async () => {
      await updateStatus('running',
        isDiligence ? 'Loading deal context…' : `Fetching process maps from ${participants.length} companies…`);

      const reportIds = participants.filter((p) => p.report_id).map((p) => p.report_id);
      let reports = [];
      if (reportIds.length > 0) {
        const reportsResp = await fetchWithTimeout(
          `${sb.url}/rest/v1/diagnostic_reports?id=in.(${reportIds.map(encodeURIComponent).join(',')})&select=id,diagnostic_data`,
          { method: 'GET', headers: getSupabaseHeaders(sb.key) },
        );
        reports = reportsResp.ok ? await reportsResp.json() : [];
      }
      const data = participants
        .flatMap((p) => {
          const report = reports.find((r) => r.id === p.report_id);
          const dd = report?.diagnostic_data || {};
          // Each participant may have multiple processes mapped — fan out so
          // process-level filters can pick a specific one across companies.
          const procs = Array.isArray(dd.rawProcesses) && dd.rawProcesses.length
            ? dd.rawProcesses
            : [(dd.rawProcesses || [])[0] || {}];
          return procs.map((rawProcess) => {
            const steps = (rawProcess?.steps || []).slice(0, 100).map((s) => ({
              name: s.name || '', department: s.department || '',
              isDecision: !!s.isDecision, isExternal: !!s.isExternal,
            }));
            return {
              companyName: p.company_name, role: p.role,
              processName: rawProcess?.processName || deal.process_name || 'Process',
              stepCount: steps.length, steps,
            };
          });
        })
        .filter((c) => {
          if (filterProcessNames.length > 0) {
            const pn = (c.processName || '').toLowerCase();
            if (!filterProcessNames.some((q) => pn.includes(q))) return false;
          }
          return isDiligence || c.steps.length > 0;
        });
      return data;
    });

    if (!isDiligence) {
      const hasSteps = companyData.every((c) => c.steps.length > 0);
      if (!hasSteps) {
        return failWith('One or more companies have no step data in their process map.');
      }
    }

    /* ── Step 3: RAG fetch (best-effort) ─────────────────────────── */

    const documentExcerpts = await step.run('rag-grounding', async () => {
      const intent = mode === 'synergy'
        ? 'systems consolidation, headcount overlap, duplicate spend, contract overlap'
        : mode === 'redesign'
        ? 'standard operating procedures, target operating model, system of record'
        : mode === 'diligence'
        ? 'core systems, key contracts, customer concentration, headcount, leadership, financial trajectory, red flags, Day 1 dependencies, separation, TSAs'
        : 'process variations, standardisation gaps, key dependencies';
      try {
        const excerpts = await searchDealChunks({
          supabaseUrl: sb.url, supabaseKey: sb.key,
          dealId: deal_id,
          queryText: `${deal.name} ${deal.process_name || ''} ${intent}`,
          limit: mode === 'diligence' ? 30 : 12,
        });
        if (excerpts.length) await updateStatus('running', `Grounding in ${excerpts.length} document excerpts…`);
        return excerpts;
      } catch (e) {
        logger.warn('Document grounding failed; continuing without', { request_id, error: e.message });
        return [];
      }
    });

    /* ── Step 4: build prompt + call Claude ──────────────────────── */

    const llmResult = await step.run('llm-call', async () => {
      const { systemPrompt, userPrompt } = buildAnalysisPrompt({ mode, deal, companyData, documentExcerpts });
      await updateStatus('running',
        mode === 'synergy'   ? 'Quantifying integration synergies…'
        : mode === 'redesign'  ? 'Designing the unified target process…'
        : mode === 'diligence' ? 'Drafting the diligence memo…'
        : 'Comparing process maps across companies…',
      );

      const model = getChatModel({ maxTokens: 8192, temperature: 0, apiKey: api_key });
      try {
        const response = await withRetry(
          () => model.invoke([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ]),
          { maxAttempts: 2, baseDelayMs: 2000, label: 'PE deal analysis', logger },
        );
        const rawContent = typeof response.content === 'string'
          ? response.content
          : response.content?.[0]?.text || '';
        const usage = response.usage_metadata
          || response.response_metadata?.usage
          || response.response_metadata?.tokenUsage
          || null;
        return { rawContent, usage };
      } catch (aiErr) {
        const isAuthErr = /401|403|invalid.*api.*key|authentication/i.test(aiErr.message || '');
        if (using_customer_key && isAuthErr) {
          throw new Error("Your organisation's Anthropic API key was rejected. Ask an admin to update it in settings.");
        }
        throw new Error(`AI analysis call failed: ${aiErr.message}`);
      }
    });

    // Token usage recording (independent step — non-fatal on failure).
    await step.run('record-token-usage', async () => {
      try {
        await recordTokenUsage({
          orgId: org_id,
          vendor: 'anthropic',
          model: 'claude-sonnet-4-6',
          surface: `deal_analysis:${mode}`,
          refId: deal_id,
          inputTokens:  Number(llmResult.usage?.input_tokens  || llmResult.usage?.inputTokens  || llmResult.usage?.promptTokens     || 0),
          outputTokens: Number(llmResult.usage?.output_tokens || llmResult.usage?.outputTokens || llmResult.usage?.completionTokens || 0),
          userEmail: requested_by_email,
        });
      } catch (e) {
        logger.warn('Token usage record failed (non-fatal)', { request_id, error: e.message });
      }
      return { ok: true };
    });

    /* ── Step 5: parse JSON + normalise findings ─────────────────── */

    const parsed = await step.run('parse-and-normalise', async () => {
      await updateStatus('running', 'Parsing analysis output…');
      const cleaned = llmResult.rawContent
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      let analysis;
      try { analysis = JSON.parse(cleaned); }
      catch (e) {
        throw new Error(`Analysis returned an unexpected format: ${e.message}`);
      }
      const bundle = normaliseFindings(analysis);
      // Strip in-memory verifier crumbs before persistence.
      for (const f of bundle.findings) delete f._originalEvidenceCount;
      if (analysis.executiveSummary) delete analysis.executiveSummary._originalEvidenceCount;
      return { analysis, bundle };
    });

    /* ── Step 6: verify evidence ─────────────────────────────────── */

    const verified = await step.run('verify-evidence', async () => {
      await updateStatus('running', 'Validating citations…');
      const { analysis, bundle } = parsed;
      const chunkIds = new Set();
      const collect = (f) => {
        for (const ev of (f.evidence || [])) {
          if (ev.kind === 'document_chunk' && ev?.ref?.chunk_id) chunkIds.add(ev.ref.chunk_id);
        }
      };
      for (const f of bundle.findings) collect(f);
      if (analysis.executiveSummary?.evidence) collect(analysis.executiveSummary);

      const chunkIndex = new Map();
      if (chunkIds.size > 0) {
        const idsArr = Array.from(chunkIds).slice(0, 100);
        const chunksResp = await fetchWithTimeout(
          `${sb.url}/rest/v1/deal_document_chunks?id=in.(${idsArr.map(encodeURIComponent).join(',')})&select=id,document_id,content`,
          { method: 'GET', headers: getSupabaseHeaders(sb.key) },
        );
        if (chunksResp.ok) {
          for (const r of await chunksResp.json()) chunkIndex.set(r.id, { content: r.content, document_id: r.document_id });
        }
      }
      const stats = verifyEvidence(bundle, chunkIndex);
      if (analysis.executiveSummary) {
        analysis.executiveSummary._originalEvidenceCount = (analysis.executiveSummary.evidence || []).length;
        analysis.executiveSummary = verifyEvidenceForFinding(analysis.executiveSummary, chunkIndex);
        if (analysis.executiveSummary) delete analysis.executiveSummary._originalEvidenceCount;
      }
      // Update the in-memory bundle's perPath onto analysis so the JSONB
      // archive and the persisted findings agree.
      for (const path of Object.keys(bundle.perPath)) analysis[path] = bundle.perPath[path];
      analysis._evidenceStats = stats;
      analysis._findingCount = bundle.findings.length;
      return { analysis, bundle, stats };
    });

    /* ── Step 7: persist analysis result + findings ──────────────── */

    await step.run('persist-result', async () => {
      await updateStatus('running', 'Saving findings…');
      const { analysis, bundle } = verified;

      // Resolve source_flow_ids for the participants whose reports we used
      const reportIds = participants.filter((p) => p.report_id).map((p) => p.report_id);
      let sourceFlowIds = [];
      if (reportIds.length > 0) {
        const flowsResp = await fetchWithTimeout(
          `${sb.url}/rest/v1/deal_flows?deal_id=eq.${deal_id}&report_id=in.(${reportIds.map(encodeURIComponent).join(',')})&select=id,report_id`,
          { method: 'GET', headers: getSupabaseHeaders(sb.key) },
        );
        const flowRows = flowsResp.ok ? await flowsResp.json() : [];
        sourceFlowIds = flowRows.map((f) => f.id);
      }

      // PATCH the existing pending row to populated.
      await fetchWithTimeout(
        `${sb.url}/rest/v1/deal_analyses?id=eq.${analysis_id}`,
        {
          method: 'PATCH',
          headers: { ...getSupabaseWriteHeaders(sb.key), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_flow_ids: sourceFlowIds,
            source_report_ids: reportIds,
            result: analysis,
            status: 'complete',
            progress_message: null,
            error: null,
            completed_at: new Date().toISOString(),
          }),
        },
      );

      // Persist findings to relational table.
      try {
        await persistFindingsForAnalysis({
          analysisId: analysis_id,
          dealId: deal_id,
          bundle,
          executiveSummary: analysis.executiveSummary,
        });
      } catch (e) {
        logger.warn('persistFindingsForAnalysis failed (renderer falls back to JSONB)', { error: e.message });
      }

      // Legacy compat for the PE comparison panel that reads deal.settings.analysis.
      if (mode === 'comparison') {
        const currentSettingsResp = await fetchWithTimeout(
          `${sb.url}/rest/v1/deals?id=eq.${deal_id}&select=settings`,
          { method: 'GET', headers: getSupabaseHeaders(sb.key) },
        );
        const [currentDeal] = currentSettingsResp.ok ? await currentSettingsResp.json() : [];
        const merged = {
          ...(currentDeal?.settings || {}),
          analysis: {
            runAt: new Date().toISOString(),
            mode,
            companiesAnalysed: companyData.map((c) => c.companyName),
            result: analysis,
          },
        };
        await fetchWithTimeout(
          `${sb.url}/rest/v1/deals?id=eq.${deal_id}`,
          {
            method: 'PATCH',
            headers: { ...getSupabaseWriteHeaders(sb.key), 'Content-Type': 'application/json' },
            body: JSON.stringify({ settings: merged }),
          },
        );
      }

      return { ok: true };
    });

    return { ok: true, analysis_id, deal_id, mode };
    } // end runPipeline
  },
);
