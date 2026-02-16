// api/team.js
// Consolidated endpoint for team diagnostics
// Routes by query param ?action=create|submit|results
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
    default:
      return res.status(400).json({ error: 'Missing or invalid action. Use ?action=create, ?action=submit, or ?action=results' });
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
