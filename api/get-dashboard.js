// api/get-dashboard.js
// Vercel Serverless Function - Dashboard operations for diagnostic reports
// GET  /api/get-dashboard?email=xxx  — fetch all reports for an email
// DELETE /api/get-dashboard           — delete a report by ID (body: { reportId, email })

const { setCorsHeaders, getSupabaseHeaders, isValidEmail, isValidUUID, fetchWithTimeout } = require('../lib/api-helpers');

module.exports = async function handler(req, res) {
  setCorsHeaders(res, 'GET,DELETE,OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'DELETE') return handleDelete(req, res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ error: 'Email is required. Use ?email=xxx' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format.' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(503).json({
        error: 'Storage not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.'
      });
    }

    const encodedEmail = encodeURIComponent(email.toLowerCase());
    const sbHeaders = getSupabaseHeaders(supabaseKey);

    const reportsUrl = `${supabaseUrl}/rest/v1/diagnostic_reports?contact_email=ilike.${encodedEmail}&select=id,contact_email,contact_name,company,lead_score,lead_grade,diagnostic_data,created_at&order=created_at.desc`;
    const sbResp = await fetchWithTimeout(reportsUrl, { method: 'GET', headers: sbHeaders });

    if (!sbResp.ok) {
      const errText = await sbResp.text();
      console.error('Supabase fetch error:', sbResp.status, errText);
      return res.status(502).json({ error: 'Failed to fetch reports from storage.' });
    }

    const rows = await sbResp.json();

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        error: 'No diagnostics found for this email address.'
      });
    }

    const reports = rows.map(row => {
      const d = row.diagnostic_data || {};
      const summary = d.summary || {};
      const auto = d.automationScore || {};
      const procs = d.processes || [];

      return {
        id: row.id,
        company: row.company || d.contact?.company || '',
        contactName: row.contact_name || d.contact?.name || '',
        leadScore: row.lead_score,
        leadGrade: row.lead_grade,
        createdAt: row.created_at,
        metrics: {
          totalProcesses: summary.totalProcesses || procs.length || 0,
          totalAnnualCost: summary.totalAnnualCost || 0,
          potentialSavings: summary.potentialSavings || 0,
          automationPercentage: auto.percentage || 0,
          automationGrade: auto.grade || 'N/A',
          qualityScore: summary.qualityScore || 0,
          analysisType: summary.analysisType || 'rule-based'
        },
        processes: procs.map(p => ({
          name: p.name || '',
          type: p.type || '',
          annualCost: p.annualCost || 0,
          elapsedDays: p.elapsedDays || 0,
          stepsCount: p.stepsCount || 0
        })),
        recommendations: (d.recommendations || []).slice(0, 5).map(r => ({
          type: r.type || 'general',
          text: r.text || ''
        })),
        roadmap: d.roadmap ? {
          quickWins: d.roadmap.phases?.quick?.items?.length || 0,
          totalSavings: d.roadmap.totalSavings || 0
        } : null
      };
    });

    // Calculate deltas if more than one report
    let deltas = null;
    if (reports.length >= 2) {
      const latest = reports[0].metrics;
      const previous = reports[1].metrics;

      deltas = {
        comparedTo: reports[1].createdAt,
        annualCost: {
          change: latest.totalAnnualCost - previous.totalAnnualCost,
          percentChange: previous.totalAnnualCost > 0
            ? ((latest.totalAnnualCost - previous.totalAnnualCost) / previous.totalAnnualCost * 100)
            : 0,
          improved: latest.totalAnnualCost < previous.totalAnnualCost
        },
        potentialSavings: {
          change: latest.potentialSavings - previous.potentialSavings,
          percentChange: previous.potentialSavings > 0
            ? ((latest.potentialSavings - previous.potentialSavings) / previous.potentialSavings * 100)
            : 0,
          improved: latest.potentialSavings > previous.potentialSavings
        },
        automationReadiness: {
          change: latest.automationPercentage - previous.automationPercentage,
          improved: latest.automationPercentage > previous.automationPercentage
        },
        processCount: {
          change: latest.totalProcesses - previous.totalProcesses
        },
        qualityScore: {
          change: latest.qualityScore - previous.qualityScore,
          improved: latest.qualityScore > previous.qualityScore
        }
      };
    }

    return res.status(200).json({
      success: true,
      email: email.toLowerCase(),
      totalReports: reports.length,
      reports,
      deltas
    });

  } catch (error) {
    console.error('Get dashboard error:', error);
    return res.status(500).json({ error: 'Failed to retrieve dashboard data.' });
  }
};

async function handleDelete(req, res) {
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

    const checkUrl = `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}&select=id,contact_email`;
    const checkResp = await fetchWithTimeout(checkUrl, { method: 'GET', headers: sbHeaders });

    if (!checkResp.ok) {
      return res.status(502).json({ error: 'Failed to verify report ownership.' });
    }

    const rows = await checkResp.json();
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Report not found or already deleted.' });
    }

    if (rows[0].contact_email?.toLowerCase() !== normalEmail) {
      return res.status(403).json({ error: 'You can only delete your own reports.' });
    }

    const delResp = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}`,
      { method: 'DELETE', headers: { ...sbHeaders, 'Prefer': 'return=minimal' } }
    );

    if (!delResp.ok && delResp.status !== 204) {
      return res.status(502).json({ error: 'Failed to delete report.' });
    }

    return res.status(200).json({ success: true, message: 'Report deleted.' });
  } catch (error) {
    console.error('Delete report error:', error);
    return res.status(500).json({ error: 'Failed to delete report.' });
  }
}
