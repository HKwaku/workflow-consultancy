/**
 * Legacy alias: /process-audit forwards to /workspace/map. The chat
 * surface lives there now; this redirect keeps n8n webhooks, deep-link
 * emails, Calendly intro URLs, and external bookmarks working.
 *
 * Query params (deal, edit, view, view=cost, reaudit, openSettings, etc.)
 * are preserved through the redirect so every entry path still lands in
 * the right state.
 */

import { redirect } from 'next/navigation';

export const metadata = { title: 'Map a process · Vesno' };

export default async function ProcessAuditLegacyAlias({ searchParams }) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp || {})) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      for (const item of v) qs.append(k, String(item));
    } else {
      qs.set(k, String(v));
    }
  }
  const target = qs.toString() ? `/workspace/map?${qs.toString()}` : '/workspace/map';
  redirect(target);
}
