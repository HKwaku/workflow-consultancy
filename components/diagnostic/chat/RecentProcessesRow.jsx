'use client';

/**
 * RecentProcessesRow — "Continue mapping" cards above the chat input
 * on a fresh chat. Lets a returning user resume an in-flight process
 * instead of starting a new one.
 *
 * Context-aware: when an operating model or deal is in scope, the row
 * narrows to that model's / deal's processes. With no scope, it falls
 * back to the user's most-recent processes globally. The hide flag
 * suppresses the row when the user has typed something or is mid-edit.
 *
 * Click → dispatches `vesno:open-process` (silent canvas swap, no
 * route change, chat thread intact). Cmd/Ctrl+click still opens the
 * canonical URL in a new tab via the underlying anchor href.
 */

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';

function fmtRelative(d) {
  if (!d) return '';
  const ms = Date.now() - new Date(d).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  if (ms < 30 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d ago`;
  try { return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); }
  catch { return ''; }
}

export default function RecentProcessesRow({ accessToken, hide, operatingModelId = null, dealId = null }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    if (!accessToken || hide) return;
    let cancelled = false;
    const qs = new URLSearchParams({ limit: '3' });
    if (dealId) qs.set('dealId', dealId);
    else if (operatingModelId) qs.set('operatingModelId', operatingModelId);
    apiFetch(`/api/me/recent-processes?${qs.toString()}`, {}, accessToken)
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (!cancelled && j?.processes) setRows(j.processes); })
      .catch(() => { /* swallow */ });
    return () => { cancelled = true; };
  }, [accessToken, hide, operatingModelId, dealId]);

  if (hide || !rows || rows.length === 0) return null;

  const headLabel = dealId
    ? 'Continue mapping (this deal)'
    : operatingModelId
      ? 'Continue mapping'
      : 'Continue mapping';

  return (
    <div className="s7-recent-processes" role="region" aria-label="Resume a recent process">
      <div className="s7-recent-processes-head">{headLabel}</div>
      <div className="s7-recent-processes-list">
        {rows.map((p) => {
          const label = p.process_name
                     || p.processName
                     || p.company
                     || p.contact_name
                     || 'Untitled process';
          return (
            <a
              key={p.id}
              className="s7-recent-process-card"
              href={`/workspace/map?view=${encodeURIComponent(p.id)}`}
              title={`Last edited ${fmtRelative(p.updated_at)} (Cmd/Ctrl+click to open in new tab)`}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
                e.preventDefault();
                if (typeof window !== 'undefined') {
                  window.dispatchEvent(new CustomEvent('vesno:open-process', {
                    detail: { reportId: p.id, intent: 'view' },
                  }));
                }
              }}
            >
              <span className="s7-recent-process-name">{label}</span>
              <span className="s7-recent-process-meta">
                <span className="s7-recent-process-when">{fmtRelative(p.updated_at)}</span>
              </span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
