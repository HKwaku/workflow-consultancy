import { NextResponse } from 'next/server';
import { stripEmDashes, checkOrigin, getRequestId } from '@/lib/api-helpers';
import { DiagnosticChatInputSchema } from '@/lib/ai-schemas';
import { runChatAgent } from '@/lib/agents/chat/graph';
import { runRedesignChatAgent } from '@/lib/agents/redesign-chat/graph';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
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
  const { message, currentSteps, currentHandoffs, processName, history, incompleteInfo, attachments, editingReportId, editingRedesign, redesignContext, segment } = parsed.data;
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured.' }, { status: 500 });

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
            onEmit: (event, data) => send(event, data),
          }));
        } else {
          ({ reply, actions } = await runChatAgent({
            message, currentSteps, currentHandoffs, processName, history, incompleteInfo, attachments,
            editingReportId, editingRedesign, redesignContext,
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
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
