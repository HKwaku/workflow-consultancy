// api/save-progress.js
// Vercel Serverless Function - Saves partial diagnostic progress to Supabase
// and optionally emails a resume link via n8n webhook.
//
// Table: diagnostic_progress (see README for schema)
// Flow: Client POSTs partial data → stored in Supabase → resume link returned
//       If email provided → n8n webhook fires → user gets email with link

const crypto = require('crypto');

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    // ── Generate or reuse progress ID ───────────────────────────
    // If the client already has a progressId (re-saving), update in place
    const progressId = req.body.progressId || crypto.randomUUID();
    const isUpdate = !!req.body.progressId;

    // ── Build resume URL ────────────────────────────────────────
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
    const resumeUrl = `${protocol}://${host}/diagnostic?resume=${progressId}`;

    // ── Store in Supabase ───────────────────────────────────────
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

    // Upsert: insert or update if ID exists
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

    // ── Send email via n8n (if email provided) ──────────────────
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

    // ── Response ────────────────────────────────────────────────
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
};


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
