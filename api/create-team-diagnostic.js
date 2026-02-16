// api/create-team-diagnostic.js
// Creates a team diagnostic session with a shareable code
// Multiple people can then submit their perspective on the same process

const crypto = require('crypto');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { createdByEmail, createdByName, processName, company, description } = req.body;

    if (!processName) {
      return res.status(400).json({ error: 'Process name is required.' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(503).json({ error: 'Storage not configured.' });
    }

    const teamId = crypto.randomUUID();
    // Short, human-friendly join code (6 chars)
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
};
