'use client';

/**
 * WorkspaceModelsTab - lists every operating model under the user's
 * org. Mirrors WorkspaceDealsTab so the Standard scope behaves the
 * same way Deals does: pick from a list, drill in.
 *
 * Props:
 *   accessToken:  Supabase JWT.
 *   onModelOpen:  optional (modelId, model) => void. Plain click calls
 *                 this and stays on the canvas. Cmd/Ctrl/Shift/middle
 *                 click falls through to the href so the user can
 *                 still open in a new tab when they want to.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api-fetch';

const KIND_LABEL = {
  single_entity: 'Single entity',
  group:         'Group',
  joint_venture: 'Joint venture',
};
const STATUS_LABEL = { live: 'Live', draft: 'Draft', archived: 'Archived' };

export default function WorkspaceModelsTab({ accessToken, onModelOpen }) {
  const [models, setModels] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [filter, setFilter]   = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    setLoading(true);
    apiFetch('/api/me/operating-models', {}, accessToken)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`/api/me/operating-models -> ${r.status}`))))
      .then((data) => {
        if (cancelled) return;
        setModels(data?.models || []);
        setActiveId(data?.activeModelId || null);
      })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accessToken]);

  // Persist the chosen model as this member's active model so Home /
  // New chat / the chat agent all follow it (server-resolved), not
  // just this tab's in-canvas navigation.
  const persistActive = (modelId) => apiFetch('/api/me/operating-models', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId }),
  }, accessToken).catch(() => {});

  const createModel = async () => {
    if (creating) return;
    const name = (typeof window !== 'undefined' && window.prompt('Name the new operating model:'))?.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const r = await apiFetch('/api/me/operating-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }, accessToken);
      const d = await r.json();
      if (!r.ok || d?.error) throw new Error(d?.error || `create -> ${r.status}`);
      // POST already made it the active model; land on it fresh.
      if (typeof window !== 'undefined') window.location.assign('/workspace');
    } catch (e) {
      setError(e.message);
      setCreating(false);
    }
  };

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!models) return [];
    if (!q) return models;
    return models.filter((m) =>
      (m.name || '').toLowerCase().includes(q)
      || (m.kind || '').toLowerCase().includes(q),
    );
  }, [models, filter]);

  return (
    <section className="ws-pane ws-models-tab">
      <div className="ws-insight-card">
        <h3>
          Operating models <span className="ws-insight-sub">{models?.length ?? 0} total</span>
        </h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '6px 0 12px' }}>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search models (name, kind)..."
            style={{
              flex: 1, padding: '6px 10px', fontSize: 13,
              border: '1px solid var(--border, #e2e8f0)', borderRadius: 6,
              background: 'var(--bg, #fff)', color: 'var(--text, #1e293b)',
            }}
          />
          <button
            type="button"
            onClick={createModel}
            disabled={creating}
            className="ws-cta"
            style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
            title="Create a new, empty operating model in your org and switch to it"
          >{creating ? 'Creating…' : '+ New model'}</button>
        </div>

        {loading && <div className="ws-empty-inline">Loading models...</div>}
        {error && <div className="ws-empty-inline ws-error">Couldn&apos;t load models: {error}</div>}
        {!loading && !error && models?.length === 0 && (
          <div className="ws-empty-inline" style={{ margin: 0 }}>
            No operating models in your org yet. An org admin can create one from org admin.
          </div>
        )}
        {!loading && !error && models?.length > 0 && rows.length === 0 && (
          <div className="ws-empty-inline" style={{ margin: 0 }}>
            No models match &quot;{filter}&quot;.
          </div>
        )}
        {rows.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-mid, #64748b)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <th style={{ padding: '6px 8px' }}>Model</th>
                <th style={{ padding: '6px 8px' }}>Kind</th>
                <th style={{ padding: '6px 8px' }}>Status</th>
                <th style={{ padding: '6px 8px' }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} style={{ borderTop: '1px solid var(--border, #e2e8f0)' }}>
                  <td style={{ padding: '8px' }}>
                    <Link
                      href={`/workspace?modelId=${encodeURIComponent(m.id)}`}
                      style={{ color: 'var(--accent, #0f766e)', textDecoration: 'none', fontWeight: 500 }}
                      title="Open this operating model (Cmd/Ctrl+click for new tab)"
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
                        // Persist as the active model so it survives
                        // Home / New chat (server-resolved everywhere).
                        persistActive(m.id);
                        setActiveId(m.id);
                        if (!onModelOpen) return; // fall through to href navigation
                        e.preventDefault();
                        onModelOpen(m.id, m);
                      }}
                    >{m.name || '(unnamed)'}</Link>
                    {m.description && (
                      <div style={{ fontSize: 11, color: 'var(--text-mid, #64748b)', marginTop: 2 }}>
                        {m.description}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '8px', color: 'var(--text-mid, #64748b)' }}>
                    {KIND_LABEL[m.kind] || m.kind || '—'}
                  </td>
                  <td style={{ padding: '8px', color: 'var(--text-mid, #64748b)' }}>
                    {STATUS_LABEL[m.status] || m.status || '—'}
                  </td>
                  <td style={{ padding: '8px', color: 'var(--text-mid, #64748b)', display: 'flex', gap: 6, alignItems: 'center' }}>
                    {m.id === activeId && <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 10, background: '#0d9488', color: '#fff', fontWeight: 600 }}>Active</span>}
                    {m.isDefault && <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 10, background: 'rgba(13,148,136,0.10)', color: '#0f766e', fontWeight: 600 }}>Default</span>}
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
