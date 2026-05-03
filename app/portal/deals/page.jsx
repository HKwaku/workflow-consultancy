/**
 * /portal/deals — replaced by the chat-rail Deals briefcase popover.
 * Old bookmarks redirect to /process-audit; users open the briefcase to
 * pick or switch deals. Org admin still lives on /portal.
 */

import { redirect } from 'next/navigation';

export default function LegacyDealsRedirect() {
  redirect('/process-audit?openDeals=1');
}
