// api/get-diagnostic.js
// Vercel Serverless Function - Fetches a diagnostic report from Supabase by ID
// Used by /report?id=xxx to retrieve stored diagnostic data + PDF
// Also supports ?id=xxx&editable=true&email=yyy to return raw process data for editing

const { setCorsHeaders, getSupabaseHeaders, isValidUUID, isValidEmail, fetchWithTimeout } = require('../lib/api-helpers');

module.exports = async function handler(req, res) {
  setCorsHeaders(res, 'GET,OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { id, editable, email } = req.query;

    if (!id) {
      return res.status(400).json({ error: 'Report ID is required. Use ?id=xxx' });
    }

    if (!isValidUUID(id)) {
      return res.status(400).json({ error: 'Invalid report ID format.' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(503).json({
        error: 'Report storage not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.'
      });
    }

    // ── Editable mode: return raw process data for editing ──────
    if (editable === 'true') {
      if (!email) {
        return res.status(400).json({ error: 'Email is required for ownership verification.' });
      }

      const editHeaders = getSupabaseHeaders(supabaseKey);

      const url = `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${id}&select=id,contact_email,contact_name,company,diagnostic_data,created_at`;
      const sbResp = await fetch(url, { method: 'GET', headers: editHeaders });

      if (!sbResp.ok) {
        console.error('Supabase fetch error:', sbResp.status);
        return res.status(502).json({ error: 'Failed to fetch report.' });
      }

      let rows = await sbResp.json();

      if (rows && rows.length > 0) {
        const report = rows[0];
        if (report.contact_email.toLowerCase() !== email.toLowerCase()) {
          return res.status(403).json({ error: 'You do not have permission to edit this diagnostic.' });
        }
        const diagData = report.diagnostic_data || {};
        if (!diagData.rawProcesses || diagData.rawProcesses.length === 0) {
          return res.status(404).json({ error: 'Raw process data not available for this diagnostic. Only diagnostics submitted after this feature was added can be edited.' });
        }
        return res.status(200).json({
          success: true,
          report: {
            id: report.id, contactEmail: report.contact_email, contactName: report.contact_name,
            company: report.company, createdAt: report.created_at,
            contact: diagData.contact || {}, rawProcesses: diagData.rawProcesses,
            customDepartments: diagData.customDepartments || []
          }
        });
      }

      // Fallback to diagnostics table
      try {
        const diagUrl = `${supabaseUrl}/rest/v1/diagnostics?id=eq.${id}&select=*`;
        const diagResp = await fetch(diagUrl, { method: 'GET', headers: editHeaders });
        if (diagResp.ok) {
          const diagRows = await diagResp.json();
          if (diagRows && diagRows.length > 0) {
            const d = diagRows[0];
            if (d.email.toLowerCase() !== email.toLowerCase()) {
              return res.status(403).json({ error: 'You do not have permission to edit this diagnostic.' });
            }
            return res.status(404).json({ error: 'Raw process data not available for this diagnostic. Records from the legacy table cannot be edited — run a new diagnostic to get editable data.' });
          }
        }
      } catch (e) { console.error('Editable fallback error:', e.message); }

      return res.status(404).json({ error: 'Report not found.' });
    }

    // ── Standard mode: return full report + PDF ─────────────────
    const sbHeaders = getSupabaseHeaders(supabaseKey);

    const url = `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${id}&select=*`;
    const sbResp = await fetch(url, { method: 'GET', headers: sbHeaders });

    if (!sbResp.ok) {
      const errText = await sbResp.text();
      console.error('Supabase fetch error:', sbResp.status, errText);
      return res.status(502).json({ error: 'Failed to fetch report from storage.' });
    }

    let rows = await sbResp.json();

    // Fallback: check the diagnostics table if not found in diagnostic_reports
    if (!rows || rows.length === 0) {
      try {
        const diagUrl = `${supabaseUrl}/rest/v1/diagnostics?id=eq.${id}&select=*`;
        const diagResp = await fetch(diagUrl, { method: 'GET', headers: sbHeaders });
        if (diagResp.ok) {
          const diagRows = await diagResp.json();
          if (diagRows && diagRows.length > 0) {
            const d = diagRows[0];
            let procs = [];
            let recs = [];
            try { procs = typeof d.processes === 'string' ? JSON.parse(d.processes) : (d.processes || []); } catch (e) { console.error('Failed to parse processes:', e.message); }
            try { recs = typeof d.recommendations === 'string' ? JSON.parse(d.recommendations) : (d.recommendations || []); } catch (e) { console.error('Failed to parse recommendations:', e.message); }
            let factors = [];
            try { factors = typeof d.lead_score_factors === 'string' ? JSON.parse(d.lead_score_factors) : (d.lead_score_factors || []); } catch (e) { console.error('Failed to parse lead_score_factors:', e.message); }

            return res.status(200).json({
              success: true,
              source: 'diagnostics',
              report: {
                id: d.id,
                contactEmail: d.email,
                contactName: d.name || '',
                company: d.company || '',
                leadScore: d.lead_score || 0,
                leadGrade: d.lead_grade || '',
                diagnosticData: {
                  contact: { name: d.name, email: d.email, company: d.company, title: d.title, phone: d.phone, industry: d.industry, teamSize: d.team_size },
                  summary: {
                    totalProcesses: d.total_processes || 0,
                    totalAnnualCost: d.annual_process_cost || 0,
                    potentialSavings: d.potential_savings || 0,
                    analysisType: d.analysis_type || 'rule-based',
                    qualityScore: d.quality_score || 0
                  },
                  automationScore: {
                    percentage: d.automation_percentage || 0,
                    grade: d.automation_grade || 'N/A',
                    insight: d.automation_insight || ''
                  },
                  recommendations: recs,
                  processes: procs,
                  roadmap: (d.quick_wins || d.agent_items || d.human_loop_items || d.multi_agent_items) ? {
                    phases: {
                      quick: { items: new Array(d.quick_wins || 0) },
                      agent: { items: new Array(d.agent_items || 0) },
                      human: { items: new Array(d.human_loop_items || 0) },
                      multi: { items: new Array(d.multi_agent_items || 0) }
                    },
                    totalSavings: d.roadmap_total_savings || 0
                  } : null,
                  leadScore: { score: d.lead_score || 0, grade: d.lead_grade || '', factors }
                },
                pdfBase64: null,
                createdAt: d.completed_at || d.created_at
              }
            });
          }
        }
      } catch (fallbackErr) {
        console.warn('Diagnostics table fallback failed:', fallbackErr.message);
      }

      return res.status(404).json({ error: 'Report not found. It may have expired or the ID is incorrect.' });
    }

    const report = rows[0];

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
