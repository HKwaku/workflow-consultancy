import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSupabaseHeaders, getSupabaseWriteHeaders, requireSupabase, fetchWithTimeout, getRequestId, checkOrigin } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

/** Sanitize for JSON: remove undefined, avoid circular refs */
function sanitizeForJson(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForJson);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    try { out[k] = sanitizeForJson(v); } catch { /* skip */ }
  }
  return out;
}

export async function PUT(request) {
  try {
    const originErr = checkOrigin(request);
    if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });
    const auth = await requireAuth(request);
    if (auth.error) return NextResponse.json(auth.error.body, { status: auth.error.status });
    const email = auth.email;

    const rl = await checkRateLimit(getRateLimitKey(request));
    if (!rl.allowed) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

    const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
    if (contentLength > 2 * 1024 * 1024) return NextResponse.json({ error: 'Request body too large.' }, { status: 413 });

    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
    // Manual validation to avoid Zod 4 _zod bug with complex nested objects (acceptedProcesses, etc.)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    const reportId = body.reportId;
    const updates = body.updates;
    if (!reportId || typeof reportId !== 'string') return NextResponse.json({ error: 'Valid report ID required.' }, { status: 400 });
    if (!updates || typeof updates !== 'object') return NextResponse.json({ error: 'Updates object required.' }, { status: 400 });
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const reportIdTrimmed = String(reportId).trim();
    if (!uuidRegex.test(reportIdTrimmed)) return NextResponse.json({ error: 'Invalid report ID format.' }, { status: 400 });

    const sbConfig = requireSupabase();
    if (!sbConfig)
      return NextResponse.json({ error: 'Storage not configured.' }, { status: 503 });
    const { url: supabaseUrl, key: supabaseKey } = sbConfig;

    const readUrl = `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportIdTrimmed}&select=id,contact_email,diagnostic_data,implementation_status`;
    const readResp = await fetchWithTimeout(readUrl, { method: 'GET', headers: getSupabaseHeaders(supabaseKey) });
    if (!readResp.ok)
      return NextResponse.json({ error: 'Failed to read report.' }, { status: 502 });

    let rows;
    try { rows = await readResp.json(); } catch (e) { logger.error('Update diagnostic: Supabase parse error', { requestId: getRequestId(request), error: e.message }); return NextResponse.json({ error: 'Failed to read report.' }, { status: 502 }); }
    if (!rows || rows.length === 0)
      return NextResponse.json({ error: 'Report not found.' }, { status: 404 });

    const existing = rows[0];
    if (existing.contact_email?.toLowerCase() !== email.toLowerCase())
      return NextResponse.json({ error: 'You do not have permission to edit this report.' }, { status: 403 });

    const dd = existing.diagnostic_data || {};

    const topLevelPatch = { updated_at: new Date().toISOString() };
    if (updates.contactName) topLevelPatch.contact_name = updates.contactName;
    if (updates.contactEmail) topLevelPatch.contact_email = updates.contactEmail;
    if (updates.company !== undefined) topLevelPatch.company = updates.company;
    if (updates.leadScore !== undefined) topLevelPatch.lead_score = updates.leadScore;
    if (updates.leadGrade !== undefined) topLevelPatch.lead_grade = updates.leadGrade;

    if (updates.contact) dd.contact = { ...(dd.contact || {}), ...updates.contact };
    if (updates.summary) dd.summary = { ...(dd.summary || {}), ...updates.summary };
    if (updates.automationScore) dd.automationScore = { ...(dd.automationScore || {}), ...updates.automationScore };
    if (updates.processes && Array.isArray(updates.processes)) dd.processes = updates.processes;
    if (updates.rawProcesses && Array.isArray(updates.rawProcesses)) dd.rawProcesses = updates.rawProcesses;
    if (updates.flowLayouts && Array.isArray(updates.flowLayouts)) {
      const rp = Array.isArray(dd.rawProcesses) ? [...dd.rawProcesses] : [];
      for (const fl of updates.flowLayouts) {
        if (typeof fl.processIndex !== 'number' || fl.processIndex < 0) continue;
        // Ensure the target process entry exists — create a stub if rawProcesses
        // doesn't have one yet (e.g. older reports or summary-only diagnostics)
        if (!rp[fl.processIndex]) {
          const summaryProc = Array.isArray(dd.processes) ? dd.processes[fl.processIndex] : null;
          rp[fl.processIndex] = summaryProc ? { processName: summaryProc.name || 'Process', steps: [] } : { processName: 'Process', steps: [] };
        }
        const entry = { ...rp[fl.processIndex] };
        if (fl.flowNodePositions !== undefined) entry.flowNodePositions = fl.flowNodePositions;
        if (fl.flowCustomEdges !== undefined) entry.flowCustomEdges = fl.flowCustomEdges;
        if (fl.flowDeletedEdges !== undefined) entry.flowDeletedEdges = fl.flowDeletedEdges;
        rp[fl.processIndex] = entry;
      }
      dd.rawProcesses = rp;
    }
    if (updates.recommendations && Array.isArray(updates.recommendations)) dd.recommendations = updates.recommendations;
    if (updates.roadmap) dd.roadmap = updates.roadmap;
    if (updates.customDepartments && Array.isArray(updates.customDepartments)) dd.customDepartments = updates.customDepartments;
    if (updates.implementationStatus && typeof updates.implementationStatus === 'object') {
      topLevelPatch.implementation_status = { ...(existing.implementation_status || {}), ...updates.implementationStatus };
    }

    // Redesign updates go to the report_redesigns table
    if (updates.redesign && typeof updates.redesign === 'object') {
      try {
        const redesignId = updates.redesign.redesignId;
        const rejectAccepted = updates.redesign.rejectAccepted === true;

        if (rejectAccepted) {
          const accUrl = `${supabaseUrl}/rest/v1/report_redesigns?report_id=eq.${reportIdTrimmed}&status=eq.accepted&select=id`;
          const accResp = await fetchWithTimeout(accUrl, { method: 'GET', headers: getSupabaseHeaders(supabaseKey) });
          let accRows;
          try { accRows = accResp.ok ? await accResp.json() : []; } catch (e) { accRows = []; }
          if (accRows.length > 0) {
            const patchResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/report_redesigns?id=eq.${accRows[0].id}`, {
              method: 'PATCH', headers: getSupabaseWriteHeaders(supabaseKey),
              body: JSON.stringify({ status: 'pending', accepted_at: null, updated_at: new Date().toISOString() })
            });
            if (!patchResp.ok) throw new Error('Failed to reject accepted redesign.');
          }
        } else {
          const rdReadUrl = redesignId
            ? `${supabaseUrl}/rest/v1/report_redesigns?report_id=eq.${reportIdTrimmed}&id=eq.${redesignId}&select=id,redesign_data,decisions,status`
            : `${supabaseUrl}/rest/v1/report_redesigns?report_id=eq.${reportIdTrimmed}&select=id,redesign_data,decisions,status&order=created_at.desc&limit=1`;
          const rdResp = await fetchWithTimeout(rdReadUrl, { method: 'GET', headers: getSupabaseHeaders(supabaseKey) });
          let rdRows;
          try { rdRows = rdResp.ok ? await rdResp.json() : []; } catch (e) { rdRows = []; }

          if (updates.redesign.acceptedAt && rdRows.length > 0) {
            const targetId = rdRows[0].id;
            const accCheckUrl = `${supabaseUrl}/rest/v1/report_redesigns?report_id=eq.${reportIdTrimmed}&status=eq.accepted&select=id`;
            const accCheckResp = await fetchWithTimeout(accCheckUrl, { method: 'GET', headers: getSupabaseHeaders(supabaseKey) });
            let accCheckRows;
            try { accCheckRows = accCheckResp.ok ? await accCheckResp.json() : []; } catch (e) { accCheckRows = []; }
            if (accCheckRows.length > 0 && accCheckRows[0].id !== targetId) {
              return NextResponse.json({
                error: 'Only one redesign can be accepted at a time. Refer to the accepted redesign in your portal, or reject it first to accept a different one.',
                code: 'REDESIGN_ALREADY_ACCEPTED'
              }, { status: 400 });
            }
          }

          if (rdRows.length > 0) {
            const rd = rdRows[0];
            const rdPatch = { updated_at: new Date().toISOString() };
            if (updates.redesign.decisions) rdPatch.decisions = { ...(rd.decisions || {}), ...updates.redesign.decisions };
            if (updates.redesign.acceptedAt) {
              rdPatch.status = 'accepted';
              rdPatch.accepted_at = updates.redesign.acceptedAt;
            }
            if (updates.redesign.acceptedProcesses) {
              const procs = sanitizeForJson(updates.redesign.acceptedProcesses);
              rdPatch.redesign_data = { ...(rd.redesign_data || {}), acceptedProcesses: procs, optimisedProcesses: procs };
            }
            const rdPatchStr = JSON.stringify(rdPatch);
            const rdPatchResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/report_redesigns?id=eq.${rd.id}`, {
              method: 'PATCH', headers: getSupabaseWriteHeaders(supabaseKey), body: rdPatchStr
            });
            if (!rdPatchResp.ok) {
              const rdErr = await rdPatchResp.text();
              logger.error('Update diagnostic: report_redesigns PATCH failed', { requestId: getRequestId(request), status: rdPatchResp.status, body: rdErr?.slice(0, 500) });
              throw new Error('Redesign update failed: ' + (rdErr || rdPatchResp.statusText));
            }
          } else {
          const rdPayload = {
            id: crypto.randomUUID(), report_id: reportIdTrimmed,
            redesign_data: sanitizeForJson(updates.redesign), decisions: updates.redesign.decisions || {},
            status: updates.redesign.acceptedAt ? 'accepted' : 'pending',
            accepted_at: updates.redesign.acceptedAt || null,
            created_at: new Date().toISOString(), updated_at: new Date().toISOString()
          };
          const rdPostResp = await fetchWithTimeout(`${supabaseUrl}/rest/v1/report_redesigns`, {
            method: 'POST', headers: getSupabaseWriteHeaders(supabaseKey), body: JSON.stringify(rdPayload)
          });
          if (!rdPostResp.ok) {
            const rdErr = await rdPostResp.text();
            logger.error('Update diagnostic: report_redesigns POST failed', { requestId: getRequestId(request), status: rdPostResp.status, body: rdErr?.slice(0, 500) });
            throw new Error('Redesign save failed: ' + (rdErr || rdPostResp.statusText));
          }
        }
        }
      } catch (rdErr) { logger.warn('Redesign table update error', { requestId: getRequestId(request), message: rdErr.message }); }

      // Keep backward compatibility: also store in diagnostic_data
      dd.redesign = { ...(dd.redesign || {}), ...sanitizeForJson(updates.redesign) };
    }

    // Redesign flow layout saves — patch only the flow fields on processes within report_redesigns
    if (updates.redesignFlowLayouts && Array.isArray(updates.redesignFlowLayouts)) {
      for (const fl of updates.redesignFlowLayouts) {
        const { redesignId: flRedesignId, processIndex: flIdx, flowNodePositions, flowCustomEdges, flowDeletedEdges } = fl;
        if (!flRedesignId || typeof flIdx !== 'number' || flIdx < 0) continue;
        try {
          const rdUrl = `${supabaseUrl}/rest/v1/report_redesigns?id=eq.${flRedesignId}&report_id=eq.${reportIdTrimmed}&select=id,redesign_data`;
          const rdResp = await fetchWithTimeout(rdUrl, { method: 'GET', headers: getSupabaseHeaders(supabaseKey) });
          if (!rdResp.ok) continue;
          const rdRows = await rdResp.json().catch(() => []);
          if (!rdRows?.length) continue;
          const rdData = sanitizeForJson(rdRows[0].redesign_data || {});
          const updateProcs = (arr) => {
            if (!Array.isArray(arr) || !arr[flIdx]) return arr;
            const updated = [...arr];
            updated[flIdx] = {
              ...updated[flIdx],
              ...(flowNodePositions !== undefined && { flowNodePositions }),
              ...(flowCustomEdges !== undefined && { flowCustomEdges }),
              ...(flowDeletedEdges !== undefined && { flowDeletedEdges }),
            };
            return updated;
          };
          if (rdData.acceptedProcesses) rdData.acceptedProcesses = updateProcs(rdData.acceptedProcesses);
          if (rdData.optimisedProcesses) rdData.optimisedProcesses = updateProcs(rdData.optimisedProcesses);
          await fetchWithTimeout(`${supabaseUrl}/rest/v1/report_redesigns?id=eq.${flRedesignId}`, {
            method: 'PATCH', headers: getSupabaseWriteHeaders(supabaseKey),
            body: JSON.stringify({ redesign_data: rdData, updated_at: new Date().toISOString() }),
          });
        } catch (flErr) { logger.warn('Redesign flow layout update error', { requestId: getRequestId(request), message: flErr.message }); }
      }
    }

    const patchBody = { ...topLevelPatch, diagnostic_data: sanitizeForJson(dd) };
    const writeUrl = `${supabaseUrl}/rest/v1/diagnostic_reports?id=eq.${reportIdTrimmed}`;
    let patchStr;
    try {
      patchStr = JSON.stringify(patchBody);
    } catch (serializeErr) {
      logger.error('Update diagnostic: JSON serialize error', { requestId: getRequestId(request), error: serializeErr.message });
      return NextResponse.json({ error: 'Invalid data structure. Please try again.' }, { status: 400 });
    }
    const writeResp = await fetchWithTimeout(writeUrl, {
      method: 'PATCH', headers: getSupabaseWriteHeaders(supabaseKey), body: patchStr
    });

    if (!writeResp.ok) {
      const t = await writeResp.text();
      logger.error('Update diagnostic: Supabase write failed', { requestId: getRequestId(request), status: writeResp.status, body: t?.slice(0, 500) });
      return NextResponse.json({ error: 'Write failed: ' + (t || writeResp.statusText) }, { status: 502 });
    }

    return NextResponse.json({ success: true, message: 'Report updated.' });
  } catch (err) {
    logger.error('Update diagnostic error', { requestId: getRequestId(request), error: err.message, stack: err.stack });
    const msg = process.env.NODE_ENV === 'development' ? err.message : 'Failed to update report.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
