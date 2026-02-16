// api/get-team-results.js
// Fetches all team responses and computes aggregated comparison
// Shows where perceptions differ across departments

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { code } = req.query;

    if (!code) {
      return res.status(400).json({ error: 'Team code is required. Use ?code=xxx' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(503).json({ error: 'Storage not configured.' });
    }

    // Fetch team diagnostic
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

    // Fetch all responses
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

    // Build individual summaries
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

    // Compute aggregation — averages, ranges, and disagreements
    const nums = (key) => individuals.map(i => i.metrics[key]).filter(v => typeof v === 'number' && v > 0);
    const avg = (arr) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
    const spread = (arr) => arr.length > 1 ? Math.max(...arr) - Math.min(...arr) : 0;

    const elapsedDaysArr = nums('elapsedDays');
    const stepsArr = nums('stepsCount');
    const handoffArr = nums('handoffCount');
    const hoursArr = nums('totalUserHours');

    // Find perception gaps — where responses differ significantly
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

    // Performance perception gap
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

    // Biggest delay gap — different bottleneck descriptions
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

    // Issues frequency
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
};
