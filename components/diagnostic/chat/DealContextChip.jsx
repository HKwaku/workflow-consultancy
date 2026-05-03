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
  const focusFindingKey = searchParams?.get('focusFinding') || null;

  // The deal workspace modal opens only on explicit user action — the
  // "Open workspace" button below or a deep-link from a chat finding
  // card (?focusFinding=…). The previous auto-open-on-first-pick was
  // removed because it surprised users dropping into a deal from the
  // chat. The sessionStorage flag from the old implementation
  // (AUTOSEEN_KEY_PREFIX) is now dead data; existing entries are
  // harmless and will eventually be cleared by the browser.
  useEffect(() => {
    if (focusFindingKey && dealId && !workspaceOpen) setWorkspaceOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusFindingKey, dealId]);

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

  return (
    <div className="chat-deal-context">
      <div className="chat-deal-chip" role="status" aria-live="polite">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="2" y="7" width="20" height="14" rx="2" />
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
        </svg>
        <span>
          Talking about <strong>{dealName || summary?.name || 'this deal'}</strong>
          {myCompany && <> · mapping for <strong>{myCompany}</strong></>}
        </span>
        <button
          type="button"
          className="chat-deal-chip-toggle"
          onClick={() => setWorkspaceOpen(true)}
        >
          Open workspace
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
      />
    </div>
  );
}
