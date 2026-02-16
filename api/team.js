// api/team.js
// Consolidated endpoint for team diagnostics
// Routes by query param ?action=create|submit|results|analyze
// Combines former create-team-diagnostic.js, submit-team-response.js, get-team-results.js

const crypto = require('crypto');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = req.query.action || (req.method === 'GET' ? 'results' : '');

  switch (action) {
    case 'create':  return createTeam(req, res);
    case 'submit':  return submitResponse(req, res);
    case 'results': return getResults(req, res);
    case 'analyze': return analyzeGaps(req, res);
    default:
      return res.status(400).json({ error: 'Missing or invalid action. Use ?action=create, ?action=submit, ?action=results, or ?action=analyze' });
  }
};


// ── POST ?action=create ─────────────────────────────────────────
async function createTeam(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { createdByEmail, createdByName, processName, company, description } = req.body;

    if (!processName) {
      return res.status(400).json({ error: 'Process name is required.' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    if (!supabaseUrl || !supabaseKey) return res.status(503).json({ error: 'Storage not configured.' });

    const teamId = crypto.randomUUID();
    const teamCode = crypto.randomBytes(3).toString('hex').toUpperCase();

    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
    const joinUrl = `${protocol}://${host}/diagnostic?team=${teamCode}`;
    const resultsUrl = `${protocol}://${host}/team-results?code=${teamCode}`;

    const payload = {
      id: teamId,
      team_code: teamCode,
      created_by_email: createdByEmail || null,
      created_by_name: createdByName || null,
      process_name: processName,
      company: company || null,
      description: description || null,
      status: 'open',
      created_at: new Date().toISOString()
    };

    const sbResp = await fetch(`${supabaseUrl}/rest/v1/team_diagnostics`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(payload)
    });

    if (!sbResp.ok && sbResp.status !== 201) {
      const errText = await sbResp.text();
      console.error('Supabase insert failed:', sbResp.status, errText);
      return res.status(502).json({ error: 'Failed to create team diagnostic.' });
    }

    return res.status(200).json({
      success: true,
      teamId,
      teamCode,
      joinUrl,
      resultsUrl,
      processName,
      message: `Team diagnostic created. Share code ${teamCode} with your team.`
    });

  } catch (error) {
    console.error('Create team diagnostic error:', error);
    return res.status(500).json({ error: 'Failed to create team diagnostic.' });
  }
}


// ── POST ?action=submit ─────────────────────────────────────────
async function submitResponse(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { teamCode, respondentName, respondentEmail, respondentDepartment, responseData } = req.body;

    if (!teamCode) return res.status(400).json({ error: 'Team code is required.' });
    if (!respondentName) return res.status(400).json({ error: 'Your name is required.' });
    if (!responseData) return res.status(400).json({ error: 'Response data is required.' });

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    if (!supabaseUrl || !supabaseKey) return res.status(503).json({ error: 'Storage not configured.' });

    const lookupUrl = `${supabaseUrl}/rest/v1/team_diagnostics?team_code=eq.${encodeURIComponent(teamCode)}&select=id,process_name,status`;
    const lookupResp = await fetch(lookupUrl, {
      method: 'GET',
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Accept': 'application/json' }
    });

    const teams = await lookupResp.json();
    if (!teams || teams.length === 0) {
      return res.status(404).json({ error: 'Team diagnostic not found. Check the code and try again.' });
    }

    const team = teams[0];
    if (team.status === 'closed') {
      return res.status(400).json({ error: 'This team diagnostic is closed and no longer accepting responses.' });
    }

    const responseId = crypto.randomUUID();

    const payload = {
      id: responseId,
      team_id: team.id,
      team_code: teamCode,
      respondent_name: respondentName,
      respondent_email: respondentEmail || null,
      respondent_department: respondentDepartment || null,
      response_data: responseData,
      created_at: new Date().toISOString()
    };

    const sbResp = await fetch(`${supabaseUrl}/rest/v1/team_responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(payload)
    });

    if (!sbResp.ok && sbResp.status !== 201) {
      const errText = await sbResp.text();
      console.error('Supabase insert failed:', sbResp.status, errText);
      return res.status(502).json({ error: 'Failed to submit response.' });
    }

    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
    const resultsUrl = `${protocol}://${host}/team-results?code=${teamCode}`;

    return res.status(200).json({
      success: true,
      responseId,
      processName: team.process_name,
      resultsUrl,
      message: 'Your perspective has been submitted. View the team comparison when everyone has responded.'
    });

  } catch (error) {
    console.error('Submit team response error:', error);
    return res.status(500).json({ error: 'Failed to submit response.' });
  }
}


// ── GET ?action=results&code=XXX ────────────────────────────────
async function getResults(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { code } = req.query;

    if (!code) {
      return res.status(400).json({ error: 'Team code is required. Use ?action=results&code=xxx' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    if (!supabaseUrl || !supabaseKey) return res.status(503).json({ error: 'Storage not configured.' });

    const teamUrl = `${supabaseUrl}/rest/v1/team_diagnostics?team_code=eq.${encodeURIComponent(code)}&select=*`;
    const teamResp = await fetch(teamUrl, {
      method: 'GET',
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Accept': 'application/json' }
    });
    const teams = await teamResp.json();

    if (!teams || teams.length === 0) {
      return res.status(404).json({ error: 'Team diagnostic not found.' });
    }
    const team = teams[0];

    const respUrl = `${supabaseUrl}/rest/v1/team_responses?team_code=eq.${encodeURIComponent(code)}&select=*&order=created_at.asc`;
    const respResp = await fetch(respUrl, {
      method: 'GET',
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Accept': 'application/json' }
    });
    const responses = await respResp.json();

    if (!responses || responses.length === 0) {
      return res.status(200).json({
        success: true,
        team: { id: team.id, processName: team.process_name, company: team.company, status: team.status, createdAt: team.created_at },
        responseCount: 0,
        responses: [],
        aggregation: null
      });
    }

    const individuals = responses.map(r => {
      const d = r.response_data || {};
      const p = d.processData || d;

      return {
        id: r.id,
        name: r.respondent_name,
        email: r.respondent_email,
        department: r.respondent_department,
        createdAt: r.created_at,
        metrics: {
          elapsedDays: p.lastExample?.elapsedDays || 0,
          stepsCount: (p.steps || []).length,
          handoffCount: (p.handoffs || []).length,
          poorHandoffs: (p.handoffs || []).filter(h => h.clarity === 'yes-multiple' || h.clarity === 'yes-major').length,
          approvalCount: (p.approvals || []).length,
          systemCount: (p.systems || []).length,
          complexity: p.definition?.complexity || '',
          departments: p.definition?.departments || [],
          performance: p.performance || '',
          issues: p.issues || [],
          biggestDelay: p.biggestDelay || '',
          bottleneck: p.bottleneck?.name || '',
          totalUserHours: p.userTime?.total || 0
        }
      };
    });

    const nums = (key) => individuals.map(i => i.metrics[key]).filter(v => typeof v === 'number' && v > 0);
    const avg = (arr) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
    const spread = (arr) => arr.length > 1 ? Math.max(...arr) - Math.min(...arr) : 0;

    const elapsedDaysArr = nums('elapsedDays');
    const stepsArr = nums('stepsCount');
    const handoffArr = nums('handoffCount');
    const hoursArr = nums('totalUserHours');

    const gaps = [];

    if (spread(elapsedDaysArr) > 5) {
      const byName = individuals.filter(i => i.metrics.elapsedDays > 0)
        .map(i => `${i.name} (${i.department || '?'}): ${i.metrics.elapsedDays} days`);
      gaps.push({
        metric: 'Cycle Time',
        severity: spread(elapsedDaysArr) > 14 ? 'high' : 'medium',
        detail: `Team estimates range from ${Math.min(...elapsedDaysArr)} to ${Math.max(...elapsedDaysArr)} days`,
        byPerson: byName
      });
    }

    if (spread(stepsArr) > 3) {
      const byName = individuals.filter(i => i.metrics.stepsCount > 0)
        .map(i => `${i.name} (${i.department || '?'}): ${i.metrics.stepsCount} steps`);
      gaps.push({
        metric: 'Process Steps',
        severity: spread(stepsArr) > 8 ? 'high' : 'medium',
        detail: `Team sees between ${Math.min(...stepsArr)} and ${Math.max(...stepsArr)} steps`,
        byPerson: byName
      });
    }

    const perfVotes = {};
    individuals.forEach(i => {
      if (i.metrics.performance) {
        perfVotes[i.metrics.performance] = (perfVotes[i.metrics.performance] || 0) + 1;
      }
    });
    if (Object.keys(perfVotes).length > 1) {
      const byName = individuals.filter(i => i.metrics.performance)
        .map(i => `${i.name} (${i.department || '?'}): ${i.metrics.performance}`);
      gaps.push({
        metric: 'Performance Assessment',
        severity: 'medium',
        detail: 'Team disagrees on process performance: ' + Object.entries(perfVotes).map(([k, v]) => `${v}× "${k}"`).join(', '),
        byPerson: byName
      });
    }

    const delays = individuals.filter(i => i.metrics.biggestDelay).map(i => ({
      name: i.name, department: i.department, delay: i.metrics.biggestDelay
    }));
    if (delays.length > 1) {
      const unique = [...new Set(delays.map(d => d.delay.toLowerCase().trim()))];
      if (unique.length > 1) {
        gaps.push({
          metric: 'Biggest Bottleneck',
          severity: 'high',
          detail: 'Team identifies different bottlenecks — this signals the process looks different depending on where you sit',
          byPerson: delays.map(d => `${d.name} (${d.department || '?'}): "${d.delay}"`)
        });
      }
    }

    const issueFreq = {};
    individuals.forEach(i => {
      (i.metrics.issues || []).forEach(issue => {
        issueFreq[issue] = (issueFreq[issue] || 0) + 1;
      });
    });

    const aggregation = {
      elapsedDays: { avg: avg(elapsedDaysArr), min: Math.min(...elapsedDaysArr) || 0, max: Math.max(...elapsedDaysArr) || 0, spread: spread(elapsedDaysArr) },
      steps: { avg: avg(stepsArr), min: Math.min(...stepsArr) || 0, max: Math.max(...stepsArr) || 0, spread: spread(stepsArr) },
      handoffs: { avg: avg(handoffArr), min: Math.min(...handoffArr) || 0, max: Math.max(...handoffArr) || 0 },
      totalHours: { avg: avg(hoursArr), min: Math.min(...hoursArr) || 0, max: Math.max(...hoursArr) || 0 },
      perceptionGaps: gaps,
      issueFrequency: Object.entries(issueFreq).sort((a, b) => b[1] - a[1]).map(([issue, count]) => ({ issue, count, pct: Math.round(count / individuals.length * 100) })),
      consensusScore: Math.max(0, 100 - (gaps.filter(g => g.severity === 'high').length * 25) - (gaps.filter(g => g.severity === 'medium').length * 10))
    };

    return res.status(200).json({
      success: true,
      team: {
        id: team.id,
        processName: team.process_name,
        company: team.company,
        description: team.description,
        status: team.status,
        createdAt: team.created_at,
        createdBy: team.created_by_name
      },
      responseCount: individuals.length,
      responses: individuals,
      aggregation
    });

  } catch (error) {
    console.error('Get team results error:', error);
    return res.status(500).json({ error: 'Failed to retrieve team results.' });
  }
}


// ── POST ?action=analyze ────────────────────────────────────────
// AI-powered perception gap analysis using Claude
async function analyzeGaps(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { team, responses, aggregation } = req.body;

    if (!responses || responses.length < 2 || !aggregation) {
      return res.status(400).json({ error: 'Need at least 2 responses and aggregation data.' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(200).json({
        success: true,
        analysisType: 'rule-based',
        analysis: buildRuleBasedAnalysis(team, responses, aggregation)
      });
    }

    // Build the prompt
    const respondentSummaries = responses.map(r => {
      const m = r.metrics;
      const decisionSteps = (r.responseData?.processData?.steps || []).filter(s => s.isDecision);
      return `- ${r.name} (${r.department}): sees ${m.stepsCount} steps, ${m.elapsedDays} days cycle time, ${m.handoffCount} handoffs, ${m.totalUserHours}h invested, performance="${m.performance}", biggest delay="${m.biggestDelay}", bottleneck="${m.bottleneck}"${decisionSteps.length > 0 ? `, ${decisionSteps.length} decision/routing points` : ''}`;
    }).join('\n');

    const gapSummaries = (aggregation.perceptionGaps || []).map(g =>
      `- ${g.metric} (${g.severity}): ${g.detail}\n  Per person: ${g.byPerson.join('; ')}`
    ).join('\n');

    const issueSummary = (aggregation.issueFrequency || []).map(i =>
      `- "${i.issue}" reported by ${i.count}/${responses.length} (${i.pct}%)`
    ).join('\n');

    const prompt = `You are an expert organisational process consultant analysing a TEAM diagnostic where multiple people from different departments described the SAME process. Their differing perspectives reveal hidden inefficiencies, misalignment, and improvement opportunities.

PROCESS: ${team.processName || 'Unknown'}
COMPANY: ${team.company || 'Unknown'}
RESPONDENTS: ${responses.length}

INDIVIDUAL PERSPECTIVES:
${respondentSummaries}

AGGREGATED METRICS:
- Average cycle time: ${aggregation.elapsedDays.avg} days (range: ${aggregation.elapsedDays.min}–${aggregation.elapsedDays.max})
- Average steps: ${aggregation.steps.avg} (range: ${aggregation.steps.min}–${aggregation.steps.max})
- Average handoffs: ${aggregation.handoffs.avg} (range: ${aggregation.handoffs.min}–${aggregation.handoffs.max})
- Average time invested: ${aggregation.totalHours.avg}h (range: ${aggregation.totalHours.min}–${aggregation.totalHours.max}h)
- Consensus score: ${aggregation.consensusScore}%

PERCEPTION GAPS DETECTED:
${gapSummaries || 'None detected'}

ISSUES REPORTED:
${issueSummary || 'None'}

Analyse these team results and provide your response as JSON with this exact structure:
{
  "executiveSummary": "2-3 sentence overview of the team's alignment and the most critical finding",
  "rootCauses": [
    {
      "title": "Short root cause name",
      "severity": "critical|high|medium",
      "explanation": "2-3 sentences explaining why this matters",
      "affectedDepartments": ["dept1", "dept2"],
      "evidence": "Specific data points from the responses that prove this"
    }
  ],
  "hiddenInefficiencies": [
    {
      "title": "What's hidden",
      "insight": "1-2 sentences. Focus on what the gap REVEALS that no individual would see alone."
    }
  ],
  "recommendations": [
    {
      "priority": 1,
      "action": "Specific, actionable recommendation",
      "impact": "Expected outcome",
      "owner": "Which department should lead this",
      "timeframe": "quick-win|30-day|90-day"
    }
  ],
  "alignmentActions": [
    "Specific action to get the team aligned on this process"
  ]
}

Return ONLY valid JSON, no markdown fences or extra text.`;

    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        temperature: 0.5,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!claudeResp.ok) {
      console.warn('Claude API error:', claudeResp.status);
      return res.status(200).json({
        success: true,
        analysisType: 'rule-based',
        analysis: buildRuleBasedAnalysis(team, responses, aggregation)
      });
    }

    const claudeData = await claudeResp.json();
    const text = claudeData.content?.[0]?.text || '';

    let analysis;
    try {
      const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      analysis = JSON.parse(cleaned);
    } catch (parseErr) {
      console.warn('Claude JSON parse failed, falling back to rule-based');
      return res.status(200).json({
        success: true,
        analysisType: 'rule-based',
        analysis: buildRuleBasedAnalysis(team, responses, aggregation)
      });
    }

    return res.status(200).json({
      success: true,
      analysisType: 'ai-enhanced',
      analysis
    });

  } catch (error) {
    console.error('Analyze gaps error:', error);
    return res.status(500).json({ error: 'Analysis failed.' });
  }
}


function buildRuleBasedAnalysis(team, responses, aggregation) {
  const gaps = aggregation.perceptionGaps || [];
  const highGaps = gaps.filter(g => g.severity === 'high');
  const medGaps = gaps.filter(g => g.severity === 'medium');

  const rootCauses = [];
  if (highGaps.some(g => g.metric === 'Cycle Time')) {
    rootCauses.push({ title: 'Cycle time perception mismatch', severity: 'critical', explanation: 'Team members experience vastly different timelines for the same process. This typically indicates hidden rework loops, inconsistent routing, or departmental bottlenecks that are invisible to upstream teams.', affectedDepartments: [...new Set(responses.map(r => r.department).filter(Boolean))], evidence: `Spread of ${aggregation.elapsedDays.spread} days across respondents` });
  }
  if (highGaps.some(g => g.metric === 'Process Steps')) {
    rootCauses.push({ title: 'Process visibility gap', severity: 'high', explanation: 'Different departments see a different number of steps. This means parts of the process are invisible to certain stakeholders, creating blind spots and misaligned expectations.', affectedDepartments: [...new Set(responses.map(r => r.department).filter(Boolean))], evidence: `Step counts range from ${aggregation.steps.min} to ${aggregation.steps.max}` });
  }
  if (highGaps.some(g => g.metric === 'Biggest Bottleneck')) {
    rootCauses.push({ title: 'Distributed bottleneck problem', severity: 'high', explanation: 'Each department identifies a different bottleneck. This means the process has multiple constraint points and no single fix will resolve the issue — a coordinated approach is needed.', affectedDepartments: [...new Set(responses.map(r => r.department).filter(Boolean))], evidence: 'All respondents named different bottlenecks' });
  }
  if (medGaps.some(g => g.metric === 'Performance Assessment')) {
    rootCauses.push({ title: 'Inconsistent performance standards', severity: 'medium', explanation: 'Team disagrees on whether the process performs well. This suggests no shared KPIs or service level agreements exist.', affectedDepartments: [...new Set(responses.map(r => r.department).filter(Boolean))], evidence: 'Mixed performance ratings across respondents' });
  }

  const recommendations = [
    { priority: 1, action: 'Run a cross-departmental process mapping workshop to establish a single source of truth', impact: 'Eliminate visibility gaps and align on actual steps, routing, and ownership', owner: 'Process Owner / Operations', timeframe: 'quick-win' },
    { priority: 2, action: 'Define shared KPIs and SLAs for each handoff point in the process', impact: 'Create accountability and enable measurement of improvement', owner: 'Operations + Department Heads', timeframe: '30-day' },
    { priority: 3, action: 'Implement a process tracking tool that provides real-time visibility across all departments', impact: 'Reduce information gaps and enable data-driven optimisation', owner: 'IT / Operations', timeframe: '90-day' }
  ];

  return {
    executiveSummary: `The team shows ${aggregation.consensusScore >= 50 ? 'partial' : 'significant'} misalignment on "${team.processName}". ${highGaps.length} high-severity perception gaps were identified across ${responses.length} respondents, indicating that each department experiences a fundamentally different process.`,
    rootCauses,
    hiddenInefficiencies: [
      { title: 'Shadow processes', insight: 'When team members see different step counts, it often means unofficial workarounds and shortcuts have become normalised but undocumented.' },
      { title: 'Information asymmetry', insight: 'Different bottleneck perceptions suggest teams are working around problems locally rather than escalating them — masking systemic issues.' }
    ],
    recommendations,
    alignmentActions: [
      'Schedule a 90-minute cross-departmental session to review these results together',
      'Have each respondent walk through their version of the process on a shared whiteboard',
      'Agree on a single process definition with numbered steps and clear ownership'
    ]
  };
}
