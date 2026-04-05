import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase, getRequestId, checkOrigin } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { computeRedesignCostProfile } from '@/lib/computeRedesignCostProfile';

// PostgREST returns HTTP 409 or embeds Postgres error code 23505 in the body
function isUniqueViolation(status, body) {
  if (status === 409) return true;
  try { const j = JSON.parse(body); return j?.code === '23505'; } catch { return false; }
}

export async function POST(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });
  const auth = await requireAuth(request);
  if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
  const email = auth.email;

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  // Manual validation to avoid Zod 4 _zod bug with complex nested redesign objects
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const reportId = body.reportId != null ? String(body.reportId).trim() : '';
  const redesign = body.redesign;
  const mode = body.mode;
  const name = body.name != null ? String(body.name).trim() || null : null;
  const source = body.source === 'ai' ? 'ai' : body.source === 'human' ? 'human' : null;
  if (!reportId || reportId.length > 64) return NextResponse.json({ error: 'Valid report ID required.' }, { status: 400 });
  if (!redesign || typeof redesign !== 'object') return NextResponse.json({ error: 'Redesign object required.' }, { status: 400 });
  if (mode !== 'overwrite' && mode !== 'save_new') return NextResponse.json({ error: 'Mode must be overwrite or save_new.' }, { status: 400 });

  const sbConfig = requireSupabase();
  if (!sbConfig) return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
  const { url: supabaseUrl, key: supabaseKey } = sbConfig;

  const sbHeaders = { ...getSupabaseWriteHeaders(supabaseKey), 'Content-Type': 'application/json' };

  const reportUrl = `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}&contact_email=ilike.${encodeURIComponent(email.toLowerCase())}&select=id,diagnostic_data`;
  const reportResp = await fetchWithTimeout(reportUrl, { method: 'GET', headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, Accept: 'application/json' } });
  if (!reportResp.ok) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });
  const reportRows = await reportResp.json();
  if (!reportRows?.length) return NextResponse.json({ error: 'Report not found.' }, { status: 404 });

  const rdUrl = `${supabaseUrl}/rest/v1/report_redesigns?report_id=eq.${reportId}&select=id,created_at&order=created_at.desc`;
  const rdResp = await fetchWithTimeout(rdUrl, { method: 'GET', headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, Accept: 'application/json' } });
  const rdRows = rdResp.ok ? await rdResp.json() : [];

  const d = reportRows[0].diagnostic_data || {};
  const costProfile = d.costAnalysis ? (() => {
    try { return computeRedesignCostProfile(d, redesign); } catch { return null; }
  })() : null;

  try {
    if (mode === 'overwrite' && rdRows.length > 0) {
      const latestId = rdRows[0].id;
      const patchData = { ...redesign };
      if (source != null) patchData.source = source;
      if (costProfile) patchData.costProfile = costProfile;
      const patchBody = {
        redesign_data: patchData,
        decisions: {},
        status: 'pending',
        updated_at: new Date().toISOString(),
      };
      if (name != null) patchBody.name = name;
      const patchResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/report_redesigns?id=eq.${latestId}`, {
        method: 'PATCH',
        headers: sbHeaders,
        body: JSON.stringify(patchBody),
      });
      if (!patchResp.ok) {
        const errText = await patchResp.text();
        if (isUniqueViolation(patchResp.status, errText)) {
          return NextResponse.json({ error: 'Only one redesign can be accepted at a time. Reject the current accepted redesign first.', code: 'REDESIGN_ALREADY_ACCEPTED' }, { status: 409 });
        }
        logger.error('Save redesign: report_redesigns PATCH failed', { requestId: getRequestId(request), status: patchResp.status, body: errText?.slice(0, 500) });
        throw new Error('Redesign update failed: ' + (errText || patchResp.statusText));
      }
    } else {
      const postData = { ...redesign };
      if (source != null) postData.source = source;
      if (costProfile) postData.costProfile = costProfile;
      const postBody = {
        id: crypto.randomUUID(),
        report_id: reportId,
        redesign_data: postData,
        decisions: {},
        status: 'pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (name != null) postBody.name = name;
      const postResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/report_redesigns`, {
        method: 'POST',
        headers: sbHeaders,
        body: JSON.stringify(postBody),
      });
      if (!postResp.ok) {
        const errText = await postResp.text();
        if (isUniqueViolation(postResp.status, errText)) {
          return NextResponse.json({ error: 'Only one redesign can be accepted at a time. Reject the current accepted redesign first.', code: 'REDESIGN_ALREADY_ACCEPTED' }, { status: 409 });
        }
        logger.error('Save redesign: report_redesigns POST failed', { requestId: getRequestId(request), status: postResp.status, body: errText?.slice(0, 500) });
        throw new Error('Redesign save failed: ' + (errText || postResp.statusText));
      }
    }

    const auditEvent = {
      type: 'redesign_save',
      detail: mode === 'overwrite' ? 'Overwrote existing redesign' : 'Saved redesign as new version',
      timestamp: new Date().toISOString(),
      actor: email,
    };
    const auditTrail = [...(d.auditTrail || []), auditEvent].slice(-50);
    const reportPatchResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportId}`, {
      method: 'PATCH',
      headers: { ...sbHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({
        diagnostic_data: { ...d, redesign, auditTrail },
        updated_at: new Date().toISOString(),
      }),
    });
    if (!reportPatchResp.ok) {
      const errText = await reportPatchResp.text();
      logger.error('Save redesign: diagnostic_reports PATCH failed', { requestId: getRequestId(request), status: reportPatchResp.status, body: errText?.slice(0, 500) });
      throw new Error('Report update failed: ' + (errText || reportPatchResp.statusText));
    }

    return NextResponse.json({ success: true, reportId });
  } catch (err) {
    logger.error('Save redesign error', { requestId: getRequestId(request), error: err.message, stack: err.stack });
    const msg = process.env.NODE_ENV === 'development' ? err.message : 'Failed to save redesign.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
