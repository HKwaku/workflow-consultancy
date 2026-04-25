import { NextResponse } from 'next/server';
import { checkOrigin, getRequestId, requireSupabase, getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, isValidEmail } from '@/lib/api-helpers';
import { verifySupabaseSession } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { triggerWebhook } from '@/lib/triggerWebhook';
import { logger } from '@/lib/logger';
import { z } from 'zod';

const ShareSchema = z.object({
  reportId: z.string().min(1).max(64),
  managerEmail: z.string().email().max(254),
  costUrl: z.string().url().max(2048),
  contactName: z.string().max(200).optional(),
  company: z.string().max(200).optional(),
});

function getPlatformAdmins() {
  return (process.env.PLATFORM_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function POST(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const session = await verifySupabaseSession(request);
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  const parsed = ShareSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const { reportId, managerEmail, costUrl, contactName, company } = parsed.data;

  const sbConfig = requireSupabase();
  if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const { url: supabaseUrl, key: supabaseKey } = sbConfig;

  // Verify caller owns the report (or is platform admin) before granting any access
  const readResp = await fetchWithTimeout(
    `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${encodeURIComponent(reportId)}&select=contributor_emails,contact_email,diagnostic_data`,
    { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
  );
  if (!readResp.ok) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });
  const rows = await readResp.json();
  if (!rows?.length) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });

  const row = rows[0];
  const ownerEmail = (row.contact_email || '').toLowerCase();
  const sessionEmail = (session.email || '').toLowerCase();
  const admins = getPlatformAdmins();
  const isOwner = !!ownerEmail && ownerEmail === sessionEmail;
  const isAdmin = admins.includes(sessionEmail);

  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: 'Only the report owner can share cost access.' }, { status: 403 });
  }

  const { sent } = await triggerWebhook({
    requestType: 'cost-analysis-share',
    reportId,
    managerEmail,
    costUrl,
    contactName: contactName || '',
    company: company || '',
    timestamp: new Date().toISOString(),
  }, { envSuffix: 'COST_ANALYSIS_SHARE', requestId: getRequestId(request) });

  if (!sent) {
    logger.warn('cost-analysis-share webhook not sent', { requestId: getRequestId(request), reportId });
  }

  // Add the manager as a contributor on the report so they can view it in their portal
  if (isValidEmail(managerEmail)) {
    const managerEmailLower = managerEmail.toLowerCase();
    try {
      if (row.contact_email?.toLowerCase() !== managerEmailLower) {
        const patch = {};

        // Add to contributor_emails for portal access
        const existing = row.contributor_emails || [];
        if (!existing.includes(managerEmailLower)) {
          patch.contributor_emails = [...existing, managerEmailLower];
        }

        // Add to costAuthorizedEmails so they can see cost data everywhere
        const dd = row.diagnostic_data || {};
        const authorized = (dd.costAuthorizedEmails || []).map(e => e.toLowerCase());
        if (!authorized.includes(managerEmailLower)) {
          patch.diagnostic_data = {
            ...dd,
            costAuthorizedEmails: [...authorized, managerEmailLower],
          };
        }

        if (Object.keys(patch).length > 0) {
          await fetchWithTimeout(
            `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${encodeURIComponent(reportId)}`,
            { method: 'PATCH', headers: getSupabaseWriteHeaders(supabaseKey), body: JSON.stringify(patch) }
          );
        }
      }
    } catch (err) {
      logger.warn('cost-analysis-share: failed to add contributor', { requestId: getRequestId(request), error: err.message });
    }
  }

  return NextResponse.json({ success: true, sent });
}
