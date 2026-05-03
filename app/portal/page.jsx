/**
 * /portal — used to be the catch-all dashboard (reports + deals + analytics
 * + settings). All of those now live on the chat surface (rail icons in
 * /process-audit). The dashboard route is now reserved exclusively for
 * **organisation admin** — members, BYO API keys, model allowlist, usage,
 * budget. Anything that isn't org-admin redirects into the chat.
 */

import { redirect } from 'next/navigation';

export default async function PortalRoot({ searchParams }) {
  const sp = await searchParams;
  // Preserve a few legacy entry params so deep-links into the chat still work
  // (edit=<reportId> means open that report; returnTo bounces to a custom URL).
  if (sp?.edit) {
    redirect(`/process-audit?edit=${encodeURIComponent(String(sp.edit))}${sp?.email ? `&email=${encodeURIComponent(String(sp.email))}` : ''}`);
  }
  if (sp?.returnTo) {
    redirect(String(sp.returnTo));
  }
  // Default landing for /portal: org admin.
  redirect('/portal/org-admin');
}
