/**
 * Legacy deal page — replaced by the chat-first workspace as of Phase 18.
 *
 * This is now a redirect to /workspace/map?deal=<id>, preserving:
 *   - the deal scope on the chat surface (DealsRailButton hydrates from ?deal=)
 *   - any ?focusFinding=<key> deep-link (DealWorkspaceModal auto-opens to it)
 *
 * Old bookmarks (`/deals/<id>?focusFinding=...`) keep working — they just
 * land in the chat with the workspace modal open on the right finding.
 *
 * If you ever need the legacy long-form layout back, recover from git
 * history: `git log --diff-filter=D -- app/deals/[id]/page.jsx`.
 */

import { redirect } from 'next/navigation';

export default async function LegacyDealPageRedirect({ params, searchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const qs = new URLSearchParams();
  if (id) qs.set('deal', id);
  if (sp?.focusFinding) qs.set('focusFinding', String(sp.focusFinding));
  if (sp?.focus) qs.set('focus', String(sp.focus));
  redirect(`/workspace/map?${qs.toString()}`);
}
