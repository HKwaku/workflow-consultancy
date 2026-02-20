// api/send-diagnostic-report.js
// Vercel Serverless Function - Sends diagnostic report via n8n webhook
// Handles: 1) Store report in Supabase  2) Email delivery  3) CRM lead capture  4) Team notification
//
// The PDF is stored directly in Supabase so the client can download it
// from /report?id=xxx without n8n needing to handle binary attachments.

const crypto = require('crypto');
const { setCorsHeaders, getSupabaseWriteHeaders, fetchWithTimeout } = require('../lib/api-helpers');

module.exports = async function handler(req, res) {
  setCorsHeaders(res, 'POST,OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      contact,
      summary,
      recommendations,
      automationScore,
      roadmap,
      processes,
      rawProcesses,
      customDepartments,
      pdfBase64,
      timestamp
    } = req.body;

    if (!contact || !contact.email) {
      return res.status(400).json({ error: 'Contact email is required' });
    }

    // ── Generate Report ID ─────────────────────────────────────
    const reportId = crypto.randomUUID();

    // ── Build Report URL ───────────────────────────────────────
    // Use the request host to build the full URL (works in dev + production)
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
    const reportUrl = `${protocol}://${host}/report?id=${reportId}`;

    // ── Lead Scoring ──────────────────────────────────────────
    const leadScore = calculateLeadScore(contact, summary, automationScore, processes);

    // ── Store in Supabase ─────────────────────────────────────
    // Store the full diagnostic data + PDF so it can be retrieved at /report?id=xxx
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    let storedInSupabase = false;

    if (supabaseUrl && supabaseKey) {
      try {
        const insertPayload = {
          id: reportId,
          contact_email: contact.email || '',
          contact_name: contact.name || '',
          company: contact.company || '',
          lead_score: leadScore.score,
          lead_grade: leadScore.grade,
          diagnostic_data: {
            contact,
            summary,
            recommendations,
            automationScore,
            roadmap,
            processes,
            rawProcesses: rawProcesses || null,
            customDepartments: customDepartments || [],
            leadScore
          },
          pdf_base64: pdfBase64 || null,
          created_at: timestamp || new Date().toISOString()
        };

        const sbResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/diagnostic_reports`, {
          method: 'POST',
          headers: getSupabaseWriteHeaders(supabaseKey),
          body: JSON.stringify(insertPayload)
        });

        if (sbResp.ok || sbResp.status === 201) {
          storedInSupabase = true;
          console.log('Diagnostic report stored in Supabase:', reportId);
        } else {
          const errText = await sbResp.text();
          console.warn('Supabase insert failed:', sbResp.status, errText);
        }
      } catch (sbErr) {
        console.warn('Supabase error:', sbErr.message);
      }
    } else {
      console.log('Supabase not configured. Report will not be stored for later download.');
    }

    // ── Build n8n Payload ─────────────────────────────────────
    // NESTED structure matching n8n "Extract Webhook Data" node
    // NOTE: pdfBase64 is NOT sent to n8n anymore — it's stored in Supabase
    //       and the email includes a download link instead.
    const notif = buildNotificationSummary(contact, summary, leadScore, automationScore);

    const n8nPayload = {
      requestType: 'diagnostic-complete',

      reportId,
      reportUrl,

      contact: {
        name: contact.name || '',
        email: contact.email || '',
        company: contact.company || '',
        title: contact.title || '',
        industry: contact.industry || '',
        teamSize: contact.teamSize || '',
        phone: contact.phone || ''
      },

      leadScore,

      summary: {
        totalProcesses: summary?.totalProcesses || 0,
        totalAnnualCost: summary?.totalAnnualCost || 0,
        potentialSavings: summary?.potentialSavings || 0,
        analysisType: summary?.analysisType || 'rule-based',
        qualityScore: summary?.qualityScore || 0
      },

      automationScore: {
        percentage: automationScore?.percentage || 0,
        grade: automationScore?.grade || 'N/A',
        insight: automationScore?.insight || ''
      },

      recommendations: (recommendations || []).slice(0, 6).map(r => ({
        type: r.type || 'general',
        process: r.process || '',
        text: r.text || ''
      })),

      roadmap: {
        quickWins: (roadmap?.phases?.quick?.items || []).length,
        agentItems: (roadmap?.phases?.agent?.items || []).length,
        humanLoopItems: (roadmap?.phases?.human?.items || []).length,
        multiAgentItems: (roadmap?.phases?.multi?.items || []).length,
        totalSavings: roadmap?.totalSavings || 0
      },

      processes: (processes || []).map(p => ({
        name: p.name || '',
        type: p.type || '',
        annualCost: p.annualCost || 0,
        elapsedDays: p.elapsedDays || 0,
        stepsCount: p.stepsCount || 0,
        teamSize: p.teamSize || 0,
        qualityGrade: p.quality?.grade || ''
      })),

      notification: notif,

      timestamp: timestamp || new Date().toISOString()
    };

    // ── Forward to n8n Webhook ────────────────────────────────
    const webhookUrl = process.env.N8N_DIAGNOSTIC_WEBHOOK_URL || process.env.N8N_WEBHOOK_URL;
    const isValidUrl = webhookUrl && (webhookUrl.startsWith('http://') || webhookUrl.startsWith('https://'));

    let webhookConfigured = false;
    let webhookResponse = null;

    if (isValidUrl) {
      try {
        const n8nResp = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(n8nPayload)
        });

        if (n8nResp.ok) {
          webhookConfigured = true;
          try {
            webhookResponse = await n8nResp.json();
          } catch {
            webhookResponse = { accepted: true };
          }
        } else {
          console.warn('n8n webhook returned:', n8nResp.status);
        }
      } catch (n8nErr) {
        console.warn('n8n webhook error:', n8nErr.message);
      }
    } else {
      console.log('No valid n8n webhook URL configured. Payload stored for manual processing.');
    }

    // ── Response ──────────────────────────────────────────────
    return res.status(200).json({
      success: true,
      reportId,
      reportUrl: storedInSupabase ? reportUrl : null,
      webhookConfigured,
      storedInSupabase,
      leadScore,
      message: webhookConfigured
        ? 'Report sent successfully. Email delivery, CRM update, and team notification triggered.'
        : 'Report generated and lead scored. Configure N8N_DIAGNOSTIC_WEBHOOK_URL to enable email delivery, CRM integration, and team notifications.',
      ...(webhookResponse || {})
    });

  } catch (error) {
    console.error('Send diagnostic report error:', error);
    return res.status(500).json({ error: 'Failed to process diagnostic report.' });
  }
};


// ================================================================
// LEAD SCORING
// Scores the lead 0-100 based on diagnostic signals
// ================================================================
function calculateLeadScore(contact, summary, automationScore, processes) {
  let score = 0;
  const factors = [];

  // ── Company size (max 20 pts) ──────────────────────────────
  const sizeMap = {
    '1-10': 5, '11-50': 10, '51-200': 15, '201-500': 18, '500+': 20
  };
  const sizeScore = sizeMap[contact.teamSize] || 8;
  score += sizeScore;
  factors.push({ factor: 'Company size', value: contact.teamSize || 'unknown', points: sizeScore });

  // ── Annual process cost (max 25 pts) ───────────────────────
  const cost = summary?.totalAnnualCost || 0;
  let costScore = 0;
  if (cost >= 500000) costScore = 25;
  else if (cost >= 200000) costScore = 20;
  else if (cost >= 100000) costScore = 15;
  else if (cost >= 50000) costScore = 10;
  else if (cost >= 20000) costScore = 5;
  score += costScore;
  factors.push({ factor: 'Annual process cost', value: '£' + (cost / 1000).toFixed(0) + 'K', points: costScore });

  // ── Automation readiness (max 20 pts) ──────────────────────
  const autoPerc = automationScore?.percentage || 0;
  let autoScore = 0;
  if (autoPerc >= 70) autoScore = 20;
  else if (autoPerc >= 50) autoScore = 15;
  else if (autoPerc >= 30) autoScore = 10;
  else if (autoPerc > 0) autoScore = 5;
  score += autoScore;
  factors.push({ factor: 'Automation readiness', value: autoPerc + '%', points: autoScore });

  // ── Number of processes (max 10 pts) ───────────────────────
  const numProc = summary?.totalProcesses || 0;
  const procScore = Math.min(10, numProc * 4);
  score += procScore;
  factors.push({ factor: 'Processes analysed', value: numProc, points: procScore });

  // ── Data quality / engagement (max 15 pts) ─────────────────
  const qualScore = summary?.qualityScore || 0;
  let engScore = 0;
  if (qualScore >= 80) engScore = 15;
  else if (qualScore >= 60) engScore = 10;
  else if (qualScore >= 40) engScore = 5;
  score += engScore;
  factors.push({ factor: 'Data quality', value: qualScore + '%', points: engScore });

  // ── Contact completeness (max 10 pts) ──────────────────────
  let contactScore = 0;
  if (contact.email) contactScore += 3;
  if (contact.phone) contactScore += 3;
  if (contact.title) contactScore += 2;
  if (contact.industry) contactScore += 2;
  score += contactScore;
  factors.push({ factor: 'Contact completeness', value: contactScore + '/10', points: contactScore });

  // Clamp
  score = Math.max(0, Math.min(100, score));

  // Grade
  let grade;
  if (score >= 80) grade = 'Hot';
  else if (score >= 60) grade = 'Warm';
  else if (score >= 40) grade = 'Interested';
  else grade = 'Cold';

  return { score, grade, factors };
}


// ================================================================
// NOTIFICATION SUMMARY
// Human-readable summary for Slack/Teams/email alerts to the team
// ================================================================
function buildNotificationSummary(contact, summary, leadScore, automationScore) {
  const cost = summary?.totalAnnualCost || 0;
  const savings = summary?.potentialSavings || 0;
  const procs = summary?.totalProcesses || 0;

  const headline = `🔔 New Diagnostic Completed: ${contact.company || 'Unknown Company'}`;

  const body = [
    `**Contact:** ${contact.name || 'N/A'} (${contact.email || 'no email'})`,
    contact.title ? `**Title:** ${contact.title}` : null,
    `**Company:** ${contact.company || 'N/A'} | ${contact.teamSize || '?'} employees | ${contact.industry || 'Unknown industry'}`,
    ``,
    `**Diagnostic Summary:**`,
    `• ${procs} process${procs !== 1 ? 'es' : ''} analysed`,
    `• Annual process cost: £${(cost / 1000).toFixed(0)}K`,
    `• Potential savings: £${(savings / 1000).toFixed(0)}K`,
    automationScore?.percentage ? `• Automation readiness: ${automationScore.percentage}% (${automationScore.grade || 'N/A'})` : null,
    ``,
    `**Lead Score: ${leadScore.score}/100 (${leadScore.grade})**`,
    ``,
    leadScore.grade === 'Hot' ? '🔥 HIGH PRIORITY - Follow up within 24 hours!' : null,
    leadScore.grade === 'Warm' ? '⚡ Follow up within 48 hours.' : null
  ].filter(Boolean).join('\n');

  // Plain text version (for email subject/body)
  const subject = `[${leadScore.grade}] New Diagnostic: ${contact.company || 'Unknown'} - £${(cost / 1000).toFixed(0)}K annual cost`;

  return {
    headline,
    body,
    subject,
    priority: leadScore.grade === 'Hot' ? 'high' : leadScore.grade === 'Warm' ? 'medium' : 'low'
  };
}
