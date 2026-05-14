'use client';

/**
 * WorkspaceDealsTab - lists the signed-in user's deals (owned,
 * collaborator, or participant). Replaces the chat rail's
 * DealsRailButton; the workspace is the new home for deal management.
 *
 * Click a row to open the deal workspace inline (default, stays on
 * canvas) or Cmd/Ctrl+click for a new tab. Same convention as every
 * other process row in the workspace.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api-fetch';

const TYPE_LABEL = { ma: 'M&A', pe_rollup: 'PE roll-up', scaling: 'Scaling' };
const STATUS_LABEL = {
  collecting: 'Collecting', analyzing: 'Analyzing', complete: 'Complete', archived: 'Archived',
};

/**
 * Props:
 *   accessToken: Supabase JWT, used to authenticate /api/deals.
 *   onDealOpen:  optional (dealId, deal) => void. When provided,
 *                plain click on a deal row calls this with the row
 *                payload (so the caller can update chat context
 *                synchronously without waiting for /api/deals/[id])
 *                instead of navigating. Cmd/Ctrl/Shift/middle-click
 *                always falls through to the href.
 */
export default function WorkspaceDealsTab({ accessToken, onDealOpen }) {
  const [deals, setDeals] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    setLoading(true);
    apiFetch('/api/deals', {}, accessToken)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`/api/deals -> ${r.status}`))))
      .then((data) => { if (!cancelled) setDeals(data?.deals || []); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accessToken]);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!deals) return [];
    if (!q) return deals;
    return deals.filter((d) =>
      (d.name || '').toLowerCase().includes(q)
      || (d.dealCode || d.deal_code || '').toLowerCase().includes(q)
      || (d.processName || d.process_name || '').toLowerCase().includes(q),
    );
  }, [deals, filter]);

  return (
    <section className="ws-pane ws-deals-tab">
      <div className="ws-insight-card">
        <h3>
          Deals <span className="ws-insight-sub">{deals?.length ?? 0} total</span>
        </h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '6px 0 12px' }}>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search deals (name, code, process)..."
            style={{
              flex: 1, padding: '6px 10px', fontSize: 13,
              border: '1px solid var(--border, #e2e8f0)', borderRadius: 6,
              background: 'var(--bg, #fff)', color: 'var(--text, #1e293b)',
            }}
          />
          <Link href="/workspace/map?openDeals=1" className="ws-cta ws-cta--small" title="Open the deals briefcase to create a new deal">
            + New deal
          </Link>
        </div>

        {loading && <div className="ws-empty-inline">Loading deals...</div>}
        {error && <div className="ws-empty-inline ws-error">Couldn&apos;t load deals: {error}</div>}
        {!loading && !error && deals?.length === 0 && (
          <div className="ws-empty-inline" style={{ margin: 0 }}>
            No deals yet. Create one from the portal to get started.
          </div>
        )}
        {!loading && !error && deals?.length > 0 && rows.length === 0 && (
          <div className="ws-empty-inline" style={{ margin: 0 }}>
            No deals match &quot;{filter}&quot;.
          </div>
        )}
        {rows.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-mid, #64748b)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <th style={{ padding: '6px 8px' }}>Deal</th>
                <th style={{ padding: '6px 8px' }}>Type</th>
                <th style={{ padding: '6px 8px' }}>Status</th>
                <th style={{ padding: '6px 8px' }}>Code</th>
                <th style={{ padding: '6px 8px' }}>Your role</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} style={{ borderTop: '1px solid var(--border, #e2e8f0)' }}>
                  <td style={{ padding: '8px' }}>
                    <Link
                      href={`/deals/${encodeURIComponent(d.id)}/workspace`}
                      style={{ color: 'var(--accent, #0f766e)', textDecoration: 'none', fontWeight: 500 }}
                      title="Open deal workspace (Cmd/Ctrl+click for new tab)"
                      onClick={(e) => {
                        if (!onDealOpen) return; // fall through to Link
                        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
                        e.preventDefault();
                        onDealOpen(d.id, d);
                      }}
                    >{d.name || '(unnamed)'}</Link>
                    {(d.processName || d.process_name) && (
                      <div style={{ fontSize: 11, color: 'var(--text-mid, #64748b)', marginTop: 2 }}>
                        {d.processName || d.process_name}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '8px', color: 'var(--text-mid, #64748b)' }}>
                    {TYPE_LABEL[d.type] || d.type || '—'}
                  </td>
                  <td style={{ padding: '8px', color: 'var(--text-mid, #64748b)' }}>
                    {STATUS_LABEL[d.status] || d.status || '—'}
                  </td>
                  <td style={{ padding: '8px', color: 'var(--text-mid, #64748b)', fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>
                    {d.dealCode || d.deal_code || '—'}
                  </td>
                  <td style={{ padding: '8px', color: 'var(--text-mid, #64748b)' }}>
                    {d.ownerRole || d.accessMode || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
