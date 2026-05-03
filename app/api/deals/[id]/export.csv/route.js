/**
 * GET /api/deals/[id]/export.csv?type=findings|qa
 *
 * RFC-4180 CSV export of findings or Q&A items. Lawyers want CSVs to
 * massage in Excel; PPTX is for IC. Both types stream as
 * `text/csv; charset=utf-8` with a Content-Disposition that names the file
 * after the deal.
 *
 * Open to any deal viewer. Per-document visibility applied to findings
 * exports (mirrors scorecard) so participants can't pull findings whose
 * evidence they can't see.
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, fetchWithTimeout, requireSupabase, isValidUUID,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveDealAccess } from '@/lib/dealAuth';
import { canSeeDocument } from '@/lib/dealDocumentVisibility';

export const maxDuration = 30;

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(rows, columns) {
  const head = columns.map((c) => csvEscape(c.label)).join(',');
  const body = rows.map((r) =>
    columns.map((c) => csvEscape(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','),
  ).join('\r\n');
  // BOM so Excel auto-detects UTF-8 on Windows.
  return '﻿' + head + '\r\n' + body + (body ? '\r\n' : '');
}

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Valid deal id required.' }, { status: 400 });

  const access = await resolveDealAccess({ dealId: id, email: auth.email, userId: auth.userId });
  if (!access) return NextResponse.json({ error: 'Deal not found or access denied.' }, { status: 404 });

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  const type = (request.nextUrl.searchParams.get('type') || 'findings').toLowerCase();
  if (!['findings', 'qa'].includes(type)) {
    return NextResponse.json({ error: 'type must be "findings" or "qa".' }, { status: 400 });
  }

  // Resolve deal name for the filename + the latest analysis id for findings.
  const dealResp = await fetchWithTimeout(
    `${sb.url}/rest/v1/deals?id=eq.${id}&select=id,name,deal_code`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  const [deal] = dealResp.ok ? await dealResp.json() : [];
  const slug = (deal?.deal_code || deal?.name || id).toString().replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);

  let csv;
  let filename;

  if (type === 'qa') {
    const r = await fetchWithTimeout(
      `${sb.url}/rest/v1/deal_qa_items?deal_id=eq.${id}&select=question,asked_by_email,asked_at,assigned_company,status,answer_text,answered_by_email,answered_at,related_finding_key&order=asked_at.desc&limit=2000`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    );
    const items = r.ok ? await r.json() : [];
    csv = toCsv(items, [
      { label: 'question', key: 'question' },
      { label: 'asked_by', key: 'asked_by_email' },
      { label: 'asked_at', key: 'asked_at' },
      { label: 'assigned_company', key: 'assigned_company' },
      { label: 'status', key: 'status' },
      { label: 'answer', key: 'answer_text' },
      { label: 'answered_by', key: 'answered_by_email' },
      { label: 'answered_at', key: 'answered_at' },
      { label: 'related_finding_key', key: 'related_finding_key' },
    ]);
    filename = `${slug}-qa.csv`;
  } else {
    // Findings: pull from the latest completed analysis only — that's the
    // current state. Apply visibility filter so participants don't get
    // findings about docs they can't see.
    const latestResp = await fetchWithTimeout(
      `${sb.url}/rest/v1/deal_analyses?deal_id=eq.${id}&status=eq.complete&order=completed_at.desc&limit=1&select=id,mode,completed_at`,
      { method: 'GET', headers: getSupabaseHeaders(sb.key) },
    );
    const [latest] = latestResp.ok ? await latestResp.json() : [];
    let findings = [];
    if (latest?.id) {
      const fr = await fetchWithTimeout(
        `${sb.url}/rest/v1/deal_findings?analysis_id=eq.${latest.id}&select=finding_key,section,title,body,severity,confidence,category,tags,stale,evidence&order=order_index.asc&limit=2000`,
        { method: 'GET', headers: getSupabaseHeaders(sb.key) },
      );
      findings = fr.ok ? await fr.json() : [];

      if (access.mode === 'participant') {
        const docResp = await fetchWithTimeout(
          `${sb.url}/rest/v1/deal_documents?deal_id=eq.${id}&select=id,visibility,source_party`,
          { method: 'GET', headers: getSupabaseHeaders(sb.key) },
        );
        const docs = docResp.ok ? await docResp.json() : [];
        const visibleIds = new Set(docs
          .filter((d) => canSeeDocument({ document: d, viewerRole: access.participantRole, isOwner: false, isCollaborator: false }))
          .map((d) => d.id));
        findings = findings.filter((f) => {
          const ev = Array.isArray(f.evidence) ? f.evidence : [];
          if (ev.length === 0) return true;
          const docRefs = ev.map((e) => e?.document_id || e?.ref?.document_id).filter(Boolean);
          return docRefs.length === 0 || docRefs.some((d) => visibleIds.has(d));
        });
      }
    }
    csv = toCsv(findings, [
      { label: 'finding_key', key: 'finding_key' },
      { label: 'section', key: 'section' },
      { label: 'title', key: 'title' },
      { label: 'body', key: 'body' },
      { label: 'severity', key: 'severity' },
      { label: 'confidence', key: 'confidence' },
      { label: 'category', key: 'category' },
      { label: 'tags', get: (f) => Array.isArray(f.tags) ? f.tags.join(';') : '' },
      { label: 'stale', get: (f) => f.stale ? 'true' : 'false' },
      { label: 'evidence_count', get: (f) => Array.isArray(f.evidence) ? f.evidence.length : 0 },
    ]);
    filename = `${slug}-findings.csv`;
  }

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
