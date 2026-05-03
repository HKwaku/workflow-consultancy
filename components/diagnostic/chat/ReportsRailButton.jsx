'use client';

/**
 * Rail icon for the diagnostic chat that scopes the conversation to one of
 * the user's existing diagnostic reports.
 *
 * UX: NOT a floating popover — opens as a slide-in panel that visually
 * extends the rail to the right (rail | reports panel | chat). Has its own
 * close button to collapse back to rail-only. Reports are grouped logically
 * — by company, then by recency bucket within each company — rather than
 * shown as a flat list.
 *
 * Click a report → push `?edit=<id>&email=…`. The existing chatSession
 * resume effect in `DiagnosticClient.jsx` hydrates the report's flow into
 * the canvas.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/api-fetch';
import { useDiagnostic } from '../DiagnosticContext';

const RECENCY_BUCKETS = [
  { key: 'today',     label: 'Today',         maxDays: 1 },
  { key: 'this_week', label: 'This week',     maxDays: 7 },
  { key: 'this_month',label: 'This month',    maxDays: 31 },
  { key: 'older',     label: 'Earlier',       maxDays: Infinity },
];

function bucketForDate(iso) {
  if (!iso) return 'older';
  const days = Math.max(0, (Date.now() - new Date(iso).getTime()) / 86_400_000);
  return RECENCY_BUCKETS.find((b) => days < b.maxDays).key;
}

/**
 * Group reports by company → recency bucket. Returns:
 *   [{ company, items: [{ bucket, label, reports: [...] }] }, ...]
 * Companies sorted by most-recent activity. "Untagged" group last.
 */
function groupReports(reports) {
  const byCompany = new Map();
  for (const r of reports) {
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
      .map((b) => ({ bucket: b.key, label: b.label, reports: byBucket.get(b.key) }));
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

/**
 * Derive a compact list of status dots for a report row. Each entry is
 * { kind, title } where `kind` maps to a CSS colour modifier on
 * `.s7-rail-pane-dot--<kind>`. Dots replace verbose tag pills — they take
 * far less space and the title attribute carries the full label on hover
 * for users who want detail.
 */
function dotsFor(r) {
  const dots = [];
  if (r.redesignStatus === 'accepted' || r.acceptedRedesign) {
    dots.push({ kind: 'redesigned', title: 'Redesigned · accepted' });
  } else if (r.redesignStatus === 'pending' || r.pendingRedesign) {
    dots.push({ kind: 'pending', title: 'Pending redesign' });
  }
  if (r.costAnalysisStatus && r.costAnalysisStatus !== 'complete') {
    dots.push({ kind: 'pending', title: 'Pending cost analysis' });
  }
  if (r.isContributor) dots.push({ kind: 'shared', title: 'Shared with you' });
  if (r.dealId || r.deal_id) dots.push({ kind: 'deal', title: 'Deal-bound report' });
  return dots;
}

/**
 * URL builders for the three navigation modes the diagnostic surface
 * understands when entering an existing report. Encoded here so the rail
 * button stays the only place that knows the routing.
 */
const reportUrl = (id, email) => `/process-audit?edit=${encodeURIComponent(id)}&email=${encodeURIComponent(email || '')}`;
const editRedesignUrl = (id, email) => `${reportUrl(id, email)}&editRedesign=1`;
const newRedesignUrl  = (id, email) => `${reportUrl(id, email)}&aiRedesign=1`;

/* Compact icon-only action buttons. Hover-reveals the label via title.
   Edit = pencil, Redesign = sparkle, Delete = trash. The action row stays
   visible at all times but is much narrower than text-labelled buttons. */
function IconBtn({ glyph, title, accent, danger, onClick }) {
  const cls = `s7-rail-pane-icon-btn${accent ? ' is-accent' : ''}${danger ? ' is-danger' : ''}`;
  return (
    <button type="button" className={cls} onClick={onClick} title={title} aria-label={title}>
      {glyph}
    </button>
  );
}

const EditGlyph = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
  </svg>
);
const RedesignGlyph = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 2l1.5 5L19 8l-5 3 1.5 6L12 14l-3.5 3L10 11 5 8l5.5-1z" />
  </svg>
);
const TrashGlyph = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
  </svg>
);

function ReportRow({ r, active, busy, sessionUserEmail, onPickHref, onDelete, onDeleteRedesign }) {
  const procName = (r.processes && r.processes[0]?.name) || null;
  const procCount = r.metrics?.totalProcesses ?? (r.processes?.length || 0);
  const headline = procName || r.contactName || r.displayCode || 'Untitled report';
  const dateBit = r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : '';
  const savings = r.metrics?.potentialSavings || 0;
  const subBits = [];
  if (procCount > 1) subBits.push(`${procCount}p`);
  if (savings >= 1000) subBits.push(`£${(savings / 1000).toFixed(savings >= 100_000 ? 0 : 1)}k`);
  const grade = r.metrics?.automationGrade;
  if (grade && grade !== 'N/A') subBits.push(grade);
  if (dateBit) subBits.push(dateBit);

  const dots = dotsFor(r);
  const versions = Array.isArray(r.redesignVersions) ? r.redesignVersions : [];
  const hasRedesigns = versions.length > 0 || r.acceptedRedesign || r.pendingRedesign;
  const hasRedesignNow = hasRedesigns;

  // Default state is collapsed — row shows ONLY the title + status dots
  // (the "tag level" the user asked for). Click + to expand and reveal
  // metrics + parent actions + redesign children.
  const [expanded, setExpanded] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [confirmDelChild, setConfirmDelChild] = useState(null); // 'baseline' | redesign id

  return (
    <li>
      {/* ── Parent row — always visible. +/− toggles the children panel.
          Delete sits on this row so it's reachable without expanding. ── */}
      <div className={`s7-rail-pane-item s7-rail-pane-item--row${active ? ' active' : ''}${expanded ? ' is-expanded' : ''}`}>
        <button
          type="button"
          className={`s7-rail-pane-expand${expanded ? ' open' : ''}`}
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          aria-expanded={expanded}
        >{expanded ? '−' : '+'}</button>
        <button
          type="button"
          className="s7-rail-pane-item-body s7-rail-pane-item-body--toggle"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Collapse' : 'Expand'}
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
        </button>
        <span className="s7-rail-pane-actions">
          <IconBtn
            glyph={TrashGlyph}
            title="Delete report"
            danger
            onClick={() => setConfirmDel(true)}
          />
        </span>
      </div>

      {confirmDel && (
        <div className="s7-rail-pane-confirm">
          <span>Delete <strong>{headline}</strong>? This cascades to its redesigns.</span>
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

      {/* ── Expanded body: only the two children — Current process and
          redesigns (any number). Metrics now live inline on the parent row
          so they're visible even when collapsed. Edit lives on each child. ── */}
      {expanded && (
        <div className="s7-rail-pane-expanded">
          <ul className="s7-rail-pane-children">
            {/* Current process (baseline). Deleting this is the same as
                deleting the whole report — surface that warning explicitly. */}
            <li>
              <div className="s7-rail-pane-item s7-rail-pane-item--row s7-rail-pane-item--child">
                <span className="s7-rail-pane-child-dot" aria-hidden>○</span>
                <button
                  type="button"
                  className="s7-rail-pane-item-body"
                  onClick={() => onPickHref(reportUrl(r.id, sessionUserEmail))}
                  disabled={busy}
                  title="Open the baseline"
                >
                  <span className="s7-rail-pane-item-name">Current process</span>
                  <span className="s7-rail-pane-item-meta">Baseline</span>
                </button>
                <span className="s7-rail-pane-actions">
                  <IconBtn glyph={EditGlyph} title="Edit baseline"
                    onClick={() => onPickHref(reportUrl(r.id, sessionUserEmail))} />
                  {/* Redesign always available — each click spawns another
                      version. Multiple redesigns per report are first-class. */}
                  <IconBtn
                    glyph={RedesignGlyph}
                    title={hasRedesigns ? 'Generate another redesign' : 'Generate redesign'}
                    accent
                    onClick={() => onPickHref(newRedesignUrl(r.id, sessionUserEmail))}
                  />
                  <IconBtn glyph={TrashGlyph} title="Delete baseline (deletes the whole report)" danger
                    onClick={() => setConfirmDelChild('baseline')} />
                </span>
              </div>
              {confirmDelChild === 'baseline' && (
                <div className="s7-rail-pane-confirm">
                  <span>Delete the baseline? This deletes the <strong>entire report</strong> including all redesigns.</span>
                  <span className="s7-rail-pane-confirm-actions">
                    <button
                      type="button"
                      className="s7-rail-pane-action s7-rail-pane-action--danger"
                      onClick={async () => { await onDelete(r); setConfirmDelChild(null); }}
                    >Delete</button>
                    <button
                      type="button"
                      className="s7-rail-pane-action"
                      onClick={() => setConfirmDelChild(null)}
                    >Cancel</button>
                  </span>
                </div>
              )}
            </li>

            {hasRedesigns && (versions.length > 0
              ? versions
              : [{ id: 'fallback', name: 'Redesigned process', source: 'ai', status: r.acceptedRedesign ? 'accepted' : 'pending' }]
            ).map((v) => {
              const isFallback = v.id === 'fallback';
              const cdKey = v.id || `v${v.version || 'fb'}`;
              return (
                <li key={cdKey}>
                  <div className="s7-rail-pane-item s7-rail-pane-item--row s7-rail-pane-item--child">
                    <span className="s7-rail-pane-child-dot" aria-hidden>●</span>
                    <button
                      type="button"
                      className="s7-rail-pane-item-body"
                      onClick={() => onPickHref(editRedesignUrl(r.id, sessionUserEmail))}
                      disabled={busy}
                      title="Open this redesign"
                    >
                      <span className="s7-rail-pane-item-name">
                        {v.name || `Redesign v${v.version || 1}`}
                        {v.status === 'accepted' && (
                          <span className="s7-rail-pane-dot s7-rail-pane-dot--redesigned" title="Accepted" style={{ marginLeft: 6 }} />
                        )}
                      </span>
                      <span className="s7-rail-pane-item-meta">
                        {v.source === 'ai' ? 'AI' : 'Manual'}
                        {v.createdAt ? ` · ${new Date(v.createdAt).toISOString().slice(0, 10)}` : ''}
                      </span>
                    </button>
                    <span className="s7-rail-pane-actions">
                      <IconBtn glyph={EditGlyph} title="Edit redesign" accent
                        onClick={() => onPickHref(editRedesignUrl(r.id, sessionUserEmail))} />
                      {!isFallback && (
                        <IconBtn glyph={TrashGlyph} title="Delete this redesign" danger
                          onClick={() => setConfirmDelChild(cdKey)} />
                      )}
                    </span>
                  </div>
                  {confirmDelChild === cdKey && (
                    <div className="s7-rail-pane-confirm">
                      <span>Delete <strong>{v.name || `Redesign v${v.version || 1}`}</strong>? The baseline report stays intact.</span>
                      <span className="s7-rail-pane-confirm-actions">
                        <button
                          type="button"
                          className="s7-rail-pane-action s7-rail-pane-action--danger"
                          onClick={async () => {
                            await onDeleteRedesign(r, v);
                            setConfirmDelChild(null);
                          }}
                        >Delete</button>
                        <button
                          type="button"
                          className="s7-rail-pane-action"
                          onClick={() => setConfirmDelChild(null)}
                        >Cancel</button>
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
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
  const [reports, setReports] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [panePos, setPanePos] = useState(null);
  const [filter, setFilter] = useState('');
  // Companies the user has explicitly collapsed to the group-title level.
  // Default = expanded (set is empty).
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const toggleGroup = (company) => setCollapsedGroups((s) => {
    const next = new Set(s);
    if (next.has(company)) next.delete(company); else next.add(company);
    return next;
  });
  const paneRef = useRef(null);
  const btnRef = useRef(null);

  const activeReportId = searchParams?.get('report') || searchParams?.get('edit') || null;

  // Anchor the slide-in panel flush to the right edge of the rail.
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

  // Close on outside click (anywhere outside the rail + the pane) or Escape.
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
    if (!open || reports.length > 0 || loading) return;
    if (!accessToken || !sessionUserEmail) { setError('Sign in to see your reports.'); return; }
    setLoading(true);
    setError(null);
    apiFetch(`/api/get-dashboard?email=${encodeURIComponent(sessionUserEmail)}`, {}, accessToken)
      .then((r) => r.json())
      .then((data) => {
        if (data?.error) throw new Error(data.error);
        setReports((data?.reports || []).slice(0, 200));
      })
      .catch((e) => setError(e?.message || 'Failed to load reports.'))
      .finally(() => setLoading(false));
  }, [open, accessToken, sessionUserEmail, reports.length, loading]);

  const select = async (report) => {
    pickHref(reportUrl(report.id, sessionUserEmail));
  };

  // Generic navigator the row's Edit / Redesign / Edit-redesign buttons use.
  // Accepts a fully-formed href (e.g. /process-audit?edit=…&aiRedesign=1) so
  // each action can route to its specific mode without each component
  // duplicating the URL-merge logic.
  const pickHref = (href) => {
    if (busy) return;
    setBusy(true);
    try {
      setDeal(null);
      // Replace the query string entirely so old params (deal, chatSession,
      // focusFinding, etc.) drop. Use full-path navigation since the new
      // params change which mode the resume effect picks (edit / editRedesign
      // / aiRedesign).
      router.replace(href, { scroll: false });
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const deleteReport = async (report) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch(
        '/api/get-dashboard',
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reportId: report.id }),
        },
        accessToken,
      );
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || `Delete failed (${r.status})`);
      // Optimistic local removal — drop the row without re-fetching.
      setReports((prev) => prev.filter((x) => x.id !== report.id));
      // If the deleted report was the active one in the URL, drop the params.
      if (activeReportId === report.id) {
        const params = new URLSearchParams(Array.from(searchParams.entries()));
        params.delete('edit');
        params.delete('email');
        params.delete('chatSession');
        params.delete('report');
        const qs = params.toString();
        router.replace(qs ? `?${qs}` : '?', { scroll: false });
      }
    } catch (e) {
      setError(e?.message || 'Delete failed.');
    } finally {
      setBusy(false);
    }
  };

  // Delete a single redesign version, leaving the parent report intact.
  // Calls /api/save-redesign DELETE — owner-only on the server.
  const deleteRedesign = async (report, version) => {
    if (busy || !version?.id) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch(
        '/api/save-redesign',
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reportId: report.id, redesignId: version.id }),
        },
        accessToken,
      );
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || `Delete failed (${r.status})`);
      // Optimistic local update — drop the version from this report's row.
      setReports((prev) => prev.map((x) => x.id !== report.id ? x : ({
        ...x,
        redesignVersions: (x.redesignVersions || []).filter((v) => v.id !== version.id),
        // If we deleted the active redesign, also clear the parent flags so
        // the row's "has redesign" state is consistent.
        acceptedRedesign: x.acceptedRedesign && x.acceptedRedesign.id === version.id ? null : x.acceptedRedesign,
        pendingRedesign: x.pendingRedesign && x.pendingRedesign.id === version.id ? null : x.pendingRedesign,
        redesignStatus: ((x.redesignVersions || []).filter((v) => v.id !== version.id).length === 0) ? null : x.redesignStatus,
      })));
    } catch (e) {
      setError(e?.message || 'Delete failed.');
    } finally {
      setBusy(false);
    }
  };

  const clearReport = () => {
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    params.delete('edit');
    params.delete('email');
    params.delete('chatSession');
    params.delete('report');
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '?', { scroll: false });
    setOpen(false);
  };

  // Filtering + grouping.
  const filteredReports = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter((r) => {
      const procs = (r.processes || []).map((p) => p.name).join(' ').toLowerCase();
      return [r.company, r.contactName, r.displayCode, procs].some(
        (s) => (s || '').toLowerCase().includes(q),
      );
    });
  }, [reports, filter]);
  const groups = useMemo(() => groupReports(filteredReports), [filteredReports]);

  return (
    <div className="s7-split-rail-deals">
      <button
        ref={btnRef}
        type="button"
        className={`s7-split-rail-btn${activeReportId ? ' active' : ''}${open ? ' active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={activeReportId ? 'Switch report' : 'Open one of your reports'}
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
            <span className="s7-rail-pane-title">Your reports</span>
            <div className="s7-rail-pane-head-actions">
              {activeReportId && (
                <button type="button" className="s7-rail-pane-clear" onClick={clearReport}>Clear</button>
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
            {!loading && !error && reports.length === 0 && (
              <div className="s7-rail-pane-empty">
                No reports yet. <a href="/process-audit">Run your first audit →</a>
              </div>
            )}
            {!loading && !error && reports.length > 0 && groups.length === 0 && (
              <div className="s7-rail-pane-empty">No matches.</div>
            )}
            {!loading && !error && groups.length > 0 && (
              <div className="s7-rail-pane-groups">
                {groups.map((g) => {
                  const collapsed = collapsedGroups.has(g.company);
                  const totalCount = g.items.reduce((n, b) => n + b.reports.length, 0);
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
                            {b.reports.map((r) => (
                              <ReportRow
                                key={r.id}
                                r={r}
                                active={r.id === activeReportId}
                                busy={busy}
                                sessionUserEmail={sessionUserEmail}
                                onPickHref={pickHref}
                                onDelete={deleteReport}
                                onDeleteRedesign={deleteRedesign}
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
