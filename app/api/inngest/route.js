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
import { syncConnectorBinding } from '@/lib/inngest/functions/syncConnectorBinding';
import { buildOfficeArtefact } from '@/lib/inngest/functions/buildOfficeArtefact';

// Office-artefact builds are a single long model + code-execution-
// sandbox call (can be minutes); the serve handler's per-invocation
// budget must cover that one step. 300s matches the chat route's prior
// synchronous budget — the wait just moved off the user's request.
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    processDealDocument,
    syncConnectorBinding,
    buildOfficeArtefact,
  ],
});
