import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSupabaseHeaders, getSupabaseWriteHeaders, fetchWithTimeout, requireSupabase, isValidEmail, checkOrigin, getRequestId } from '@/lib/api-helpers';
import { verifySupabaseSession } from '@/lib/auth';
import { resolveDefaultModelForUser } from '@/lib/operatingModel/auth';
import { SendDiagnosticReportInputSchema } from '@/lib/ai-schemas';
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
    let { focusedProcessId, editingReportId, contact, fallbackEmail, authToken, summary, recommendations, automationScore, roadmap, processes, rawProcesses, customDepartments, timestamp, userId, progressId, auditTrail, parentReportId, dealParticipantToken, dealCode, dealFlowId, dealId, operatingModelId, functionId } = parsed.data;
    // Living-workspace contract: prefer focusedProcessId (new key) over
    // editingReportId (legacy alias). Both mean "this is the live row
    // to upsert"; we collapse them into a single local that the rest of
    // the function uses.
    editingReportId = focusedProcessId || editingReportId;
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
    // Lead-scoring removed: it was a one-shot snapshot of "how qualified
    // is this user as a sales lead" — pure lead-gen artefact, irrelevant
    // to a living workspace.
    const now = new Date().toISOString();

    const sbConfig = requireSupabase();
    let storedInSupabase = false;
    let supabaseError = null;

    if (!sbConfig) {
      logger.warn('Supabase not configured - SUPABASE_URL or SUPABASE_SERVICE_KEY missing', { requestId: getRequestId(request) });
      supabaseError = 'Supabase not configured (missing env vars)';
    }

    // Collect contributor emails automatically from sharing events.
    // diagnostic_progress table dropped — handover-by-forwarded-link
    // no longer captures a second email. The cost-analyst hand-off is
    // also gone, so this is currently always an empty set; kept as the
    // collection point in case future sharing features need it.
    const autoContributors = new Set();
    const contributorEmailsToSave = [...autoContributors];

    // Resolve deal participant token → deal link data (non-fatal if missing/invalid)
    let dealLink = null; // { dealId, dealRole, participantId, dealFlowId? }
    if (dealParticipantToken && sbConfig && !editingReportId) {
      try {
        const { url: supabaseUrl, key: supabaseKey } = sbConfig;
        const dpResp = await fetchWithTimeout(
          `${supabaseUrl}/rest/v1/deal_participants?invite_token=eq.${encodeURIComponent(dealParticipantToken)}&select=id,deal_id,role,status`,
          { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
        );
        if (dpResp.ok) {
          const [dp] = await dpResp.json();
          if (dp && dp.status !== 'complete') {
            dealLink = { dealId: dp.deal_id, dealRole: dp.role, participantId: dp.id };
          }
        }
      } catch { /* non-fatal */ }
    }

    // Resolve deal flow id → deal link data (new multi-flow slot per company)
    if (!dealLink && dealFlowId && sbConfig && !editingReportId) {
      try {
        const { url: supabaseUrl, key: supabaseKey } = sbConfig;
        const flowResp = await fetchWithTimeout(
          `${supabaseUrl}/rest/v1/deal_flows?id=eq.${encodeURIComponent(dealFlowId)}&select=id,deal_id,participant_id,status,deal_participants(id,role,participant_email,status),deals(owner_email,collaborator_emails,status)`,
          { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
        );
        if (flowResp.ok) {
          const [flow] = await flowResp.json();
          const flowDeal = flow?.deals || null;
          const flowPart = flow?.deal_participants || null;
          if (flow && flowPart && flowDeal && flowDeal.status !== 'complete' && flow.status !== 'complete') {
            // Caller must be owner, collaborator, or the assigned participant email
            const callerLower = resolvedEmailLower;
            const ownerLower = (flowDeal.owner_email || '').toLowerCase();
            const collabLower = Array.isArray(flowDeal.collaborator_emails)
              ? flowDeal.collaborator_emails.map((e) => (typeof e === 'string' ? e.toLowerCase() : '')).filter(Boolean)
              : [];
            const partEmailLower = (flowPart.participant_email || '').toLowerCase();
            const authorized = callerLower === ownerLower || collabLower.includes(callerLower) || (!!partEmailLower && partEmailLower === callerLower);
            if (authorized) {
              dealLink = { dealId: flow.deal_id, dealRole: flowPart.role, participantId: flowPart.id, dealFlowId: flow.id };
            }
          }
        }
      } catch { /* non-fatal */ }
    }

    // Code-based flow: no pre-created participant; create one on-the-fly
    if (!dealLink && dealCode && sbConfig && !editingReportId) {
      const trimmedDealCode = (dealCode || '').trim().toUpperCase();
      if (/^[A-Z0-9]{4,20}$/.test(trimmedDealCode)) {
        try {
          const { url: supabaseUrl, key: supabaseKey } = sbConfig;
          // Find deal by code
          const dealResp = await fetchWithTimeout(
            `${supabaseUrl}/rest/v1/deals?deal_code=eq.${encodeURIComponent(trimmedDealCode)}&select=id,type,status,owner_email`,
            { method: 'GET', headers: getSupabaseHeaders(supabaseKey) }
          );
          if (dealResp.ok) {
            const [foundDeal] = await dealResp.json();
            if (foundDeal && foundDeal.status !== 'complete') {
              // Determine role from deal type
              const codeRole = foundDeal.type === 'ma' ? 'target' : foundDeal.type === 'pe_rollup' ? 'portfolio_company' : 'self';
              // Create participant on-the-fly
              const partResp = await fetchWithTimeout(
                `${supabaseUrl}/rest/v1/deal_participants`,
                {
                  method: 'POST',
                  headers: { ...getSupabaseWriteHeaders(supabaseKey), Prefer: 'return=representation' },
                  body: JSON.stringify({
                    deal_id: foundDeal.id,
                    role: codeRole,
                    company_name: contact?.company || 'Unknown',
                    participant_email: resolvedEmail || null,
                    participant_name: contact?.name || null,
                    invited_at: null,
                  }),
                }
              );
              if (partResp.ok) {
                const [newPart] = await partResp.json();
                if (newPart) dealLink = { dealId: foundDeal.id, dealRole: newPart.role, participantId: newPart.id };
              }
            }
          }
        } catch { /* non-fatal */ }
      }
    }

    // Fourth path — direct dealId from a signed-in user mapping inside
    // an existing deal scope (no invite token / no flow slot / no
    // dealCode prompt). Match the user's email against
    // deal_participants.participant_email on this deal. This is the
    // common case for an owner / collaborator mapping their own side.
    if (!dealLink && dealId && sbConfig && !editingReportId) {
      try {
        const { url: supabaseUrl, key: supabaseKey } = sbConfig;
        const dealResp = await fetchWithTimeout(
          `${supabaseUrl}/rest/v1/deals?id=eq.${encodeURIComponent(dealId)}&select=id,type,status,owner_email,collaborator_emails`,
          { method: 'GET', headers: getSupabaseHeaders(supabaseKey) },
        );
        if (dealResp.ok) {
          const [foundDeal] = await dealResp.json();
          if (foundDeal && foundDeal.status !== 'complete') {
            const ownerLower = (foundDeal.owner_email || '').toLowerCase();
            const collabLower = Array.isArray(foundDeal.collaborator_emails)
              ? foundDeal.collaborator_emails.map((e) => (typeof e === 'string' ? e.toLowerCase() : '')).filter(Boolean)
              : [];
            const isOwnerOrCollab = resolvedEmailLower === ownerLower || collabLower.includes(resolvedEmailLower);
            // Look for an existing participant on this deal that the
            // signed-in user owns (by email).
            const partsResp = await fetchWithTimeout(
              `${supabaseUrl}/rest/v1/deal_participants?deal_id=eq.${encodeURIComponent(dealId)}&select=id,role,participant_email,status,process_id`,
              { method: 'GET', headers: getSupabaseHeaders(supabaseKey) },
            );
            if (partsResp.ok) {
              const parts = await partsResp.json().catch(() => []);
              let myPart = (parts || []).find(
                (p) => (p.participant_email || '').toLowerCase() === resolvedEmailLower
                  && p.status !== 'complete',
              );
              // Owner/collaborator with no participant_email match: if
              // there's exactly ONE incomplete participant on the deal
              // and the caller is owner/collab, take that slot. This is
              // the pattern the user just described — owner mapping the
              // acquirer flow themselves before any specific email is
              // assigned to that participant.
              if (!myPart && isOwnerOrCollab) {
                const incomplete = (parts || []).filter((p) => p.status !== 'complete');
                if (incomplete.length === 1) myPart = incomplete[0];
              }
              if (myPart) {
                dealLink = { dealId, dealRole: myPart.role, participantId: myPart.id };
                // If the participant_email column was null, claim it
                // for the signed-in user so future presence + handover
                // mechanics can find them by email.
                if (!myPart.participant_email) {
                  try {
                    await fetchWithTimeout(
                      `${supabaseUrl}/rest/v1/deal_participants?id=eq.${encodeURIComponent(myPart.id)}`,
                      {
                        method: 'PATCH',
                        headers: { ...getSupabaseWriteHeaders(supabaseKey), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
                        body: JSON.stringify({ participant_email: resolvedEmailLower }),
                      },
                    );
                  } catch { /* non-fatal */ }
                }
              }
            }
          }
        }
      } catch (err) {
        logger.warn('Deal-id participant resolve failed', { requestId: getRequestId(request), error: err.message, dealId });
      }
    }

    if (sbConfig) {
      const { url: supabaseUrl, key: supabaseKey } = sbConfig;
      try {
        // Living-workspace contract: no consultant token, no
        // costAnalysisStatus gate, no costAuthorizedEmails list. The owner
        // edits costs directly on the canvas. The previous flow persisted
        // a token + 'pending' status to invite a cost analyst to fill in
        // the numbers via a separate URL — that surface was 410'd and the
        // dashboard link became inert. Stop persisting the fields so the
        // dashboard stops advertising a flow that doesn't work.

        // Guard: only write known segment values to the DB column (has a CHECK constraint).
        // Unknown values (e.g. a new module not yet in the migration) are stored in
        // diagnostic_data.contact.segment but not in the promoted column.
        const VALID_DB_SEGMENTS = ['scaling', 'ma', 'pe', 'highstakes', 'high-risk-ops'];
        const safeSegment = VALID_DB_SEGMENTS.includes(contact.segment) ? contact.segment : null;

        // Living-workspace contract: the row is the live state of the
        // process, not a captured submission. We DO NOT persist a
        // submission-time `summary` / `recommendations` / `automationScore`
        // / `leadScore` snapshot — those are derived on read from
        // rawProcesses[].steps[] via lib/processMetrics.js, and any
        // captured copy goes stale the moment the user edits a step.
        // The fields we keep on flow_data are the canvas state itself
        // (rawProcesses, processes, customDepartments), the contact +
        // segment metadata for routing, and the auditTrail tail.
        // Server-side model fallback. A brand-new standalone process
        // from a signed-in workspace user must land in their operating
        // model even when the client didn't send one: the /workspace/map
        // chat context frequently has no selectedOperatingModelId
        // client-side, so without this the row is created unfiled and is
        // invisible to the workspace ("I mapped a process but it's not in
        // the model"). Mirrors the chat agent's resolveActiveModelId and
        // the /api/update-diagnostic create path. Create only, only when
        // no explicit model was sent and this is not a deal flow.
        if (!isUpdate && !operatingModelId && !dealLink && resolvedEmail) {
          try {
            const rdm = await resolveDefaultModelForUser({ email: resolvedEmail });
            if (rdm?.modelId) operatingModelId = rdm.modelId;
          } catch (e) {
            logger.warn('send-diagnostic-report: model resolve failed on create (process will be unfiled)', { requestId: getRequestId(request), error: e.message });
          }
        }

        const reportPayload = {
          id: reportId,
          contact_email: contact.email || '',
          contact_name: contact.name || '',
          company: contact.company || '',
          segment: safeSegment,
          flow_data: {
            contact,
            processes,
            rawProcesses: rawProcesses || null,
            customDepartments: customDepartments || [],
            // auditTrail is NOT persisted any more — the `changes` table
            // is the canonical relational audit log. The in-memory
            // auditTrail array on DiagnosticContext stays as a real-time
            // activity feed for the UI; it just doesn't land in flow_data.
            //
            // costAnalysisToken / costAnalysisStatus / costAuthorizedEmails
            // are NOT persisted - the cost-analyst hand-off flow is gone.
          },
          updated_at: now,
          ...(userId ? { user_id: userId } : {}),
          ...(parentReportId && !isUpdate ? { parent_report_id: parentReportId } : {}),
          ...(dealLink && !isUpdate ? { deal_id: dealLink.dealId } : {}),
          ...(operatingModelId && !isUpdate ? { operating_model_id: operatingModelId } : {}),
          ...(functionId && !isUpdate     ? { function_id: functionId } : {}),
        };
        if (!isUpdate) reportPayload.created_at = timestamp || now;

        // Optional columns that may not exist in older deployed schemas.
        // After the living-workspace migration the dropped columns won't
        // be in the payload at all, so this list is much shorter.
        const OPTIONAL_COLUMNS = ['segment', 'deal_id', 'parent_report_id', 'operating_model_id', 'function_id'];

        async function attemptWrite(payload) {
          if (isUpdate) {
            const updatePayload = { ...payload }; delete updatePayload.id; delete updatePayload.created_at;
            return fetchWithTimeout(`${supabaseUrl}/rest/v1/processes?id=eq.${reportId}`, { method: 'PATCH', headers: getSupabaseWriteHeaders(supabaseKey), body: JSON.stringify(updatePayload) });
          }
          return fetchWithTimeout(`${supabaseUrl}/rest/v1/processes`, { method: 'POST', headers: getSupabaseWriteHeaders(supabaseKey), body: JSON.stringify(payload) });
        }

        let sbResp;
        let workingPayload = reportPayload;
        let lastBody = '';
        for (let attempt = 0; attempt < 8; attempt++) {
          sbResp = await attemptWrite(workingPayload);
          if (sbResp.ok || sbResp.status === 201 || sbResp.status === 204) { storedInSupabase = true; break; }
          lastBody = '';
          try { lastBody = await sbResp.text(); } catch { /* ignore */ }
          // PGRST204: missing column. Strip it and retry if it's in OPTIONAL_COLUMNS.
          const missingCol = (() => {
            try { const j = JSON.parse(lastBody); if (j?.code === 'PGRST204') { const m = (j.message || '').match(/'([^']+)' column/); return m ? m[1] : null; } } catch { /* not json */ }
            return null;
          })();
          if (missingCol && OPTIONAL_COLUMNS.includes(missingCol) && (missingCol in workingPayload)) {
            const next = { ...workingPayload }; delete next[missingCol];
            workingPayload = next;
            logger.warn('Supabase write: dropping missing column and retrying', { requestId: getRequestId(request), missingCol });
            continue;
          }
          break;
        }
        if (!storedInSupabase) {
          logger.warn('Supabase write failed', { requestId: getRequestId(request), status: sbResp.status, body: lastBody.slice(0, 500) });
          supabaseError = `Supabase write failed (${sbResp.status}): ${lastBody.slice(0, 200)}`;
        }

        // Living-workspace contract: link the process to the deal
        // participant + flow slot, but DO NOT freeze them. There is no
        // 'complete' terminal state — the participant keeps editing on
        // the live canvas. `maybeCompleteDeal` is also gone; deals
        // don't have a derived-complete state anymore.
        if (storedInSupabase && !isUpdate && dealLink) {
          const dealReqId = getRequestId(request);
          (async () => {
            await linkParticipantToProcess(supabaseUrl, supabaseKey, dealLink.participantId, reportId, dealReqId);
            if (dealLink.dealFlowId) {
              await linkFlowToProcess(supabaseUrl, supabaseKey, dealLink.dealFlowId, reportId, dealReqId);
            }
          })();
        }
      } catch (sbErr) {
        supabaseError = sbErr.message;
        logger.warn('Supabase error', { requestId: getRequestId(request), message: sbErr.message });
      }
    }

    // Living-workspace contract: this endpoint is just an upsert into
    // `processes`. There are no follow-on "deliverable" side effects
    // (no email notification, no lead-score snapshot, no cost-analysis
    // pending workflow). The earlier code shipped all of those — n8n
    // notification with lead-score/summary, separate cost-analysis
    // share link with pending state. All gone.
    void contributorEmailsToSave;

    return NextResponse.json({
      success: true,
      reportId,
      storedInSupabase,
      ...(supabaseError && { supabaseError }),
    });
  } catch (error) {
    logger.error('Send diagnostic report error', { requestId: getRequestId(request), error: error.message, stack: error.stack });
    return NextResponse.json({ error: 'Failed to process diagnostic report.' }, { status: 500 });
  }
}

// Link the process row to a deal_participant slot. Does NOT flip the
// participant to status='complete' — there is no terminal state in the
// living-workspace model; participants keep editing on the live canvas.
async function linkParticipantToProcess(supabaseUrl, supabaseKey, participantId, reportId, requestId) {
  try {
    await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/deal_participants?id=eq.${encodeURIComponent(participantId)}`,
      {
        method: 'PATCH',
        headers: getSupabaseWriteHeaders(supabaseKey),
        body: JSON.stringify({ process_id: reportId }),
      }
    );
  } catch (err) {
    logger.warn('Failed to link participant to process', { requestId, message: err.message });
  }
}

// Link the process row to a deal_flow slot. Does NOT flip the flow to
// status='complete'. The deal stays open as the participant keeps editing.
async function linkFlowToProcess(supabaseUrl, supabaseKey, dealFlowId, reportId, requestId) {
  try {
    await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/deal_flows?id=eq.${encodeURIComponent(dealFlowId)}`,
      {
        method: 'PATCH',
        headers: getSupabaseWriteHeaders(supabaseKey),
        body: JSON.stringify({ process_id: reportId }),
      }
    );
  } catch (err) {
    logger.warn('Failed to link flow to process', { requestId, message: err.message });
  }
}

// calculateLeadScore and buildNotificationSummary removed — both were
// lead-gen helpers for the email notification that a "new audit" had
// arrived. There is no "audit completion" event in the living model.
