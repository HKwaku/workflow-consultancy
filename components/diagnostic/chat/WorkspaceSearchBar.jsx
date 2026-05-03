'use client';

/**
 * In-workspace document search. A small bar sits above the data-room
 * section; typing triggers a debounced query against /api/deals/[id]/search,
 * results render inline as ranked chunk cards. Click a card → opens the
 * matching document via the same signed-URL path the evidence drawer uses.
 *
 * Designed to feel like a global search affordance — the partner can type
 * "customer concentration" or "change of control" without knowing which
 * document holds the answer. Backed by the same hybrid search RPC that
 * powers Reina's chat tool, so results match what the agent would surface.
 */

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';

const DEBOUNCE_MS = 300;

export default function WorkspaceSearchBar({ dealId, accessToken, onOpenDoc }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null); // null = collapsed; [] = no matches; [...] = hits
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults(null); setErr(null); return undefined; }
    setLoading(true); setErr(null);
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await apiFetch(
          `/api/deals/${dealId}/search?q=${encodeURIComponent(query)}&limit=15`,
          {}, accessToken,
        );
        const j = await r.json();
        if (!r.ok) setErr(j?.error || 'Search failed.');
        else setResults(j.results || []);
      } catch (e) {
        setErr(e?.message || 'Network error.');
      } finally { setLoading(false); }
    }, DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, dealId, accessToken]);

  const open = (r) => onOpenDoc?.({ id: r.document_id, filename: r.filename });

  return (
    <div className="workspace-search">
      <div className="workspace-search-bar">
        <span className="workspace-search-icon" aria-hidden>🔍</span>
        <input
          type="search"
          className="workspace-search-input"
          placeholder="Search the data room — e.g. customer concentration, change of control…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button type="button" className="workspace-search-clear" onClick={() => setQuery('')} aria-label="Clear">×</button>
        )}
      </div>
      {(loading || err || results !== null) && (
        <div className="workspace-search-results">
          {loading && <div className="workspace-search-empty">Searching…</div>}
          {err && <div className="workspace-search-empty workspace-search-empty--err">{err}</div>}
          {!loading && !err && results && results.length === 0 && (
            <div className="workspace-search-empty">No matches.</div>
          )}
          {!loading && !err && results && results.length > 0 && (
            <ul className="workspace-search-list">
              {results.map((r, i) => {
                const loc = [
                  r.page_number ? `p.${r.page_number}` : null,
                  r.slide_number ? `slide ${r.slide_number}` : null,
                  r.sheet_name ? `sheet ${r.sheet_name}` : null,
                  r.cell_range, r.section_path,
                ].filter(Boolean).join(' · ');
                return (
                  <li key={r.chunk_id || i}>
                    <button type="button" className="workspace-search-item" onClick={() => open(r)}>
                      <span className="workspace-search-item-head">
                        <span className="workspace-search-item-name">{r.filename}</span>
                        {r.category && <span className="workspace-search-item-cat">{r.category}</span>}
                        {loc && <span className="workspace-search-item-loc">{loc}</span>}
                      </span>
                      <span className="workspace-search-item-snip">"{r.snippet}"</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
