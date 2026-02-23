import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase } from '@/lib/api-helpers';

export async function POST(request) {
  try {
    const { editingReportId, contact, summary, recommendations, automationScore, roadmap, processes, rawProcesses, customDepartments, timestamp } = await request.json();
    if (!contact || !contact.email) return NextResponse.json({ error: 'Contact email is required' }, { status: 400 });

    const reportId = editingReportId || crypto.randomUUID();
    const isUpdate = !!editingReportId;
    const proto = request.headers.get('x-forwarded-proto') || 'https';
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3000';
    const reportUrl = `${proto}://${host}/report?id=${reportId}`;
    const leadScore = calculateLeadScore(contact, summary, automationScore, processes);

    const sbConfig = requireSupabase();
    let storedInSupabase = false;

    if (sbConfig) {
      const { url: supabaseUrl, key: supabaseKey } = sbConfig;
      try {
        const reportPayload = { id: reportId, contact_email: contact.email || '', contact_name: contact.name || '', company: contact.company || '', lead_score: leadScore.score, lead_grade: leadScore.grade, diagnostic_data: { contact, summary, recommendations, automationScore, roadmap, processes, rawProcesses: rawProcesses || null, customDepartments: customDepartments || [], leadScore }, created_at: timestamp || new Date().toISOString() };
        let sbResp;
        if (isUpdate) {
          const updatePayload = { ...reportPayload }; delete updatePayload.id; updatePayload.updated_at = new Date().toISOString();
          sbResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}`, { method: 'PATCH', headers: getSupabaseWriteHeaders(supabaseKey), body: JSON.stringify(updatePayload) });
        } else {
          sbResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/diagnostic_reports`, { method: 'POST', headers: getSupabaseWriteHeaders(supabaseKey), body: JSON.stringify(reportPayload) });
        }
        if (sbResp.ok || sbResp.status === 201 || sbResp.status === 204) storedInSupabase = true;
        else console.warn('Supabase failed:', sbResp.status);
      } catch (sbErr) { console.warn('Supabase error:', sbErr.message); }
    }

    const notif = buildNotificationSummary(contact, summary, leadScore, automationScore);
    const n8nPayload = { requestType: 'diagnostic-complete', reportId, reportUrl, contact: { name: contact.name || '', email: contact.email || '', company: contact.company || '', title: contact.title || '', industry: contact.industry || '', teamSize: contact.teamSize || '', phone: contact.phone || '' }, leadScore, summary: { totalProcesses: summary?.totalProcesses || 0, totalAnnualCost: summary?.totalAnnualCost || 0, potentialSavings: summary?.potentialSavings || 0, analysisType: summary?.analysisType || 'rule-based', qualityScore: summary?.qualityScore || 0 }, automationScore: { percentage: automationScore?.percentage || 0, grade: automationScore?.grade || 'N/A', insight: automationScore?.insight || '' }, recommendations: (recommendations || []).slice(0, 6).map(r => ({ type: r.type || 'general', process: r.process || '', text: r.text || '' })), roadmap: { quickWins: (roadmap?.phases?.quick?.items || []).length, totalSavings: roadmap?.totalSavings || 0 }, processes: (processes || []).map(p => ({ name: p.name || '', type: p.type || '', annualCost: p.annualCost || 0, stepsCount: p.stepsCount || 0 })), notification: notif, timestamp: timestamp || new Date().toISOString() };

    const webhookUrl = process.env.N8N_DIAGNOSTIC_WEBHOOK_URL || process.env.N8N_WEBHOOK_URL;
    const isValidUrl = webhookUrl && (webhookUrl.startsWith('http://') || webhookUrl.startsWith('https://'));
    let webhookConfigured = false;
    let webhookResponse = null;
    if (isValidUrl) {
      try {
        const n8nResp = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(n8nPayload) });
        if (n8nResp.ok) { webhookConfigured = true; try { webhookResponse = await n8nResp.json(); } catch { webhookResponse = { accepted: true }; } }
      } catch (n8nErr) { console.warn('n8n webhook error:', n8nErr.message); }
    }

    return NextResponse.json({ success: true, reportId, reportUrl: storedInSupabase ? reportUrl : null, webhookConfigured, storedInSupabase, leadScore, message: webhookConfigured ? 'Report sent successfully.' : 'Report generated.', ...(webhookResponse || {}) });
  } catch (error) {
    console.error('Send diagnostic report error:', error);
    return NextResponse.json({ error: 'Failed to process diagnostic report.' }, { status: 500 });
  }
}

function calculateLeadScore(contact, summary, automationScore, processes) {
  let score = 0; const factors = [];
  const sizeMap = { '1-10': 5, '11-50': 10, '51-200': 15, '201-500': 18, '500+': 20 };
  const sizeScore = sizeMap[contact.teamSize] || 8; score += sizeScore; factors.push({ factor: 'Company size', value: contact.teamSize || 'unknown', points: sizeScore });
  const cost = summary?.totalAnnualCost || 0;
  let costScore = cost >= 500000 ? 25 : cost >= 200000 ? 20 : cost >= 100000 ? 15 : cost >= 50000 ? 10 : cost >= 20000 ? 5 : 0;
  score += costScore; factors.push({ factor: 'Annual process cost', value: '£' + (cost / 1000).toFixed(0) + 'K', points: costScore });
  const autoPerc = automationScore?.percentage || 0;
  let autoScore = autoPerc >= 70 ? 20 : autoPerc >= 50 ? 15 : autoPerc >= 30 ? 10 : autoPerc > 0 ? 5 : 0;
  score += autoScore; factors.push({ factor: 'Automation readiness', value: autoPerc + '%', points: autoScore });
  const numProc = summary?.totalProcesses || 0;
  const procScore = Math.min(10, numProc * 4); score += procScore;
  const qualScore = summary?.qualityScore || 0;
  let engScore = qualScore >= 80 ? 15 : qualScore >= 60 ? 10 : qualScore >= 40 ? 5 : 0; score += engScore;
  let contactScore = 0;
  if (contact.email) contactScore += 3; if (contact.phone) contactScore += 3; if (contact.title) contactScore += 2; if (contact.industry) contactScore += 2;
  score += contactScore;
  score = Math.max(0, Math.min(100, score));
  const grade = score >= 80 ? 'Hot' : score >= 60 ? 'Warm' : score >= 40 ? 'Interested' : 'Cold';
  return { score, grade, factors };
}

function buildNotificationSummary(contact, summary, leadScore, automationScore) {
  const cost = summary?.totalAnnualCost || 0;
  const headline = `New Diagnostic Completed: ${contact.company || 'Unknown Company'}`;
  const subject = `[${leadScore.grade}] New Diagnostic: ${contact.company || 'Unknown'} - £${(cost / 1000).toFixed(0)}K annual cost`;
  return { headline, subject, priority: leadScore.grade === 'Hot' ? 'high' : leadScore.grade === 'Warm' ? 'medium' : 'low' };
}
