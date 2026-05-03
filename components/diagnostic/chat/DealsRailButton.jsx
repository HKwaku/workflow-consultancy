'use client';

/**
 * Rail icon for the diagnostic chat that scopes the conversation to a deal.
 * Click → slide-in panel listing the user's deals (owner / collaborator /
 * participant). Click a deal → setDeal() in DiagnosticContext + URL ?deal=<id>
 * so the chat is scoped to that deal. Mirrors the Reports panel UX so every
 * rail icon opens the same way (no popovers).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDiagnostic } from '../DiagnosticContext';
import { apiFetch } from '@/lib/api-fetch';
import RailSlidePanel from './RailSlidePanel';

const DEAL_TYPE_LABEL = { pe_rollup: 'PE roll-up', ma: 'M&A', scaling: 'Scaling' };

export default function DealsRailButton({ accessToken }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { dealId, setDeal } = useDiagnostic();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deals, setDeals] = useState([]);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const btnRef = useRef(null);

  // Legacy /portal/deals → redirect → ?openDeals=1 — auto-open the panel.
  useEffect(() => {
    if (searchParams?.get('openDeals') === '1') setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open || deals.length > 0 || loading) return;
    if (!accessToken) { setError('Sign in to see your deals.'); return; }
    setLoading(true);
    setError(null);
    apiFetch('/api/deals', {}, accessToken)
      .then((r) => r.json())
      .then((data) => {
        if (data?.error) throw new Error(data.error);
        setDeals(Array.isArray(data?.deals) ? data.deals : []);
      })
      .catch((e) => setError(e?.message || 'Failed to load deals.'))
      .finally(() => setLoading(false));
  }, [open, accessToken, deals.length, loading]);

  // setDeal expects { dealId, dealCode, dealName, ... }; deal records use
  // { id, deal_code, name }. Normalise so callers can pass raw deal rows.
  const normaliseForContext = (deal) => ({
    dealId: deal.id,
    dealCode: deal.deal_code || deal.code || null,
    dealName: deal.name || null,
    dealRole: deal.role || null,
    dealParticipants: deal.participants || [],
  });

  // Hydrate from URL ?deal=<id> on mount so refresh keeps deal context.
  useEffect(() => {
    if (dealId) return;
    const urlDealId = searchParams.get('deal');
    if (!urlDealId || !accessToken) return;
    apiFetch(`/api/deals/${urlDealId}`, {}, accessToken)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.deal) setDeal(normaliseForContext(data.deal)); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  const select = async (deal) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setDeal(normaliseForContext(deal));
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      params.set('deal', deal.id);
      try {
        const r = await apiFetch(
          `/api/deals/${deal.id}/chat-session`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' } },
          accessToken,
        );
        const data = r.ok ? await r.json() : null;
        if (data?.sessionId) params.set('chatSession', data.sessionId);
      } catch {
        // Non-fatal — chat still works without the persistent session.
      }
      router.replace(`?${params.toString()}`, { scroll: false });
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const clearDeal = () => {
    setDeal(null);
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    params.delete('deal');
    params.delete('chatSession');
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '?', { scroll: false });
    setOpen(false);
  };

  // Risk-first ordering: deals with the highest weighted risk score float
  // to the top of the list so the partner sees what needs attention. Ties
  // fall back to recency. Filter happens after the sort so search results
  // also stay risk-ordered.
  const sortedDeals = useMemo(() => {
    return [...deals].sort((a, b) => {
      const da = a.riskScore ?? 0;
      const db = b.riskScore ?? 0;
      if (db !== da) return db - da;
      return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
    });
  }, [deals]);

  const filteredDeals = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return sortedDeals;
    return sortedDeals.filter((d) => [
      d.name, d.deal_code, d.code, d.type, d.status,
    ].some((s) => (s || '').toString().toLowerCase().includes(q)));
  }, [sortedDeals, filter]);

  const riskBucket = (score) => {
    if (score == null || score <= 0) return null;
    if (score >= 8) return 'critical';
    if (score >= 4) return 'high';
    if (score >= 1.5) return 'medium';
    return 'low';
  };

  // Cross-deal portfolio search — overlays the deal list when active.
  // Lazy-loaded; no work until the user types.
  const [portfolioQuery, setPortfolioQuery] = useState('');
  const [portfolioTag, setPortfolioTag] = useState('');
  const [portfolioResults, setPortfolioResults] = useState(null);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  useEffect(() => {
    const term = portfolioQuery.trim();
    if (!term && !portfolioTag) { setPortfolioResults(null); return undefined; }
    const t = setTimeout(async () => {
      setPortfolioLoading(true);
      try {
        const sp = new URLSearchParams();
        if (term) sp.set('q', term);
        if (portfolioTag) sp.set('tag', portfolioTag);
        sp.set('limit', '60');
        const r = await apiFetch(`/api/portfolio/findings?${sp.toString()}`, {}, accessToken);
        const j = r.ok ? await r.json() : null;
        if (j) setPortfolioResults(j);
      } finally { setPortfolioLoading(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [portfolioQuery, portfolioTag, accessToken]);

  const PORTFOLIO_TAGS = ['deal_breaker', 're_trade', 'disclose', 'mitigate', 'monitor'];

  return (
    <div className="s7-split-rail-deals">
      <button
        ref={btnRef}
        type="button"
        className={`s7-split-rail-btn${dealId ? ' active' : ''}${open ? ' active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={dealId ? 'Switch deal context' : 'Bring a deal into this chat'}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="2" y="7" width="20" height="14" rx="2" />
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
        </svg>
        {dealId && <span className="s7-split-rail-deals-dot" aria-hidden />}
      </button>

      <RailSlidePanel
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={btnRef}
        title="Deals"
        headerRight={dealId ? (
          <button type="button" className="s7-rail-pane-clear" onClick={clearDeal}>Clear</button>
        ) : null}
      >
        <div className="s7-rail-pane-search">
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name, code, type…"
            className="s7-rail-pane-search-input"
            autoFocus
          />
        </div>

        {/* Cross-deal portfolio search — overlays the deal list. */}
        <div className="s7-rail-pane-portfolio">
          <input
            type="search"
            value={portfolioQuery}
            onChange={(e) => setPortfolioQuery(e.target.value)}
            placeholder="Search findings across all your deals…"
            className="s7-rail-pane-search-input"
          />
          <div className="s7-rail-pane-portfolio-tags">
            {PORTFOLIO_TAGS.map((t) => (
              <button
                key={t}
                type="button"
                className={`s7-rail-pane-portfolio-tag${portfolioTag === t ? ' is-on' : ''}`}
                onClick={() => setPortfolioTag(portfolioTag === t ? '' : t)}
              >{t.replace('_', '-')}</button>
            ))}
          </div>
        </div>

        {portfolioResults && (
          <div className="s7-rail-pane-body">
            {portfolioLoading && <div className="s7-rail-pane-empty">Searching…</div>}
            {!portfolioLoading && portfolioResults.findings.length === 0 && (
              <div className="s7-rail-pane-empty">No findings match.</div>
            )}
            {!portfolioLoading && portfolioResults.findings.length > 0 && (
              <ul className="s7-rail-pane-list">
                {portfolioResults.findings.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      className="s7-rail-pane-item s7-rail-pane-item--row"
                      onClick={() => {
                        // Scope chat to that deal + focus the finding via the existing
                        // workspace deep-link path.
                        const params = new URLSearchParams(Array.from(searchParams.entries()));
                        params.set('deal', f.deal_id);
                        params.set('focusFinding', f.finding_key);
                        router.replace(`?${params.toString()}`, { scroll: false });
                        setOpen(false);
                      }}
                    >
                      <span className="s7-rail-pane-item-body">
                        <span className="s7-rail-pane-item-name">
                          {f.title}
                          {f.stale && <span className="deal-workspace-finding-stale" style={{ marginLeft: 6 }}>STALE</span>}
                        </span>
                        <span className="s7-rail-pane-item-meta">
                          {f.deal?.name || 'Deal'} · {f.severity} · weight {f.weight}
                          {f.tags?.length > 0 && ` · ${f.tags.join(', ')}`}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!portfolioResults && (
        <div className="s7-rail-pane-body">
          {loading && <div className="s7-rail-pane-empty">Loading…</div>}
          {error && <div className="s7-rail-pane-empty">{error}</div>}
          {!loading && !error && deals.length === 0 && (
            <div className="s7-rail-pane-empty">
              No deals yet. <a href="/portal/deals">Create one →</a>
            </div>
          )}
          {!loading && !error && deals.length > 0 && filteredDeals.length === 0 && (
            <div className="s7-rail-pane-empty">No matches.</div>
          )}
          {!loading && !error && filteredDeals.length > 0 && (
            <ul className="s7-rail-pane-list">
              {filteredDeals.map((d) => {
                const active = d.id === dealId;
                const bucket = riskBucket(d.riskScore);
                return (
                  <li key={d.id}>
                    <div className={`s7-rail-pane-item s7-rail-pane-item--row${active ? ' active' : ''}`}>
                      <button
                        type="button"
                        className="s7-rail-pane-item-body"
                        onClick={() => select(d)}
                        disabled={busy}
                        role="menuitemradio"
                        aria-checked={active}
                      >
                        <span className="s7-rail-pane-item-name">
                          {d.name}
                          {bucket && (
                            <span
                              className={`s7-rail-pane-risk s7-rail-pane-risk--${bucket}`}
                              title={`Risk score ${d.riskScore} · ${d.openFindings} findings · ${d.criticalFindings} critical`}
                            >
                              {d.riskScore}
                              {d.criticalFindings > 0 ? ` · ${d.criticalFindings}!` : ''}
                            </span>
                          )}
                        </span>
                        <span className="s7-rail-pane-item-meta">
                          {DEAL_TYPE_LABEL[d.type] || d.type}
                          {d.status ? ` · ${d.status}` : ''}
                          {d.deal_code ? ` · ${d.deal_code}` : ''}
                        </span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        )}
      </RailSlidePanel>
    </div>
  );
}
