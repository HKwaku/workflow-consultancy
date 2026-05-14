/**
 * GET /api/deals/[id]/activity?limit=...&since=...
 *
 * Per-deal activity timeline. Unions:
 *   • audit_logs entries scoped to deal_id (uploads, doc opens, deletes,
 *     access events, GDPR exports, etc.)
 *   • deal_qa_items lifecycle (asked, answered, skipped)
 *   • deal_finding_comments posts
 *   • deal_documents inserts (covered by audit_logs but de-duped here)
 *
 * Open to any deal viewer. Each item shape:
 *   { id, kind, at, actor, summary, details? }
 *
 * The composer is a single PostgREST round-trip per source (parallel) so
 * the timeline endpoint stays fast even on large deals.
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, fetchWithTimeout, requireSupabase, isValidUUID,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveDealAccess } from '@/lib/dealAuth';

export const maxDuration = 15;

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Valid deal id required.' }, { status: 400 });

  const access = await resolveDealAccess({ dealId: id, email: auth.email, userId: auth.userId });
  if (!access) return NextResponse.json({ error: 'Deal not found or access denied.' }, { status: 404 });

  const sp = request.nextUrl.searchParams;
  const limit = Math.max(10, Math.min(Number(sp.get('limit') || 200), 500));

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  const [auditR, qaR, commentsR] = await Promise.all([
    fetchWithTimeout(
      `${sb.url}/rest/v1/audit_logs?deal_id=eq.${id}&select=id,actor_email,actor_kind,action,target_type,target_id,outcome,details,created_at&order=created_at.desc&limit=${limit}`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    ),
    fetchWithTimeout(
      `${sb.url}/rest/v1/deal_qa_items?deal_id=eq.${id}&select=id,question,asked_by_email,asked_at,answered_by_email,answered_at,status&order=asked_at.desc&limit=${limit}`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    ),
    fetchWithTimeout(
      `${sb.url}/rest/v1/deal_finding_comments?deal_id=eq.${id}&select=id,finding_key,author_email,body,created_at&order=created_at.desc&limit=${limit}`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    ),
  ]);

  const audit    = auditR.ok    ? await auditR.json()    : [];
  const qa       = qaR.ok       ? await qaR.json()       : [];
  const comments = commentsR.ok ? await commentsR.json() : [];

  const items = [];

  for (const a of audit) {
    items.push({
      id: `audit:${a.id}`,
      kind: 'audit',
      action: a.action,
      at: a.created_at,
      actor: a.actor_email || a.actor_kind || 'system',
      summary: humaniseAudit(a),
      details: { target_type: a.target_type, target_id: a.target_id, outcome: a.outcome, ...(a.details || {}) },
    });
  }
  for (const q of qa) {
    items.push({
      id: `qa-asked:${q.id}`,
      kind: 'qa_asked',
      at: q.asked_at,
      actor: q.asked_by_email,
      summary: `Asked: ${(q.question || '').slice(0, 100)}`,
      details: { qa_id: q.id, status: q.status },
    });
    if (q.answered_at) {
      items.push({
        id: `qa-answered:${q.id}`,
        kind: 'qa_answered',
        at: q.answered_at,
        actor: q.answered_by_email,
        summary: `Answered: ${(q.question || '').slice(0, 100)}`,
        details: { qa_id: q.id },
      });
    }
  }
  for (const c of comments) {
    items.push({
      id: `comment:${c.id}`,
      kind: 'finding_comment',
      at: c.created_at,
      actor: c.author_email,
      summary: `Commented on a finding: ${(c.body || '').slice(0, 100)}`,
      details: { finding_key: c.finding_key },
    });
  }

  items.sort((a, b) => new Date(b.at) - new Date(a.at));
  return NextResponse.json({ items: items.slice(0, limit) });
}

function humaniseAudit(a) {
  const action = a.action || 'event';
  const target = a.target_type ? `${a.target_type}` : '';
  if (action.startsWith('document.')) return `${action.replace('document.', 'Document ')}${target ? ' · ' + target : ''}`;
  if (action.startsWith('participant.')) return action.replace('participant.', 'Participant ').replace(/_/g, ' ');
  if (action.startsWith('finding.')) return action.replace('finding.', 'Finding ').replace(/_/g, ' ');
  if (action.startsWith('deal.')) return action.replace('deal.', 'Deal ').replace(/_/g, ' ');
  return action.replace(/[._]/g, ' ');
}
