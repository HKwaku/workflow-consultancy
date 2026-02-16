// api/progress.js
// Consolidated endpoint: save (POST) + load (GET) diagnostic progress
// Combines former save-progress.js and load-progress.js into one function

const crypto = require('crypto');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') return saveProgress(req, res);
  if (req.method === 'GET') return loadProgress(req, res);

  return res.status(405).json({ error: 'Method not allowed' });
};


// ── POST: Save progress ─────────────────────────────────────────
async function saveProgress(req, res) {
  try {
    const { email, progressData, currentScreen, processName } = req.body;

    if (!progressData) {
      return res.status(400).json({ error: 'Progress data is required.' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(503).json({
        error: 'Storage not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.'
      });
    }

    const progressId = req.body.progressId || crypto.randomUUID();
    const isUpdate = !!req.body.progressId;

    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
    const resumeUrl = `${protocol}://${host}/diagnostic?resume=${progressId}`;

    const payload = {
      id: progressId,
      email: email || null,
      process_name: processName || null,
      current_screen: currentScreen || 0,
      progress_data: progressData,
      updated_at: new Date().toISOString()
    };

    if (!isUpdate) {
      payload.created_at = new Date().toISOString();
    }

    const sbResp = await fetch(`${supabaseUrl}/rest/v1/diagnostic_progress`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(payload)
    });

    if (!sbResp.ok && sbResp.status !== 201) {
      const errText = await sbResp.text();
      console.error('Supabase upsert failed:', sbResp.status, errText);
      return res.status(502).json({ error: 'Failed to save progress.' });
    }

    let emailSent = false;

    if (email) {
      const webhookUrl = process.env.N8N_DIAGNOSTIC_WEBHOOK_URL || process.env.N8N_WEBHOOK_URL;
      const isValidUrl = webhookUrl && (webhookUrl.startsWith('http://') || webhookUrl.startsWith('https://'));

      if (isValidUrl) {
        try {
          const n8nPayload = {
            requestType: 'save-progress',
            progressId,
            resumeUrl,
            email,
            processName: processName || 'your diagnostic',
            currentScreen: currentScreen || 0,
            screenLabel: getScreenLabel(currentScreen),
            timestamp: new Date().toISOString()
          };

          const n8nResp = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(n8nPayload)
          });

          if (n8nResp.ok) {
            emailSent = true;
          } else {
            console.warn('n8n webhook returned:', n8nResp.status);
          }
        } catch (n8nErr) {
          console.warn('n8n webhook error:', n8nErr.message);
        }
      }
    }

    return res.status(200).json({
      success: true,
      progressId,
      resumeUrl,
      emailSent,
      message: emailSent
        ? 'Progress saved! A resume link has been sent to your email.'
        : email
          ? 'Progress saved! Email delivery is not configured, but you can use the link below.'
          : 'Progress saved! Use the link below to continue later.'
    });

  } catch (error) {
    console.error('Save progress error:', error);
    return res.status(500).json({ error: 'Failed to save progress.' });
  }
}


// ── GET: Load progress ──────────────────────────────────────────
async function loadProgress(req, res) {
  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ error: 'Progress ID is required. Use ?id=xxx' });
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: 'Invalid progress ID format.' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(503).json({
        error: 'Storage not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.'
      });
    }

    const url = `${supabaseUrl}/rest/v1/diagnostic_progress?id=eq.${id}&select=*`;
    const sbResp = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Accept': 'application/json'
      }
    });

    if (!sbResp.ok) {
      const errText = await sbResp.text();
      console.error('Supabase fetch error:', sbResp.status, errText);
      return res.status(502).json({ error: 'Failed to fetch progress from storage.' });
    }

    const rows = await sbResp.json();

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        error: 'Saved progress not found. The link may have expired or the ID is incorrect.'
      });
    }

    const progress = rows[0];

    const createdAt = new Date(progress.created_at || progress.updated_at);
    const ageDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > 30) {
      return res.status(410).json({
        error: 'This saved progress has expired (older than 30 days). Please start a new diagnostic.'
      });
    }

    return res.status(200).json({
      success: true,
      progress: {
        id: progress.id,
        email: progress.email,
        processName: progress.process_name,
        currentScreen: progress.current_screen,
        progressData: progress.progress_data,
        updatedAt: progress.updated_at,
        createdAt: progress.created_at
      }
    });

  } catch (error) {
    console.error('Load progress error:', error);
    return res.status(500).json({ error: 'Failed to retrieve saved progress.' });
  }
}


function getScreenLabel(screen) {
  const labels = {
    0: 'Getting Started', 1: 'Process Selection', 2: 'Process Name', 3: 'Define Boundaries',
    4: 'Last Example', 5: 'Time Investment', 6: 'Performance', 7: 'Step Breakdown',
    8: 'Handoff Analysis', 9: 'Bottlenecks', 10: 'Systems & Tools', 11: 'Approvals',
    12: 'Knowledge', 13: 'New Hire', 14: 'Frequency', 15: 'Cost Calculation',
    16: 'Team Cost & Savings', 17: 'Priority', 18: 'Your Details', 19: 'Results'
  };
  return labels[screen] || 'In Progress';
}
