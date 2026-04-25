'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/lib/useAuth';
import { apiFetch } from '@/lib/api-fetch';

/**
 * Chat history panel - lists every chat_sessions row the user can see,
 * with fuzzy search, status filters (all / pinned / archived), last-message
 * preview, and pin/archive/delete actions.
 *
 * Data flows:
 *   /api/chat-sessions?search=&status=  → list
 *   /api/chat-sessions/:id              → GET messages, PATCH flags, DELETE
 *   /api/get-dashboard                  → legacy report-level list (fallback
 *                                          when user has sessions from before
 *                                          cloud persistence was added).
 *
 * On select we either rehydrate the linked report (same behaviour as before)
 * or, if the session has messages but no linked report, we fetch the message
 * thread and surface it in a detail view.
 */

const MODULE_LABELS = {
  scaling: 'Scaling',
  ma: 'M&A',
  pe: 'Private Equity',
  'high-risk-ops': 'High Risk Ops',
};

function groupByDate(items) {
  const now = new Date();
  const buckets = { Pinned: [], Today: [], Yesterday: [], 'Past 7 days': [], 'Past 30 days': [], Older: [] };
  for (const s of items) {
    if (s.pinned) { buckets['Pinned'].push(s); continue; }
    const when = new Date(s.last_message_at || s.updated_at || s.updatedAt || s.createdAt);
    const diff = Math.floor((now - when) / 86400000);
    if (diff === 0) buckets['Today'].push(s);
    else if (diff === 1) buckets['Yesterday'].push(s);
    else if (diff < 7) buckets['Past 7 days'].push(s);
    else if (diff < 30) buckets['Past 30 days'].push(s);
    else buckets['Older'].push(s);
  }
  return Object.entries(buckets).filter(([, its]) => its.length > 0).map(([label, its]) => ({ label, items: its }));
}

function groupByProject(items) {
  const modules = {};
  for (const s of items) {
    const mod = s.moduleId || s.contact?.segment || s.kind || 'other';
    if (!modules[mod]) modules[mod] = [];
    modules[mod].push(s);
  }
  const order = ['scaling', 'ma', 'pe', 'high-risk-ops', 'map', 'redesign', 'cost', 'copilot', 'other'];
  return order
    .filter((k) => modules[k]?.length)
    .map((k) => ({ label: MODULE_LABELS[k] || k[0].toUpperCase() + k.slice(1), items: modules[k] }));
}

function getTitle(item) {
  return item.title
    || item.rawProcesses?.[0]?.processName
    || item.processes?.[0]?.name
    || item.company
    || (item.kind ? `${item.kind} session` : 'Diagnostic');
}

function formatArtefactTooltip(kinds) {
  if (!kinds || typeof kinds !== 'object') return 'Artefacts attached';
  const labels = {
    flow_snapshot: 'flow snapshot',
    report: 'report',
    cost_analysis: 'cost analysis',
    deal_analysis: 'deal analysis',
  };
  const parts = Object.entries(kinds).map(([k, n]) => `${n} ${labels[k] || k}${n === 1 ? '' : 's'}`);
  return parts.length ? parts.join(', ') : 'Artefacts attached';
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const diff = Math.floor((Date.now() - d) / 86400000);
  if (diff === 0) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (diff < 7) return d.toLocaleDateString('en-GB', { weekday: 'short' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function IconEdit() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function IconRedesign() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v1m0 16v1M4.22 4.22l.7.7m13.86 13.86l.7.7M3 12h1m16 0h1M4.22 19.78l.7-.7M18.36 5.64l.7-.7" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

function IconPin({ filled }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 17v5" />
      <path d="M9 10.76V3h6v7.76l3 3.24H6z" />
    </svg>
  );
}

function IconArchive() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="3" width="20" height="5" rx="1" />
      <path d="M4 8v11a2 2 0 002 2h12a2 2 0 002-2V8" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  );
}

export default function ChatHistoryPanel({ onClose, onLoadReport, onRedesignReport }) {
  const { accessToken } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [legacyReports, setLegacyReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [groupMode, setGroupMode] = useState('date');
  const [status, setStatus] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounced(searchInput, 250);
  const [loadingId, setLoadingId] = useState(null);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const searchRef = useRef(null);

  /* Initial + filtered fetches */
  useEffect(() => {
    if (!accessToken) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (status !== 'all') params.set('status', status);
    params.set('limit', '80');

    const parseJson = async (resp, label) => {
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        console.warn(`[chat-history] ${label} failed`, resp.status, text);
        return {};
      }
      return resp.json().catch(() => ({}));
    };
    Promise.all([
      apiFetch(`/api/chat-sessions?${params.toString()}`, {}, accessToken).then((r) => parseJson(r, 'list-sessions')).catch((e) => { console.warn('[chat-history] list-sessions network', e); return { sessions: [] }; }),
      apiFetch('/api/get-dashboard?limit=100', {}, accessToken).then((r) => parseJson(r, 'dashboard')).catch((e) => { console.warn('[chat-history] dashboard network', e); return { reports: [] }; }),
    ])
      .then(([sessRes, repRes]) => {
        if (cancelled) return;
        setSessions(sessRes?.sessions || []);
        setLegacyReports(repRes?.reports || []);
        setError(null);
      })
      .catch(() => { if (!cancelled) setError('Could not load history.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accessToken, search, status]);

  /* Cmd/Ctrl+K focuses search */
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  /* Merge cloud sessions + legacy dashboard rows, dedup by reportId */
  const merged = useMemo(() => {
    if (status !== 'all' && status !== 'pinned') return sessions;
    const byReport = new Map();
    for (const s of sessions) {
      if (s.report_id) byReport.set(s.report_id, true);
    }
    const extras = legacyReports
      .filter((r) => !byReport.has(r.id))
      .map((r) => ({
        id: r.id,
        report_id: r.id,
        kind: 'map',
        title: r.processes?.[0]?.name || r.rawProcesses?.[0]?.processName || r.company || 'Diagnostic',
        last_message: null,
        last_message_at: r.updatedAt || r.createdAt,
        company: r.company,
        redesignStatus: r.redesignStatus,
        moduleId: r.moduleId || r.contact?.segment,
        pinned: false,
        archived: false,
        legacy: true,
        _raw: r,
      }));
    return [...sessions, ...extras];
  }, [sessions, legacyReports, status]);

  /* Client-side search fall-through for legacy rows (server handles cloud sessions) */
  const filtered = useMemo(() => {
    if (!search.trim()) return merged;
    const q = search.trim().toLowerCase();
    return merged.filter((s) => {
      const hay = [s.title, s.last_message, s.summary, s.company, getTitle(s)].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [merged, search]);

  const groups = groupMode === 'date' ? groupByDate(filtered) : groupByProject(filtered);

  /* Actions */
  const handleSelect = useCallback((session) => {
    // Route every session - with or without a linked report - through the
    // ?chatSession resume path so the workflow snapshot (steps, handoffs,
    // flow canvas) AND the message thread are both restored. The resume
    // handler falls back to the report row when the snapshot is empty.
    window.location.href = `/process-audit?chatSession=${encodeURIComponent(session.id)}`;
  }, []);

  const handleEdit = useCallback(async (e, session) => {
    e.stopPropagation();
    const reportId = session.report_id || session.id;
    if (!onLoadReport) {
      window.location.href = `/process-audit?edit=${encodeURIComponent(reportId)}`;
      return;
    }
    setActionLoadingId(session.id + '_edit');
    try {
      const resp = await apiFetch(`/api/get-diagnostic?id=${encodeURIComponent(reportId)}&editable=true`, {}, accessToken);
      const data = resp.ok ? await resp.json().catch(() => ({})) : {};
      if (data.success && data.report) {
        onLoadReport(data.report);
        onClose();
      } else {
        window.location.href = `/process-audit?edit=${encodeURIComponent(reportId)}`;
      }
    } catch {
      window.location.href = `/process-audit?edit=${encodeURIComponent(reportId)}`;
    } finally {
      setActionLoadingId(null);
    }
  }, [accessToken, onLoadReport, onClose]);

  const handleRedesign = useCallback((e, session) => {
    e.stopPropagation();
    const reportId = session.report_id || session.id;
    if (onRedesignReport) {
      onRedesignReport(reportId);
      onClose();
    } else {
      window.location.href = `/process-audit?edit=${encodeURIComponent(reportId)}`;
    }
  }, [onRedesignReport, onClose]);

  const patchSession = useCallback(async (session, patch) => {
    if (session.legacy) return;
    // Optimistic update
    setSessions((prev) => prev.map((s) => (s.id === session.id ? { ...s, ...patch } : s)));
    try {
      const resp = await apiFetch(`/api/chat-sessions/${encodeURIComponent(session.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }, accessToken);
      if (!resp.ok) throw new Error('patch failed');
    } catch {
      // Rollback on failure
      setSessions((prev) => prev.map((s) => (s.id === session.id ? session : s)));
    }
  }, [accessToken]);

  const handleTogglePin = useCallback((e, session) => {
    e.stopPropagation();
    patchSession(session, { pinned: !session.pinned });
  }, [patchSession]);

  const handleToggleArchive = useCallback((e, session) => {
    e.stopPropagation();
    patchSession(session, { archived: !session.archived });
  }, [patchSession]);

  return (
    <div className="s7-chat-inner chat-history-panel">
      <div className="chat-history-hd">
        <div className="chat-history-hd-tabs">
          <button type="button" className={`chat-history-tab${groupMode === 'date' ? ' active' : ''}`} onClick={() => setGroupMode('date')}>
            Recents
          </button>
          <button type="button" className={`chat-history-tab${groupMode === 'project' ? ' active' : ''}`} onClick={() => setGroupMode('project')}>
            Projects
          </button>
        </div>
        <button className="chat-history-close-btn" onClick={onClose} aria-label="Close history">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {accessToken && (
        <div className="chat-history-search-row">
          <div className="chat-history-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchRef}
              className="chat-history-search-input"
              type="search"
              placeholder="Search conversations…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <span className="chat-history-search-hint" aria-hidden>⌘K</span>
          </div>
          <div className="chat-history-status-tabs">
            <button type="button" className={`chat-history-status-tab${status === 'all' ? ' active' : ''}`} onClick={() => setStatus('all')}>All</button>
            <button type="button" className={`chat-history-status-tab${status === 'pinned' ? ' active' : ''}`} onClick={() => setStatus('pinned')}>Pinned</button>
            <button type="button" className={`chat-history-status-tab${status === 'archived' ? ' active' : ''}`} onClick={() => setStatus('archived')}>Archived</button>
          </div>
        </div>
      )}

      <div className="chat-history-new-btn-row">
        <a href="/process-audit?new=1" className="chat-history-new-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New chat
        </a>
      </div>

      <div className="chat-history-body">
        {!accessToken && (
          <div className="chat-history-empty">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            <p>Sign in to view your history.</p>
            <a href="/portal" className="chat-history-signin-link">Sign in</a>
          </div>
        )}

        {accessToken && loading && (
          <div className="chat-history-loading">
            <div className="chat-history-spinner" /><span>Loading…</span>
          </div>
        )}

        {accessToken && !loading && error && (
          <div className="chat-history-empty"><p>{error}</p></div>
        )}

        {accessToken && !loading && !error && filtered.length === 0 && (
          <div className="chat-history-empty">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
            <p>
              {search.trim()
                ? `No matches for "${search.trim()}"`
                : status === 'archived'
                  ? 'No archived conversations.'
                  : status === 'pinned'
                    ? 'Nothing pinned yet.'
                    : <>No sessions yet.<br />Complete a diagnostic to see it here.</>}
            </p>
          </div>
        )}

        {accessToken && !loading && !error && groups.map((group) => (
          <div key={group.label} className="chat-history-group">
            <div className="chat-history-group-label">{group.label}</div>
            {group.items.map((session) => {
              const title = getTitle(session);
              const preview = session.last_message;
              return (
                <div
                  key={session.id}
                  className={`chat-history-item-wrap${loadingId === session.id ? ' loading' : ''}${session.pinned ? ' is-pinned' : ''}${session.archived ? ' is-archived' : ''}`}
                >
                  <button
                    type="button"
                    className="chat-history-item"
                    onClick={() => handleSelect(session)}
                    disabled={loadingId === session.id}
                  >
                    <div className="chat-history-item-title">
                      {session.pinned && <span className="chat-history-item-pinmark" aria-hidden>📌</span>}
                      {title}
                    </div>
                    {preview && (
                      <div className="chat-history-item-preview">{preview}</div>
                    )}
                    <div className="chat-history-item-row">
                      {session.company && <span className="chat-history-item-meta">{session.company}</span>}
                      {session.kind && session.kind !== 'map' && (
                        <span className="chat-history-item-kind">{session.kind}</span>
                      )}
                      <span className="chat-history-item-date">{formatDate(session.last_message_at || session.updatedAt || session.createdAt)}</span>
                      {session.message_count > 0 && (
                        <span className="chat-history-item-count">{session.message_count} msg{session.message_count === 1 ? '' : 's'}</span>
                      )}
                      {session.artefact_count > 0 && (
                        <span className="chat-history-item-artefacts" title={formatArtefactTooltip(session.artefact_kinds)}>
                          ◫ {session.artefact_count}
                        </span>
                      )}
                      {session.redesignStatus === 'accepted' && <span className="chat-history-item-tag">Redesigned</span>}
                    </div>
                  </button>
                  <div className="chat-history-item-actions">
                    {!session.legacy && (
                      <button
                        type="button"
                        className={`chat-history-action-btn${session.pinned ? ' active' : ''}`}
                        onClick={(e) => handleTogglePin(e, session)}
                        title={session.pinned ? 'Unpin' : 'Pin'}
                      >
                        <IconPin filled={session.pinned} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="chat-history-action-btn"
                      onClick={(e) => handleEdit(e, session)}
                      disabled={actionLoadingId === session.id + '_edit'}
                      title="Edit process"
                    >
                      <IconEdit />
                    </button>
                    <button
                      type="button"
                      className="chat-history-action-btn"
                      onClick={(e) => handleRedesign(e, session)}
                      title="Redesign with AI"
                    >
                      <IconRedesign />
                    </button>
                    {!session.legacy && (
                      <button
                        type="button"
                        className="chat-history-action-btn"
                        onClick={(e) => handleToggleArchive(e, session)}
                        title={session.archived ? 'Unarchive' : 'Archive'}
                      >
                        <IconArchive />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {accessToken && !loading && filtered.length > 0 && (
        <div className="chat-history-footer">
          <a href="/portal?dashboard=1" className="chat-history-portal-link" target="_blank" rel="noopener noreferrer">View all in dashboard →</a>
        </div>
      )}
    </div>
  );
}
