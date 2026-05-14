'use client';

/**
 * SystemDetailDrawer — side panel that lists every process touching a
 * given system. Opened from the InsightsPanel system inventory rows.
 *
 * Works for both linked (canonical model_systems row) and unlinked (raw
 * step.systems[] mention with no inventory row yet) systems via the
 * /system-processes endpoint which accepts either system_id or match_key.
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api-fetch';

function money(n) {
  if (n == null) return null;
  if (Math.abs(n) >= 1_000_000) return `£${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000)     return `£${(n / 1_000).toFixed(0)}k`;
  return `£${Math.round(n)}`;
}

export default function SystemDetailDrawer({
  modelId, accessToken, system, onClose, capabilitiesById,
}) {
  const [processes, setProcesses] = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);

  const load = useCallback(async () => {
    if (!modelId || !accessToken || !system) return;
    setLoading(true); setError(null);
    try {
      const qs = system.system_id
        ? `system_id=${encodeURIComponent(system.system_id)}`
        : `match_key=${encodeURIComponent((system.system_name || '').toLowerCase())}`;
      const r = await apiFetch(
        `/api/operating-models/${modelId}/system-processes?${qs}`,
        {}, accessToken,
      );
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || `system-processes ${r.status}`);
      }
      const j = await r.json();
      setProcesses(j.processes || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [modelId, accessToken, system]);

  useEffect(() => { load(); }, [load]);

  // Esc-to-close — matches the existing modal patterns in the workspace.
  useEffect(() => {
    if (!system) return;
    const handler = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [system, onClose]);

  if (!system) return null;

  return (
    <>
      <div className="ws-drawer-overlay" onClick={onClose} aria-hidden />
      <aside className="ws-drawer" role="dialog" aria-label={`Processes touching ${system.system_name}`}>
        <header className="ws-drawer-head">
          <div>
            <div className="ws-drawer-title">{system.system_name}</div>
            <div className="ws-drawer-sub">
              {system.system_id
                ? 'Canonical inventory · processes that mention this system'
                : 'Unlinked mention · processes that reference this name'}
            </div>
          </div>
          <button type="button" className="ws-drawer-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        {loading && <div className="ws-drawer-empty">Loading…</div>}
        {error && <div className="ws-drawer-empty ws-error">{error}</div>}
        {!loading && processes && processes.length === 0 && (
          <div className="ws-drawer-empty">No processes touch this system.</div>
        )}
        {!loading && processes && processes.length > 0 && (
          <ul className="ws-drawer-list">
            {processes.map((p) => {
              const cap = p.function_id ? (capabilitiesById?.get?.(p.function_id)) : null;
              return (
                <li key={p.id} className="ws-drawer-row">
                  <Link
                    href={`/workspace/map?view=${encodeURIComponent(p.id)}`}
                    className="ws-drawer-row-title"
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
                      e.preventDefault();
                      if (typeof window !== 'undefined') {
                        window.dispatchEvent(new CustomEvent('vesno:open-process', {
                          detail: { reportId: p.id, intent: 'view' },
                        }));
                      }
                      onClose?.();
                    }}
                  >{p.company || p.contact_name || 'Untitled process'}</Link>
                  <div className="ws-drawer-row-meta">
                    {cap?.name && <span className="ws-drawer-cap">{cap.name}</span>}
                    {p.step_mentions > 1 && (
                      <span className="ws-drawer-mentions">{p.step_mentions} step mentions</span>
                    )}
                    {p.first_step_name && p.step_mentions === 1 && (
                      <span className="ws-drawer-mentions">at &quot;{p.first_step_name}&quot;</span>
                    )}
                    {p.total_annual_cost ? (
                      <span className="ws-drawer-cost">{money(p.total_annual_cost)}/yr</span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </aside>
    </>
  );
}
