// api/load-progress.js
// Vercel Serverless Function - Loads saved diagnostic progress from Supabase
// Used when a user visits /diagnostic?resume=xxx

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ error: 'Progress ID is required. Use ?id=xxx' });
    }

    // Validate UUID format
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

    // Fetch from Supabase
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

    // Check age — expire after 30 days
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
};
