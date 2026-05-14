'use client';

/**
 * The "Talking about X" pill + Open Workspace button + collapsible stats
 * pane that's shown anywhere chat is scoped to a deal. Lives in its own
 * file so both `ChatWorkspaceShell` (pre-map screens) and `DiagnosticWorkspace`
 * (screen 2) can mount it — without it, switching to screen 2 used to hide
 * every visible deal affordance and the post-pick state felt empty.
 *
 * Auto-opens the workspace modal once per deal on first pick (Phase 20 / B):
 * the user gets immediate visual proof of what's there (participants, docs,
 * findings) instead of an empty-feeling chat.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useDiagnostic } from '../DiagnosticContext';
import { useAuth } from '@/lib/useAuth';
import { apiFetch } from '@/lib/api-fetch';
import DealWorkspaceModal from './DealWorkspaceModal';

export default function DealContextChip() {
  const { dealId, dealName } = useDiagnostic();
  const { user: sessionUser, accessToken } = useAuth();
  const searchParams = useSearchParams();
  const [summary, setSummary] = useState(null);
  const [paneOpen, setPaneOpen] = useState(true);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);

  // Focus targets can arrive two ways:
  //   1. URL params (?focusFinding=… / ?focusChange=…) on first load or
  //      a real navigation — read via useSearchParams.
  //   2. Silent canvas-internal dispatch (vesno:focus-finding /
  //      vesno:focus-change) when a click elsewhere in the canvas wants
  //      to focus without forcing a route change. Those fire after
  //      history.replaceState, which doesn't trigger useSearchParams,
  //      so we shadow the search-params reading with local state that
  //      the listeners can update.
  const urlFindingKey = searchParams?.get('focusFinding') || null;
  const urlChangeId = searchParams?.get('focusChange') || null;
  const [liveFindingKey, setLiveFindingKey] = useState(urlFindingKey);
  const [liveChangeId, setLiveChangeId] = useState(urlChangeId);

  // Sync from URL when search params change (real navigation / first
  // load). Effects below honour whichever was most recently set.
  useEffect(() => { setLiveFindingKey(urlFindingKey); }, [urlFindingKey]);
  useEffect(() => { setLiveChangeId(urlChangeId); }, [urlChangeId]);

  // Window-event listeners for the silent dispatch path. Setting the
  // live key + opening the modal mirrors the URL-driven path; the
  // modal's own focus-watching effect re-runs when the prop changes.
  useEffect(() => {
    if (!dealId) return undefined;
    const onFinding = (e) => {
      const key = e?.detail?.findingKey;
      if (!key) return;
      setLiveFindingKey(key);
      setWorkspaceOpen(true);
    };
    const onChange = (e) => {
      const id = e?.detail?.changeId;
      if (!id) return;
      setLiveChangeId(id);
      setWorkspaceOpen(true);
    };
    window.addEventListener('vesno:focus-finding', onFinding);
    window.addEventListener('vesno:focus-change', onChange);
    return () => {
      window.removeEventListener('vesno:focus-finding', onFinding);
      window.removeEventListener('vesno:focus-change', onChange);
    };
  }, [dealId]);

  const focusFindingKey = liveFindingKey;
  const focusChangeId = liveChangeId;

  // Auto-open the modal when a focus target arrives via URL (silent
  // dispatch opens it directly inside the listeners above).
  useEffect(() => {
    if (focusFindingKey && dealId && !workspaceOpen) setWorkspaceOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusFindingKey, dealId]);

  useEffect(() => {
    if (focusChangeId && dealId && !workspaceOpen) setWorkspaceOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusChangeId, dealId]);

  useEffect(() => {
    if (!dealId || !accessToken) { setSummary(null); return; }
    let cancelled = false;
    apiFetch(`/api/deals/${dealId}`, {}, accessToken)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.deal) return;
        setSummary({
          name: data.deal.name,
          status: data.deal.status,
          type: data.deal.type,
          participants: data.participants || [],
          summary: data.summary || {},
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [dealId, accessToken]);

  if (!dealId) return null;

  // Match the current user against deal participants → which company are they
  // mapping for? This makes "Talking about <deal>" become "Talking about
  // <deal> · mapping for <company>" so the user always knows their lens.
  const myEmail = (sessionUser?.email || '').toLowerCase();
  const me = (summary?.participants || []).find(
    (p) => (p.participant_email || p.participantEmail || '').toLowerCase() === myEmail,
  );
  const myCompany = me?.companyName || me?.company_name || null;

  const partsTotal = summary?.participants?.length || 0;
  const partsDone  = (summary?.participants || []).filter((p) => p.status === 'complete').length;
  const docsTotal  = summary?.summary?.documentsTotal ?? null;
  const docsReady  = summary?.summary?.documentsReady ?? null;
  const latestMode = summary?.summary?.latestAnalysisMode || null;
  const latestStat = summary?.summary?.latestAnalysisStatus || null;

  // Resolve the active participant + the user's role label so the
  // chip can clearly tell the user which flow they're in. Prefer
  // matching by email; fall back to the first incomplete participant
  // so the user always sees something concrete instead of a blank.
  const ROLE_LABEL = {
    acquirer: 'Acquirer', target: 'Target',
    platform_company: 'Platform', portfolio_company: 'Portfolio',
    self: 'Self',
  };
  const activeParticipant = me
    || (summary?.participants || []).find((p) => p.status !== 'complete')
    || null;
  const activeRoleLabel = activeParticipant
    ? (ROLE_LABEL[activeParticipant.role] || activeParticipant.role)
    : null;
  const activeCompany = activeParticipant?.companyName || activeParticipant?.company_name || null;

  return (
    <div className="chat-deal-context">
      <div className="chat-deal-chip" role="status" aria-live="polite">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="2" y="7" width="20" height="14" rx="2" />
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
        </svg>
        <span>
          Talking about <strong>{dealName || summary?.name || 'this deal'}</strong>
          {activeCompany && (
            <> · mapping the <strong>{activeRoleLabel}</strong> flow for <strong>{activeCompany}</strong></>
          )}
        </span>
        <a
          href={`/deals/${encodeURIComponent(dealId)}/workspace`}
          className="chat-deal-chip-toggle"
          title="Same tabs as /workspace, scoped to this deal (Cmd/Ctrl+click for new tab)"
          onClick={(e) => {
            // Default click: open the deal workspace inline on the
            // canvas (same vesno:open-workspace event the rail uses).
            // The DiagnosticWorkspace overlay reads `dealId` from
            // context and mounts DealWorkspaceClient. Cmd/Ctrl/Shift/
            // middle-click bypasses this so the user can still open
            // /deals/<id>/workspace in a new tab.
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
            e.preventDefault();
            window.dispatchEvent(new CustomEvent('vesno:open-workspace'));
          }}
        >
          Open workspace
        </a>
        <button
          type="button"
          className="chat-deal-chip-toggle"
          onClick={() => setWorkspaceOpen(true)}
          title="Quick context drawer with documents, findings, participants"
        >
          Quick view
        </button>
        {summary && (
          <button
            type="button"
            className="chat-deal-chip-toggle"
            onClick={() => setPaneOpen((v) => !v)}
            aria-expanded={paneOpen}
          >
            {paneOpen ? 'Hide context' : 'Show context'}
          </button>
        )}
      </div>
      {summary && paneOpen && (
        <div className="chat-deal-pane">
          <div className="chat-deal-pane-stat">
            <span className="chat-deal-pane-num">{partsDone}<span className="chat-deal-pane-num-of">/{partsTotal}</span></span>
            <span className="chat-deal-pane-label">Participants ready</span>
          </div>
          {docsTotal != null && (
            <div className="chat-deal-pane-stat">
              <span className="chat-deal-pane-num">{docsReady ?? '—'}<span className="chat-deal-pane-num-of">/{docsTotal}</span></span>
              <span className="chat-deal-pane-label">Documents indexed</span>
            </div>
          )}
          <div className="chat-deal-pane-stat">
            <span className="chat-deal-pane-num chat-deal-pane-num--text">
              {latestStat ? `${latestMode || 'analysis'} · ${latestStat}` : 'No analyses yet'}
            </span>
            <span className="chat-deal-pane-label">Latest analysis</span>
          </div>
          <div className="chat-deal-pane-stat">
            <span className={`chat-deal-pane-num chat-deal-pane-num--text chat-deal-pane-status--${summary.status}`}>
              {summary.status}
            </span>
            <span className="chat-deal-pane-label">Deal status</span>
          </div>
        </div>
      )}
      <DealWorkspaceModal
        open={workspaceOpen}
        onClose={() => setWorkspaceOpen(false)}
        dealId={dealId}
        accessToken={accessToken}
        focusFindingKey={focusFindingKey}
        focusChangeId={focusChangeId}
      />
    </div>
  );
}
