/**
 * /workspace/processes/[processId] — legacy text-only design surface.
 *
 * The product rule is "everything opens on the canvas unless the user
 * explicitly asks for a new tab", so this route now redirects to the
 * chat canvas in view mode (?view=<id>). Kept as a permanent redirect
 * so old bookmarks / shared links keep working.
 */

import { redirect } from 'next/navigation';

export const metadata = { title: 'Opening on canvas - Vesno' };

export default async function ProcessDesignPage({ params }) {
  const { processId } = await params;
  redirect(`/workspace/map?view=${encodeURIComponent(processId)}`);
}
