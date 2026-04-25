import { NextResponse } from 'next/server';
import { getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase, checkOrigin, getRequestId } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { getChatModel } from '@/lib/agents/models';
import { withRetry } from '@/lib/ai-retry';
import { logger } from '@/lib/logger';
import { buildAnalysisPrompt } from '@/lib/deal-analysis/prompts';

export const maxDuration = 120;

const SUPPORTED_MODES = new Set(['comparison', 'synergy', 'redesign']);

/**
 * POST /api/deals/[id]/analyse
 * Owner or collaborator only. Runs cross-company AI analysis for a PE roll-up
 * deal. Requires all participants to have completed their process maps.
 * Streams SSE: progress events → done event with structured analysis.
 *
 * Body: { mode?: 'comparison' | 'synergy' }  - default 'comparison'
 * Writes a row to deal_analyses with the selected mode, plus a legacy copy
 * to deals.settings.analysis for the comparison mode (backward compat).
 */
export async function POST(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Deal ID required.' }, { status: 400 });

  // Parse mode from body (optional). Must be done before streaming starts.
  let mode = 'comparison';
  try {
    const body = await request.json();
    if (body && typeof body.mode === 'string' && SUPPORTED_MODES.has(body.mode)) {
      mode = body.mode;
    }
  } catch { /* no body / not JSON is fine - default to comparison */ }

  const sbConfig = requireSupabase();
  if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const { url: supabaseUrl, key: supabaseKey } = sbConfig;

  const reqId = getRequestId(request);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, data) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { /* client disconnected */ }
      };

      try {
        send('progress', { message: 'Loading deal data…' });

        // 1. Fetch deal
        const dealResp = await fetchWithTimeout(
          `${supabaseUrl}/rest/v1/deals?id=eq.${encodeURIComponent(id)}&select=id,type,name,process_name,owner_email,collaborator_emails,status,settings`,
          { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
        );
        const [deal] = dealResp.ok ? await dealResp.json() : [];
        if (!deal) { send('error', { error: 'Deal not found.' }); return; }
        const isEditor = deal.owner_email === auth.email
          || (Array.isArray(deal.collaborator_emails) && deal.collaborator_emails.some((e) => typeof e === 'string' && e.toLowerCase() === auth.email.toLowerCase()));
        if (!isEditor) { send('error', { error: 'Only the deal owner or a collaborator can run analysis.' }); return; }

        // 2. Fetch participants
        const partResp = await fetchWithTimeout(
          `${supabaseUrl}/rest/v1/deal_participants?deal_id=eq.${id}&select=id,role,company_name,status,report_id&order=created_at.asc`,
          { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
        );
        const participants = partResp.ok ? await partResp.json() : [];

        const incomplete = participants.filter((p) => p.status !== 'complete' || !p.report_id);
        if (incomplete.length > 0) {
          const names = incomplete.map((p) => p.company_name).join(', ');
          send('error', { error: `Not all companies have completed their process map. Waiting on: ${names}` });
          return;
        }
        if (participants.length < 2) {
          send('error', { error: 'At least 2 companies must have completed their process maps.' });
          return;
        }

        send('progress', { message: `Fetching process maps from ${participants.length} companies…` });

        // 3. Fetch rawProcesses for each participant's report
        const reportIds = participants.map((p) => p.report_id);
        const reportsResp = await fetchWithTimeout(
          `${supabaseUrl}/rest/v1/diagnostic_reports?id=in.(${reportIds.map(encodeURIComponent).join(',')})&select=id,diagnostic_data`,
          { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
        );
        const reports = reportsResp.ok ? await reportsResp.json() : [];

        // Build company → steps map
        const companyData = participants.map((p) => {
          const report = reports.find((r) => r.id === p.report_id);
          const dd = report?.diagnostic_data || {};
          const rawProcess = (dd.rawProcesses || [])[0] || {};
          const steps = (rawProcess.steps || []).slice(0, 100).map((s) => ({
            name: s.name || '',
            department: s.department || '',
            isDecision: !!s.isDecision,
            isExternal: !!s.isExternal,
          }));
          return {
            companyName: p.company_name,
            role: p.role,
            processName: rawProcess.processName || deal.process_name || 'Process',
            stepCount: steps.length,
            steps,
          };
        });

        const hasSteps = companyData.every((c) => c.steps.length > 0);
        if (!hasSteps) {
          send('error', { error: 'One or more companies have no step data in their process map. Ensure all reports include detailed process steps.' });
          return;
        }

        send('progress', {
          message: mode === 'synergy' ? 'Quantifying integration synergies…'
            : mode === 'redesign' ? 'Designing the unified target process…'
            : 'Comparing process maps across companies…',
        });

        // 4. Build AI prompt (mode-specific)
        const { systemPrompt, userPrompt } = buildAnalysisPrompt({
          mode,
          deal,
          companyData,
        });

        send('progress', {
          message: mode === 'synergy' ? 'Running AI analysis - estimating overlap and consolidation savings…'
            : mode === 'redesign' ? 'Running AI analysis - building the unified target process…'
            : 'Running AI analysis - comparing step patterns…',
        });

        // 5. Call Claude
        const model = getChatModel({ maxTokens: 8192, temperature: 0 });
        let rawContent;
        try {
          const response = await withRetry(
            () => model.invoke([
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ]),
            { maxAttempts: 2, baseDelayMs: 2000, label: 'PE deal analysis', logger }
          );
          rawContent = typeof response.content === 'string'
            ? response.content
            : response.content?.[0]?.text || '';
        } catch (aiErr) {
          logger.error('PE deal AI analysis failed', { requestId: reqId, error: aiErr.message });
          send('error', { error: 'AI analysis failed. Please try again.' });
          return;
        }

        // 6. Parse JSON (strip markdown fences if present)
        let analysis;
        try {
          const cleaned = rawContent
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/```\s*$/i, '')
            .trim();
          analysis = JSON.parse(cleaned);
        } catch (parseErr) {
          logger.error('PE deal AI analysis JSON parse failed', { requestId: reqId, error: parseErr.message, raw: rawContent.slice(0, 500) });
          send('error', { error: 'Analysis returned an unexpected format. Please try again.' });
          return;
        }

        send('progress', { message: 'Saving analysis…' });

        const runAt = new Date().toISOString();

        // 7a. Persist to deal_analyses table (authoritative history). The table
        // is keyed per-deal with mode/status/result, so multiple runs are kept.
        // If the migration hasn't been applied the insert will 4xx - we log and
        // fall through so the analysis still renders from settings.analysis.
        try {
          // Resolve source deal_flows for the participants whose reports we just analysed
          const flowsResp = await fetchWithTimeout(
            `${supabaseUrl}/rest/v1/deal_flows?deal_id=eq.${encodeURIComponent(id)}&report_id=in.(${reportIds.map(encodeURIComponent).join(',')})&select=id,report_id`,
            { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
          );
          const flowRows = flowsResp.ok ? await flowsResp.json() : [];
          const sourceFlowIds = flowRows.map((f) => f.id);

          const analysisRow = {
            deal_id: id,
            mode,
            name: null,
            source_flow_ids: sourceFlowIds,
            source_report_ids: reportIds,
            status: 'complete',
            result: analysis,
            created_by_email: auth.email,
            completed_at: runAt,
          };
          const analysisResp = await fetchWithTimeout(
            `${supabaseUrl}/rest/v1/deal_analyses`,
            {
              method: 'POST',
              headers: { ...getSupabaseWriteHeaders(supabaseKey), Prefer: 'return=minimal' },
              body: JSON.stringify(analysisRow),
            }
          );
          if (!analysisResp.ok && analysisResp.status !== 201 && analysisResp.status !== 204) {
            const txt = await analysisResp.text().catch(() => '');
            logger.warn('Failed to insert deal_analyses row', { requestId: reqId, status: analysisResp.status, body: txt.slice(0, 300) });
          }
        } catch (e) {
          logger.warn('deal_analyses insert errored', { requestId: reqId, error: e.message });
        }

        // 7b. Keep the legacy settings.analysis copy for the current UI - the
        // PE panel reads `deal.settings.analysis` to render the latest
        // comparison result. For other modes the history endpoint is the
        // source of truth; don't clobber the legacy comparison snapshot.
        const latestPayload = {
          runAt,
          mode,
          companiesAnalysed: companyData.map((c) => c.companyName),
          result: analysis,
        };

        if (mode === 'comparison') {
          const currentSettingsResp = await fetchWithTimeout(
            `${supabaseUrl}/rest/v1/deals?id=eq.${encodeURIComponent(id)}&select=settings`,
            { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
          );
          const [currentDeal] = currentSettingsResp.ok ? await currentSettingsResp.json() : [];
          const mergedSettings = {
            ...(currentDeal?.settings || {}),
            analysis: latestPayload,
          };

          await fetchWithTimeout(
            `${supabaseUrl}/rest/v1/deals?id=eq.${encodeURIComponent(id)}`,
            {
              method: 'PATCH',
              headers: getSupabaseWriteHeaders(supabaseKey),
              body: JSON.stringify({ settings: mergedSettings }),
            }
          ).catch((e) => logger.warn('Failed to persist deal analysis', { requestId: reqId, error: e.message }));
        }

        send('done', {
          success: true,
          analysis: latestPayload,
        });
      } catch (err) {
        logger.error('Deal analysis stream error', { requestId: reqId, error: err.message, stack: err.stack });
        send('error', { error: 'Analysis failed. Please try again.' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
