import { NextResponse } from 'next/server';
import { getSupabaseHeaders, requireSupabase, fetchWithTimeout, checkOrigin, getRequestId, isValidUUID } from '@/lib/api-helpers';
import { verifySupabaseSession } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { getFastModel } from '@/lib/agents/models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

export async function POST(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'AI not configured.' }, { status: 503 });
  }

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  const { reportId, token } = body;
  if (!reportId || !isValidUUID(reportId)) return NextResponse.json({ error: 'Valid report ID required.' }, { status: 400 });

  const sbConfig = requireSupabase();
  if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const { url: supabaseUrl, key: supabaseKey } = sbConfig;

  const sbResp = await fetchWithTimeout(
    `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}&select=id,contact_email,diagnostic_data`,
    { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
  );
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
    return NextResponse.json({ error: 'Access denied.' }, { status: 403 });
  }

  const rawProcesses = dd.rawProcesses || dd.processes || [];

  const processDescriptions = rawProcesses.map((raw, i) => {
    const steps = raw.steps || [];
    const name = raw.processName || raw.name || `Process ${i + 1}`;
    const total = steps.length;
    const manualSteps = steps.filter(s => !s.isAutomated).length;
    const approvals = steps.filter(s => s.isApproval).length;
    const decisions = steps.filter(s => s.isDecision && (s.branches || []).length > 0).length;
    const bottlenecks = steps.filter(s => s.isBottleneck).length;
    const multiSystemSteps = steps.filter(s => (s.systems || []).length >= 2).length;
    const systems = [...new Set(steps.flatMap(s => s.systems || []).filter(Boolean))];
    const depts = [...new Set(steps.map(s => s.department).filter(Boolean))];
    const totalWork = steps.reduce((sum, s) => sum + (s.workMinutes ?? 0), 0);
    const totalWait = steps.reduce((sum, s) => sum + (s.waitMinutes ?? 0), 0);
    const waitRatio = totalWork > 0 ? Math.round(totalWait / totalWork * 100) : 0;
    const costs = raw.costs || {};
    const hoursPerInstance = costs.hoursPerInstance ?? 4;
    const annual = costs.annual ?? (raw.frequency?.annual ?? 12);
    const teamSize = costs.teamSize ?? 1;
    const bottleneckReason = raw.bottleneck?.reason || '';
    return `Process ${i}: "${name}"
- Steps: ${total} total, ${manualSteps} manual (${Math.round(manualSteps / Math.max(total, 1) * 100)}%)
- Approvals: ${approvals}, Decision points: ${decisions}, Bottlenecks flagged: ${bottlenecks}
- Multi-system re-entry steps: ${multiSystemSteps}
- Systems: ${systems.join(', ') || 'none'}
- Departments: ${depts.join(', ') || 'unspecified'} (${depts.length} team${depts.length !== 1 ? 's' : ''})
- Wait/work ratio: ${waitRatio}% (higher = more idle time = more automation opportunity)
- Volume: ${hoursPerInstance}h/instance × ${annual}/yr × ${teamSize} people
- Primary bottleneck: ${bottleneckReason || 'unspecified'}`;
  }).join('\n\n');

  const systemPrompt = `You are a senior operations consultant specialising in process automation ROI. Analyse each process and provide realistic savings estimates across three scenarios.

Scenario definitions:
- Conservative: high-confidence floor — achievable even if scope is reduced or execution faces delays
- Base: expected outcome for a well-scoped, competently executed automation project
- Optimistic: achievable with full commitment, clean data, modern tooling, and no major surprises

Benchmark ranges by process type (% of total process cost eliminable):
- Simple data entry / form routing: conservative 30%, base 48%, optimistic 65%
- Approval workflows (rule-based criteria): conservative 25%, base 38%, optimistic 55%
- Multi-system re-entry (no existing APIs): conservative 28%, base 44%, optimistic 60%
- Complex decision / exception-heavy processes: conservative 8%, base 18%, optimistic 28%
- Notification / scheduling / reminder processes: conservative 40%, base 60%, optimistic 75%
- Compliance / audit / reporting processes: conservative 15%, base 25%, optimistic 38%

Hidden cost flags to identify (these inflate true process cost beyond direct labour):
- "high wait ratio" — idle time in queue represents real cost not captured in step duration
- "multi-system re-entry" — manual transcription creates error/rework cost
- "cross-department handoffs" — coordination overhead and delay cost
- "approval bottleneck" — SLA risk and exception-handling overhead
- "manual reconciliation" — error correction cost is significant
- "unclear ownership" — rework and delay from ambiguity add hidden cost

automationApproach: write one specific, technical description of the primary automation method (e.g. "Power Automate + SharePoint approval workflow replacing email chain", "Zapier integration between CRM and accounting system with auto-notifications", "Custom API integration + rules engine + automated status updates")

implementationComplexity:
- "low": achievable in weeks with off-the-shelf tools, no custom development required
- "medium": 1–3 months, configuration-heavy, possibly one custom integration build
- "high": 3+ months, custom development required, multiple system integrations, significant change management

Respond ONLY with a valid JSON array — no markdown, no text outside the array:
[{"processIndex":0,"conservativePct":22,"savingsPct":35,"optimisticPct":52,"reasoning":"One sentence on the primary savings driver and key constraint","confidence":"high|medium|low","automationApproach":"Specific technical description","implementationComplexity":"low|medium|high","hiddenCostFlags":["flag1","flag2"]}]`;

  const userPrompt = `Estimate automation savings across three scenarios for each process:\n\n${processDescriptions}`;

  try {
    const model = getFastModel({ temperature: 0 });
    const response = await model.invoke([new SystemMessage(systemPrompt), new HumanMessage(userPrompt)]);
    let content = response.content;
    if (Array.isArray(content)) {
      content = content.filter(b => b?.type === 'text').map(b => b.text).join('');
    }
    const text = String(content || '').trim();

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array in response');
    const suggestions = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(suggestions)) throw new Error('Invalid response format');

    const validated = suggestions.map(s => {
      const base = Math.min(80, Math.max(5, Math.round(s.savingsPct || 25)));
      return {
        processIndex: typeof s.processIndex === 'number' ? s.processIndex : 0,
        conservativePct: Math.min(75, Math.max(5, Math.round(s.conservativePct || Math.round(base * 0.65)))),
        savingsPct: base,
        optimisticPct: Math.min(90, Math.max(10, Math.round(s.optimisticPct || Math.round(base * 1.4)))),
        reasoning: typeof s.reasoning === 'string' ? s.reasoning.slice(0, 400) : '',
        confidence: ['high', 'medium', 'low'].includes(s.confidence) ? s.confidence : 'medium',
        automationApproach: typeof s.automationApproach === 'string' ? s.automationApproach.slice(0, 250) : '',
        implementationComplexity: ['low', 'medium', 'high'].includes(s.implementationComplexity) ? s.implementationComplexity : 'medium',
        hiddenCostFlags: Array.isArray(s.hiddenCostFlags) ? s.hiddenCostFlags.slice(0, 4).map(f => String(f).slice(0, 80)) : [],
      };
    });

    return NextResponse.json({ success: true, suggestions: validated });
  } catch (e) {
    logger.error('Suggest savings AI error', { requestId: getRequestId(request), error: e.message });
    return NextResponse.json({ error: 'AI estimation failed. Use manual entry.' }, { status: 500 });
  }
}
