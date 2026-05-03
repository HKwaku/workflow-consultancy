/**
 * /status — public uptime + recent incidents page.
 *
 * Two modes, controlled by env:
 *
 *   - STATUS_PAGE_URL set (Better Stack / Statuspage / Instatus) →
 *     iframe / link out to the vendor page. Vendor owns incident comms.
 *
 *   - STATUS_PAGE_URL unset → self-reported. We do a live /api/health
 *     fetch and show "All systems operational" / "Degraded" based on the
 *     response. Sufficient for pre-customer; sign up for a vendor before
 *     the first paying customer (see RUNBOOK_STATUS_PAGE.md).
 *
 * Server component: fetches /api/health server-side at request time so the
 * status reflects the live check, not a cached one. No client-side polling
 * here — keeps the page light and the vendor (when configured) is the
 * authoritative source.
 */

import StatusClient from './StatusClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'Status · Vesno',
  description: 'Vesno platform status, recent incidents, and component health.',
};

async function fetchHealthSelfReported() {
  // When STATUS_PAGE_URL is set, we trust the vendor's signal and skip the
  // local health probe entirely.
  try {
    const base = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    const resp = await fetch(`${base}/api/health`, { cache: 'no-store' });
    const json = await resp.json().catch(() => null);
    return { ok: resp.ok && json?.ok === true, payload: json, fetchedAt: new Date().toISOString() };
  } catch (e) {
    return { ok: false, payload: null, fetchedAt: new Date().toISOString(), error: e.message };
  }
}

export default async function StatusPage() {
  const vendorUrl = process.env.STATUS_PAGE_URL || null;
  const selfReport = vendorUrl ? null : await fetchHealthSelfReported();

  return <StatusClient vendorUrl={vendorUrl} selfReport={selfReport} />;
}
