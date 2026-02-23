import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, stripEmDashes, requireSupabase } from '@/lib/api-helpers';

export async function POST(request) {
  const body = await request.json();
  const sp = request.nextUrl.searchParams;
  const action = sp.get('action') || '';

  switch (action) {
    case 'create': return createTeam(body, request);
    case 'submit': return submitResponse(body);
    case 'analyze': return analyzeGaps(body);
    default: return NextResponse.json({ error: 'Missing or invalid action. Use ?action=create, ?action=submit, or ?action=analyze' }, { status: 400 });
  }
}

export async function GET(request) {
  const sp = request.nextUrl.searchParams;
  const action = sp.get('action') || 'results';
  if (action === 'results') return getResults(request);
  return NextResponse.json({ error: 'Use ?action=results&code=xxx' }, { status: 400 });
}

async function createTeam(body, request) {
  try {
    const { createdByEmail, createdByName, processName, company, description } = body;
    if (!processName) return NextResponse.json({ error: 'Process name is required.' }, { status: 400 });

    const sbConfig = requireSupabase();
    if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;

    const teamId = crypto.randomUUID();
    const teamCode = crypto.randomBytes(3).toString('hex').toUpperCase();
    const proto = request.headers.get('x-forwarded-proto') || 'https';
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3000';
    const joinUrl = `${proto}://${host}/diagnostic?team=${teamCode}`;
    const resultsUrl = `${proto}://${host}/team-results?code=${teamCode}`;

    const payload = { id: teamId, team_code: teamCode, created_by_email: createdByEmail || null, created_by_name: createdByName || null, process_name: processName, company: company || null, description: description || null, status: 'open', created_at: new Date().toISOString() };
    const sbResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/team_diagnostics`, { method: 'POST', headers: getSupabaseWriteHeaders(supabaseKey), body: JSON.stringify(payload) });
    if (!sbResp.ok && sbResp.status !== 201) return NextResponse.json({ error: 'Failed to create team diagnostic.' }, { status: 502 });

    return NextResponse.json({ success: true, teamId, teamCode, joinUrl, resultsUrl, processName, message: `Team diagnostic created. Share code ${teamCode} with your team.` });
  } catch (error) {
    console.error('Create team diagnostic error:', error);
    return NextResponse.json({ error: 'Failed to create team diagnostic.' }, { status: 500 });
  }
}

async function submitResponse(body) {
  try {
    const { teamCode, respondentName, respondentEmail, respondentDepartment, responseData } = body;
    if (!teamCode) return NextResponse.json({ error: 'Team code is required.' }, { status: 400 });
    if (!respondentName) return NextResponse.json({ error: 'Your name is required.' }, { status: 400 });
    if (!responseData) return NextResponse.json({ error: 'Response data is required.' }, { status: 400 });

    const sbConfig = requireSupabase();
    if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;

    const lookupUrl = `${supabaseUrl}/rest/v1/team_diagnostics?team_code=eq.${encodeURIComponent(teamCode)}&select=id,process_name,status`;
    const lookupResp = await fetchWithTimeout(lookupUrl, { method: 'GET', headers: getSupabaseHeaders(supabaseKey) });
    const teams = await lookupResp.json();
    if (!teams || teams.length === 0) return NextResponse.json({ error: 'Team diagnostic not found.' }, { status: 404 });
    const team = teams[0];
    if (team.status === 'closed') return NextResponse.json({ error: 'This team diagnostic is closed.' }, { status: 400 });

    const responseId = crypto.randomUUID();
    const payload = { id: responseId, team_id: team.id, team_code: teamCode, respondent_name: respondentName, respondent_email: respondentEmail || null, respondent_department: respondentDepartment || null, response_data: responseData, created_at: new Date().toISOString() };
    const sbResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/team_responses`, { method: 'POST', headers: getSupabaseWriteHeaders(supabaseKey), body: JSON.stringify(payload) });
    if (!sbResp.ok && sbResp.status !== 201) return NextResponse.json({ error: 'Failed to submit response.' }, { status: 502 });

    return NextResponse.json({ success: true, responseId, processName: team.process_name, message: 'Your perspective has been submitted.' });
  } catch (error) {
    console.error('Submit team response error:', error);
    return NextResponse.json({ error: 'Failed to submit response.' }, { status: 500 });
  }
}

async function getResults(request) {
  try {
    const code = request.nextUrl.searchParams.get('code');
    if (!code) return NextResponse.json({ error: 'Team code is required. Use ?action=results&code=xxx' }, { status: 400 });

    const sbConfig = requireSupabase();
    if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;

    const sbHeaders = getSupabaseHeaders(supabaseKey);
    const teamResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/team_diagnostics?team_code=eq.${encodeURIComponent(code)}&select=*`, { method: 'GET', headers: sbHeaders });
    const teams = await teamResp.json();
    if (!teams || teams.length === 0) return NextResponse.json({ error: 'Team diagnostic not found.' }, { status: 404 });
    const team = teams[0];

    const respResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/team_responses?team_code=eq.${encodeURIComponent(code)}&select=*&order=created_at.asc`, { method: 'GET', headers: sbHeaders });
    const responses = await respResp.json();
    if (!responses || responses.length === 0) return NextResponse.json({ success: true, team: { id: team.id, processName: team.process_name, company: team.company, status: team.status, createdAt: team.created_at }, responseCount: 0, responses: [], aggregation: null });

    const individuals = responses.map(r => {
      const d = r.response_data || {};
      const m = d.metrics || {};
      const p = d.processData || d;
      const hasDirectMetrics = m.elapsedDays !== undefined || m.stepsCount !== undefined;
      return {
        id: r.id, name: r.respondent_name, email: r.respondent_email, department: r.respondent_department, createdAt: r.created_at, responseData: d,
        metrics: {
          elapsedDays: hasDirectMetrics ? (m.elapsedDays || 0) : (p.lastExample?.elapsedDays || 0),
          stepsCount: hasDirectMetrics ? (m.stepsCount || (p.steps || []).length) : (p.steps || []).length,
          handoffCount: hasDirectMetrics ? (m.handoffCount || 0) : (p.handoffs || []).length,
          poorHandoffs: hasDirectMetrics ? (m.poorHandoffs || 0) : (p.handoffs || []).filter(h => h.clarity === 'yes-multiple' || h.clarity === 'yes-major').length,
          performance: hasDirectMetrics ? (m.performance || '') : (p.performance || ''),
          issues: hasDirectMetrics ? (d.issues || m.issues || []) : (p.issues || []),
          biggestDelay: hasDirectMetrics ? (m.biggestDelay || '') : (p.biggestDelay || ''),
          bottleneck: hasDirectMetrics ? (m.bottleneck || '') : (p.bottleneck?.name || ''),
          totalUserHours: hasDirectMetrics ? (m.totalUserHours || 0) : (p.userTime?.total || 0)
        }
      };
    });

    const nums = (key) => individuals.map(i => i.metrics[key]).filter(v => typeof v === 'number' && v > 0);
    const avg = (arr) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
    const spread = (arr) => arr.length > 1 ? Math.max(...arr) - Math.min(...arr) : 0;
    const safeMin = (arr) => arr.length > 0 ? Math.min(...arr) : 0;
    const safeMax = (arr) => arr.length > 0 ? Math.max(...arr) : 0;

    const elapsedDaysArr = nums('elapsedDays'), stepsArr = nums('stepsCount'), handoffArr = nums('handoffCount'), hoursArr = nums('totalUserHours');
    const gaps = [];

    if (spread(elapsedDaysArr) > 5) gaps.push({ metric: 'Cycle Time', severity: spread(elapsedDaysArr) > 14 ? 'high' : 'medium', detail: `Range: ${safeMin(elapsedDaysArr)} to ${safeMax(elapsedDaysArr)} days` });
    if (spread(stepsArr) > 3) gaps.push({ metric: 'Process Steps', severity: spread(stepsArr) > 8 ? 'high' : 'medium', detail: `Range: ${safeMin(stepsArr)} to ${safeMax(stepsArr)} steps` });
    if (spread(handoffArr) > 3) gaps.push({ metric: 'Handoff Count', severity: spread(handoffArr) > 8 ? 'high' : 'medium', detail: `Range: ${safeMin(handoffArr)} to ${safeMax(handoffArr)}` });

    const aggregation = {
      elapsedDays: { avg: avg(elapsedDaysArr), min: safeMin(elapsedDaysArr), max: safeMax(elapsedDaysArr), spread: spread(elapsedDaysArr) },
      steps: { avg: avg(stepsArr), min: safeMin(stepsArr), max: safeMax(stepsArr), spread: spread(stepsArr) },
      handoffs: { avg: avg(handoffArr), min: safeMin(handoffArr), max: safeMax(handoffArr) },
      totalHours: { avg: avg(hoursArr), min: safeMin(hoursArr), max: safeMax(hoursArr) },
      perceptionGaps: gaps,
      consensusScore: Math.max(0, 100 - (gaps.filter(g => g.severity === 'high').length * 25) - (gaps.filter(g => g.severity === 'medium').length * 10))
    };

    return NextResponse.json({ success: true, team: { id: team.id, processName: team.process_name, company: team.company, description: team.description, status: team.status, createdAt: team.created_at, createdBy: team.created_by_name }, responseCount: individuals.length, responses: individuals, aggregation });
  } catch (error) {
    console.error('Get team results error:', error);
    return NextResponse.json({ error: 'Failed to retrieve team results.' }, { status: 500 });
  }
}

async function analyzeGaps(body) {
  try {
    const { team, responses, aggregation } = body;
    if (!responses || responses.length < 2 || !aggregation) return NextResponse.json({ error: 'Need at least 2 responses and aggregation data.' }, { status: 400 });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ success: true, analysisType: 'rule-based', analysis: buildRuleBasedAnalysis(team, responses, aggregation) });

    const respondentSummaries = responses.map(r => `- ${r.name} (${r.department}): ${r.metrics.stepsCount} steps, ${r.metrics.elapsedDays} days, ${r.metrics.handoffCount} handoffs`).join('\n');
    const prompt = `Analyse this TEAM diagnostic where ${responses.length} people described the SAME process "${team.processName || 'Unknown'}". Consensus score: ${aggregation.consensusScore}%.\n\nPerspectives:\n${respondentSummaries}\n\nReturn JSON: { "executiveSummary": "...", "rootCauses": [...], "hiddenInefficiencies": [...], "recommendations": [...], "alignmentActions": [...] }`;

    const claudeResp = await fetchWithTimeout('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 4000, temperature: 0.5, messages: [{ role: 'user', content: prompt }] }) });
    if (!claudeResp.ok) return NextResponse.json({ success: true, analysisType: 'rule-based', analysis: buildRuleBasedAnalysis(team, responses, aggregation) });

    const claudeData = await claudeResp.json();
    const text = claudeData.content?.[0]?.text || '';
    let analysis;
    try { analysis = stripEmDashes(JSON.parse(text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim())); }
    catch { return NextResponse.json({ success: true, analysisType: 'rule-based', analysis: buildRuleBasedAnalysis(team, responses, aggregation) }); }

    return NextResponse.json({ success: true, analysisType: 'ai-enhanced', analysis });
  } catch (error) {
    console.error('Analyze gaps error:', error);
    return NextResponse.json({ error: 'Analysis failed.' }, { status: 500 });
  }
}

function buildRuleBasedAnalysis(team, responses, aggregation) {
  return {
    executiveSummary: `The team shows ${aggregation.consensusScore >= 50 ? 'partial' : 'significant'} misalignment on "${team.processName}".`,
    rootCauses: [],
    hiddenInefficiencies: [{ title: 'Shadow processes', insight: 'Different step counts suggest undocumented workarounds.' }],
    recommendations: [{ priority: 1, action: 'Run a cross-departmental process mapping workshop', impact: 'Align on actual steps and ownership', owner: 'Operations', timeframe: 'quick-win' }],
    alignmentActions: ['Schedule a 90-minute cross-departmental review session']
  };
}
