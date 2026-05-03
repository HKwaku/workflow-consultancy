import { NextResponse } from 'next/server';
import { stripEmDashes, checkOrigin, getRequestId } from '@/lib/api-helpers';
import { DiagnosticChatInputSchema } from '@/lib/ai-schemas';
import { runChatAgent } from '@/lib/agents/chat/graph';
import { runRedesignChatAgent } from '@/lib/agents/redesign-chat/graph';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { buildSessionContext } from '@/lib/chatPersistence';
import { verifySupabaseSession } from '@/lib/auth';
import { resolveDealAccess } from '@/lib/dealAuth';
import { resolveActiveKey } from '@/lib/customerKey';
import { getOrgIdForUser } from '@/lib/costGuard';
import { requireBudgetClearance } from '@/lib/trialBudget';
import { resolveAllowedModels } from '@/lib/orgModels';
import { logger } from '@/lib/logger';

export const maxDuration = 60;

const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024; // 2MB

export async function POST(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

  const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
  if (contentLength > MAX_PAYLOAD_BYTES) return NextResponse.json({ error: 'Request body too large.' }, { status: 413 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  const parsed = DiagnosticChatInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Message or attachments required.' }, { status: 400 });
  const { message, currentSteps, currentHandoffs, processName, history, incompleteInfo, phaseState, attachments, editingReportId, editingRedesign, redesignContext, segment, dealId, model: requestedModel } = parsed.data;
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured.' }, { status: 500 });

  // Authenticated users get cross-session memory injected into the system
  // prompt - prior processes, recent conversations. Anonymous flows run
  // without context, same as before. Failures are swallowed: missing
  // context is a soft downgrade, never a reason to block the chat.
  let sessionContext = null;
  let sessionInfo = null;
  try {
    const session = await verifySupabaseSession(request);
    if (session) {
      sessionInfo = { userId: session.userId, email: session.email };
      sessionContext = await buildSessionContext({
        email: session.email,
        userId: session.userId,
        excludeReportId: editingReportId,
      });
    }
  } catch (err) {
    logger.warn('Session context build failed', { error: err.message });
  }

  // Trial-budget gate. Signed-in users without an org get a one-shot
  // platform allowance (default 50k tokens). Once exhausted, we 402 with
  // a `gateAction: 'create_org'` payload so the client can render the
  // create-org / paste-key banner. Anonymous + org-tier users pass
  // through; their spend is bounded by the rate-limit and the existing
  // org budget respectively.
  if (sessionInfo) {
    try {
      const gate = await requireBudgetClearance(sessionInfo);
      if (!gate.allowed) {
        return NextResponse.json({
          error: gate.message,
          gateAction: gate.gateAction,
          reason: gate.reason,
        }, { status: 402 });
      }
    } catch (err) {
      logger.warn('Trial budget clearance check failed (allowing chat)', { error: err.message });
    }
  }

  // Resolve customer-managed Anthropic key, if the user belongs to an org
  // that has set one. Pass through to runChatAgent so streaming uses the
  // customer's key (Anthropic charges them directly). Falls back to the
  // platform key automatically.
  let resolvedApiKey = null;
  let resolvedOrgId = null;
  let hasCustomerKey = false;
  if (sessionInfo) {
    try {
      resolvedOrgId = await getOrgIdForUser({ email: sessionInfo.email, userId: sessionInfo.userId });
      if (resolvedOrgId) {
        const k = await resolveActiveKey({ orgId: resolvedOrgId, vendor: 'anthropic' });
        if (k.source === 'customer') { resolvedApiKey = k.key; hasCustomerKey = true; }
      }
    } catch (err) {
      logger.warn('Customer key resolution failed (falling back to platform)', { error: err.message });
    }
  }

  // Resolve which model to use. Validate the requested model against the
  // org's allowlist; refuse silently → fall back to default rather than
  // 4xx-ing the chat (the picker should never offer a forbidden model;
  // this is defence in depth for tampered requests).
  let resolvedModel = null;
  try {
    const models = await resolveAllowedModels({ orgId: resolvedOrgId, hasCustomerKey });
    if (requestedModel && models.allowed.includes(requestedModel)) {
      resolvedModel = requestedModel;
    } else {
      if (requestedModel) {
        logger.warn('Chat requested model outside allowlist; falling back to default', {
          requestedModel, orgId: resolvedOrgId,
        });
      }
      resolvedModel = models.default;
    }
  } catch (err) {
    logger.warn('Model resolution failed; agent will use built-in default', { error: err.message });
  }

  // SECURITY: validate deal access before forwarding dealId to the chat agent.
  // search_deal_documents (chat tool) calls Postgres via the service-role key,
  // which bypasses RLS. Without this check, any authenticated user could pass
  // an arbitrary deal UUID in the request body and read its document chunks.
  // We drop dealId on access failure (rather than 403'ing the whole chat) so
  // non-deal conversations still work — the tool itself refuses without a
  // verified dealAccess flag.
  let verifiedDealId = null;
  let dealAccessVerified = false;
  if (dealId) {
    if (!sessionInfo) {
      logger.warn('Anonymous user attempted to use dealId in diagnostic-chat', { requestId: getRequestId(request), dealId });
    } else {
      try {
        const access = await resolveDealAccess({
          dealId, email: sessionInfo.email, userId: sessionInfo.userId,
        });
        if (access) {
          verifiedDealId = dealId;
          dealAccessVerified = true;
        } else {
          logger.warn('User attempted to use dealId without access', {
            requestId: getRequestId(request),
            dealId,
            email: sessionInfo.email,
          });
        }
      } catch (err) {
        logger.warn('Deal access check failed in diagnostic-chat', { error: err.message });
      }
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, data) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        let reply, actions;
        if (editingRedesign) {
          ({ reply, actions } = await runRedesignChatAgent({
            message, currentSteps, currentHandoffs, processName, history, redesignContext, segment,
            sessionContext,
            onEmit: (event, data) => send(event, data),
          }));
        } else {
          ({ reply, actions } = await runChatAgent({
            message, currentSteps, currentHandoffs, processName, history, incompleteInfo, phaseState, attachments,
            editingReportId, editingRedesign, redesignContext,
            dealId: verifiedDealId, dealAccessVerified,
            sessionContext, session: sessionInfo,
            apiKey: resolvedApiKey,
            modelOverride: resolvedModel,
            onEmit: (event, data) => send(event, data),
          }));
        }
        send('done', { reply: stripEmDashes(reply), actions: actions || undefined });
      } catch (err) {
        logger.error('Diagnostic chat error', { requestId: getRequestId(request), error: err.message, stack: err.stack });
        send('error', { error: 'Chat failed: ' + err.message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disables proxy/CDN response buffering so each SSE event reaches
      // the client as it's enqueued, not after the response closes.
      // Recognised by nginx ('X-Accel-Buffering') and similar by most
      // edge / CDN layers — without this the per-tool-call updates
      // sent via send() can be coalesced at the network boundary.
      'X-Accel-Buffering': 'no',
    },
  });
}
