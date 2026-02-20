// api/process-instances.js
// Vercel Serverless Function - Log and query process instances for live monitoring
// GET: Fetch instances for a process (by report ID or email)
// POST: Log a new instance event (started, completed, stuck, waiting)

const crypto = require('crypto');
const { setCorsHeaders, getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout } = require('../lib/api-helpers');

module.exports = async function handler(req, res) {
  setCorsHeaders(res, 'GET,OPTIONS,POST');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(503).json({ error: 'Storage not configured.' });
  }

  if (req.method === 'POST') return logInstance(req, res, supabaseUrl, supabaseKey);
  if (req.method === 'GET') return getInstances(req, res, supabaseUrl, supabaseKey);
  return res.status(405).json({ error: 'Method not allowed' });
};

async function logInstance(req, res, supabaseUrl, supabaseKey) {
  try {
    const { reportId, email, processName, instanceName, status, notes } = req.body;

    if (!processName || !status) {
      return res.status(400).json({ error: 'processName and status are required.' });
    }

    const validStatuses = ['started', 'in-progress', 'waiting', 'stuck', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Use one of: ${validStatuses.join(', ')}` });
    }

    const payload = {
      id: crypto.randomUUID(),
      report_id: reportId || null,
      email: email || null,
      process_name: processName,
      instance_name: instanceName || null,
      status,
      notes: notes || null,
      logged_at: new Date().toISOString()
    };

    const sbResp = await fetch(`${supabaseUrl}/rest/v1/process_instances`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(payload)
    });

    if (!sbResp.ok) {
      const errText = await sbResp.text();
      console.error('Supabase insert failed:', sbResp.status, errText);
      return res.status(502).json({ error: 'Failed to log instance.' });
    }

    return res.status(200).json({ success: true, instanceId: payload.id });

  } catch (error) {
    console.error('Log instance error:', error);
    return res.status(500).json({ error: 'Failed to log instance.' });
  }
}

async function getInstances(req, res, supabaseUrl, supabaseKey) {
  try {
    const { email, reportId, processName, limit: lim } = req.query;

    if (!email && !reportId) {
      return res.status(400).json({ error: 'email or reportId is required.' });
    }

    let filter = '';
    if (email) filter = `email=ilike.${encodeURIComponent(email.toLowerCase())}`;
    else filter = `report_id=eq.${encodeURIComponent(reportId)}`;
    if (processName) filter += `&process_name=eq.${encodeURIComponent(processName)}`;

    const rowLimit = Math.min(parseInt(lim) || 200, 500);
    const url = `${supabaseUrl}/rest/v1/process_instances?${filter}&select=*&order=logged_at.desc&limit=${rowLimit}`;

    const sbResp = await fetch(url, {
      method: 'GET',
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Accept': 'application/json' }
    });

    if (!sbResp.ok) {
      return res.status(502).json({ error: 'Failed to fetch instances.' });
    }

    const rows = await sbResp.json();

    // Compute summary stats
    const byProcess = {};
    rows.forEach(r => {
      const key = r.process_name || 'Unknown';
      if (!byProcess[key]) byProcess[key] = { started: 0, completed: 0, stuck: 0, waiting: 0, cancelled: 0, inProgress: 0, instances: [] };
      byProcess[key][r.status === 'in-progress' ? 'inProgress' : r.status] = (byProcess[key][r.status === 'in-progress' ? 'inProgress' : r.status] || 0) + 1;
      byProcess[key].instances.push(r);
    });

    // Calculate avg completion time per process
    Object.keys(byProcess).forEach(proc => {
      const instances = byProcess[proc].instances;
      const completed = instances.filter(i => i.status === 'completed');
      const started = instances.filter(i => i.status === 'started');

      // Match starts to completions by instance_name
      const completionTimes = [];
      completed.forEach(c => {
        const match = started.find(s => s.instance_name && s.instance_name === c.instance_name);
        if (match) {
          const days = (new Date(c.logged_at) - new Date(match.logged_at)) / (1000 * 60 * 60 * 24);
          if (days > 0 && days < 365) completionTimes.push(days);
        }
      });

      byProcess[proc].avgCompletionDays = completionTimes.length > 0
        ? Math.round(completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length * 10) / 10
        : null;
      byProcess[proc].totalInstances = instances.length;
    });

    return res.status(200).json({
      success: true,
      totalEvents: rows.length,
      processes: byProcess,
      recentEvents: rows.slice(0, 20)
    });

  } catch (error) {
    console.error('Get instances error:', error);
    return res.status(500).json({ error: 'Failed to retrieve instances.' });
  }
}
