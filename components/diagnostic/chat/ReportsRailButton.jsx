'use client';

/**
 * Rail icon for the diagnostic chat that scopes the conversation to one
 * of the user's existing processes.
 *
 * Living-workspace model: every process is a single live row in the
 * `processes` table — no "redesign" children, no versions, no cost
 * deliverable. The rail lists processes grouped by company → recency.
 * Click a row → silent canvas swap via `vesno:open-process` (no route
 * change, chat thread intact). Cmd/Ctrl+click on the row title opens
 * the canonical URL in a new tab via the underlying href.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api-fetch';
import { useDiagnostic } from '../DiagnosticContext';

const RECENCY_BUCKETS = [
  { key: 'today',     label: 'Today',      maxDays: 1 },
  { key: 'this_week', label: 'This week',  maxDays: 7 },
  { key: 'this_month',label: 'This month', maxDays: 31 },
  { key: 'older',     label: 'Earlier',    maxDays: Infinity },
];

function bucketForDate(iso) {
  if (!iso) return 'older';
  const days = Math.max(0, (Date.now() - new Date(iso).getTime()) / 86_400_000);
  return RECENCY_BUCKETS.find((b) => days < b.maxDays).key;
}

function groupProcesses(processes) {
  const byCompany = new Map();
  for (const r of processes) {
    const co = (r.company || '').trim() || 'Untagged';
    if (!byCompany.has(co)) byCompany.set(co, []);
    byCompany.get(co).push(r);
  }
  const groups = [];
  for (const [company, items] of byCompany.entries()) {
    items.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const byBucket = new Map();
    for (const r of items) {
      const b = bucketForDate(r.createdAt);
      if (!byBucket.has(b)) byBucket.set(b, []);
      byBucket.get(b).push(r);
    }
    const bucketed = RECENCY_BUCKETS
      .filter((b) => byBucket.has(b.key))
      .map((b) => ({ bucket: b.key, label: b.label, processes: byBucket.get(b.key) }));
    const mostRecent = items[0]?.createdAt ? new Date(items[0].createdAt).getTime() : 0;
    groups.push({ company, items: bucketed, mostRecent });
  }
  groups.sort((a, b) => {
    if (a.company === 'Untagged') return 1;
    if (b.company === 'Untagged') return -1;
    return b.mostRecent - a.mostRecent;
  });
  return groups;
}

// Status dots: "Shared with you" (contributor) and "Deal-bound" only.
// Redesign / cost-analysis status dots removed with the snapshot
// paradigm.
function dotsFor(r) {
  const dots = [];
  if (r.isContributor) dots.push({ kind: 'shared', title: 'Shared with you' });
  if (r.dealId || r.deal_id) dots.push({ kind: 'deal', title: 'Deal-bound process' });
  return dots;
}

const processUrl = (id) => `/workspace/map?view=${encodeURIComponent(id)}`;

function IconBtn({ glyph, title, danger, onClick }) {
  const cls = `s7-rail-pane-icon-btn${danger ? ' is-danger' : ''}`;
  return (
    <button type="button" className={cls} onClick={onClick} title={title} aria-label={title}>
      {glyph}
    </button>
  );
}

const TrashGlyph = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
  </svg>
);

function ProcessRow({ r, active, busy, onOpen, onDelete }) {
  const procName = (r.processes && r.processes[0]?.name) || null;
  const headline = procName || r.contactName || r.displayCode || 'Untitled process';
  const dateBit = r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : '';
  const procCount = r.metrics?.totalProcesses ?? (r.processes?.length || 0);
  const savings = r.metrics?.potentialSavings || 0;
  const auto    = r.metrics?.automationPercentage;
  const subBits = [];
  if (procCount > 1) subBits.push(`${procCount} processes`);
  if (savings >= 1000) subBits.push(`£${(savings / 1000).toFixed(savings >= 100_000 ? 0 : 1)}k savings`);
  if (auto != null) subBits.push(`${Math.round(auto)}% auto`);
  if (dateBit) subBits.push(dateBit);

  const dots = dotsFor(r);
  const [confirmDel, setConfirmDel] = useState(false);

  return (
    <li>
      <div className={`s7-rail-pane-item s7-rail-pane-item--row${active ? ' active' : ''}`}>
        <a
          className="s7-rail-pane-item-body s7-rail-pane-item-body--link"
          href={processUrl(r.id)}
          title={`Open ${headline} (Cmd/Ctrl+click for new tab)`}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
            e.preventDefault();
            if (busy) return;
            onOpen(r);
          }}
        >
          <span className="s7-rail-pane-item-name">
            {headline}
            {dots.length > 0 && (
              <span className="s7-rail-pane-dots">
                {dots.map((d, i) => (
                  <span key={i} className={`s7-rail-pane-dot s7-rail-pane-dot--${d.kind}`} title={d.title} />
                ))}
              </span>
            )}
          </span>
          {subBits.length > 0 && (
            <span className="s7-rail-pane-item-meta">{subBits.join(' · ')}</span>
          )}
        </a>
        <span className="s7-rail-pane-actions">
          <IconBtn
            glyph={TrashGlyph}
            title="Delete process"
            danger
            onClick={() => setConfirmDel(true)}
          />
        </span>
      </div>

      {confirmDel && (
        <div className="s7-rail-pane-confirm">
          <span>Delete <strong>{headline}</strong>? This removes the process and its change history.</span>
          <span className="s7-rail-pane-confirm-actions">
            <button
              type="button"
              className="s7-rail-pane-action s7-rail-pane-action--danger"
              onClick={async () => { await onDelete(r); setConfirmDel(false); }}
            >Delete</button>
            <button
              type="button"
              className="s7-rail-pane-action"
              onClick={() => setConfirmDel(false)}
            >Cancel</button>
          </span>
        </div>
      )}
    </li>
  );
}

export default function ReportsRailButton({ accessToken, sessionUserEmail }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setDeal } = useDiagnostic();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [processes, setProcesses] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [panePos, setPanePos] = useState(null);
  const [filter, setFilter] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const toggleGroup = (company) => setCollapsedGroups((s) => {
    const next = new Set(s);
    if (next.has(company)) next.delete(company); else next.add(company);
    return next;
  });
  const paneRef = useRef(null);
  const btnRef = useRef(null);

  const activeReportId = searchParams?.get('view') || searchParams?.get('edit') || null;

  useEffect(() => {
    if (!open) return;
    const compute = () => {
      const rail = btnRef.current?.closest('.s7-split-rail');
      if (!rail) return;
      const r = rail.getBoundingClientRect();
      setPanePos({ left: r.right, top: r.top, height: r.height });
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (paneRef.current?.contains(e.target)) return;
      if (btnRef.current?.contains(e.target)) return;
      const rail = btnRef.current?.closest('.s7-split-rail');
      if (rail?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open || processes.length > 0 || loading) return;
    if (!accessToken || !sessionUserEmail) { setError('Sign in to see your processes.'); return; }
    setLoading(true);
    setError(null);
    apiFetch(`/api/get-dashboard?email=${encodeURIComponent(sessionUserEmail)}`, {}, accessToken)
      .then((r) => r.json())
      .then((data) => {
        if (data?.error) throw new Error(data.error);
        setProcesses((data?.reports || []).slice(0, 200));
      })
      .catch((e) => setError(e?.message || 'Failed to load processes.'))
      .finally(() => setLoading(false));
  }, [open, accessToken, sessionUserEmail, processes.length, loading]);

  // Open a process inline on the canvas. Same silent-dispatch path the
  // rest of the app uses — no route change, chat thread stays.
  const onOpenProcess = (process) => {
    if (busy) return;
    setBusy(true);
    try {
      setDeal(null);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('vesno:open-process', {
          detail: { reportId: process.id, intent: 'view' },
        }));
      }
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const deleteProcess = async (process) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch(
        '/api/get-dashboard',
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reportId: process.id }),
        },
        accessToken,
      );
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || `Delete failed (${r.status})`);
      setProcesses((prev) => prev.filter((x) => x.id !== process.id));
      if (activeReportId === process.id) {
        const params = new URLSearchParams(Array.from(searchParams.entries()));
        params.delete('edit');
        params.delete('email');
        params.delete('chatSession');
        params.delete('view');
        const qs = params.toString();
        router.replace(qs ? `?${qs}` : '?', { scroll: false });
      }
    } catch (e) {
      setError(e?.message || 'Delete failed.');
    } finally {
      setBusy(false);
    }
  };

  const clearActive = () => {
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    params.delete('edit');
    params.delete('email');
    params.delete('chatSession');
    params.delete('view');
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '?', { scroll: false });
    setOpen(false);
  };

  const filteredProcesses = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return processes;
    return processes.filter((r) => {
      const procs = (r.processes || []).map((p) => p.name).join(' ').toLowerCase();
      return [r.company, r.contactName, r.displayCode, procs].some(
        (s) => (s || '').toLowerCase().includes(q),
      );
    });
  }, [processes, filter]);
  const groups = useMemo(() => groupProcesses(filteredProcesses), [filteredProcesses]);

  return (
    <div className="s7-split-rail-deals">
      <button
        ref={btnRef}
        type="button"
        className={`s7-split-rail-btn${activeReportId ? ' active' : ''}${open ? ' active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={activeReportId ? 'Switch process' : 'Open one of your processes'}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="9" y1="13" x2="15" y2="13" />
          <line x1="9" y1="17" x2="15" y2="17" />
        </svg>
        {activeReportId && <span className="s7-split-rail-deals-dot" aria-hidden />}
      </button>

      {open && panePos && typeof document !== 'undefined' && createPortal(
        <div
          ref={paneRef}
          className="s7-rail-pane"
          role="menu"
          style={{
            position: 'fixed',
            left: panePos.left,
            top: panePos.top,
            height: panePos.height,
          }}
        >
          <div className="s7-rail-pane-head">
            <span className="s7-rail-pane-title">Your processes</span>
            <div className="s7-rail-pane-head-actions">
              {activeReportId && (
                <button type="button" className="s7-rail-pane-clear" onClick={clearActive}>Clear</button>
              )}
              <button
                type="button"
                className="s7-rail-pane-close"
                onClick={() => setOpen(false)}
                aria-label="Close panel"
                title="Close"
              >×</button>
            </div>
          </div>

          <div className="s7-rail-pane-search">
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by company, process, code…"
              className="s7-rail-pane-search-input"
              autoFocus
            />
          </div>

          <div className="s7-rail-pane-body">
            {loading && <div className="s7-rail-pane-empty">Loading…</div>}
            {error && <div className="s7-rail-pane-empty">{error}</div>}
            {!loading && !error && processes.length === 0 && (
              <div className="s7-rail-pane-empty">
                No processes yet. Map one in the chat.
              </div>
            )}
            {!loading && !error && processes.length > 0 && groups.length === 0 && (
              <div className="s7-rail-pane-empty">No matches.</div>
            )}
            {!loading && !error && groups.length > 0 && (
              <div className="s7-rail-pane-groups">
                {groups.map((g) => {
                  const collapsed = collapsedGroups.has(g.company);
                  const totalCount = g.items.reduce((n, b) => n + b.processes.length, 0);
                  return (
                    <section key={g.company} className={`s7-rail-pane-group${collapsed ? ' is-collapsed' : ''}`}>
                      <button
                        type="button"
                        className="s7-rail-pane-group-title"
                        onClick={() => toggleGroup(g.company)}
                        aria-expanded={!collapsed}
                        title={collapsed ? `Expand ${g.company}` : `Collapse ${g.company}`}
                      >
                        <span className="s7-rail-pane-group-toggle">{collapsed ? '+' : '−'}</span>
                        <span>{g.company}</span>
                        <span className="s7-rail-pane-group-count">{totalCount}</span>
                      </button>
                      {!collapsed && g.items.map((b) => (
                        <div key={b.bucket} className="s7-rail-pane-bucket">
                          <div className="s7-rail-pane-bucket-label">{b.label}</div>
                          <ul className="s7-rail-pane-list">
                            {b.processes.map((r) => (
                              <ProcessRow
                                key={r.id}
                                r={r}
                                active={r.id === activeReportId}
                                busy={busy}
                                onOpen={onOpenProcess}
                                onDelete={deleteProcess}
                              />
                            ))}
                          </ul>
                        </div>
                      ))}
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
