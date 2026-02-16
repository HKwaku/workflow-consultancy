// api/submit-team-response.js
// Submits an individual team member's diagnostic perspective
// Stores in team_responses linked to a team_diagnostics record

const crypto = require('crypto');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { teamCode, respondentName, respondentEmail, respondentDepartment, responseData } = req.body;

    if (!teamCode) return res.status(400).json({ error: 'Team code is required.' });
    if (!respondentName) return res.status(400).json({ error: 'Your name is required.' });
    if (!responseData) return res.status(400).json({ error: 'Response data is required.' });

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(503).json({ error: 'Storage not configured.' });
    }

    // Look up team diagnostic by code
    const lookupUrl = `${supabaseUrl}/rest/v1/team_diagnostics?team_code=eq.${encodeURIComponent(teamCode)}&select=id,process_name,status`;
    const lookupResp = await fetch(lookupUrl, {
      method: 'GET',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Accept': 'application/json'
      }
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
};
