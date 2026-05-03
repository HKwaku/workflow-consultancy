'use client';

/**
 * Per-deal activity timeline — chronological feed of doc uploads, finding
 * state changes, Q&A asks/answers, comments, analyses, audit events.
 * Lazy-loaded on first expand so the workspace modal doesn't pay for it
 * upfront.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';

const KIND_META = {
  audit:               { icon: '⚙', cls: 'audit' },
  analysis_created:    { icon: '◇', cls: 'analysis' },
  analysis_completed:  { icon: '✓', cls: 'analysis-ok' },
  analysis_failed:     { icon: '✕', cls: 'analysis-err' },
  qa_asked:            { icon: '?', cls: 'qa' },
  qa_answered:         { icon: '!', cls: 'qa-ok' },
  finding_comment:     { icon: '💬', cls: 'comment' },
};

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

export default function DealActivityTimeline({ dealId, accessToken }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    if (!dealId || !accessToken) return;
    setLoading(true);
    try {
      const r = await apiFetch(`/api/deals/${dealId}/activity?limit=200`, {}, accessToken);
      const j = r.ok ? await r.json() : null;
      if (j?.items) setItems(j.items);
    } finally { setLoading(false); }
  }, [dealId, accessToken]);

  useEffect(() => { if (open && items === null) load(); }, [open, items, load]);

  const filtered = (items || []).filter((i) => {
    if (filter === 'all') return true;
    if (filter === 'qa') return i.kind === 'qa_asked' || i.kind === 'qa_answered';
    if (filter === 'analyses') return i.kind.startsWith('analysis_');
    if (filter === 'documents') return i.kind === 'audit' && (i.details?.target_type === 'document' || (i.action || '').startsWith('document.'));
    if (filter === 'discussion') return i.kind === 'finding_comment';
    return true;
  });

  return (
    <section className="deal-workspace-section deal-activity">
      <h3 className="deal-workspace-section-title">
        <button
          type="button"
          className="deal-activity-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        ><span aria-hidden>{open ? '−' : '+'}</span> Activity</button>
        <span className="deal-workspace-section-sub">{items ? `${items.length} events` : ''}</span>
      </h3>
      {open && (
        <>
          <div className="deal-activity-filters">
            {['all', 'documents', 'analyses', 'qa', 'discussion'].map((k) => (
              <button
                key={k}
                type="button"
                className={`deal-activity-filter${filter === k ? ' active' : ''}`}
                onClick={() => setFilter(k)}
              >{k}</button>
            ))}
            <button type="button" className="deal-activity-filter" onClick={load} disabled={loading}>
              {loading ? '↻ Loading…' : '↻ Refresh'}
            </button>
          </div>
          {loading && <div className="deal-workspace-empty">Loading…</div>}
          {!loading && items && filtered.length === 0 && (
            <div className="deal-workspace-empty">No events for this filter.</div>
          )}
          {!loading && filtered.length > 0 && (
            <ul className="deal-activity-list">
              {filtered.map((it) => {
                const meta = KIND_META[it.kind] || { icon: '•', cls: 'audit' };
                return (
                  <li key={it.id} className={`deal-activity-item deal-activity-item--${meta.cls}`}>
                    <span className="deal-activity-icon" aria-hidden>{meta.icon}</span>
                    <span className="deal-activity-body">
                      <span className="deal-activity-summary">{it.summary}</span>
                      <span className="deal-activity-meta">
                        {it.actor || 'system'} · {fmtRelative(it.at)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
