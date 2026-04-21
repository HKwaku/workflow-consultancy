import { NextResponse } from 'next/server';
import {
  checkOrigin,
  getRequestId,
  requireSupabase,
  getSupabaseHeaders,
  getSupabaseWriteHeaders,
  fetchWithTimeout,
  isValidUUID,
  isValidEmail,
} from '@/lib/api-helpers';
import { verifySupabaseSession } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { z } from 'zod';

/**
 * Manage the `costAuthorizedEmails` list on a report.
 *
 * GET  ?id=<reportId>  → { ownerEmail, authorizedEmails: string[] }
 * PUT                   { reportId, authorizedEmails: string[] }
 *
 * Auth: must be the report owner (contact_email matches session email) or
 * a platform admin. Cost analysts themselves cannot manage the list.
 */

const PutSchema = z.object({
  reportId: z.string().min(1).max(64),
  authorizedEmails: z.array(z.string().email().max(254)).max(50),
});

function getPlatformAdmins() {
  return (process.env.PLATFORM_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeList(emails) {
  const seen = new Set();
  const out = [];
  for (const raw of emails) {
    if (!isValidEmail(raw)) continue;
    const lower = raw.trim().toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(lower);
  }
  return out;
}

export async function GET(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const id = request.nextUrl.searchParams.get('id');
  if (!id || !isValidUUID(id)) return NextResponse.json({ error: 'Valid report ID required.' }, { status: 400 });

  const session = await verifySupabaseSession(request);
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });

  const sbConfig = requireSupabase();
  if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const { url: supabaseUrl, key: supabaseKey } = sbConfig;

  const resp = await fetchWithTimeout(
    `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${id}&select=id,contact_email,diagnostic_data`,
    { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
  );
  if (!resp.ok) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });
  const rows = await resp.json();
  if (!rows?.length) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });

  const row = rows[0];
  const ownerEmail = (row.contact_email || '').toLowerCase();
  const sessionEmail = (session.email || '').toLowerCase();
  const admins = getPlatformAdmins();
  const isOwner = !!ownerEmail && ownerEmail === sessionEmail;
  const isAdmin = admins.includes(sessionEmail);

  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: 'Only the report owner can manage cost access.' }, { status: 403 });
  }

  const dd = row.diagnostic_data || {};
  const authorizedEmails = (dd.costAuthorizedEmails || [])
    .map((e) => String(e).toLowerCase())
    .filter((e) => e !== ownerEmail);

  return NextResponse.json({ success: true, ownerEmail, authorizedEmails });
}

export async function PUT(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const session = await verifySupabaseSession(request);
  if (!session) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });

  const { reportId, authorizedEmails } = parsed.data;
  if (!isValidUUID(reportId)) return NextResponse.json({ error: 'Valid report ID required.' }, { status: 400 });

  const sbConfig = requireSupabase();
  if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const { url: supabaseUrl, key: supabaseKey } = sbConfig;

  const readResp = await fetchWithTimeout(
    `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}&select=id,contact_email,diagnostic_data`,
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
    return NextResponse.json({ error: 'Only the report owner can manage cost access.' }, { status: 403 });
  }

  const dd = { ...(row.diagnostic_data || {}) };
  const normalized = normalizeList(authorizedEmails).filter((e) => e !== ownerEmail);
  // Always include the owner in the persisted list for downstream reads
  const persisted = ownerEmail ? [ownerEmail, ...normalized] : normalized;

  const patch = { diagnostic_data: { ...dd, costAuthorizedEmails: persisted } };

  const writeResp = await fetchWithTimeout(
    `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}`,
    { method: 'PATCH', headers: getSupabaseWriteHeaders(supabaseKey), body: JSON.stringify(patch) }
  );
  if (!writeResp.ok) {
    logger.warn('cost-authorized-emails PUT failed', { requestId: getRequestId(request), reportId, status: writeResp.status });
    return NextResponse.json({ error: 'Failed to update cost access.' }, { status: 500 });
  }

  return NextResponse.json({ success: true, ownerEmail, authorizedEmails: normalized });
}
