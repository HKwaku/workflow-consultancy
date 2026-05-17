import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSupabaseHeaders, getSupabaseWriteHeaders, requireSupabase, fetchWithTimeout, getRequestId, checkOrigin } from '@/lib/api-helpers';
import { requireAuth } from '@/lib/auth';
import { resolveDefaultModelForUser } from '@/lib/operatingModel/auth';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { transitionChangesForRedesign, recordChanges } from '@/lib/changes/repo';
import { diffStepsForChangelog } from '@/lib/changes/serverDiff';
import { syncProcessSystemsForReport } from '@/lib/operatingModel/processSystems';

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

    // Living-workspace migration: target_data + state_kind are gone.
    // A process is a single living thing; there's no separate "target"
    // surface. Reject explicit target writes with a clear message.
    if (body.surface === 'target') {
      return NextResponse.json(
        { error: 'Target-state writes have been removed. Edit the live process directly.' },
        { status: 410 },
      );
    }

    // implementation_status: the column still exists on the table from
    // an earlier migration but nothing reads it. Skipped here so we don't
    // accidentally read-modify-write a frozen "checklist of stuff you
    // said you'd do" — that surface was deleted with the report-gen UI.
    const readUrl = `${supabaseUrl}/rest/v1/processes?id=eq.${reportIdTrimmed}&select=id,contact_email,flow_data,operating_model_id,function_id`;
    const readResp = await fetchWithTimeout(readUrl, { method: 'GET', headers: getSupabaseHeaders(supabaseKey) });
    if (!readResp.ok)
      return NextResponse.json({ error: 'Failed to read report.' }, { status: 502 });

    let rows;
    try { rows = await readResp.json(); } catch (e) { logger.error('Update diagnostic: Supabase parse error', { requestId: getRequestId(request), error: e.message }); return NextResponse.json({ error: 'Failed to read report.' }, { status: 502 }); }

    // Living-workspace contract: this endpoint is an upsert. If the row
    // doesn't exist, the caller is creating a new process and we mint
    // the row with their email as owner. No special "first save" path;
    // intake and edit are the same write.
    const isCreate = !rows || rows.length === 0;
    let existing;
    if (isCreate) {
      const nowIso = new Date().toISOString();

      // Attach the new process to the user's operating model. Without
      // this it lands with operating_model_id = NULL and is invisible
      // to the workspace (the list / rollup filter by operating_model_id):
      // "I mapped a process but it's not in the model". The
      // create_process Confirm-card path sets this already; this is the
      // generic first-save path (the chat step-tools autosave a brand-new
      // process here), so it has to resolve the model too. Prefer an
      // explicit id from the client (the model the user is looking at);
      // fall back to their active/default model server-side so the link
      // is correct no matter which path minted the row. Deal-participant
      // maps are created via the deal endpoints, not here, so a generic
      // authenticated create is always the standalone-workspace case.
      let createModelId =
        (typeof body.operatingModelId === 'string' && uuidRegex.test(body.operatingModelId.trim()))
          ? body.operatingModelId.trim()
          : null;
      const createFunctionId =
        (typeof body.functionId === 'string' && uuidRegex.test(body.functionId.trim()))
          ? body.functionId.trim()
          : null;
      if (!createModelId) {
        try {
          const resolved = await resolveDefaultModelForUser({ email });
          if (resolved?.modelId) createModelId = resolved.modelId;
        } catch (e) {
          logger.warn('update-diagnostic: model resolve failed on create (process will be unfiled)', { requestId: getRequestId(request), error: e.message });
        }
      }

      const seedPayload = {
        id: reportIdTrimmed,
        contact_email: email,
        contact_name: updates?.contactName || updates?.contact?.name || '',
        company: updates?.company || updates?.contact?.company || '',
        flow_data: {},
        operating_model_id: createModelId,
        function_id: createModelId ? createFunctionId : null,
        created_at: nowIso,
        updated_at: nowIso,
      };
      const seedResp = await fetchWithTimeout(
        `${supabaseUrl}/rest/v1/processes`,
        {
          method: 'POST',
          headers: { ...getSupabaseWriteHeaders(supabaseKey), Prefer: 'return=representation' },
          body: JSON.stringify(seedPayload),
        },
      );
      if (!seedResp.ok && seedResp.status !== 201 && seedResp.status !== 204) {
        const txt = await seedResp.text().catch(() => '');
        logger.warn('Upsert create failed', { requestId: getRequestId(request), status: seedResp.status, body: txt?.slice(0, 300) });
        return NextResponse.json({ error: 'Failed to create process.' }, { status: 502 });
      }
      existing = {
        id: reportIdTrimmed,
        contact_email: email,
        flow_data: {},
        operating_model_id: createModelId,
        function_id: createModelId ? createFunctionId : null,
      };
    } else {
      existing = rows[0];
      if (existing.contact_email?.toLowerCase() !== email.toLowerCase()) {
        return NextResponse.json({ error: 'You do not have permission to edit this process.' }, { status: 403 });
      }
    }

    const dd = existing.flow_data || {};
    // Snapshot the OLD rawProcesses BEFORE the merge mutates dd, so
    // we can diff for the relational changelog after the PATCH lands.
    const oldRawForDiff = Array.isArray(dd.rawProcesses)
      ? JSON.parse(JSON.stringify(dd.rawProcesses))
      : [];

    const topLevelPatch = { updated_at: new Date().toISOString() };
    if (updates.contactName) topLevelPatch.contact_name = updates.contactName;
    if (updates.contactEmail) topLevelPatch.contact_email = updates.contactEmail;
    if (updates.company !== undefined) topLevelPatch.company = updates.company;

    // Self-heal: a process orphaned by the old create path (operating_
    // model_id NULL → invisible to the workspace) gets adopted into the
    // model the user is viewing the next time they save it. Strictly
    // fill-only: we never move a process that already has a model, and
    // only when the client explicitly sends the model it's looking at
    // (not for deal flows, which don't send it). function_id is filled
    // alongside only if the row also has none.
    if (!isCreate && !existing.operating_model_id
        && typeof body.operatingModelId === 'string' && uuidRegex.test(body.operatingModelId.trim())) {
      topLevelPatch.operating_model_id = body.operatingModelId.trim();
      if (!existing.function_id
          && typeof body.functionId === 'string' && uuidRegex.test(body.functionId.trim())) {
        topLevelPatch.function_id = body.functionId.trim();
      }
    }
    // lead_score / lead_grade columns dropped (lead-gen artefacts).
    // Silently swallow any client that still sends them.

    if (updates.contact) dd.contact = { ...(dd.contact || {}), ...updates.contact };
    // Living-workspace contract: `summary` / `automationScore` /
    // `recommendations` are NOT persisted. They were submission-time
    // snapshots that went stale the moment the user edited a step. All
    // three derive on read now (lib/processMetrics.js for cost/savings/
    // automation; the chat agent computes recommendations live from
    // step structure). We silently drop any incoming payload that
    // tries to write them — back-compat for older clients, but the
    // fields stay empty on the row going forward. Any pre-migration
    // rows that still carry them are read-only history; nothing in the
    // codebase should consume them. Also strip them from `dd` so a
    // subsequent merge doesn't preserve stale values from before.
    delete dd.summary;
    delete dd.automationScore;
    delete dd.recommendations;
    delete dd.aiRecommendations;
    if (updates.processes && Array.isArray(updates.processes)) dd.processes = updates.processes;
    if (updates.rawProcesses && Array.isArray(updates.rawProcesses)) dd.rawProcesses = updates.rawProcesses;
    if (updates.flowLayouts && Array.isArray(updates.flowLayouts)) {
      const rp = Array.isArray(dd.rawProcesses) ? [...dd.rawProcesses] : [];
      for (const fl of updates.flowLayouts) {
        if (typeof fl.processIndex !== 'number' || fl.processIndex < 0) continue;
        // Ensure the target process entry exists - create a stub if rawProcesses
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
    // `updates.recommendations` is no longer accepted — see the
    // delete-dd.recommendations block above. `roadmap` was a
    // companion snapshot; drop it the same way.
    delete dd.roadmap;
    if (updates.customDepartments && Array.isArray(updates.customDepartments)) dd.customDepartments = updates.customDepartments;
    // updates.implementationStatus is silently dropped — the ImplementationTracker
    // surface was a snapshot-era "tick off your recommendations" widget that
    // never gets rendered in the living workspace. The DB column still
    // exists on processes but no read path surfaces it.

    // Living-workspace migration: the report_redesigns table is dropped.
    // Redesigns no longer exist as a separate snapshot artefact; AI
    // suggestions become inline `changes` rows that the user accepts
    // in-place. Any `redesign` / `redesignFlowLayouts` keys on the
    // update body are swallowed here — silently for back-compat.

    const patchBody = { ...topLevelPatch, flow_data: sanitizeForJson(dd) };
    const writeUrl = `${supabaseUrl}/rest/v1/processes?id=eq.${reportIdTrimmed}`;
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

    // Living-workspace contract: capture inline edits in the relational
    // changelog. The client records discrete events (addStep, removeStep,
    // moveStep) at the moment of the click; this diff catches everything
    // else — typed renames, department changes, work/wait minutes,
    // boolean flips, workspace-anchor edits. Only 'modified' rows are
    // emitted; 'added'/'removed'/'reordered' are exclusively client-
    // side to avoid double-recording.
    if (Array.isArray(updates.rawProcesses)) {
      try {
        const diffRows = diffStepsForChangelog(oldRawForDiff, dd.rawProcesses, {
          processId: reportIdTrimmed,
          actorEmail: email,
        });
        if (diffRows.length) await recordChanges(diffRows);
      } catch (e) {
        logger.warn('Server-side diff for changelog failed', { requestId: getRequestId(request), error: e.message });
      }
    }

    // If this report is linked to a deal_flow, bump its updated_at so
    // recent-activity surfaces show the edit. Non-fatal.
    try {
      await fetchWithTimeout(
        `${supabaseUrl}/rest/v1/deal_flows?process_id=eq.${encodeURIComponent(reportIdTrimmed)}`,
        {
          method: 'PATCH',
          headers: getSupabaseWriteHeaders(supabaseKey),
          body: JSON.stringify({ updated_at: new Date().toISOString() }),
        }
      );
    } catch (touchErr) {
      logger.warn('deal_flows touch on edit failed', { requestId: getRequestId(request), message: touchErr.message });
    }

    // Best-effort: keep the process_systems join in sync with the canvas.
    // Cross-process system inventory queries depend on this being fresh.
    // Failure here never blocks the save — workspace UI still works without
    // the join (it just won't show this process in inventory views until
    // the next save lands).
    syncProcessSystemsForReport({
      reportId: reportIdTrimmed,
      diagnosticData: dd,
      operatingModelId: existing.operating_model_id || null,
      functionId: existing.function_id || null,
    }).catch((e) => logger.warn('process_systems sync threw', {
      requestId: getRequestId(request), message: e.message,
    }));

    return NextResponse.json({ success: true, message: 'Report updated.' });
  } catch (err) {
    logger.error('Update diagnostic error', { requestId: getRequestId(request), error: err.message, stack: err.stack });
    const msg = process.env.NODE_ENV === 'development' ? err.message : 'Failed to update report.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
