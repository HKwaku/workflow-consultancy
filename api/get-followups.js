// api/get-followups.js
// Vercel Serverless Function - Returns diagnostic reports that need follow-up emails
// Called by n8n on a daily schedule to trigger Day 3, Day 14, Day 30 nurture emails
//
// n8n workflow: Schedule Trigger (daily) → HTTP Request (GET /api/get-followups) → Loop → Send Email

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Support POST for n8n marking follow-ups as sent
  if (req.method === 'POST') return markFollowUpSent(req, res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(503).json({ error: 'Storage not configured.' });
    }

    const now = new Date();

    // Fetch reports from the last 35 days that have a contact email
    const cutoff = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000).toISOString();
    const url = `${supabaseUrl}/rest/v1/diagnostic_reports?created_at=gte.${cutoff}&contact_email=neq.&select=id,contact_email,contact_name,company,lead_score,lead_grade,created_at,followup_day3_sent,followup_day14_sent,followup_day30_sent&order=created_at.asc`;

    const sbResp = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Accept': 'application/json'
      }
    });

    if (!sbResp.ok) {
      return res.status(502).json({ error: 'Failed to fetch reports.' });
    }

    const reports = await sbResp.json();
    const followups = [];

    reports.forEach(report => {
      const createdAt = new Date(report.created_at);
      const daysSince = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));

      if (daysSince >= 3 && daysSince < 7 && !report.followup_day3_sent) {
        followups.push({
          reportId: report.id,
          email: report.contact_email,
          name: report.contact_name,
          company: report.company,
          leadGrade: report.lead_grade,
          daysSince,
          followupType: 'day3',
          subject: 'Have you reviewed your diagnostic report?',
          message: `Hi ${report.contact_name || 'there'}, your process diagnostic was completed ${daysSince} days ago. Have you had a chance to review the findings? Your report identified key areas for improvement — the quick wins alone could make an immediate impact.`
        });
      }

      if (daysSince >= 14 && daysSince < 21 && !report.followup_day14_sent) {
        followups.push({
          reportId: report.id,
          email: report.contact_email,
          name: report.contact_name,
          company: report.company,
          leadGrade: report.lead_grade,
          daysSince,
          followupType: 'day14',
          subject: 'Ready to discuss your quick wins?',
          message: `Hi ${report.contact_name || 'there'}, it's been two weeks since your diagnostic. Many of our clients start seeing results within the first month by implementing the quick wins identified in their report. Would you like to discuss how to get started?`
        });
      }

      if (daysSince >= 30 && daysSince < 35 && !report.followup_day30_sent) {
        followups.push({
          reportId: report.id,
          email: report.contact_email,
          name: report.contact_name,
          company: report.company,
          leadGrade: report.lead_grade,
          daysSince,
          followupType: 'day30',
          subject: 'Your 90-day roadmap starts now',
          message: `Hi ${report.contact_name || 'there'}, one month ago your diagnostic revealed significant optimisation opportunities. Your 90-day transformation roadmap is ready to execute — let's schedule a call to discuss implementation.`
        });
      }
    });

    return res.status(200).json({
      success: true,
      followups,
      totalDue: followups.length,
      checkedReports: reports.length
    });

  } catch (error) {
    console.error('Get followups error:', error);
    return res.status(500).json({ error: 'Failed to check follow-ups.' });
  }
};


// POST handler: mark a follow-up as sent
async function markFollowUpSent(req, res) {
  try {
    const { reportId, followupType } = req.body;

    if (!reportId || !followupType) {
      return res.status(400).json({ error: 'reportId and followupType are required.' });
    }

    const columnMap = {
      'day3': 'followup_day3_sent',
      'day14': 'followup_day14_sent',
      'day30': 'followup_day30_sent'
    };

    const column = columnMap[followupType];
    if (!column) {
      return res.status(400).json({ error: 'Invalid followupType. Use day3, day14, or day30.' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    const updatePayload = {};
    updatePayload[column] = new Date().toISOString();

    const sbResp = await fetch(`${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(updatePayload)
    });

    if (!sbResp.ok) {
      return res.status(502).json({ error: 'Failed to mark follow-up as sent.' });
    }

    return res.status(200).json({ success: true, message: `${followupType} marked as sent for ${reportId}` });

  } catch (error) {
    console.error('Mark followup error:', error);
    return res.status(500).json({ error: 'Failed to update follow-up status.' });
  }
}
