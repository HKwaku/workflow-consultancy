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
    return `Process ${i}: "${name}"
- Steps: ${total} total, ${manualSteps} manual (${Math.round(manualSteps/Math.max(total,1)*100)}%)
- Approvals: ${approvals}, Decision points: ${decisions}, Bottlenecks flagged: ${bottlenecks}
- Multi-system steps (re-entry risk): ${multiSystemSteps}
- Systems: ${systems.join(', ') || 'none listed'}
- Departments: ${depts.join(', ') || 'unspecified'}
- Wait/work ratio: ${waitRatio}% (higher = more idle time, more automation opportunity)`;
  }).join('\n\n');

  const systemPrompt = `You are an operations consultant estimating what percentage of labour cost can be eliminated through process automation. Be specific, realistic, and conservative. Consider:
- Manual steps vs automated steps
- Approval gates (often hard to fully automate)
- Decision points (require human judgment — partial automation only)
- Multi-system re-entry (strong automation candidate)
- High wait/work ratios (scheduling/notification automation)
- Industry norms: simple data entry processes 40-60%, approval-heavy processes 20-35%, complex decision processes 10-25%

Respond ONLY with a JSON array, no markdown, no explanation outside JSON:
[{"processIndex":0,"savingsPct":35,"reasoning":"One sentence explaining the key drivers","confidence":"high|medium|low"}]`;

  const userPrompt = `Estimate automation labour savings % for each process:\n\n${processDescriptions}`;

  try {
    const model = getFastModel({ temperature: 0 });
    const response = await model.invoke([new SystemMessage(systemPrompt), new HumanMessage(userPrompt)]);
    let content = response.content;
    if (Array.isArray(content)) {
      content = content.filter(b => b?.type === 'text').map(b => b.text).join('');
    }
    const text = String(content || '').trim();

    // Extract JSON array from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array in response');
    const suggestions = JSON.parse(jsonMatch[0]);

    if (!Array.isArray(suggestions)) throw new Error('Invalid response format');

    const validated = suggestions.map(s => ({
      processIndex: typeof s.processIndex === 'number' ? s.processIndex : 0,
      savingsPct: Math.min(80, Math.max(5, Math.round(s.savingsPct || 25))),
      reasoning: typeof s.reasoning === 'string' ? s.reasoning.slice(0, 300) : '',
      confidence: ['high', 'medium', 'low'].includes(s.confidence) ? s.confidence : 'medium',
    }));

    return NextResponse.json({ success: true, suggestions: validated });
  } catch (e) {
    logger.error('Suggest savings AI error', { requestId: getRequestId(request), error: e.message });
    return NextResponse.json({ error: 'AI estimation failed. Use manual entry.' }, { status: 500 });
  }
}
