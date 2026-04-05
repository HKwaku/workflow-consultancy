import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase, isValidEmail, checkOrigin, getRequestId, generateDisplayCode } from '@/lib/api-helpers';
import { verifySupabaseSession } from '@/lib/auth';
import { SendDiagnosticReportInputSchema } from '@/lib/ai-schemas';
import { triggerWebhook } from '@/lib/triggerWebhook';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export async function POST(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

  const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024; // 2MB
  try {
    const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_PAYLOAD_BYTES) return NextResponse.json({ error: 'Request body too large.' }, { status: 413 });

    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
    const parsed = SendDiagnosticReportInputSchema.safeParse(body);
    if (!parsed.success) {
      const err = parsed.error.flatten();
      const msg = err.formErrors?.join?.(' ') || err.errors?.[0]?.message || 'Invalid request.';
      return NextResponse.json({ error: msg, details: err }, { status: 400 });
    }
    let { editingReportId, contact, fallbackEmail, authToken, summary, recommendations, automationScore, roadmap, processes, rawProcesses, customDepartments, diagnosticMode, timestamp, userId, progressId, auditTrail, costAnalystEmail, parentReportId } = parsed.data;
    let resolvedEmail = (contact?.email || '').trim() || (fallbackEmail || '').trim() || '';
    if (!resolvedEmail || !isValidEmail(resolvedEmail)) {
      const token = authToken || request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')?.trim();
      if (token) {
        const authReq = new Request(request.url, { headers: new Headers({ Authorization: `Bearer ${token}` }) });
        const session = await verifySupabaseSession(authReq);
        if (session?.email && isValidEmail(session.email)) resolvedEmail = session.email;
      }
    }
    if (!resolvedEmail || !isValidEmail(resolvedEmail)) return NextResponse.json({ error: 'Invalid request. Contact email required.' }, { status: 400 });
    contact = { ...(contact || {}), email: resolvedEmail, name: contact?.name ?? '', company: contact?.company ?? '' };
    const resolvedEmailLower = resolvedEmail.toLowerCase();

    const reportId = editingReportId || crypto.randomUUID();
    const isUpdate = !!editingReportId;
    const proto = request.headers.get('x-forwarded-proto') || 'https';
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3000';
    const baseUrl = `${proto}://${host}`;
    const reportUrl = `${baseUrl}/report?id=${reportId}`;
    const portalUrl = `${baseUrl}/portal`;
    const costAnalysisToken = crypto.randomBytes(24).toString('base64url');
    const leadScore = calculateLeadScore(contact, summary, automationScore, processes);
    const now = new Date().toISOString();

    const sbConfig = requireSupabase();
    let storedInSupabase = false;

    // Collect contributor emails automatically from sharing events
    const autoContributors = new Set();
    // Cost analyst is always a contributor
    if (costAnalystEmail) {
      const ca = (costAnalystEmail || '').trim().toLowerCase();
      if (ca && isValidEmail(ca) && ca !== resolvedEmailLower) autoContributors.add(ca);
    }
    // Fetch the progress record to see if the link was forwarded to someone
    if (sbConfig && progressId && !isUpdate) {
      try {
        const { url: supabaseUrl, key: supabaseKey } = sbConfig;
        const pgResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/diagnostic_progress?id=eq.${progressId}&select=email`, { method: 'GET', headers: getSupabaseHeaders(supabaseKey) });
        if (pgResp.ok) {
          const [pgRow] = await pgResp.json();
          const pgEmail = (pgRow?.email || '').trim().toLowerCase();
          if (pgEmail && isValidEmail(pgEmail) && pgEmail !== resolvedEmailLower) {
            autoContributors.add(pgEmail);
          }
        }
      } catch { /* non-fatal */ }
    }
    const contributorEmailsToSave = [...autoContributors];

    if (sbConfig) {
      const { url: supabaseUrl, key: supabaseKey } = sbConfig;
      try {
        const costAnalysisPending = (summary?.totalAnnualCost || 0) === 0 && diagnosticMode === 'comprehensive';
        let costStatus = costAnalysisPending ? 'pending' : 'complete';
        let costToken = costAnalysisPending ? costAnalysisToken : undefined;

        if (isUpdate) {
          const readResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}&select=diagnostic_data`, { method: 'GET', headers: getSupabaseHeaders(supabaseKey) });
          if (readResp.ok) {
            try {
              const [existing] = await readResp.json();
              const dd = existing?.diagnostic_data || {};
              if (dd.costAnalysisStatus === 'complete') {
                costStatus = 'complete';
                costToken = undefined;
              } else if (dd.costAnalysisToken) {
                costToken = dd.costAnalysisToken;
              }
            } catch { /* keep new token */ }
          }
        }

        const reportPayload = {
          id: reportId,
          display_code: !isUpdate ? generateDisplayCode() : undefined,
          contact_email: contact.email || '',
          contact_name: contact.name || '',
          company: contact.company || '',
          contributor_emails: contributorEmailsToSave,
          lead_score: leadScore.score,
          lead_grade: leadScore.grade,
          diagnostic_mode: diagnosticMode || 'comprehensive',
          segment: contact.segment || null,
          cost_analysis_status: costStatus,
          cost_analysis_token: costToken || null,
          cost_analysis_token_expires_at: costToken ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : null,
          total_annual_cost: summary?.totalAnnualCost || null,
          potential_savings: summary?.potentialSavings || null,
          automation_percentage: automationScore?.percentage || null,
          automation_grade: automationScore?.grade || null,
          diagnostic_data: {
            contact, summary, recommendations, automationScore, roadmap, processes, rawProcesses: rawProcesses || null, customDepartments: customDepartments || [], leadScore, diagnosticMode: diagnosticMode || 'comprehensive', auditTrail: (auditTrail || []).slice(-50),
            costAnalysisStatus: costStatus,
            ...(costToken ? { costAnalysisToken: costToken } : {}),
            // Seed the cost-authorized list with the cost analyst's email.
            // Only users in this list (or holders of the cost_analysis_token) can see cost data.
            costAuthorizedEmails: costAnalystEmail ? [(costAnalystEmail).trim().toLowerCase()] : [],
          },
          updated_at: now,
          ...(userId ? { user_id: userId } : {}),
          ...(parentReportId && !isUpdate ? { parent_report_id: parentReportId } : {}),
        };
        if (!isUpdate) reportPayload.created_at = timestamp || now;

        let sbResp;
        if (isUpdate) {
          const updatePayload = { ...reportPayload }; delete updatePayload.id; delete updatePayload.created_at;
          sbResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}`, { method: 'PATCH', headers: getSupabaseWriteHeaders(supabaseKey), body: JSON.stringify(updatePayload) });
        } else {
          sbResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/diagnostic_reports`, { method: 'POST', headers: getSupabaseWriteHeaders(supabaseKey), body: JSON.stringify(reportPayload) });
        }
        if (sbResp.ok || sbResp.status === 201 || sbResp.status === 204) storedInSupabase = true;
        else logger.warn('Supabase failed', { requestId: getRequestId(request), status: sbResp.status });

        if (storedInSupabase && !isUpdate) {
          scheduleFollowups(supabaseUrl, supabaseKey, reportId, contact, now, getRequestId(request));
          linkProgressRecord(supabaseUrl, supabaseKey, progressId, reportId, getRequestId(request));
        }
      } catch (sbErr) { logger.warn('Supabase error', { requestId: getRequestId(request), message: sbErr.message }); }
    }

    const notif = buildNotificationSummary(contact, summary, leadScore, automationScore);
    const n8nPayload = {
      requestType: 'diagnostic-complete',
      reportId,
      reportUrl,
      portalUrl,
      contact: {
        name: contact.name || '',
        email: contact.email || '',
        company: contact.company || '',
        segment: contact.segment || '',
      },
      leadScore: { score: leadScore.score, grade: leadScore.grade },
      summary: {
        totalProcesses: summary?.totalProcesses || 0,
        totalAnnualCost: summary?.totalAnnualCost || 0,
        potentialSavings: summary?.potentialSavings || 0,
      },
      automationScore: {
        percentage: automationScore?.percentage || 0,
        grade: automationScore?.grade || 'N/A',
      },
      notification: notif,
      timestamp: timestamp || now,
      contributorEmails: contributorEmailsToSave,
    };

    const { sent: webhookConfigured, body: webhookResponse } = await triggerWebhook(n8nPayload, { envSuffix: 'DIAGNOSTIC_COMPLETE', requestId: getRequestId(request) });

    const costAnalysisPending = (summary?.totalAnnualCost || 0) === 0 && diagnosticMode === 'comprehensive';
    const costAnalysisUrl = costAnalysisPending ? `${baseUrl}/cost-analysis?id=${reportId}&token=${costAnalysisToken}` : null;

    return NextResponse.json({
      success: true, reportId,
      reportUrl: storedInSupabase ? reportUrl : null,
      costAnalysisUrl: costAnalysisPending ? costAnalysisUrl : null,
      webhookConfigured, storedInSupabase, leadScore,
      message: webhookConfigured ? 'Report sent successfully.' : 'Report generated.',
      ...(webhookResponse || {}),
    });
  } catch (error) {
    logger.error('Send diagnostic report error', { requestId: getRequestId(request), error: error.message, stack: error.stack });
    return NextResponse.json({ error: 'Failed to process diagnostic report.' }, { status: 500 });
  }
}

async function scheduleFollowups(supabaseUrl, supabaseKey, reportId, contact, now, requestId) {
  try {
    const base = new Date(now);
    const rows = [
      { followup_type: 'day3', scheduled_for: new Date(base.getTime() + 3 * 86400000).toISOString() },
      { followup_type: 'day14', scheduled_for: new Date(base.getTime() + 14 * 86400000).toISOString() },
      { followup_type: 'day30', scheduled_for: new Date(base.getTime() + 30 * 86400000).toISOString() },
    ].map((r) => ({
      id: crypto.randomUUID(),
      report_id: reportId,
      contact_email: contact.email,
      // contact_name and company are sourced via FK join on report; not duplicated here
      ...r,
      status: 'pending',
      created_at: now,
    }));

    await fetchWithTimeout(`${supabaseUrl}/rest/v1/followup_events`, {
      method: 'POST',
      headers: { ...getSupabaseWriteHeaders(supabaseKey), 'Prefer': 'return=minimal' },
      body: JSON.stringify(rows),
    });
  } catch (err) {
    logger.warn('Failed to schedule follow-ups', { requestId, message: err.message });
  }
}

async function linkProgressRecord(supabaseUrl, supabaseKey, progressId, reportId, requestId) {
  if (!progressId) return;
  try {
    await fetchWithTimeout(`${supabaseUrl}/rest/v1/diagnostic_progress?id=eq.${encodeURIComponent(progressId)}`, {
      method: 'PATCH',
      headers: getSupabaseWriteHeaders(supabaseKey),
      body: JSON.stringify({ report_id: reportId }),
    });
  } catch (err) {
    logger.warn('Failed to link progress record to report', { requestId, message: err.message });
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
  const headline = `New Process Audit Completed: ${contact.company || 'Unknown Company'}`;
  const subject = `[${leadScore.grade}] New Process Audit: ${contact.company || 'Unknown'} - £${(cost / 1000).toFixed(0)}K annual cost`;
  return { headline, subject, priority: leadScore.grade === 'Hot' ? 'high' : leadScore.grade === 'Warm' ? 'medium' : 'low' };
}
