// api/get-editable-diagnostic.js
// Returns the raw process input data for a completed diagnostic report
// so it can be loaded back into the diagnostic form for editing.
// Requires email ownership verification.

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { id, email } = req.query;

    if (!id) {
      return res.status(400).json({ error: 'Report ID is required. Use ?id=xxx&email=yyy' });
    }

    if (!email) {
      return res.status(400).json({ error: 'Email is required for ownership verification.' });
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: 'Invalid report ID format.' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(503).json({ error: 'Storage not configured.' });
    }

    // Fetch the report
    const url = `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${id}&select=id,contact_email,contact_name,company,diagnostic_data,created_at`;
    const sbResp = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Accept': 'application/json'
      }
    });

    if (!sbResp.ok) {
      console.error('Supabase fetch error:', sbResp.status);
      return res.status(502).json({ error: 'Failed to fetch report.' });
    }

    const rows = await sbResp.json();

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Report not found.' });
    }

    const report = rows[0];

    // Verify email ownership (case-insensitive)
    if (report.contact_email.toLowerCase() !== email.toLowerCase()) {
      return res.status(403).json({ error: 'You do not have permission to edit this diagnostic.' });
    }

    const diagData = report.diagnostic_data || {};

    // Check if raw process data was stored
    if (!diagData.rawProcesses || diagData.rawProcesses.length === 0) {
      return res.status(404).json({
        error: 'Raw process data not available for this diagnostic. Only diagnostics submitted after this feature was added can be edited.'
      });
    }

    return res.status(200).json({
      success: true,
      report: {
        id: report.id,
        contactEmail: report.contact_email,
        contactName: report.contact_name,
        company: report.company,
        createdAt: report.created_at,
        contact: diagData.contact || {},
        rawProcesses: diagData.rawProcesses,
        customDepartments: diagData.customDepartments || []
      }
    });

  } catch (error) {
    console.error('Get editable diagnostic error:', error);
    return res.status(500).json({ error: 'Failed to retrieve diagnostic data.' });
  }
};
