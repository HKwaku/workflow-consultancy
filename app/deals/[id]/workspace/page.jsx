/**
 * /deals/[id]/workspace - deal workspace.
 *
 * Mirrors the operating-model workspace at /workspace, but the data
 * source is the deal (participants + flows) rather than a single
 * operating model. Same tab row, same view components, same
 * navigation grammar. Works for both M&A (acquirer + target) and
 * PE roll-ups (platform + portfolio companies).
 *
 * Server shell only - the client component does the resolve + load.
 */

import DealWorkspaceClient from './DealWorkspaceClient';

export const metadata = { title: 'Deal workspace - Vesno' };

export default async function DealWorkspacePage({ params }) {
  const { id } = await params;
  return <DealWorkspaceClient dealId={id} />;
}
