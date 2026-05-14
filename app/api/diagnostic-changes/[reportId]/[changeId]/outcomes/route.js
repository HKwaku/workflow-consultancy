/**
 * POST /api/diagnostic-changes/[reportId]/[changeId]/outcomes
 *
 * Report-side mirror of the deal outcomes endpoint. Same body shape;
 * auth via diagnostic_reports.contact_email.
 */

import { NextResponse } from 'next/server';
import {
  getSupabaseHeaders, fetchWithTimeout, requireSupabase,
  checkOrigin, isValidUUID, getRequestId,
} from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { recordOutcome } from '@/lib/changes/repo';
import { logger } from '@/lib/logger';

const VALID_SOURCES = new Set(['process_instance', 'report_rerun', 'manual', 'inferred_from_doc', 'agent']);

export async function POST(request, { params }) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });

  const { reportId, changeId } = await params;
  if (!reportId || typeof reportId !== 'string' || reportId.length > 64) {
    return NextResponse.json({ error: 'Valid report id required.' }, { status: 400 });
  }
  if (!isValidUUID(changeId)) return NextResponse.json({ error: 'Valid change id required.' }, { status: 400 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  const metric = String(body?.metric || '').trim();
  if (!metric) return NextResponse.json({ error: 'metric required.' }, { status: 400 });
  if (metric.length > 80) return NextResponse.json({ error: 'metric must be ≤ 80 chars.' }, { status: 400 });

  const source = String(body?.source || '').trim();
  if (!VALID_SOURCES.has(source)) {
    return NextResponse.json({ error: `source must be one of: ${[...VALID_SOURCES].join(', ')}.` }, { status: 400 });
  }

  const sb = requireSupabase();
  if (!sb) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });

  // Both the report ownership AND the change-belongs-to-this-report join.
  const ownerResp = await fetchWithTimeout(
    `${sb.url}/rest/v1/changes?id=eq.${encodeURIComponent(changeId)}&process_id=eq.${encodeURIComponent(reportId)}&select=id&limit=1`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  const owned = ownerResp.ok ? await ownerResp.json() : [];
  if (!owned.length) return NextResponse.json({ error: 'Change not found on this process.' }, { status: 404 });

  const reportResp = await fetchWithTimeout(
    `${sb.url}/rest/v1/processes?id=eq.${encodeURIComponent(reportId)}&contact_email=ilike.${encodeURIComponent(auth.email.toLowerCase())}&select=id&limit=1`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  const ownedReport = reportResp.ok ? await reportResp.json() : [];
  if (!ownedReport.length) return NextResponse.json({ error: 'Not your report.' }, { status: 403 });

  const result = await recordOutcome({
    change_id: changeId,
    metric,
    unit: body?.unit ? String(body.unit).slice(0, 20) : null,
    value_before: body?.value_before == null ? null : Number(body.value_before),
    value_after:  body?.value_after  == null ? null : Number(body.value_after),
    source,
    source_ref: body?.source_ref || null,
    notes: body?.notes ? String(body.notes).slice(0, 2000) : null,
  });
  if (!result.ok) {
    logger.warn('Outcome insert failed', { requestId: getRequestId(request), changeId });
    return NextResponse.json({ error: 'Failed to save outcome.' }, { status: 502 });
  }

  const fetchResp = await fetchWithTimeout(
    `${sb.url}/rest/v1/change_outcomes?change_id=eq.${encodeURIComponent(changeId)}&select=id,metric,unit,value_before,value_after,delta,source,measured_at&order=measured_at.desc&limit=1`,
    { method: 'GET', headers: getSupabaseHeaders(sb.key) },
  );
  const [outcome] = fetchResp.ok ? await fetchResp.json() : [];
  return NextResponse.json({ ok: true, outcome: outcome || null });
}
