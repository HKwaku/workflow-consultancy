/**
 * Inngest client + tiny event helper.
 *
 * Inngest hosts the queue + scheduler; we register Next.js handlers at
 * /api/inngest. Functions live in lib/inngest/functions/. Local dev runs the
 * Inngest dev server (`npx inngest-cli@latest dev`) which auto-discovers the
 * /api/inngest route.
 *
 * Env:
 *   INNGEST_EVENT_KEY  - required to send events (cloud)
 *   INNGEST_SIGNING_KEY - required to register functions (cloud)
 *
 * If neither is set, sendEvent is a no-op so the rest of the app stays
 * functional. The Inngest dev server bypasses both keys.
 */

import { Inngest } from 'inngest';

export const inngest = new Inngest({
  id: 'workflow-consultancy',
  // Inngest auto-detects from process.env in production; explicit pass-through
  // here is purely for clarity.
  eventKey: process.env.INNGEST_EVENT_KEY,
});

const HAS_INNGEST = !!(process.env.INNGEST_EVENT_KEY || process.env.INNGEST_SIGNING_KEY || process.env.INNGEST_DEV);

/**
 * Send an event. If Inngest isn't configured, returns { skipped: true }.
 * Callers should treat enqueue failures as best-effort - the row stays at
 * 'pending' and can be retried via the worker's manual reprocess endpoint.
 */
export async function sendEvent(event) {
  if (!HAS_INNGEST) {
    return { skipped: true, reason: 'Inngest not configured' };
  }
  return inngest.send(event);
}
