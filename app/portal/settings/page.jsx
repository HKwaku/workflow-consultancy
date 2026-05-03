/**
 * /portal/settings — replaced by the chat-rail Settings popover.
 * Theme + sign-out + GDPR (export, delete) all live behind the gear icon
 * in the chat surface now. Old bookmarks redirect to /process-audit.
 */

import { redirect } from 'next/navigation';

export default function LegacySettingsRedirect() {
  redirect('/process-audit?openSettings=1');
}
