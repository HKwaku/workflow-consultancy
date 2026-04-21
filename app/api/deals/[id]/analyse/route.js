import { NextResponse } from 'next/server';
import { getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase, checkOrigin, getRequestId } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { getChatModel } from '@/lib/agents/models';
import { withRetry } from '@/lib/ai-retry';
import { logger } from '@/lib/logger';

export const maxDuration = 120;

/**
 * POST /api/deals/[id]/analyse
 * Owner only. Runs cross-company AI analysis for a PE roll-up deal.
 * Requires all participants to have completed their process maps.
 * Streams SSE: progress events → done event with structured analysis.
 * Saves result to deals.settings.analysis.
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
          `${supabaseUrl}/rest/v1/deals?id=eq.${encodeURIComponent(id)}&select=id,type,name,process_name,owner_email,status,settings`,
          { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
        );
        const [deal] = dealResp.ok ? await dealResp.json() : [];
        if (!deal) { send('error', { error: 'Deal not found.' }); return; }
        if (deal.owner_email !== auth.email) { send('error', { error: 'Only the deal owner can run analysis.' }); return; }
        if (deal.type !== 'pe_rollup') { send('error', { error: 'Analysis is only available for PE roll-up deals.' }); return; }

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

        send('progress', { message: 'Comparing process maps across companies…' });

        // 4. Build AI prompt
        const processName = deal.process_name || companyData[0]?.processName || 'the process';
        const companySections = companyData.map((c) => {
          const stepList = c.steps.map((s, i) =>
            `  ${i + 1}. ${s.name}${s.department ? ` [${s.department}]` : ''}${s.isDecision ? ' [DECISION POINT]' : ''}${s.isExternal ? ' [EXTERNAL]' : ''}`
          ).join('\n');
          return `Company: ${c.companyName}\nRole: ${c.role}\nSteps (${c.steps.length}):\n${stepList}`;
        }).join('\n\n---\n\n');

        const systemPrompt = `You are a process excellence consultant for a private equity firm. You compare process maps from portfolio companies to identify standardisation, consolidation, and efficiency opportunities. Your analysis must be data-driven, specific, and actionable. Output only valid JSON.`;

        const userPrompt = `Deal: ${deal.name}
Process being mapped: ${processName}
Number of companies: ${companyData.length}

Process maps:

${companySections}

Analyse these process maps across all ${companyData.length} companies. Identify:
1. Steps that appear across multiple or all companies (standardisation candidates)
2. Steps unique to individual companies (review for necessity)
3. Specific recommendations for consolidating into a single standard process
4. A proposed standard process the PE portfolio should adopt

Return ONLY this JSON with no markdown fences, no commentary before or after:
{
  "summary": "2-3 sentence executive summary of the key findings and opportunity",
  "commonSteps": [
    {
      "name": "descriptive step name",
      "presentAt": ["Company A", "Company B"],
      "presentAtAll": true,
      "departments": ["Finance"],
      "varianceNote": "how this step differs between companies, or empty string if identical"
    }
  ],
  "uniqueSteps": [
    {
      "name": "step name",
      "companyName": "Company A",
      "recommendation": "keep",
      "reason": "brief reason this step is unique and what to do with it"
    }
  ],
  "mergeRecommendations": [
    {
      "finding": "clear description of the standardisation opportunity",
      "affectedSteps": ["step name 1", "step name 2"],
      "action": "specific, concrete action to take",
      "estimatedSavingPct": 15
    }
  ],
  "proposedProcess": [
    {
      "stepNumber": 1,
      "name": "step name",
      "source": "common",
      "department": "Finance",
      "notes": "standardisation or implementation note"
    }
  ]
}

recommendation values must be one of: keep, review, remove
source values must be the company name or "common" or "merged"`;

        send('progress', { message: 'Running AI analysis — comparing step patterns…' });

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

        // 7. Persist to deal.settings.analysis
        const currentSettingsResp = await fetchWithTimeout(
          `${supabaseUrl}/rest/v1/deals?id=eq.${encodeURIComponent(id)}&select=settings`,
          { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
        );
        const [currentDeal] = currentSettingsResp.ok ? await currentSettingsResp.json() : [];
        const mergedSettings = {
          ...(currentDeal?.settings || {}),
          analysis: {
            runAt: new Date().toISOString(),
            companiesAnalysed: companyData.map((c) => c.companyName),
            result: analysis,
          },
        };

        await fetchWithTimeout(
          `${supabaseUrl}/rest/v1/deals?id=eq.${encodeURIComponent(id)}`,
          {
            method: 'PATCH',
            headers: getSupabaseWriteHeaders(supabaseKey),
            body: JSON.stringify({ settings: mergedSettings }),
          }
        ).catch((e) => logger.warn('Failed to persist deal analysis', { requestId: reqId, error: e.message }));

        send('done', {
          success: true,
          analysis: mergedSettings.analysis,
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
