// api/delete-report.js
// Vercel Serverless Function - Deletes a diagnostic report by ID
// Requires email ownership verification before deletion.
// Attempts deletion from both diagnostic_reports and diagnostics (legacy) tables.

const { setCorsHeaders, getSupabaseHeaders, isValidUUID, isValidEmail, fetchWithTimeout } = require('../lib/api-helpers');

module.exports = async function handler(req, res) {
  setCorsHeaders(res, 'DELETE,OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { reportId, email } = req.body || {};

    if (!reportId || !email) {
      return res.status(400).json({ error: 'reportId and email are required.' });
    }

    if (!isValidUUID(reportId)) {
      return res.status(400).json({ error: 'Invalid report ID format.' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format.' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(503).json({ error: 'Storage not configured.' });
    }

    const sbHeaders = getSupabaseHeaders(supabaseKey);
    const normalEmail = email.toLowerCase();
    let deleted = false;

    // Try diagnostic_reports table first — verify ownership via contact_email
    const checkUrl = `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}&select=id,contact_email`;
    const checkResp = await fetchWithTimeout(checkUrl, { method: 'GET', headers: sbHeaders });

    if (checkResp.ok) {
      const rows = await checkResp.json();
      if (rows.length > 0) {
        if (rows[0].contact_email?.toLowerCase() !== normalEmail) {
          return res.status(403).json({ error: 'You can only delete your own reports.' });
        }
        const delUrl = `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}`;
        const delResp = await fetchWithTimeout(delUrl, {
          method: 'DELETE',
          headers: { ...sbHeaders, 'Prefer': 'return=minimal' }
        });
        if (delResp.ok || delResp.status === 204) deleted = true;
      }
    }

    // Also try legacy diagnostics table
    const legacyCheckUrl = `${supabaseUrl}/rest/v1/diagnostics?id=eq.${reportId}&select=id,email`;
    const legacyResp = await fetchWithTimeout(legacyCheckUrl, { method: 'GET', headers: sbHeaders }).catch(() => null);

    if (legacyResp && legacyResp.ok) {
      const legacyRows = await legacyResp.json();
      if (legacyRows.length > 0) {
        if (legacyRows[0].email?.toLowerCase() !== normalEmail) {
          if (!deleted) return res.status(403).json({ error: 'You can only delete your own reports.' });
        } else {
          const legacyDelUrl = `${supabaseUrl}/rest/v1/diagnostics?id=eq.${reportId}`;
          const legacyDelResp = await fetchWithTimeout(legacyDelUrl, {
            method: 'DELETE',
            headers: { ...sbHeaders, 'Prefer': 'return=minimal' }
          });
          if (legacyDelResp.ok || legacyDelResp.status === 204) deleted = true;
        }
      }
    }

    if (!deleted) {
      return res.status(404).json({ error: 'Report not found or already deleted.' });
    }

    return res.status(200).json({ success: true, message: 'Report deleted.' });

  } catch (error) {
    console.error('Delete report error:', error);
    return res.status(500).json({ error: 'Failed to delete report.' });
  }
};
