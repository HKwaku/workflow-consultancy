// api/get-diagnostic.js
// Vercel Serverless Function - Fetches a diagnostic report from Supabase by ID
// Used by /report?id=xxx to retrieve stored diagnostic data + PDF

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
      return res.status(400).json({ error: 'Report ID is required. Use ?id=xxx' });
    }

    // Validate UUID format (basic check)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: 'Invalid report ID format.' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(503).json({
        error: 'Report storage not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.'
      });
    }

    // Fetch from Supabase
    const url = `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${id}&select=*`;
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
      return res.status(502).json({ error: 'Failed to fetch report from storage.' });
    }

    const rows = await sbResp.json();

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Report not found. It may have expired or the ID is incorrect.' });
    }

    const report = rows[0];

    // Return diagnostic data (PDF base64 included so client can trigger download)
    return res.status(200).json({
      success: true,
      report: {
        id: report.id,
        contactEmail: report.contact_email,
        contactName: report.contact_name,
        company: report.company,
        leadScore: report.lead_score,
        leadGrade: report.lead_grade,
        diagnosticData: report.diagnostic_data,
        pdfBase64: report.pdf_base64,
        createdAt: report.created_at
      }
    });

  } catch (error) {
    console.error('Get diagnostic error:', error);
    return res.status(500).json({ error: 'Failed to retrieve diagnostic report.' });
  }
};
