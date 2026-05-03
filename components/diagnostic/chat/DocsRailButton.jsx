'use client';

/**
 * Rail icon for the diagnostic chat that lists docs in a slide-in panel.
 * Click a doc → opens /docs/<slug> in a new tab. Mirrors the Reports panel
 * UX so every rail icon opens the same way.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import RailSlidePanel from './RailSlidePanel';

export default function DocsRailButton() {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const btnRef = useRef(null);

  useEffect(() => {
    if (!open || groups.length > 0 || loading) return;
    setLoading(true);
    apiFetch('/api/docs/list')
      .then((r) => r.json())
      .then((data) => setGroups(data?.groups || []))
      .catch(() => setGroups([]))
      .finally(() => setLoading(false));
  }, [open, groups.length, loading]);

  const filteredGroups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({ ...g, items: (g.items || []).filter((it) => (it.title || '').toLowerCase().includes(q)) }))
      .filter((g) => g.items.length > 0);
  }, [groups, filter]);

  return (
    <div className="s7-split-rail-deals">
      <button
        ref={btnRef}
        type="button"
        className={`s7-split-rail-btn${open ? ' active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Docs & guides"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z" />
          <path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />
        </svg>
      </button>

      <RailSlidePanel
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={btnRef}
        title="Docs & guides"
      >
        <div className="s7-rail-pane-search">
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter docs…"
            className="s7-rail-pane-search-input"
            autoFocus
          />
        </div>

        <div className="s7-rail-pane-body">
          {loading && <div className="s7-rail-pane-empty">Loading…</div>}
          {!loading && groups.length === 0 && (
            <div className="s7-rail-pane-empty">No docs available.</div>
          )}
          {!loading && groups.length > 0 && filteredGroups.length === 0 && (
            <div className="s7-rail-pane-empty">No matches.</div>
          )}
          {!loading && filteredGroups.length > 0 && (
            <div className="s7-rail-pane-groups">
              {filteredGroups.map((g) => (
                <section key={g.group} className="s7-rail-pane-group">
                  <div className="s7-rail-pane-group-title s7-rail-pane-group-title--static">
                    <span>{g.group}</span>
                    <span className="s7-rail-pane-group-count">{g.items.length}</span>
                  </div>
                  <ul className="s7-rail-pane-list">
                    {g.items.map((it) => (
                      <li key={it.slug}>
                        <a
                          className="s7-rail-pane-item s7-rail-pane-item--row"
                          href={`/docs/${it.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <span className="s7-rail-pane-item-body">
                            <span className="s7-rail-pane-item-name">{it.title}</span>
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </RailSlidePanel>
    </div>
  );
}
