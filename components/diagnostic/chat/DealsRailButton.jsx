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
import { IconDelete } from '../actionIcons';

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

  const handleDelete = async (e, deal) => {
    e.stopPropagation();
    if (typeof window === 'undefined') return;
    // Two-phase delete: probe for the impact preview, show counts to
    // the user, require typed confirmation before the actual delete.
    setBusy(true);
    let impact = null;
    try {
      const probe = await apiFetch(`/api/deals/${encodeURIComponent(deal.id)}`, { method: 'DELETE' }, accessToken);
      const data = await probe.json().catch(() => ({}));
      if (!probe.ok) throw new Error(data.error || 'Failed to load delete impact.');
      impact = data.impact;
    } catch (err) {
      window.alert(err.message);
      setBusy(false);
      return;
    }
    if (!impact) { setBusy(false); return; }
    const lines = [];
    lines.push(`This will permanently delete "${deal.name}" and:`);
    const c = impact.counts || {};
    if (c.participants) lines.push(`  • ${c.participants} participant${c.participants === 1 ? '' : 's'}`);
    if (c.flows) lines.push(`  • ${c.flows} flow${c.flows === 1 ? '' : 's'}`);
    if (c.documents) lines.push(`  • ${c.documents} document${c.documents === 1 ? '' : 's'}${c.document_chunks ? ` (${c.document_chunks} indexed chunks)` : ''}`);
    if (c.analyses) lines.push(`  • ${c.analyses} analys${c.analyses === 1 ? 'is' : 'es'}`);
    if (c.findings) lines.push(`  • ${c.findings} finding${c.findings === 1 ? '' : 's'}${c.finding_comments ? ` + ${c.finding_comments} comments` : ''}${c.finding_reviews ? ` + ${c.finding_reviews} reviews` : ''}`);
    if (c.qa_items) lines.push(`  • ${c.qa_items} Q&A item${c.qa_items === 1 ? '' : 's'}`);
    if (c.connector_bindings) lines.push(`  • ${c.connector_bindings} folder binding${c.connector_bindings === 1 ? '' : 's'} (SharePoint / Drive)`);
    if (c.chat_sessions) lines.push(`  • ${c.chat_sessions} chat conversation${c.chat_sessions === 1 ? '' : 's'} + every artefact attached to them`);
    if (impact.collaborators_revoked) lines.push(`  • Access revoked for ${impact.collaborators_revoked} collaborator${impact.collaborators_revoked === 1 ? '' : 's'}`);
    if (impact.reports_unlinked) lines.push(`  ${impact.reports_unlinked} saved diagnostic report${impact.reports_unlinked === 1 ? '' : 's'} will be UNLINKED (kept, but no longer attached to a deal).`);
    lines.push('');
    lines.push('This cannot be undone.');
    lines.push('');
    lines.push(`Type "${deal.name}" to confirm:`);
    const typed = window.prompt(lines.join('\n'));
    if (typed == null) { setBusy(false); return; }
    if (typed.trim() !== deal.name) {
      window.alert('Deal name did not match — delete cancelled.');
      setBusy(false);
      return;
    }
    try {
      const resp = await apiFetch(`/api/deals/${encodeURIComponent(deal.id)}?confirm=1`, { method: 'DELETE' }, accessToken);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Failed to delete deal.');
      setDeals((prev) => prev.filter((d) => d.id !== deal.id));
      if (dealId === deal.id) setDeal(null);
    } catch (err) {
      window.alert(err.message);
    } finally {
      setBusy(false);
    }
  };

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

  // Cross-deal portfolio findings search has been removed: it called
  // /api/portfolio/findings which is 410'd post-living-workspace migration
  // (the cross-deal rollup depended on deal_finding_reviews keyed on
  // analysis_id, which is gone). When a portfolio-scoped surface is
  // rebuilt we can wire it back in here.

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

        <div className="s7-rail-pane-body">
          {loading && <div className="s7-rail-pane-empty">Loading…</div>}
          {error && <div className="s7-rail-pane-empty">{error}</div>}
          {!loading && !error && deals.length === 0 && (
            <div className="s7-rail-pane-empty">
              No deals yet. <a href="/workspace/map?openDeals=1">Create one →</a>
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
                      {(d.role === 'owner' || d.accessMode === 'owner') && (
                        <div className="s7-rail-pane-item-actions">
                          <button
                            type="button"
                            className="chat-history-action-btn chat-history-action-btn--danger"
                            onClick={(e) => handleDelete(e, d)}
                            disabled={busy}
                            title="Delete deal"
                            aria-label="Delete deal"
                          >
                            <IconDelete />
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </RailSlidePanel>
    </div>
  );
}
