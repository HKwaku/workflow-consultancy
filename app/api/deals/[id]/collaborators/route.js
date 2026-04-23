import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout,
  requireSupabase, checkOrigin, getRequestId, isValidEmail,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { requireDealOwner } from '@/lib/dealAuth';
import { logger } from '@/lib/logger';

/**
 * POST /api/deals/[id]/collaborators
 * Owner-only. Adds one or more emails to deals.collaborator_emails.
 * Body: { emails: string[] }
 * Returns the updated list.
 */
export async function POST(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id: dealId } = await params;
  if (!dealId) return NextResponse.json({ error: 'Deal ID required.' }, { status: 400 });

  const guard = await requireDealOwner({ dealId, email: auth.email, userId: auth.userId });
  if (guard.error) return NextResponse.json(guard.error, { status: guard.status });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  const emails = Array.isArray(body.emails) ? body.emails : [];
  const clean = emails
    .map((e) => typeof e === 'string' ? e.trim().toLowerCase() : '')
    .filter(Boolean);
  if (!clean.length) return NextResponse.json({ error: 'At least one email required.' }, { status: 400 });
  for (const e of clean) {
    if (!isValidEmail(e)) return NextResponse.json({ error: `Invalid email: ${e}` }, { status: 400 });
  }

  // Merge with existing (dedup, skip owner email)
  const existing = Array.isArray(guard.access.deal.collaborator_emails) ? guard.access.deal.collaborator_emails : [];
  const ownerEmail = (guard.access.deal.owner_email || '').toLowerCase();
  const merged = Array.from(new Set([...existing.map((e) => e.toLowerCase()), ...clean]))
    .filter((e) => e !== ownerEmail);
  if (merged.length > 50) return NextResponse.json({ error: 'Maximum 50 collaborators per deal.' }, { status: 400 });

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/deals?id=eq.${encodeURIComponent(dealId)}`,
      { method: 'PATCH', headers: getSupabaseWriteHeaders(sb.key), body: JSON.stringify({ collaborator_emails: merged }) }
    );
    if (!resp.ok) return NextResponse.json({ error: 'Failed to update collaborators.' }, { status: 502 });
    return NextResponse.json({ success: true, collaboratorEmails: merged });
  } catch (err) {
    logger.error('Add collaborator error', { requestId: getRequestId(request), error: err.message });
    return NextResponse.json({ error: 'Failed to update collaborators.' }, { status: 500 });
  }
}

/**
 * DELETE /api/deals/[id]/collaborators?email=user@host
 * Owner-only. Removes one email from deals.collaborator_emails.
 */
export async function DELETE(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id: dealId } = await params;
  if (!dealId) return NextResponse.json({ error: 'Deal ID required.' }, { status: 400 });

  const email = (request.nextUrl.searchParams.get('email') || '').trim().toLowerCase();
  if (!email) return NextResponse.json({ error: 'email query param required.' }, { status: 400 });

  const guard = await requireDealOwner({ dealId, email: auth.email, userId: auth.userId });
  if (guard.error) return NextResponse.json(guard.error, { status: guard.status });

  const existing = Array.isArray(guard.access.deal.collaborator_emails) ? guard.access.deal.collaborator_emails : [];
  const next = existing.filter((e) => typeof e === 'string' && e.toLowerCase() !== email);

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  try {
    const resp = await fetchWithTimeout(
      `${sb.url}/rest/v1/deals?id=eq.${encodeURIComponent(dealId)}`,
      { method: 'PATCH', headers: getSupabaseWriteHeaders(sb.key), body: JSON.stringify({ collaborator_emails: next }) }
    );
    if (!resp.ok) return NextResponse.json({ error: 'Failed to update collaborators.' }, { status: 502 });
    return NextResponse.json({ success: true, collaboratorEmails: next });
  } catch (err) {
    logger.error('Remove collaborator error', { requestId: getRequestId(request), error: err.message });
    return NextResponse.json({ error: 'Failed to update collaborators.' }, { status: 500 });
  }
}
