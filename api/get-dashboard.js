// api/get-dashboard.js
// Vercel Serverless Function - Fetches all diagnostic reports for an email
// Used by /dashboard?email=xxx to show comparative results over time

const { setCorsHeaders, getSupabaseHeaders, isValidEmail, fetchWithTimeout } = require('../lib/api-helpers');

module.exports = async function handler(req, res) {
  setCorsHeaders(res, 'GET,OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
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

    // Fetch from both tables in parallel
    const reportsUrl = `${supabaseUrl}/rest/v1/diagnostic_reports?contact_email=ilike.${encodedEmail}&select=id,contact_email,contact_name,company,lead_score,lead_grade,diagnostic_data,created_at&order=created_at.desc`;
    const diagUrl = `${supabaseUrl}/rest/v1/diagnostics?email=ilike.${encodedEmail}&select=id,email,name,company,total_processes,annual_process_cost,potential_savings,automation_percentage,automation_grade,automation_insight,quality_score,analysis_type,recommendations,processes,lead_score,lead_grade,completed_at&order=completed_at.desc`;

    const sbHeaders = getSupabaseHeaders(supabaseKey);

    const [sbResp, diagResp] = await Promise.all([
      fetchWithTimeout(reportsUrl, { method: 'GET', headers: sbHeaders }),
      fetchWithTimeout(diagUrl, { method: 'GET', headers: sbHeaders }).catch(() => null)
    ]);

    if (!sbResp.ok) {
      const errText = await sbResp.text();
      console.error('Supabase fetch error:', sbResp.status, errText);
      return res.status(502).json({ error: 'Failed to fetch reports from storage.' });
    }

    const rows = await sbResp.json();

    // Merge records from the diagnostics table that aren't in diagnostic_reports
    let diagRows = [];
    if (diagResp && diagResp.ok) {
      try { diagRows = await diagResp.json(); } catch (e) { console.error('Failed to parse diagnostics response:', e.message); diagRows = []; }
    }

    const reportIds = new Set((rows || []).map(r => r.id));
    const extraRows = (diagRows || []).filter(d => !reportIds.has(d.id) && d.total_processes > 0).map(d => {
      let procs = [];
      let recs = [];
      try { procs = typeof d.processes === 'string' ? JSON.parse(d.processes) : (d.processes || []); } catch (e) { console.error('Failed to parse processes:', e.message); }
      try { recs = typeof d.recommendations === 'string' ? JSON.parse(d.recommendations) : (d.recommendations || []); } catch (e) { console.error('Failed to parse recommendations:', e.message); }
      return {
        id: d.id,
        contact_email: d.email,
        contact_name: d.name || '',
        company: d.company || '',
        lead_score: d.lead_score || 0,
        lead_grade: d.lead_grade || '',
        diagnostic_data: {
          contact: { name: d.name, email: d.email, company: d.company },
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
          roadmap: null
        },
        created_at: d.completed_at || d.created_at
      };
    });

    const allRows = [...(rows || []), ...extraRows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (!allRows.length) {
      return res.status(404).json({
        error: 'No diagnostics found for this email address.'
      });
    }

    const reports = allRows.map(row => {
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
