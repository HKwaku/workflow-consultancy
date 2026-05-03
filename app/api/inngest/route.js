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

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    processDealDocument,
    runDealAnalysis,
    syncConnectorBinding,
  ],
});
