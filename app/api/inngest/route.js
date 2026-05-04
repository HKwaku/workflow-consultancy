/**
 * Inngest serve handler. Exposes the registered functions at /api/inngest
 * for both the Inngest cloud platform (signed) and the local dev server
 * (`npx inngest-cli@latest dev`, no signing key required).
 *
 * Add new functions to the `functions` array.
 */

import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { processDealDocument } from '@/lib/inngest/functions/processDealDocument';
import { runDealAnalysis } from '@/lib/inngest/functions/runDealAnalysis';
import { syncConnectorBinding } from '@/lib/inngest/functions/syncConnectorBinding';

// Inngest invokes individual function steps as POSTs to this route.
// Vercel Hobby caps per-route timeout at 60 seconds. To fit inside
// that, runDealAnalysis uses Haiku 4.5 (not Sonnet) for the LLM step —
// Haiku outputs ~3-5x faster, so a redesign-mode JSON response lands
// in roughly 25-40s instead of 90-150s. Once on Pro, raise this to
// 300 and switch the model in lib/inngest/functions/runDealAnalysis.js
// back to getChatModel (Sonnet) for higher-quality output.
export const maxDuration = 60;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    processDealDocument,
    runDealAnalysis,
    syncConnectorBinding,
  ],
});
