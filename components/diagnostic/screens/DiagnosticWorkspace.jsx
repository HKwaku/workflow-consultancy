'use client';

import { useState, useCallback, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useDiagnostic } from '../DiagnosticContext';
import { useDiagnosticNav } from '../DiagnosticNavContext';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/components/ThemeProvider';
import { apiFetch } from '@/lib/api-fetch';
import InteractiveFlowCanvas from '@/components/flow/InteractiveFlowCanvas';
import { HANDOFF_METHODS, CLARITY_OPTIONS } from '@/lib/diagnostic/handoffOptions';
import { DEPT_INTERNAL, DEPT_EXTERNAL } from '@/lib/diagnostic/stepConstants';
import { COMMON_SYSTEMS, WAIT_TYPE_OPTIONS } from '@/lib/diagnostic/constants';
import { getFriendlyChatError, isRetryableError } from '@/lib/chat-utils';
import { STEP_SUGGESTIONS } from '@/lib/diagnostic/stepSuggestions';
import { resolveBranchTarget } from '@/lib/flows/shared';
import { loadSnippets, saveSnippet, deleteSnippet } from '@/lib/diagnostic/savedSnippets';
import { getWaitProfile } from '@/lib/flows/flowModel';
import { repairFlow } from '@/lib/flows/normalizer';
import { reconcileDecisionBranches } from '@/lib/flows/reconcileEdges';
import { computePhaseState } from '@/lib/diagnostic/intakePhases';
import FloatingFlowViewer from '../FloatingFlowViewer';
import ChatHistoryPanel from '../ChatHistoryPanel';
import ChatMessageContent, { CopyButton } from '../ChatMessageContent';

const MAP_SPLIT_RAIL_PX = 48;
const MAP_SPLIT_HANDLE_PX = 8;

const MIN_STEPS = 3;
const MAX_STEPS = 50;
const DEP_TYPE_LABELS = {
  feeds_into: '→ Feeds into',
  receives_from: '← Receives from',
  triggers: '⚡ Triggers',
  triggered_by: '⚡ Triggered by',
  shares_data: '⇄ Shares data with',
  waits_for: '⏳ Waits for',
};
const PREDEFINED_DEPTS = new Set([...DEPT_INTERNAL, ...DEPT_EXTERNAL]);

function SectionHint({ text }) {
  const [tip, setTip] = useState(null);
  const ref = useRef(null);

  const show = useCallback(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setTip({ x: r.left + r.width / 2, y: r.top - 8 });
  }, []);
  const hide = useCallback(() => setTip(null), []);

  return (
    <>
      <span ref={ref} className="s7-section-hint" onMouseEnter={show} onMouseLeave={hide} aria-label={text}>?</span>
      {tip && createPortal(
        <div className="s7-section-hint-tooltip" style={{ left: tip.x, top: tip.y }}>{text}</div>,
        document.body
      )}
    </>
  );
}

const NODE_TYPE_OPTIONS = [
  { id: 'step',      label: 'Step',      icon: '▭', desc: 'Regular process step',             isDecision: false, parallel: false, inclusive: false, isMerge: false },
  { id: 'exclusive', label: 'Exclusive', icon: '◇', desc: 'XOR: exactly one path is taken',   isDecision: true,  parallel: false, inclusive: false, isMerge: false },
  { id: 'parallel',  label: 'Parallel',  icon: '⊕', desc: 'AND: all paths run simultaneously', isDecision: true,  parallel: true,  inclusive: false, isMerge: false },
  { id: 'inclusive', label: 'Inclusive', icon: '◎', desc: 'OR: one or more paths are taken',  isDecision: true,  parallel: false, inclusive: true,  isMerge: false },
  { id: 'merge',     label: 'Merge',     icon: '⧉', desc: 'Convergence point for branches',   isDecision: false, parallel: false, inclusive: false, isMerge: true  },
];

function getActiveNodeType(s) {
  if (s.isMerge) return 'merge';
  if (s.isDecision && s.parallel) return 'parallel';
  if (s.isDecision && s.inclusive) return 'inclusive';
  if (s.isDecision) return 'exclusive';
  return 'step';
}

function isCustomDepartment(dept) {
  return dept && typeof dept === 'string' && dept.trim() && !PREDEFINED_DEPTS.has(dept.trim());
}

function ensureHandoffs(steps, handoffs) {
  const n = steps.length;
  const needed = Math.max(0, n - 1);
  const out = [...(handoffs || [])];
  while (out.length < needed) out.push({ method: '', clarity: '' });
  return out.slice(0, needed);
}

/* ── First-visit guide tour ─────────────────────────────────────── */

const GUIDE_TOUR = [
  {
    title: "Hi, I'm Reina",
    desc: "I'm your process mapping assistant. Describe any business process in plain language, or upload a doc, spreadsheet, or diagram, and I'll build the flow for you in real time.",
    selector: null,
    cta: "Show me around →",
  },
  {
    title: "Chat history",
    desc: "Every conversation is autosaved. Open this panel to jump back into any prior audit — your flow, chat, and progress all come back exactly as you left them.",
    selector: '[title="Chat history"]',
    cta: "Next →",
  },
  {
    title: "Step editor",
    desc: "Toggle the step list panel to add or edit steps manually. Useful for fine-tuning names, reordering, or adding details Reina hasn't filled in yet.",
    selector: '[title="Steps list"],[title="Add steps manually"]',
    cta: "Next →",
  },
  {
    title: "Snippets",
    desc: "Save reusable step templates — approvals, reviews, onboarding chunks — and drop them into any flow. Great for processes you map over and over.",
    selector: '[title="Snippets"]',
    cta: "Next →",
  },
  {
    title: "Expand the flow",
    desc: "Open the process diagram in a floating window for a full-screen view. Useful once your steps are mapped.",
    selector: '[title="Expand flow in window"]',
    cta: "Next →",
  },
  {
    title: "Activity log",
    desc: "Every change is tracked. Open the activity log to see a full audit trail of edits made during this session.",
    selector: '[title="Activity log"]',
    cta: "Next →",
  },
  {
    title: "Cost analysis",
    desc: "See the financial impact of this process — annual cost, estimated savings, payback, and ROI. Available once a report has been generated.",
    selector: '[title="Cost analysis"]',
    cta: "Next →",
  },
  {
    title: "Handover to a colleague",
    desc: "Pass this process audit to a colleague. They'll get a unique link and can pick up exactly where you left off — your flow, chat history, and notes travel with it.",
    selector: '[title="Handover to a colleague"]',
    cta: "Next →",
  },
  {
    title: "Generate report",
    desc: "When the flow is complete, click here to generate your diagnostic report — bottlenecks, automation opportunities, and cost impact.",
    selector: '[title="Generate report"]',
    cta: "Next →",
  },
  {
    title: "Dashboard / sign in",
    desc: "Access your dashboard to view saved reports, manage process audits, and track completed work.",
    selector: '[title="Dashboard"],[title="Sign in"],[title="Account"]',
    cta: "Next →",
  },
  {
    title: "Ready to go",
    desc: "That's everything. Start by telling me about your process below. What triggers it, and who kicks it off first?",
    selector: null,
    cta: "Let's go →",
  },
];

function MapGuide({ onDismiss }) {
  const [step, setStep] = useState(0);
  const [spotlightStyle, setSpotlightStyle] = useState(null);

  const current = GUIDE_TOUR[step];
  const isLast = step === GUIDE_TOUR.length - 1;

  useEffect(() => {
    if (!current.selector) { setSpotlightStyle(null); return; }
    const el = document.querySelector(current.selector);
    if (!el) {
      // Selector didn't match — skip this stop so we don't show a pointer to nothing.
      setSpotlightStyle(null);
      if (step < GUIDE_TOUR.length - 1) setStep((s) => s + 1);
      return;
    }
    const r = el.getBoundingClientRect();
    const PAD = 8;
    setSpotlightStyle({
      top: r.top - PAD,
      left: r.left - PAD,
      width: r.width + PAD * 2,
      height: r.height + PAD * 2,
    });
  }, [step, current.selector]);

  // Position card next to the spotlit element, or centred when no highlight
  const cardStyle = spotlightStyle ? {
    position: 'fixed',
    top: Math.max(16, Math.min(
      spotlightStyle.top + spotlightStyle.height / 2 - 100,
      window.innerHeight - 320,
    )),
    left: spotlightStyle.left + spotlightStyle.width + 16,
    transform: 'none',
  } : {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
  };

  const goNext = useCallback(() => {
    if (isLast) onDismiss();
    else setStep((s) => s + 1);
  }, [isLast, onDismiss]);

  const goBack = useCallback(() => setStep((s) => Math.max(0, s - 1)), []);

  return createPortal(
    <div
      className="s7-guide-backdrop"
      style={spotlightStyle ? { background: 'transparent' } : {}}
      onClick={onDismiss}
    >
      {/* Spotlight ring — its box-shadow creates the dark overlay when active */}
      {spotlightStyle && (
        <div className="s7-guide-spotlight" style={spotlightStyle} />
      )}

      {/* Tour card — positioned next to highlighted element */}
      <div
        className={`s7-guide-card${spotlightStyle ? ' s7-guide-card--arrow' : ''}`}
        style={cardStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="s7-guide-card-top">
          <div className="s7-guide-card-dots">
            {GUIDE_TOUR.map((_, i) => (
              <span key={i} className={`s7-guide-dot${i === step ? ' active' : ''}`} />
            ))}
          </div>
          <button type="button" className="s7-guide-skip-btn" onClick={onDismiss}>Skip tour</button>
        </div>

        <div className="s7-guide-card-avatar">R</div>
        <div className="s7-guide-card-title">{current.title}</div>
        <p className="s7-guide-card-desc">{current.desc}</p>

        <div className="s7-guide-card-actions">
          {step > 0 && (
            <button type="button" className="s7-guide-back-btn" onClick={goBack}>← Back</button>
          )}
          <button type="button" className="s7-guide-next-btn" onClick={goNext}>{current.cta}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** In-chat PE deal setup card — rendered as part of an assistant message. */
function DealSetupCard({ platformCompany, onSubmit }) {
  const [dealName, setDealName] = useState('');
  const [targetCompany, setTargetCompany] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const name = dealName.trim();
    const target = targetCompany.trim();
    if (!name) { setError('Enter a deal name.'); return; }
    if (!target) { setError('Enter at least one portfolio company.'); return; }
    setSubmitting(true);
    const res = await onSubmit({ dealName: name, targetCompany: target, platformCompany });
    setSubmitting(false);
    if (res?.ok) setDone(true);
    else if (res?.error) setError(res.error);
  };

  if (done) {
    return (
      <div className="s7-deal-setup-card s7-deal-setup-card--done">
        <span>Deal created ✓</span>
      </div>
    );
  }

  return (
    <form className="s7-deal-setup-card" onSubmit={handleSubmit}>
      <label className="s7-deal-setup-field">
        <span className="s7-deal-setup-label">Deal name</span>
        <input
          type="text"
          className="s7-deal-setup-input"
          value={dealName}
          onChange={(e) => setDealName(e.target.value)}
          placeholder="e.g. ABC Capital 2026 Roll-up"
          autoComplete="off"
          disabled={submitting}
        />
      </label>
      <label className="s7-deal-setup-field">
        <span className="s7-deal-setup-label">First portfolio company</span>
        <input
          type="text"
          className="s7-deal-setup-input"
          value={targetCompany}
          onChange={(e) => setTargetCompany(e.target.value)}
          placeholder="Portfolio company name"
          autoComplete="off"
          disabled={submitting}
        />
      </label>
      <div className="s7-deal-setup-platform">Platform: <strong>{platformCompany}</strong></div>
      {error && <div className="s7-deal-setup-error">{error}</div>}
      <button type="submit" className="s7-deal-setup-submit" disabled={submitting}>
        {submitting ? 'Creating…' : 'Create deal & continue'}
      </button>
    </form>
  );
}

/** Save + optional view report — top of icon rail */
function MapRailPrimaryTools({ editingReportId, onViewReport, onViewCost, onHandover, onContinue, onSaveToReport, savingToReport, sessionUser, hasCostAccess }) {
  return (
    <>
      <a
        href={sessionUser ? '/portal?dashboard=1' : '/portal'}
        className="s7-split-rail-btn s7-split-rail-link"
        title={sessionUser ? 'Dashboard' : 'Sign in'}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      </a>
      {hasCostAccess && editingReportId && (
        <button
          type="button"
          className="s7-split-rail-btn"
          onClick={() => onViewCost?.(editingReportId)}
          title="Cost analysis"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <line x1="12" y1="1" x2="12" y2="23" />
            <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
          </svg>
        </button>
      )}
      {onHandover && (
        <button type="button" className="s7-split-rail-btn" onClick={onHandover} title="Handover to a colleague">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
        </button>
      )}
      {editingReportId && (
        <button type="button" className="s7-split-rail-btn" onClick={() => onViewReport?.(editingReportId)} title="View report">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
          </svg>
        </button>
      )}
      {onSaveToReport && (
        <button type="button" className="s7-split-rail-btn" onClick={onSaveToReport} disabled={savingToReport} title={savingToReport ? 'Saving…' : 'Save to report'}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M20 14v6a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h6"/><polyline points="14 2 20 2 20 8"/><line x1="12" y1="12" x2="20" y2="2"/>
          </svg>
        </button>
      )}
      {onContinue && (
        <button type="button" className="s7-split-rail-btn s7-split-rail-btn--accent" onClick={onContinue} title="Generate report">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </button>
      )}
    </>
  );
}

/** Account menu — pinned to bottom of rail (Claude-style) */
function MapRailPortalFooter({ sessionUser, onSignOut }) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);

  // If not signed in, keep the simple sign-in link.
  if (!sessionUser) {
    return (
      <a href="/portal" className="s7-split-rail-btn s7-split-rail-link" title="Sign in">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </a>
    );
  }

  const toggle = () => {
    if (open) { setOpen(false); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ left: r.right + 8, bottom: window.innerHeight - r.bottom });
    setOpen(true);
  };

  const handleSignOut = async () => {
    setOpen(false);
    try { await onSignOut?.(); } catch { /* ignore */ }
    if (typeof window !== 'undefined') window.location.href = '/';
  };

  const email = sessionUser?.email || '';
  const name = sessionUser?.user_metadata?.full_name || sessionUser?.user_metadata?.name || '';
  const initials = (name || email || '?').slice(0, 1).toUpperCase();

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className={`s7-split-rail-btn${open ? ' active' : ''}`}
        onClick={toggle}
        title="Account"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </button>
      {open && pos && createPortal(
        <>
          <div className="s7-account-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="s7-account-menu" data-theme={theme} style={{ left: pos.left, bottom: pos.bottom }} role="menu">
            <div className="s7-account-menu-header">
              <div className="s7-account-menu-avatar">{initials}</div>
              <div className="s7-account-menu-identity">
                {name && <div className="s7-account-menu-name">{name}</div>}
                <div className="s7-account-menu-email">{email}</div>
              </div>
            </div>
            <div className="s7-account-menu-sep" />
            <button type="button" className="s7-account-menu-item s7-account-menu-item--danger" role="menuitem" onClick={handleSignOut}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Sign out
            </button>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

export default function DiagnosticWorkspace({ initialStepIdx: initialStepIdxProp, onAuditTrailToggle, auditTrailOpen, reportToLoad, onReportLoaded, redesignReportId, onRedesignConsumed }) {
  const {
    processData, updateProcessData, goToScreen,
    customDepartments, addCustomDepartment,
    diagnosticMode, teamMode, chatMessages, addChatMessage,
    saveProgressToCloud, buildFullSnapshot, editingReportId, editingRedesign, aiRedesignMode, contact, authUser, setContact,
    addAuditEvent,
    moduleId, setModuleId, dealCanonicalProcessName, dealName, dealRole, dealId, setDeal,
  } = useDiagnostic();
  const { accessToken, user: sessionUser, signOut } = useAuth();
  const { theme } = useTheme();

  /* ── Cloud chat persistence ── */
  const chatSessionIdRef = useRef(null);
  const sessionCreateInFlightRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = editingReportId ? `vesno_chat_session_${editingReportId}` : 'vesno_chat_session_active';
    try { chatSessionIdRef.current = localStorage.getItem(key) || null; } catch { /* ignore */ }
  }, [editingReportId]);

  /* ── Cost-analysis entitlement: platform admin OR any membership with cost_analyst ── */
  useEffect(() => {
    if (!accessToken) { setHasCostAccess(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const resp = await apiFetch('/api/organizations', {}, accessToken);
        if (!resp.ok) return;
        const data = await resp.json();
        if (cancelled) return;
        const fromMembership = (data.memberships || []).some((m) => m?.entitlements?.cost_analyst);
        setHasCostAccess(Boolean(data.platformAdmin) || fromMembership);
      } catch { /* ignore — icon just won't render */ }
    })();
    return () => { cancelled = true; };
  }, [accessToken]);

  /* ── Auto-open inline cost panel when ?view=cost is present in URL ── */
  useEffect(() => {
    if (!editingReportId || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === 'cost') setInlineCostReportId(editingReportId);
  }, [editingReportId]);

  const persistMessageToCloud = useCallback(async ({ role, content, actions, attachments: attachmentsArg, snapshot }) => {
    if (!accessToken) {
      if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
        console.warn('[chat-save] skipped — no accessToken (user not signed in)');
      }
      return;
    }
    let processSnapshot = null;
    try {
      processSnapshot = snapshot ? JSON.parse(JSON.stringify(snapshot)) : null;
    } catch { processSnapshot = null; }
    try {
      const resp = await apiFetch('/api/chat-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: chatSessionIdRef.current || undefined,
          reportId: editingReportId || undefined,
          kind: editingRedesign ? 'redesign' : 'map',
          title: (snapshot?.processData?.processName || snapshot?.processName || processData.processName) || undefined,
          role,
          content: typeof content === 'string' ? content : String(content ?? ''),
          actions: actions || undefined,
          attachments: attachmentsArg && attachmentsArg.length
            ? attachmentsArg.map((a) => ({ name: a.name, type: a.type, size: a.content?.length || a.textContent?.length || 0 }))
            : undefined,
          processSnapshot,
        }),
      }, accessToken);
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        console.warn('[chat-save] failed', resp.status, errText);
        return;
      }
      const data = await resp.json().catch(() => null);
      if (data?.sessionId && data.sessionId !== chatSessionIdRef.current) {
        chatSessionIdRef.current = data.sessionId;
        if (typeof window !== 'undefined') {
          const key = editingReportId ? `vesno_chat_session_${editingReportId}` : 'vesno_chat_session_active';
          try { localStorage.setItem(key, data.sessionId); } catch { /* ignore */ }
        }
      }
    } catch (err) {
      console.warn('[chat-save] network error', err?.message || err);
    }
  }, [accessToken, editingReportId, editingRedesign, processData]);

  const syncSnapshotToSession = useCallback(async (snapshot) => {
    if (!accessToken) return;
    const currentId = chatSessionIdRef.current;
    if (currentId) {
      try {
        await apiFetch(`/api/chat-sessions/${encodeURIComponent(currentId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ processSnapshot: snapshot }),
        }, accessToken);
      } catch { /* best-effort */ }
      return;
    }
    // No session yet — create one carrying the snapshot so autosave
    // produces recoverable state before the first chat message is sent.
    if (sessionCreateInFlightRef.current) return;
    sessionCreateInFlightRef.current = true;
    try {
      const resp = await apiFetch('/api/chat-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId: editingReportId || undefined,
          kind: editingRedesign ? 'redesign' : 'map',
          title: (snapshot?.processData?.processName || snapshot?.processName || processData.processName) || undefined,
          processSnapshot: snapshot,
        }),
      }, accessToken);
      if (resp.ok) {
        const data = await resp.json().catch(() => null);
        if (data?.sessionId) {
          chatSessionIdRef.current = data.sessionId;
          if (typeof window !== 'undefined') {
            const key = editingReportId ? `vesno_chat_session_${editingReportId}` : 'vesno_chat_session_active';
            try { localStorage.setItem(key, data.sessionId); } catch { /* ignore */ }
          }
        }
      }
    } catch { /* best-effort */ } finally {
      sessionCreateInFlightRef.current = false;
    }
  }, [accessToken, editingReportId, editingRedesign, processData]);

  /* ═══════ Step state ═══════ */
  const initialSteps = useMemo(() => {
    return (processData.steps?.length
      ? processData.steps
      : []
    ).map((s) => ({ ...s, isMerge: s.isMerge ?? false, systems: s.systems || [], branches: s.branches || [], contributor: s.contributor || '', checklist: s.checklist || [] }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [steps, setSteps] = useState(initialSteps);
  const [handoffs, setHandoffs] = useState(() => ensureHandoffs(initialSteps, processData.handoffs));
  const [activeIdx, setActiveIdx] = useState(0);
  const [error, setError] = useState('');
  const [validationToast, setValidationToast] = useState('');
  const validationToastTimerRef = useRef(null);

  const showValidationToast = useCallback((msg) => {
    setValidationToast(msg);
    if (validationToastTimerRef.current) clearTimeout(validationToastTimerRef.current);
    validationToastTimerRef.current = setTimeout(() => setValidationToast(''), 4000);
  }, []);
  const [customDeptInput, setCustomDeptInput] = useState({});
  const [systemInputs, setSystemInputs] = useState({});
  const [handoffInputs, setHandoffInputs] = useState({});
  const [handoffOpen, setHandoffOpen] = useState({});
  const [suggestionUsed, setSuggestionUsed] = useState(new Set());
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatProgress, setChatProgress] = useState('');
  const [chatStreamedText, setChatStreamedText] = useState('');
  const [chatAttachments, setChatAttachments] = useState([]);
  const [chatError, setChatError] = useState(null);
  const [chatDragOver, setChatDragOver] = useState(false);
  /** Shown while FileReader is loading selected files into the composer */
  const [readingChatFilesHint, setReadingChatFilesHint] = useState('');
  const [dragStepIdx, setDragStepIdx] = useState(null);
  const [dragOverStepIdx, setDragOverStepIdx] = useState(null);
  const [expandedStepIdx, setExpandedStepIdx] = useState(initialStepIdxProp ?? null);
  const [checklistInputs, setChecklistInputs] = useState({});
  const [showFloatingFlow, setShowFloatingFlow] = useState(false);
  const [inlineReportId, setInlineReportId] = useState(null);
  const [inlineCostReportId, setInlineCostReportId] = useState(null);
  const [hasCostAccess, setHasCostAccess] = useState(false);
  const [snippets, setSnippets] = useState(() => { try { return loadSnippets(null); } catch { return []; } });
  const [showSnippetPicker, setShowSnippetPicker] = useState(false);
  const [showDepsModal, setShowDepsModal] = useState(false);
  const [depsLinks, setDepsLinks] = useState(() => processData.processDependencies || []);
  const [depsNewProcess, setDepsNewProcess] = useState('');
  const [depsNewType, setDepsNewType] = useState('feeds_into');
  const [pendingNavAfterDeps, setPendingNavAfterDeps] = useState(false);
  const [previewViewMode, setPreviewViewMode] = useState('grid');
  const [flowNodePositions, setFlowNodePositions] = useState(() => processData.flowNodePositions || {});
  const [flowCustomEdges, setFlowCustomEdges] = useState(() => processData.flowCustomEdges || []);
  const [flowDeletedEdges, setFlowDeletedEdges] = useState(() => processData.flowDeletedEdges || []);

  /* ═══════ Chat history panel ═══════ */
  const [showChatHistory, setShowChatHistory] = useState(false);

  /* Ref for first-paint context inside the one-shot chat seeding effect */
  const chatSeedCtxRef = useRef(null);
  chatSeedCtxRef.current = { processData, moduleId, dealCanonicalProcessName, dealName, dealRole, chatMessages };

  /* ═══════ First-visit guide (shows every page load) ═══════ */
  const [showGuide, setShowGuide] = useState(false);
  const dismissGuide = useCallback(() => setShowGuide(false), []);

  /* ═══════ Layout state (floating panels) ═══════ */
  const [floatingPanel, setFloatingPanel] = useState(null); // null | 'steps' | 'chat'

  const SPLIT_CHAT_WIDTH_KEY = 'workflow-s7-map-split-chat-w';
  const [splitChatWidthPx, setSplitChatWidthPx] = useState(() => {
    if (typeof window === 'undefined') return 360;
    const v = parseInt(window.localStorage.getItem(SPLIT_CHAT_WIDTH_KEY) || '', 10);
    return Number.isFinite(v) && v >= 260 && v <= 640 ? v : 360;
  });
  const splitAreaRef = useRef(null);

  /* ═══════ AI redesign generation state ═══════ */
  const [redesignPhase, setRedesignPhase] = useState('idle'); // 'idle' | 'loading' | 'ready' | 'error'
  const [redesignProgress, setRedesignProgress] = useState('');
  const triggerRedesignRef = useRef(false);
  const redesignContextRef = useRef(null); // holds serialised redesign context for the chat prompt

  const SEGMENT_CHIPS = [
    { name: 'Scaling Business', segmentId: 'scaling', tagline: 'Growing fast, processes breaking' },
    { name: 'M&A Integration', segmentId: 'ma', tagline: 'Day 1 baseline, integration clarity' },
    { name: 'Private Equity', segmentId: 'pe', tagline: 'Acquisition baseline to exit-ready' },
    { name: 'High Risk Ops', segmentId: 'high-risk-ops', tagline: 'Compliance gaps, key-person risk' },
  ];

  const buildOpeningMessage = ({ mid, dName, dRole, canonical, processName }) => {
    if (processName) {
      return `Hi, I'm Reina! Let's map "${processName}" together. What's the very first thing that happens? What triggers it, and who kicks it off?`;
    }
    const isPE = mid === 'pe';
    const isPort = dRole === 'portfolio_company';
    const isPlat = dRole === 'platform_company';
    if (isPE && dName) {
      if (isPlat) return `Your roll-up "${dName}" is set up.\n\nWhich process are you mapping first? Tell me the name, then describe the first step — what triggers it and who kicks it off?`;
      if (isPort && canonical) return `Welcome! You're mapping the "${canonical}" process for the roll-up "${dName}".\n\nWhat's the very first step — what triggers it, and who kicks it off?`;
      return `Hi, I'm Reina! Let's map your processes for "${dName}".\n\nWhat process are you focusing on, and what's the first step?`;
    }
    return `Hi, I'm Reina! Let's map your process.\n\nWhat's the name of this process, and what's the very first thing that happens — what triggers it, and who kicks it off?`;
  };

  // On first arrival with no steps: seed Reina's opening message (no guided prompt questionnaire)
  const hasSeededChatRef = useRef(false);
  useEffect(() => {
    if (hasSeededChatRef.current || editingRedesign) return;

    const { processData: pd, moduleId: mid, dealCanonicalProcessName: canonical, dealName: dName, dealRole: dRole, chatMessages: ctxMsgs } = chatSeedCtxRef.current;
    const processName = pd?.processName?.trim() || canonical?.trim() || '';

    // ── Restored session or already-seeded (any existing messages means
    //    we're either restoring a session or Screen2 remounted after the
    //    user picked a pillar — don't seed another intro in either case) ──
    if (initialSteps.length > 0) return;
    if (ctxMsgs.length > 0) {
      hasSeededChatRef.current = true;
      if (!editingReportId) setShowGuide(true);
      return;
    }

    hasSeededChatRef.current = true;

    if (!mid && !dName) {
      // No segment selected yet — introduce Reina and ask which situation fits
      addChatMessage({
        role: 'assistant',
        content: `Hi, I'm Reina — your process mapping assistant.\n\nTell me about any business process in plain language and I'll build the flow for you in real time — steps, handoffs, decision branches, timings, and systems. You can also drop in docs, spreadsheets, screenshots, or diagrams and I'll extract the process from them.\n\nOnce it's mapped, I'll spot bottlenecks, estimate the cost of the current flow, and generate a redesign with automation suggestions and projected savings.\n\nTo tailor the audit, which best describes your situation?`,
        chips: SEGMENT_CHIPS,
      });
      if (!editingReportId) setShowGuide(true);
    } else {
      addChatMessage({ role: 'assistant', content: buildOpeningMessage({ mid, dName, dRole, canonical, processName }) });
      if (!editingReportId) setShowGuide(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const MODULE_LABELS = { scaling: 'Scaling Business', ma: 'M&A Integration', pe: 'Private Equity', 'high-risk-ops': 'High Risk Ops' };
  const BOTTLENECK_LABELS = { waiting: 'Waiting time', approvals: 'Approval bottlenecks', 'manual-work': 'Manual work', handoffs: 'Handoff issues', systems: 'System issues', rework: 'Rework / errors' };

  const handleLoadReport = useCallback((report) => {
    const dd = report.diagnosticData || {};
    const raw = (report.rawProcesses || dd.rawProcesses || [])[0] || {};
    const processName = raw.processName || report.contactName || 'Process Audit';
    const company = report.company || report.contact?.company || '';
    const stepCount = (raw.steps || []).length;
    const bottleneck = BOTTLENECK_LABELS[raw.bottleneck?.reason] || raw.bottleneck?.reason || '';
    const savings = raw.savings?.estimatedSavingsPercent || 0;
    const mod = report.moduleId || dd.moduleId || raw.segment || '';
    const modLabel = MODULE_LABELS[mod] || '';

    const lines = [`**${processName}**${company ? ` · ${company}` : ''}${modLabel ? ` · ${modLabel}` : ''}`];
    if (stepCount > 0) lines.push(`${stepCount} step${stepCount !== 1 ? 's' : ''} mapped`);
    if (bottleneck) lines.push(`Main bottleneck: ${bottleneck}`);
    if (savings > 0) lines.push(`Estimated saving: ~${savings}%`);

    addChatMessage({
      role: 'assistant',
      content: lines.join('\n'),
      reportActions: { id: report.id, processName },
    });
  }, [addChatMessage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Consume report passed from DiagnosticClient (e.g. after Screen6 completion)
  useEffect(() => {
    if (!reportToLoad) return;
    handleLoadReport(reportToLoad);
    onReportLoaded?.();
  }, [reportToLoad]); // eslint-disable-line react-hooks/exhaustive-deps

  // Consume redesign trigger from DiagnosticClient (e.g. from chat history)
  useEffect(() => {
    if (!redesignReportId) return;
    handleRedesignInChat(redesignReportId);
    onRedesignConsumed?.();
  }, [redesignReportId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSegmentChip = useCallback((segmentId, label) => {
    setModuleId(segmentId);
    updateProcessData({ segment: segmentId });
    addChatMessage({ role: 'user', content: label });
    if (segmentId === 'pe' && !dealId) {
      // PE roll-up: collect deal setup in-chat before opening question.
      const platformCompany = (authUser?.company || '').trim() || 'your platform company';
      addChatMessage({
        role: 'assistant',
        content: `Great — let's set up your roll-up. I'll create a deal for **${platformCompany}** and one portfolio company to start (you can invite more later).`,
        dealSetup: {
          platformCompany,
        },
      });
    } else {
      const opening = buildOpeningMessage({ mid: segmentId, dName: null, dRole: null, canonical: null, processName: null });
      addChatMessage({ role: 'assistant', content: opening });
    }
    if (!editingReportId) setShowGuide(true);
  }, [setModuleId, updateProcessData, addChatMessage, editingReportId, dealId, authUser]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── In-chat PE deal setup submission ── */
  const handleDealSetupSubmit = useCallback(async ({ dealName: name, targetCompany, platformCompany }) => {
    if (!accessToken) {
      addChatMessage({ role: 'assistant', content: 'You need to be signed in to create a deal. [Sign in](/portal?returnTo=%2Fprocess-audit)' });
      return { error: 'not signed in' };
    }
    try {
      const resp = await apiFetch('/api/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'pe_rollup',
          name,
          participants: [
            { role: 'platform_company', companyName: platformCompany },
            { role: 'portfolio_company', companyName: targetCompany },
          ],
        }),
      }, accessToken);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Failed to create deal');
      const d = data.deal;
      setDeal({
        dealId: d.id,
        dealCode: d.dealCode,
        dealRole: 'platform_company',
        dealName: d.name,
        dealParticipants: data.participants || [],
        canonicalProcessName: d.processName || null,
      });
      updateProcessData({ dealCode: d.dealCode, segment: 'pe' });
      addChatMessage({ role: 'user', content: `Deal "${name}" · Portfolio: ${targetCompany}` });
      addChatMessage({
        role: 'assistant',
        content: buildOpeningMessage({ mid: 'pe', dName: d.name, dRole: 'platform_company', canonical: null, processName: null }),
      });
      return { ok: true };
    } catch (err) {
      return { error: err.message || 'Something went wrong.' };
    }
  }, [accessToken, addChatMessage, setDeal, updateProcessData]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRedesignInChat = useCallback(async (reportId) => {
    addChatMessage({ role: 'user', content: 'Redesign this process' });
    addChatMessage({ role: 'assistant', content: 'Starting redesign analysis…' });
    try {
      const resp = await fetch('/api/generate-redesign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({ reportId }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        addChatMessage({ role: 'assistant', content: `Redesign failed: ${err.error || 'Please try again.'}` });
        return;
      }
      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('text/event-stream')) {
        const data = await resp.json();
        if (data.cached && data.redesign) {
          addChatMessage({ role: 'assistant', content: `Redesign ready. ${data.redesign.summary || 'View the full report to see the redesigned flow.'}`, reportActions: { id: reportId, processName: 'Redesigned Process' } });
        }
        return;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let eventName = 'message', dataStr = '';
          for (const line of chunk.split('\n')) {
            if (line.startsWith('event: ')) eventName = line.slice(7).trim();
            else if (line.startsWith('data: ')) dataStr = line.slice(6).trim();
          }
          if (!dataStr) continue;
          let parsed;
          try { parsed = JSON.parse(dataStr); } catch { continue; }
          if (eventName === 'progress') {
            addChatMessage({ role: 'assistant', content: parsed.message || 'Analysing…' });
          } else if (eventName === 'done') {
            const summary = parsed.redesign?.summary || 'Redesign complete.';
            addChatMessage({ role: 'assistant', content: summary, reportActions: { id: reportId, processName: 'Redesigned Process' } });
          } else if (eventName === 'error') {
            addChatMessage({ role: 'assistant', content: `Redesign failed: ${parsed.error || 'Please try again.'}` });
          }
        }
      }
    } catch (err) {
      addChatMessage({ role: 'assistant', content: 'Redesign failed. Please check your connection and try again.' });
    }
  }, [accessToken, addChatMessage]); // eslint-disable-line react-hooks/exhaustive-deps

  const [detailTab, setDetailTab] = useState('type'); // active tab in node inspector

  const focusNameRef = useRef({});
  const chatEndRef = useRef(null);
  const chatFileRef = useRef(null);
  const chatTextareaRef = useRef(null);
  const lastFailedChatPayloadRef = useRef(null);
  const chatAbortRef = useRef(null);
  const chatHistoryStackRef = useRef([]); // Undo stack for chat-applied mutations
  const costIframeRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const stepsSyncTimerRef = useRef(null);
  const stepsSyncMountedRef = useRef(false);
  // Refs hold the LATEST canvas edge state synchronously — no stale closures
  const flowCustomEdgesRef = useRef(flowCustomEdges);
  const flowDeletedEdgesRef = useRef(flowDeletedEdges);
  const flowNodePositionsRef = useRef(flowNodePositions);
  flowNodePositionsRef.current = flowNodePositions; // keep in sync every render

  /* ═══════ Sync local steps → global processData (debounced) ═════
   * processActions updates local state via setSteps but not global state.
   * Manual edits (addStep, updateStep, canvas ops) do the same.
   * This effect ensures processData.steps always mirrors local steps so
   * that navigation away/back and other components (ChatPanel, report
   * generation) see the current state.                               */
  useEffect(() => {
    if (!stepsSyncMountedRef.current) {
      stepsSyncMountedRef.current = true;
      return; // skip initial mount — no change yet
    }
    clearTimeout(stepsSyncTimerRef.current);
    stepsSyncTimerRef.current = setTimeout(() => {
      updateProcessData({ steps, handoffs });
    }, 350);
    return () => clearTimeout(stepsSyncTimerRef.current);
  }, [steps, handoffs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Workspace snapshot sync — fires whenever steps/handoffs/flow canvas
  // state changes. Catches updates from AI tool-calls that land after the
  // chat-message persist, so resuming restores the latest flow accurately.
  const snapshotSyncTimerRef = useRef(null);
  const snapshotSyncMountedRef = useRef(false);
  useEffect(() => {
    if (!snapshotSyncMountedRef.current) {
      snapshotSyncMountedRef.current = true;
      return;
    }
    if (!accessToken) return;
    clearTimeout(snapshotSyncTimerRef.current);
    snapshotSyncTimerRef.current = setTimeout(() => {
      syncSnapshotToSession(buildFullSnapshot({
        ...processData,
        steps,
        handoffs,
        flowCustomEdges: flowCustomEdgesRef.current || [],
        flowDeletedEdges: flowDeletedEdgesRef.current || [],
        flowNodePositions: flowNodePositionsRef.current || {},
      }));
    }, 600);
    return () => clearTimeout(snapshotSyncTimerRef.current);
  }, [steps, handoffs, flowCustomEdges, flowDeletedEdges, flowNodePositions, accessToken, syncSnapshotToSession, buildFullSnapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (validationToastTimerRef.current) clearTimeout(validationToastTimerRef.current); }, []);


  /* ═══════ Step helpers ═══════ */
  const syncHandoffs = useCallback((s) => setHandoffs((p) => ensureHandoffs(s, p)), []);

  const addStep = useCallback((afterIdx = -1, init = {}) => {
    const pos = afterIdx === -2 ? 1 : afterIdx >= 0 ? afterIdx + 2 : undefined;
    setSteps((prev) => {
      if (prev.length >= MAX_STEPS) return prev;
      const blank = { number: 0, name: '', department: '', isDecision: false, isMerge: false, isExternal: false, durationMinutes: undefined, durationUnit: 'hours', branches: [], systems: [], contributor: '', checklist: [], ...init };
      // Default team to "Automated" for new decision nodes that have no team yet
      if (blank.isDecision && !blank.department) blank.department = 'Automated';
      let next;
      if (afterIdx === -2) {
        next = [blank, ...prev];
      } else if (afterIdx >= 0 && afterIdx < prev.length) {
        next = [...prev.slice(0, afterIdx + 1), blank, ...prev.slice(afterIdx + 1)];
      } else {
        next = [...prev, blank];
      }
      next = next.map((s, i) => ({ ...s, number: i + 1 }));
      setHandoffs((h) => ensureHandoffs(next, h));
      setActiveIdx(afterIdx === -2 ? 0 : afterIdx >= 0 ? afterIdx + 1 : next.length - 1);
      return next;
    });
    const finalPos = pos ?? 'end';
    queueMicrotask(() => addAuditEvent({ type: 'step_add', detail: init.name ? `Added step "${init.name}" at position ${finalPos}` : `Added new step at position ${finalPos}` }));
  }, [addAuditEvent]);

  const updateStep = useCallback((idx, field, value) => {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s)));
  }, []);

  /** Change node type and all associated config atomically (branches, parallel, etc.) */
  const changeNodeType = useCallback((idx, opt) => {
    if (opt.action) {
      opt.action();
      return;
    }
    setSteps((prev) => prev.map((s, i) => {
      if (i !== idx) return s;
      const isDecision = !!opt.isDecision;
      const isMerge = !!opt.isMerge;
      const parallel = !!opt.parallel;
      const inclusive = !!opt.inclusive;
      let branches = s.branches || [];
      if (isDecision) {
        if (branches.length < 2) branches = [{ label: '', target: '' }, { label: '', target: '' }];
      } else {
        branches = [];
      }
      return {
        ...s,
        isDecision,
        isMerge,
        parallel,
        inclusive,
        branches,
        // Default team to "Automated" when switching to a decision node with no team set
        department: isDecision && !s.department ? 'Automated' : s.department,
      };
    }));
    addAuditEvent({ type: 'step_edit', detail: `Changed step ${idx + 1} to ${opt.label}` });
  }, [addAuditEvent]);

  const removeStep = useCallback((idx) => {
    let removedName = '';
    setSteps((prev) => {
      if (prev.length <= 1) return prev;
      removedName = prev[idx]?.name || '';
      const next = prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, number: i + 1 }));
      setHandoffs((h) => ensureHandoffs(next, h));
      setActiveIdx((a) => Math.min(a, next.length - 1));
      return next;
    });
    queueMicrotask(() => addAuditEvent({ type: 'step_remove', detail: `Removed step ${idx + 1}${removedName ? ` "${removedName}"` : ''}` }));
  }, [addAuditEvent]);

  const moveStep = useCallback((fromIdx, toIdx) => {
    if (fromIdx === toIdx) return;
    let movedName = '';
    setSteps((prev) => {
      movedName = prev[fromIdx]?.name || '';
      const arr = [...prev];
      const [removed] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, removed);
      const newSteps = arr.map((s, i) => ({ ...s, number: i + 1 }));
      setHandoffs((h) => {
        const newHandoffs = [];
        for (let i = 0; i < newSteps.length - 1; i++) {
          const oldIdxLo = prev.indexOf(newSteps[i]);
          const oldIdxHi = prev.indexOf(newSteps[i + 1]);
          if (oldIdxHi === oldIdxLo + 1 && oldIdxLo >= 0 && oldIdxLo < h.length) {
            newHandoffs.push(h[oldIdxLo] || { method: '', clarity: '' });
          } else {
            newHandoffs.push({ method: '', clarity: '' });
          }
        }
        return newHandoffs;
      });
      return newSteps;
    });
    setActiveIdx(toIdx);
    queueMicrotask(() => addAuditEvent({ type: 'step_edit', detail: `Moved step${movedName ? ` "${movedName}"` : ''} from position ${fromIdx + 1} to ${toIdx + 1}` }));
  }, [addAuditEvent]);

  const insertStepAt = useCallback((beforeIdx) => {
    addStep(beforeIdx === 0 ? -2 : beforeIdx - 1);
  }, [addStep]);

  const updateHandoff = useCallback((idx, field, value) => {
    setHandoffs((prev) => prev.map((h, i) => (i === idx ? { ...h, [field]: value } : h)));
    if (field === 'method' && value) {
      addAuditEvent({ type: 'step_edit', detail: `Set handoff between steps ${idx + 1}–${idx + 2} to "${value}"` });
    }
    if (field === 'clarity' && value) {
      const clarityLabel = CLARITY_OPTIONS.find((c) => c.value === value)?.label || value;
      addAuditEvent({ type: 'step_edit', detail: `Handoff ${idx + 1}→${idx + 2} clarification needed: "${clarityLabel}"` });
    }
    if (field === 'clarity' && !value) {
      addAuditEvent({ type: 'step_edit', detail: `Cleared handoff clarification on step ${idx + 1}→${idx + 2}` });
    }
  }, [addAuditEvent]);
  const toggleHandoff = (idx) => setHandoffOpen((p) => ({ ...p, [idx]: !p[idx] }));

  const addStepSystem = useCallback((stepIdx, name) => {
    const t = (name || '').trim();
    if (!t) return;
    setSteps((prev) => prev.map((s, i) => {
      if (i !== stepIdx) return s;
      const sys = [...(s.systems || [])];
      if (sys.some((x) => x.toLowerCase() === t.toLowerCase())) return s;
      return { ...s, systems: [...sys, t] };
    }));
    addAuditEvent({ type: 'step_edit', detail: `Added system "${t}" to step ${stepIdx + 1}` });
  }, [addAuditEvent]);
  const removeStepSystem = (stepIdx, sysName) => {
    updateStep(stepIdx, 'systems', (steps[stepIdx].systems || []).filter((s) => s.toLowerCase() !== sysName.toLowerCase()));
    addAuditEvent({ type: 'step_edit', detail: `Removed system "${sysName}" from step ${stepIdx + 1}` });
  };

  const toggleDecision = (idx) => {
    const d = !steps[idx].isDecision;
    updateStep(idx, 'isDecision', d);
    if (d && (!steps[idx].branches || steps[idx].branches.length === 0)) {
      updateStep(idx, 'branches', [{ label: '', target: '' }, { label: '', target: '' }]);
    }
    if (d && !steps[idx].department) {
      updateStep(idx, 'department', 'Automated');
    }
    addAuditEvent({ type: 'step_edit', detail: `${d ? 'Enabled' : 'Disabled'} decision point on step ${idx + 1}${steps[idx].name ? ` "${steps[idx].name}"` : ''}` });
  };
  const updateBranch = (si, bi, field, value) => {
    const branches = [...(steps[si].branches || [])];
    branches[bi] = { ...(branches[bi] || {}), [field]: value };
    updateStep(si, 'branches', branches);
  };
  const addBranch = (si) => updateStep(si, 'branches', [...(steps[si].branches || []), { label: '', target: '' }]);
  const removeBranch = (si, bi) => updateStep(si, 'branches', (steps[si].branches || []).filter((_, i) => i !== bi));

  const addMergeStep = useCallback((decisionIdx) => {
    const s = steps[decisionIdx];
    if (!s?.isDecision || !(s.branches || []).length || steps.length >= MAX_STEPS) return;
    const allSteps = steps.map((st, i) => ({ ...st, idx: i }));
    const targets = (s.branches || []).map((br) => resolveBranchTarget(br.target || br.targetStep, allSteps));
    const validTargets = targets.filter((t) => t >= 0 && t < steps.length);
    const insertAfter = validTargets.length >= 2 ? Math.max(...validTargets) : decisionIdx;
    addStep(insertAfter, { name: 'Merge', department: steps[Math.min(insertAfter, steps.length - 1)]?.department || '', isDecision: false, isMerge: true, isExternal: false, branches: [], systems: [] });
    setExpandedStepIdx(insertAfter + 1);
    setActiveIdx(insertAfter + 1);
  }, [steps, addStep]);

  /** Insert a step within a branch: after the branch target, or as new target if branch has none */
  const addStepInBranch = useCallback((decisionIdx, branchIdx) => {
    if (steps.length >= MAX_STEPS) return;
    const s = steps[decisionIdx];
    if (!s?.isDecision || !(s.branches || []).length) return;
    const br = s.branches[branchIdx];
    if (!br) return;
    const allSteps = steps.map((st, i) => ({ ...st, idx: i }));
    const targetIdx = resolveBranchTarget(br.target || br.targetStep, allSteps);

    if (targetIdx >= 0) {
      const insertAfter = targetIdx;
      setSteps((prev) => {
        if (prev.length >= MAX_STEPS) return prev;
        const blank = { number: 0, name: '', department: '', isDecision: false, isExternal: false, durationMinutes: undefined, durationUnit: 'hours', branches: [], systems: [], contributor: '', checklist: [] };
        const next = [...prev.slice(0, insertAfter + 1), blank, ...prev.slice(insertAfter + 1)].map((st, i) => ({ ...st, number: i + 1 }));
        const oldSteps = prev.map((st, i) => ({ ...st, idx: i }));
        const bumpTarget = (t) => {
          const idx = resolveBranchTarget(t, oldSteps);
          if (idx >= insertAfter + 1) {
            const m = String(t).match(/^(.*?)(\d+)(.*)$/);
            return m ? `${m[1]}${parseInt(m[2], 10) + 1}${m[3]}` : t;
          }
          return t;
        };
        const updated = next.map((st, i) => {
          if (!st.isDecision || !(st.branches || []).length) return st;
          return { ...st, branches: st.branches.map((b) => ({ ...b, target: bumpTarget(b.target || b.targetStep || '') })) };
        });
        setHandoffs((h) => ensureHandoffs(updated, h));
        setActiveIdx(insertAfter + 1);
        setExpandedStepIdx(insertAfter + 1);
        queueMicrotask(() => addAuditEvent({ type: 'step_add', detail: `Added step in branch after step ${insertAfter + 1}` }));
        return updated;
      });
    } else {
      setSteps((prev) => {
        if (prev.length >= MAX_STEPS) return prev;
        const blank = { number: 0, name: '', department: '', isDecision: false, isExternal: false, durationMinutes: undefined, durationUnit: 'hours', branches: [], systems: [], contributor: '', checklist: [] };
        const next = [...prev, blank].map((st, i) => ({ ...st, number: i + 1 }));
        const newIdx = next.length - 1;
        const newBranches = [...(s.branches || [])];
        newBranches[branchIdx] = { ...(newBranches[branchIdx] || {}), target: `Step ${newIdx + 1}` };
        const updated = next.map((st, i) => (i === decisionIdx ? { ...st, branches: newBranches } : st));
        setHandoffs((h) => ensureHandoffs(updated, h));
        setActiveIdx(newIdx);
        setExpandedStepIdx(newIdx);
        queueMicrotask(() => addAuditEvent({ type: 'step_add', detail: `Added step as new branch target` }));
        return updated;
      });
    }
  }, [steps, addAuditEvent]);

  /**
   * Insert a blank step at position `insertIdx` (0-based) and remap all
   * decision branch targets that point at or after that index.
   * Returns the new step count so callers can do position/edge remapping.
   */
  const insertStepWithRemap = useCallback((insertIdx, isDecisionEdgeInsert = false) => {
    const insertAfter = insertIdx - 1; // addStep convention: insert after this index
    setSteps((prev) => {
      if (prev.length >= MAX_STEPS) return prev;
      const blank = { number: 0, name: '', department: '', isDecision: false, isMerge: false, isExternal: false, durationMinutes: undefined, durationUnit: 'hours', branches: [], systems: [], contributor: '', checklist: [] };
      const next = insertAfter === -2
        ? [blank, ...prev]
        : insertAfter >= 0 && insertAfter < prev.length
          ? [...prev.slice(0, insertAfter + 1), blank, ...prev.slice(insertAfter + 1)]
          : [...prev, blank];
      const withNumbers = next.map((s, i) => ({ ...s, number: i + 1 }));
      const oldSteps = prev.map((s, i) => ({ ...s, idx: i }));
      const bumpTarget = (t) => {
        const idx = resolveBranchTarget(t, oldSteps);
        // For decision-edge inserts the new node becomes the branch start (takes
        // the slot at insertIdx), so the original target at exactly insertIdx must
        // NOT be bumped — it now correctly points to the new node.
        // For sequential inserts the node at insertIdx shifted to insertIdx+1, so
        // any branch pointing there must be bumped.
        const shouldBump = isDecisionEdgeInsert ? idx > insertIdx : idx >= insertIdx;
        if (shouldBump) {
          const m = String(t).match(/^(.*?)(\d+)(.*)$/);
          return m ? `${m[1]}${parseInt(m[2], 10) + 1}${m[3]}` : t;
        }
        return t;
      };
      const updated = withNumbers.map((s) => {
        if (!s.isDecision || !(s.branches || []).length) return s;
        return { ...s, branches: s.branches.map((b) => ({ ...b, target: bumpTarget(b.target || b.targetStep || '') })) };
      });
      setHandoffs((h) => ensureHandoffs(updated, h));
      setActiveIdx(insertAfter === -2 ? 0 : insertAfter >= 0 ? insertAfter + 1 : updated.length - 1);
      queueMicrotask(() => addAuditEvent({ type: 'step_add', detail: `Added step at position ${insertIdx + 1}` }));
      return updated;
    });
  }, [addAuditEvent]);

  const handleAddCustomDept = (stepIdx, val) => {
    const t = (val || '').trim();
    if (!t) return;
    addCustomDepartment(t);
    updateStep(stepIdx, 'department', t);
    setCustomDeptInput((p) => ({ ...p, [stepIdx]: '' }));
  };

  const addSuggestionStep = (suggestion) => {
    if (steps.length >= MAX_STEPS) return;
    const next = [...steps, { number: steps.length + 1, name: suggestion, department: '', isDecision: false, isMerge: false, isExternal: false, branches: [], systems: [], contributor: '', checklist: [] }].map((s, i) => ({ ...s, number: i + 1 }));
    setSteps(next);
    syncHandoffs(next);
    setSuggestionUsed((p) => new Set([...p, suggestion]));
    setActiveIdx(next.length - 1);
    addAuditEvent({ type: 'step_add', detail: `Added suggested step "${suggestion}"` });
  };

  const commitAndNavigate = useCallback((deps) => {
    const valid = steps.filter((s) => s.name.trim());
    const reconciled = reconcileDecisionBranches(valid, flowCustomEdgesRef.current, flowDeletedEdgesRef.current);
    const { steps: repairedValid } = repairFlow(reconciled);
    const h = ensureHandoffs(repairedValid, handoffs);
    const allSys = [...new Set(repairedValid.flatMap((s) => s.systems || []).filter(Boolean))];
    updateProcessData({ steps: repairedValid, handoffs: h, systems: allSys.length > 0 ? allSys : processData.systems, processDependencies: deps });
    if (authUser?.email && !contact?.email) {
      setContact({ name: authUser.name || '', email: authUser.email, company: authUser.company || '', title: authUser.title || '' });
    }
    setError('');
    addAuditEvent({ type: 'navigate', detail: `Completed step mapping with ${valid.length} steps` });
    goToScreen(6);
  }, [steps, handoffs, processData.systems, updateProcessData, goToScreen, addAuditEvent, authUser, contact, setContact]);

  const handleContinue = useCallback(() => {
    const valid = steps.filter((s) => s.name.trim());
    if (valid.length < MIN_STEPS) {
      const missing = MIN_STEPS - valid.length;
      showValidationToast(`Add at least ${missing} more step${missing > 1 ? 's' : ''} before continuing. You need ${MIN_STEPS} named steps minimum.`);
      return;
    }
    // Show dependency mapping modal before navigating away
    setShowDepsModal(true);
    setPendingNavAfterDeps(true);
  }, [steps, showValidationToast]);

  const goStep = (dir) => {
    const n = activeIdx + dir;
    if (n >= 0 && n < steps.length) setActiveIdx(n);
  };

  /* ═══════ Build fresh processData snapshot (avoids stale-state race) ═══════ */
  const buildFreshProcessData = useCallback(() => {
    const valid = steps.filter((s) => s.name.trim());
    const reconciled = reconcileDecisionBranches(valid, flowCustomEdgesRef.current, flowDeletedEdgesRef.current);
    const { steps: repairedValid } = repairFlow(reconciled);
    const h = ensureHandoffs(repairedValid, handoffs);
    const allSys = [...new Set(repairedValid.flatMap((s) => s.systems || []).filter(Boolean))];
    const pd = { ...processData, steps: repairedValid, handoffs: h, systems: allSys.length > 0 ? allSys : processData.systems };
    updateProcessData({ steps: repairedValid, handoffs: h, systems: pd.systems });
    return pd;
  }, [steps, handoffs, processData, updateProcessData]);

  /* ═══════ AI redesign — apply output to canvas ═══════ */
  const applyRedesign = useCallback((redesign) => {
    const proc = redesign.optimisedProcesses?.[0];
    if (!proc?.steps?.length) return;
    const newSteps = (proc.steps || [])
      .filter((s) => s.status !== 'removed')
      .map((s, si) => ({
        number: si + 1,
        name: s.name || '',
        department: s.department || '',
        isDecision: !!s.isDecision,
        isMerge: !!s.isMerge,
        isExternal: !!s.isExternal,
        parallel: !!s.parallel,
        inclusive: !!s.inclusive,
        branches: s.branches || [],
        systems: s.systems || [],
        contributor: s.contributor || '',
        checklist: s.checklist || [],
      }));
    const newHandoffs = ensureHandoffs(newSteps, proc.handoffs || []);
    setSteps(newSteps);
    setHandoffs(newHandoffs);
    // Clear canvas customisations — this is a new layout
    setFlowCustomEdges([]);
    setFlowDeletedEdges([]);
    flowCustomEdgesRef.current = [];
    flowDeletedEdgesRef.current = [];
    setFlowNodePositions({});
    // Post a summary chat message with contextual suggestion chips
    const cs = redesign.costSummary || {};
    const changes = redesign.changes || [];

    // Count findings
    const bottleneckChanges = changes.filter((c) =>
      (c.estimatedTimeSavedMinutes > 0) || ['removed', 'merged', 'reordered', 'automated'].includes(c.type)
    );
    const bottleneckCount = bottleneckChanges.length;
    const costSavedPct = cs.estimatedCostSavedPercent || 0;
    const timeSavedPct = cs.estimatedTimeSavedPercent || 0;

    // Build a concise ready message (the opening question was already shown on load)
    const statsLine = [
      cs.stepsRemoved > 0 && `${cs.stepsRemoved} step${cs.stepsRemoved > 1 ? 's' : ''} removed`,
      cs.stepsAutomated > 0 && `${cs.stepsAutomated} automated`,
      timeSavedPct > 0 && `~${timeSavedPct}% time saving`,
      costSavedPct > 0 && `~${costSavedPct}% cost saving`,
    ].filter(Boolean).join(', ');

    const msg = statsLine
      ? `Your optimised process is ready: ${statsLine}. Where would you like to start?`
      : `Your optimised process is ready. Where would you like to start?`;

    // Build contextual suggestions
    const hasRemovals = (cs.stepsRemoved || 0) > 0 || changes.some((c) => c.type === 'removed');
    const hasAutomation = (cs.stepsAutomated || 0) > 0 || changes.some((c) => c.type === 'automated');
    const hasMerges = changes.some((c) => c.type === 'merged');

    const suggestions = [
      'Start with the biggest bottleneck',
      'Focus on highest cost savings',
    ];
    if (hasAutomation) suggestions.push('What can be automated?');
    if (hasRemovals) suggestions.push('What was cut and why?');
    if (hasMerges) suggestions.push('Walk me through the merges');
    if (suggestions.length < 4) suggestions.push('Walk me through all changes');

    // Store redesign context so the chat AI can reference specific changes
    redesignContextRef.current = JSON.stringify({
      executiveSummary: redesign.executiveSummary,
      changes: redesign.changes || [],
      costSummary: redesign.costSummary || {},
      implementationPriority: redesign.implementationPriority || [],
    }, null, 2);

    addChatMessage({ role: 'assistant', content: msg, suggestions: suggestions.slice(0, 5) });
  }, [addChatMessage]);

  const triggerAiRedesign = useCallback(async () => {
    if (!editingReportId || !accessToken) return;
    setRedesignPhase('loading');
    setRedesignProgress('Preparing your redesign…');
    try {
      const resp = await fetch('/api/generate-redesign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
        body: JSON.stringify({ reportId: editingReportId }),
      });
      const contentType = resp.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream')) {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let redesignResult = null;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            let event = 'message', raw = '';
            for (const line of chunk.split('\n')) {
              if (line.startsWith('event: ')) event = line.slice(7).trim();
              else if (line.startsWith('data: ')) raw = line.slice(6);
            }
            if (!raw) continue;
            try {
              const parsed = JSON.parse(raw);
              if (event === 'progress') setRedesignProgress(parsed.message || '');
              else if (event === 'done') redesignResult = parsed.redesign;
              else if (event === 'error') throw new Error(parsed.error || 'Redesign failed');
            } catch (e) { if (!e.message?.startsWith('Redesign')) continue; throw e; }
          }
        }
        if (redesignResult) { applyRedesign(redesignResult); setRedesignPhase('ready'); }
        else { setRedesignPhase('error'); setRedesignProgress('No redesign data received. Please try again.'); }
      } else {
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Redesign failed');
        if (data.redesign) { applyRedesign(data.redesign); setRedesignPhase('ready'); }
        else { setRedesignPhase('error'); setRedesignProgress('No redesign data received.'); }
      }
    } catch (err) {
      setRedesignPhase('error');
      setRedesignProgress(err.message || 'Failed to generate redesign. Please try again.');
    }
  }, [editingReportId, accessToken, applyRedesign]);

  // Auto-trigger redesign agent when entering AI redesign mode
  useEffect(() => {
    if (!aiRedesignMode || !editingReportId || !accessToken || triggerRedesignRef.current) return;
    triggerRedesignRef.current = true;
    triggerAiRedesign();
  }, [aiRedesignMode, editingReportId, accessToken, triggerAiRedesign]);

  /* ═══════ Handover modal ═══════ */
  const [handoverModalOpen, setHandoverModalOpen] = useState(false);
  const [handoverState, setHandoverState] = useState({ email: '', senderName: '', comments: '', status: 'idle', url: '', error: '', emailSent: false });
  const [linkCopied, setLinkCopied] = useState(false);

  const openHandoverModal = useCallback(() => {
    setHandoverState({ email: '', senderName: '', comments: '', status: 'idle', url: '', error: '', emailSent: false });
    setLinkCopied(false);
    setHandoverModalOpen(true);
  }, []);

  const handleCopyLink = useCallback(() => {
    if (navigator.clipboard && handoverState.url) {
      navigator.clipboard.writeText(handoverState.url).then(() => {
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 2500);
      }).catch(() => { /* clipboard may fail in some contexts */ });
    }
  }, [handoverState.url]);

  const submitHandover = useCallback(async (sendEmail = true) => {
    const pd = buildFreshProcessData();
    setHandoverState((p) => ({ ...p, status: 'saving', error: '' }));
    try {
      const opts = {
        step: expandedStepIdx,
        processDataOverride: pd,
        isHandover: true,
        senderName: handoverState.senderName.trim() || undefined,
        comments: handoverState.comments.trim() || undefined,
      };
      const email = sendEmail && handoverState.email.trim() ? handoverState.email.trim() : null;
      const result = await saveProgressToCloud(email, opts);
      if (result?.resumeUrl) {
        setHandoverState((p) => ({ ...p, status: 'done', url: result.resumeUrl, emailSent: !!email }));
        if (navigator.clipboard) navigator.clipboard.writeText(result.resumeUrl).catch(() => {});
      } else {
        setHandoverState((p) => ({ ...p, status: 'error', error: 'Save failed. Please try again.' }));
      }
    } catch (err) {
      setHandoverState((p) => ({ ...p, status: 'error', error: err.message || 'Save failed.' }));
    }
  }, [buildFreshProcessData, saveProgressToCloud, expandedStepIdx, handoverState.email, handoverState.senderName, handoverState.comments]);

  /* ═══════ Per-step save & get link ═══════ */
  const [stepSaveUrl, setStepSaveUrl] = useState({});
  const [stepSaving, setStepSaving] = useState({});
  const handleStepSave = useCallback(async (stepIdx) => {
    const pd = buildFreshProcessData();
    setStepSaving((p) => ({ ...p, [stepIdx]: true }));
    try {
      const result = await saveProgressToCloud(null, { step: stepIdx, processDataOverride: pd });
      if (result?.resumeUrl) {
        setStepSaveUrl((p) => ({ ...p, [stepIdx]: result.resumeUrl }));
        if (navigator.clipboard) navigator.clipboard.writeText(result.resumeUrl).catch(() => {});
      }
    } catch { /* fallback — user can use main save */ }
    setStepSaving((p) => ({ ...p, [stepIdx]: false }));
  }, [buildFreshProcessData, saveProgressToCloud]);

  /* ═══════ Flow model — predicted wait times ═══════ */
  const waitProfile = useMemo(() => getWaitProfile({ steps }), [steps]);

  /* ═══════ Step warnings ═══════ */
  const stepWarnings = useMemo(() => {
    return steps.map((s, i) => {
      if (!s.name.trim()) return [];
      const w = [];
      if (!s.department) w.push('department');
      if (!s.systems || s.systems.length === 0) w.push('systems');
      if (i < steps.length - 1) {
        const ho = handoffs[i] || {};
        if (!ho.method || !ho.clarity) w.push('handoff');
      }
      return w;
    });
  }, [steps, handoffs]);

  const totalWarnings = useMemo(() => stepWarnings.reduce((sum, w) => sum + w.length, 0), [stepWarnings]);

  /* ═══════ Process chat actions (tool calls from AI) ═══════ */
  const processActions = useCallback((actions) => {
    if (!actions || actions.length === 0) return [];
    const addedNames = [];

    // Capture one snapshot per batch for undo — chat actions often come in
    // groups (e.g. replace_all_steps + multiple add_step tool calls in one
    // agent turn). A single undo reverts the whole turn rather than rolling
    // back tool-call-by-tool-call.
    const MUTATING = new Set(['replace_all_steps', 'add_step', 'update_step', 'remove_step', 'set_handoff', 'add_custom_department']);
    const turnMutates = actions.some((a) => MUTATING.has(a.name));
    if (turnMutates) {
      chatHistoryStackRef.current.push({
        steps: steps.map((s) => ({ ...s, checklist: (s.checklist || []).map((c) => ({ ...c })) })),
        handoffs: handoffs.map((h) => ({ ...h })),
        flowCustomEdges: (flowCustomEdgesRef.current || []).map((e) => ({ ...e })),
        flowDeletedEdges: (flowDeletedEdgesRef.current || []).map((e) => ({ ...e })),
        at: Date.now(),
      });
      // Cap history depth
      if (chatHistoryStackRef.current.length > 20) chatHistoryStackRef.current.shift();
    }

    for (const action of actions) {
      switch (action.name) {
        case 'replace_all_steps': {
          const newSteps = (action.input.steps || []).slice(0, MAX_STEPS).map((s, i) => ({
            number: i + 1,
            name: s.name || `Step ${i + 1}`,
            department: s.department || '',
            isExternal: !!s.isExternal,
            isDecision: !!s.isDecision,
            isMerge: !!s.isMerge,
            parallel: !!s.parallel,
            workMinutes: s.workMinutes ?? undefined,
            waitMinutes: s.waitMinutes ?? undefined,
            durationUnit: 'hours',
            branches: s.branches || [],
            systems: s.systems || [],
            contributor: s.owner || '',
            checklist: (s.checklist || []).map((t) => ({ text: t, checked: false })),
          }));
          newSteps.forEach((s) => { if (isCustomDepartment(s.department)) addCustomDepartment(s.department.trim()); });
          setSteps(newSteps);
          setHandoffs(ensureHandoffs(newSteps, []));
          flowCustomEdgesRef.current = [];
          flowDeletedEdgesRef.current = [];
          setFlowCustomEdges([]);
          setFlowDeletedEdges([]);
          setFlowNodePositions({});
          queueMicrotask(() => updateProcessData({ flowCustomEdges: [], flowDeletedEdges: [], flowNodePositions: {} }));
          setActiveIdx(0);
          setExpandedStepIdx(null);
          setFloatingPanel('steps');
          addedNames.push(...newSteps.map((s) => s.name));
          queueMicrotask(() => addAuditEvent({ type: 'step_edit', detail: `AI rebuilt all steps (${newSteps.length} steps)` }));
          break;
        }
        case 'add_step': {
          const { name, department, isExternal, isDecision, isMerge, parallel, inclusive, workMinutes, waitMinutes, systems, branches, owner, checklist, afterStep } = action.input;
          if (isCustomDepartment(department)) addCustomDepartment(department.trim());
          const init = {
            name: name || '',
            department: department || '',
            isExternal: !!isExternal,
            isDecision: !!isDecision,
            isMerge: !!isMerge,
            parallel: !!parallel,
            inclusive: !!inclusive,
            workMinutes: workMinutes ?? undefined,
            waitMinutes: waitMinutes ?? undefined,
            durationUnit: 'hours',
            systems: systems || [],
            branches: branches || [],
            contributor: owner || '',
            checklist: (checklist || []).map((t) => ({ text: t, checked: false })),
          };
          const idx = typeof afterStep === 'number'
            ? afterStep === 0 ? -2 : afterStep - 1
            : -1;
          addStep(idx, init);
          flowCustomEdgesRef.current = [];
          flowDeletedEdgesRef.current = [];
          setFlowCustomEdges([]);
          setFlowDeletedEdges([]);
          queueMicrotask(() => updateProcessData({ flowCustomEdges: [], flowDeletedEdges: [] }));
          if (name) addedNames.push(name);
          break;
        }
        case 'update_step': {
          const { stepNumber, ...updates } = action.input;
          if (isCustomDepartment(updates.department)) addCustomDepartment(updates.department.trim());
          const idx = stepNumber - 1;
          setSteps((prev) => {
            if (idx < 0 || idx >= prev.length) return prev;
            const s = { ...prev[idx] };
            if (updates.name !== undefined) s.name = updates.name;
            if (updates.department !== undefined) s.department = updates.department;
            if (updates.isExternal !== undefined) s.isExternal = !!updates.isExternal;
            if (updates.isDecision !== undefined) s.isDecision = !!updates.isDecision;
            if (updates.isMerge !== undefined) s.isMerge = !!updates.isMerge;
            if (updates.durationMinutes !== undefined) s.durationMinutes = updates.durationMinutes;
            if (updates.workMinutes !== undefined) s.workMinutes = updates.workMinutes;
            if (updates.waitMinutes !== undefined) s.waitMinutes = updates.waitMinutes;
            if (updates.systems !== undefined) s.systems = updates.systems;
            if (updates.branches !== undefined) s.branches = updates.branches;
            if (updates.parallel !== undefined) s.parallel = !!updates.parallel;
            if (updates.inclusive !== undefined) s.inclusive = !!updates.inclusive;
            if (updates.owner !== undefined) s.contributor = updates.owner;
            if (updates.checklist !== undefined) s.checklist = updates.checklist.map((t) => typeof t === 'string' ? { text: t, checked: false } : t);
            return prev.map((p, i) => (i === idx ? s : p));
          });
          setActiveIdx(idx >= 0 ? idx : 0);
          queueMicrotask(() => addAuditEvent({ type: 'step_edit', detail: `AI updated step ${stepNumber}${action.input.name ? ` "${action.input.name}"` : ''}` }));
          break;
        }
        case 'remove_step': {
          const idx = action.input.stepNumber - 1;
          removeStep(idx);
          flowCustomEdgesRef.current = [];
          flowDeletedEdgesRef.current = [];
          setFlowCustomEdges([]);
          setFlowDeletedEdges([]);
          queueMicrotask(() => updateProcessData({ flowCustomEdges: [], flowDeletedEdges: [] }));
          break;
        }
        case 'set_handoff': {
          const { fromStep, method, clarity } = action.input;
          const idx = fromStep - 1;
          setHandoffs((prev) => prev.map((h, i) => {
            if (i !== idx) return h;
            const updated = { ...h };
            if (method) updated.method = method;
            if (clarity) updated.clarity = clarity;
            return updated;
          }));
          if (method || clarity) {
            queueMicrotask(() => addAuditEvent({ type: 'step_edit', detail: `AI set handoff ${fromStep}→${fromStep + 1}${method ? ` to "${method}"` : ''}` }));
          }
          break;
        }
        case 'add_custom_department': {
          const name = (action.input.name || '').trim();
          if (name && isCustomDepartment(name)) addCustomDepartment(name);
          break;
        }
        case 'highlight_step': {
          const idx = (action.input?.stepNumber || 0) - 1;
          if (idx >= 0) {
            setActiveIdx(idx);
            setExpandedStepIdx(idx);
          }
          break;
        }
        case 'open_panel': {
          const panel = action.input?.panel;
          if (panel === 'flow') {
            setInlineReportId(null);
            setInlineCostReportId(null);
          } else if (panel === 'report' && editingReportId) {
            setInlineCostReportId(null);
            setInlineReportId(editingReportId);
          } else if (panel === 'cost' && editingReportId) {
            setInlineReportId(null);
            setInlineCostReportId(editingReportId);
          }
          break;
        }
        case 'undo_last_action': {
          const snap = chatHistoryStackRef.current.pop();
          if (!snap) break;
          setSteps(snap.steps);
          setHandoffs(snap.handoffs);
          flowCustomEdgesRef.current = snap.flowCustomEdges || [];
          flowDeletedEdgesRef.current = snap.flowDeletedEdges || [];
          setFlowCustomEdges(snap.flowCustomEdges || []);
          setFlowDeletedEdges(snap.flowDeletedEdges || []);
          queueMicrotask(() => addAuditEvent({ type: 'step_edit', detail: 'AI undid last chat action' }));
          break;
        }
        case 'set_labour_rate':
        case 'set_non_labour_cost':
        case 'set_investment':
        case 'propose_change':
        case 'ask_discovery':
          // No client-side state change — the agent's natural-language reply
          // (built from the tool result text) is the user-facing surface.
          break;
        default:
          break;
      }
    }
    return addedNames;
  }, [addStep, removeStep, addCustomDepartment, updateProcessData, addAuditEvent, steps, handoffs, editingReportId]);

  const processFiles = useCallback((files) => {
    if (!files.length) return;
    setReadingChatFilesHint(`Reading ${files.length} file${files.length > 1 ? 's' : ''}…`);
    let done = 0;
    const toAdd = [];
    const TEXT_TYPES = ['text/csv', 'text/plain', 'application/json', 'text/tab-separated-values'];
    const finishOne = () => {
      done++;
      if (done === files.length) {
        setChatAttachments((p) => [...p, ...toAdd]);
        setReadingChatFilesHint('');
      }
    };
    files.forEach((f) => {
      const reader = new FileReader();
      const isText = TEXT_TYPES.includes(f.type) || /\.(csv|txt|tsv|json)$/i.test(f.name);
      reader.onload = () => {
        if (isText) {
          const textContent = reader.result;
          if (textContent) toAdd.push({ name: f.name, type: f.type || 'text/plain', textContent });
        } else {
          const base64 = reader.result?.split(',')[1];
          if (base64) toAdd.push({ name: f.name, type: f.type || 'application/octet-stream', content: base64 });
        }
        finishOne();
      };
      reader.onerror = () => finishOne();
      if (isText) reader.readAsText(f);
      else reader.readAsDataURL(f);
    });
  }, []);

  const handleChatFileSelect = useCallback((e) => {
    processFiles(Array.from(e.target.files || []));
    e.target.value = '';
  }, [processFiles]);

  const handleChatDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setChatDragOver(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length) processFiles(files);
  }, [processFiles]);

  const handleChatDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setChatDragOver(true);
  }, []);

  const handleChatDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setChatDragOver(false);
  }, []);

  const removeChatAttachment = useCallback((idx) => {
    setChatAttachments((p) => p.filter((_, i) => i !== idx));
  }, []);

  /* ═══════ Chat ═══════ */
  const sendChat = async (systemMessage, isRetry = false, userMsgOverride = null, attachmentsOverride = null) => {
    const isSystem = !!systemMessage && !userMsgOverride;
    const msg = isRetry
      ? (lastFailedChatPayloadRef.current?.userContent || '')
      : userMsgOverride || (isSystem ? systemMessage : chatInput.trim());
    const attachmentsToSend = isRetry
      ? (lastFailedChatPayloadRef.current?.attachments || [])
      : (attachmentsOverride !== null ? attachmentsOverride : (isSystem ? [] : [...chatAttachments]));
    if (!isRetry && !isSystem && (!msg && chatAttachments.length === 0)) return;
    if (!isRetry && chatLoading) return;

    const userContent = isSystem ? (systemMessage || msg) : (msg || (attachmentsToSend.length > 0 ? 'Extract process steps from the attached file(s).' : ''));

    // Build a live snapshot of the workspace (steps + handoffs from local
    // state which may be ahead of processData's debounced copy, plus the
    // flow canvas metadata which lives only on this screen).
    const buildLiveSnapshot = () => buildFullSnapshot({
      ...processData,
      steps,
      handoffs,
      flowCustomEdges: flowCustomEdgesRef.current || [],
      flowDeletedEdges: flowDeletedEdgesRef.current || [],
      flowNodePositions: flowNodePositionsRef.current || {},
    });

    if (!isSystem && !isRetry) {
      addChatMessage({ role: 'user', content: userContent });
      setChatInput('');
      if (chatTextareaRef.current) { chatTextareaRef.current.style.height = 'auto'; }
      setChatAttachments([]);
      lastFailedChatPayloadRef.current = { userContent, attachments: attachmentsToSend };
      persistMessageToCloud({ role: 'user', content: userContent, attachments: attachmentsToSend, snapshot: buildLiveSnapshot() });
    }
    setChatError(null);
    setChatLoading(true);
    setChatStreamedText('');
    if (attachmentsToSend.length > 0) setChatProgress('Sending files to the assistant…');

    // Abort any in-flight request before starting a new one.
    if (chatAbortRef.current) {
      try { chatAbortRef.current.abort(); } catch {}
    }
    const controller = new AbortController();
    chatAbortRef.current = controller;
    let streamedSoFar = '';
    let aborted = false;

    const incompleteSummary = steps
      .map((s, i) => {
        const w = stepWarnings[i] || [];
        return w.length > 0 && s.name.trim() ? `Step ${i + 1} "${s.name}": missing ${w.join(', ')}` : null;
      })
      .filter(Boolean)
      .join('\n');

    const phaseState = computePhaseState({ steps, handoffs });

    const historyForRequest = isRetry ? chatMessages : [...chatMessages, { role: 'user', content: userContent }];

    const body = JSON.stringify({
      message: userContent,
      currentSteps: steps,
      currentHandoffs: handoffs,
      processName: processData.processName || '',
      history: historyForRequest.map((m) => ({ role: m.role, content: m.content })),
      incompleteInfo: incompleteSummary || null,
      phaseState,
      attachments: attachmentsToSend.length > 0 ? attachmentsToSend : undefined,
      editingReportId: editingReportId || undefined,
      editingRedesign: editingRedesign || undefined,
      redesignContext: redesignContextRef.current || undefined,
    });

    const maxAttempts = 3;
    let lastErr = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const resp = await fetch('/api/diagnostic-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body,
        signal: controller.signal,
      });

      const contentType = resp.headers.get('content-type') || '';
      let data;

      if (contentType.includes('text/event-stream')) {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        data = {};
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            let event = 'message', raw = '';
            for (const line of chunk.split('\n')) {
              if (line.startsWith('event: ')) event = line.slice(7).trim();
              else if (line.startsWith('data: ')) raw = line.slice(6);
            }
            if (!raw) continue;
            try {
              const parsed = JSON.parse(raw);
              if (event === 'progress') setChatProgress(parsed.message || '');
              else if (event === 'delta') {
                streamedSoFar += (parsed.text || '');
                setChatStreamedText((prev) => prev + (parsed.text || ''));
              }
              else if (event === 'done') data = parsed;
              else if (event === 'error') throw new Error(parsed.error || 'Chat failed');
            } catch (e) { if (e.message !== 'Chat failed' && !e.message.startsWith('Chat failed')) continue; throw e; }
          }
        }
      } else {
        try { data = await resp.json(); } catch (e) { throw new Error('Invalid response from server'); }
        if (!resp.ok) throw new Error(data.error || 'Chat failed');
      }

      const costProposals = (data.actions || [])
        .filter((a) => a.name === 'set_labour_rate' || a.name === 'set_non_labour_cost' || a.name === 'set_investment')
        .map((a) => ({ kind: a.name, ...a.input }));
      addChatMessage({
        role: 'assistant',
        content: data.reply,
        ...(costProposals.length ? { costProposals } : {}),
      });
      persistMessageToCloud({ role: 'assistant', content: data.reply, actions: data.actions, snapshot: buildLiveSnapshot() });
      if (data.actions?.length > 0) {
        const addedNames = processActions(data.actions);
        if (!isSystem && addedNames.length > 0) {
          const lastReply = (data.reply || '').trim();
          const replyWasMinimal = !lastReply || /^Done\s*[—\-]?\s*(added|updated|removed|set)/i.test(lastReply) || lastReply.length < 80;
          if (replyWasMinimal) {
            setTimeout(() => {
              sendChat(`[system] New steps were just added: ${addedNames.join(', ')}. Ask about 1-2 missing details (decision points, departments, or systems) for these steps. Do NOT repeat any question you already asked in your last message — check the conversation history. Keep it conversational.`);
            }, 600);
          }
        }
      }
        lastErr = null;
        break;
      } catch (err) {
        if (err?.name === 'AbortError' || controller.signal.aborted) {
          aborted = true;
          lastErr = null;
          const partial = streamedSoFar.trim();
          if (partial) {
            const flushed = `${partial}\n\n_(stopped)_`;
            addChatMessage({ role: 'assistant', content: flushed });
            persistMessageToCloud({ role: 'assistant', content: flushed, snapshot: buildLiveSnapshot() });
          }
          break;
        }
        lastErr = err;
        const canRetry = isRetryableError(err) && attempt < maxAttempts - 1;
        if (canRetry) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        if (!isSystem) {
          setChatError(getFriendlyChatError(err.message));
          lastFailedChatPayloadRef.current = { userContent, attachments: attachmentsToSend };
        } else {
          addChatMessage({ role: 'assistant', content: `Error: ${getFriendlyChatError(err.message)}` });
        }
      }
    }

    if (chatAbortRef.current === controller) chatAbortRef.current = null;
    setChatLoading(false);
    setChatProgress('');
    setChatStreamedText('');
  };

  const stopChat = useCallback(() => {
    const c = chatAbortRef.current;
    if (!c) return;
    try { c.abort(); } catch {}
    chatAbortRef.current = null;
  }, []);

  const applyCostProposal = useCallback((proposal) => {
    if (!editingReportId) return;
    // Ensure the cost panel is open so the iframe exists to receive the message
    setInlineReportId(null);
    setInlineCostReportId(editingReportId);
    // The iframe may have just been mounted; give it a tick to attach its
    // message listener before posting. Retry a few times if not ready.
    let attempts = 0;
    const post = () => {
      const iframe = costIframeRef.current;
      if (!iframe || !iframe.contentWindow) {
        if (attempts++ < 12) return setTimeout(post, 250);
        return;
      }
      iframe.contentWindow.postMessage(
        { type: 'reina:cost-change', payload: proposal },
        window.location.origin,
      );
    };
    setTimeout(post, 150);
  }, [editingReportId]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);
  useEffect(() => {
    if (!chatStreamedText) return;
    chatEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [chatStreamedText]);

  /* ═══════ Computed ═══════ */
  const namedSteps = steps.filter((s) => s.name.trim());
  /** Flowchart / canvas artifact is present — switch to chat-left + canvas-right */
  const hasFlowArtifact = namedSteps.length > 0;


  useLayoutEffect(() => {
    if (namedSteps.length === 0) return;
    const id = requestAnimationFrame(() => {
      chatEndRef.current?.scrollIntoView({ behavior: 'auto' });
    });
    return () => cancelAnimationFrame(id);
  }, [namedSteps.length]);

  const handleSplitResizeStart = useCallback((e) => {
    e.preventDefault();
    const parent = splitAreaRef.current;
    const handle = e.currentTarget;
    if (!parent || !handle) return;
    const rect = parent.getBoundingClientRect();
    const startX = e.clientX;
    const startW = splitChatWidthPx;
    const minW = 260;
    const minCanvas = 280;
    const maxW = Math.min(640, rect.width - MAP_SPLIT_RAIL_PX - MAP_SPLIT_HANDLE_PX - minCanvas);

    // Pointer capture routes every subsequent pointer event back to the
    // handle, even when the cursor crosses over the canvas iframe (whose
    // inner window would otherwise swallow mousemove). Pair it with a
    // data-resizing flag so CSS can disable pointer-events on the iframe
    // and react-flow canvas while dragging — belt-and-braces against
    // mid-drag stutter.
    try { handle.setPointerCapture(e.pointerId); } catch { /* ignore */ }

    // Require the pointer to travel past a small threshold before the drag
    // "engages" — avoids micro-resizes from accidental clicks or hand jitter
    // that make the splitter feel hair-trigger.
    const DRAG_THRESHOLD_PX = 4;
    let engaged = false;

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      if (!engaged) {
        if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
        engaged = true;
        parent.setAttribute('data-resizing', '1');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      }
      const next = Math.min(maxW, Math.max(minW, startW + dx));
      setSplitChatWidthPx(next);
    };
    const onUp = (ev) => {
      try { handle.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
      if (engaged) {
        parent.removeAttribute('data-resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      if (engaged) {
        setSplitChatWidthPx((w) => {
          try {
            localStorage.setItem(SPLIT_CHAT_WIDTH_KEY, String(w));
          } catch { /* ignore */ }
          return w;
        });
      }
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }, [splitChatWidthPx, SPLIT_CHAT_WIDTH_KEY]);

  const suggestions = useMemo(() => {
    if (namedSteps.length < 3 || !processData.processType || !STEP_SUGGESTIONS[processData.processType]) return [];
    return STEP_SUGGESTIONS[processData.processType]
      .filter((s) => !steps.some((st) => st.name.toLowerCase().includes(s.toLowerCase().substring(0, 8))) && !suggestionUsed.has(s))
      .slice(0, 6);
  }, [steps, processData.processType, suggestionUsed, namedSteps.length]);

  /* ═══════ Step list (sidebar) ═══════ */
  const stepListContent = (
    <div className="s7-steps-pane">
      <div className="s7-steps-toolbar">
        <button type="button" className="s7-steps-add-btn" onClick={() => { addStep(); }} disabled={steps.length >= MAX_STEPS}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add step
        </button>
        {totalWarnings > 0 && <span className="s7-steps-warn-count" title={`${totalWarnings} fields missing`}>⚠ {totalWarnings}</span>}
      </div>

      <div className="s7-step-list">
        {steps.map((s, i) => {
          const isSelected = expandedStepIdx === i;
          const warn = (stepWarnings[i] || []).length > 0 && s.name.trim();
          const nodeType = getActiveNodeType(s);
          const typeIcon = { step: null, exclusive: '◇', parallel: '⊕', inclusive: '◎', merge: '⧉' }[nodeType];
          return (
            <div
              key={i}
              data-idx={i}
              className={`s7-step-item${isSelected ? ' selected' : ''}${dragStepIdx === i ? ' dragging' : ''}${dragOverStepIdx === i && dragStepIdx !== i ? ' drag-target' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOverStepIdx(i); }}
              onDrop={(e) => { e.preventDefault(); const from = parseInt(e.dataTransfer.getData('text/plain'), 10); if (!isNaN(from) && from !== i) moveStep(from, i); setDragStepIdx(null); setDragOverStepIdx(null); }}
              onDragLeave={() => { if (dragOverStepIdx === i) setDragOverStepIdx(null); }}
              onClick={() => { setExpandedStepIdx(isSelected ? null : i); setActiveIdx(i); }}
            >
              <span className="s7-step-item-drag" draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(i)); setDragStepIdx(i); e.stopPropagation(); }} onDragEnd={() => { setDragStepIdx(null); setDragOverStepIdx(null); }} onClick={(e) => e.stopPropagation()} title="Drag to reorder">
                <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor" opacity="0.35"><circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/><circle cx="2" cy="6" r="1.2"/><circle cx="6" cy="6" r="1.2"/><circle cx="2" cy="10" r="1.2"/><circle cx="6" cy="10" r="1.2"/></svg>
              </span>
              <span className="s7-step-item-num">{s.number}</span>
              <span className="s7-step-item-body">
                <span className="s7-step-item-name">{s.name || <em className="s7-step-item-unnamed">Unnamed</em>}</span>
                {s.department && <span className="s7-step-item-dept">{s.department}{s.isExternal ? ' · Ext' : ''}</span>}
              </span>
              {typeIcon && <span className="s7-step-item-type" title={nodeType}>{typeIcon}</span>}
              {warn && <span className="s7-step-item-warn" title={`Missing: ${(stepWarnings[i] || []).join(', ')}`}>⚠</span>}
              <button type="button" className="s7-step-item-insert" onClick={(e) => { e.stopPropagation(); addStep(i); setExpandedStepIdx(i + 1); setActiveIdx(i + 1); }} disabled={steps.length >= MAX_STEPS} title="Insert step after">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
            </div>
          );
        })}
      </div>

      {suggestions.length > 0 && (
        <div className="s7-suggestions">
          <div className="s7-suggestions-label">Suggested steps</div>
          {suggestions.map((sug) => (
            <button key={sug} type="button" className="s7-suggestion-btn" onClick={() => addSuggestionStep(sug)}>+ {sug}</button>
          ))}
        </div>
      )}
      {error && <div className="s7-error">{error}</div>}
    </div>
  );

  /* ═══════ Step detail panel — 3-column node inspector ═══════ */
  const activeStep = expandedStepIdx !== null ? steps[expandedStepIdx] : null;

  // Mini node card renderer for source / next columns
  function renderMiniCard({ step, branchLabel, isTerminal, terminalType } = {}) {
    if (isTerminal) {
      const isStart = terminalType === 'start';
      return (
        <div className={`s7-ni-node-card s7-ni-terminal${isStart ? ' s7-ni-terminal-start' : ' s7-ni-terminal-end'}`}>
          <span className="s7-ni-terminal-icon">{isStart ? '▶' : '■'}</span>
          <span className="s7-ni-terminal-label">{isStart ? 'Process Start' : 'Process End'}</span>
        </div>
      );
    }
    if (!step) return null;
    const nt = getActiveNodeType(step);
    const typeOpt = NODE_TYPE_OPTIONS.find((o) => o.id === nt);
    const stepIdx = steps.indexOf(step);
    return (
      <div
        className="s7-ni-node-card s7-ni-node-card-clickable"
        onClick={() => { setExpandedStepIdx(stepIdx); setActiveIdx(stepIdx); }}
      >
        {branchLabel && <div className="s7-ni-branch-label">{branchLabel}</div>}
        <div className="s7-ni-card-top">
          <span className="s7-ni-card-num">Step {step.number}</span>
          <span className="s7-ni-card-icon">{typeOpt?.icon || '▭'}</span>
        </div>
        <div className="s7-ni-card-name">{step.name || <span style={{ opacity: 0.4 }}>(unnamed)</span>}</div>
        {step.department && <div className="s7-ni-card-dept">{step.department}</div>}
      </div>
    );
  }

  const stepDetailContent = activeStep ? (() => {
    const i = expandedStepIdx;
    const s = activeStep;
    const ho = handoffs[i] || {};
    const activeNodeType = getActiveNodeType(s);

    // Compute next step card(s): branch targets for decisions, else single next step
    const nextCards = [];
    if (s.isDecision && (s.branches || []).length > 0) {
      s.branches.forEach((br) => {
        const tNum = parseInt((br.target || '').replace(/^Step\s*/i, ''), 10);
        const tStep = isNaN(tNum) ? null : steps.find((st) => st.number === tNum);
        nextCards.push({ step: tStep, branchLabel: br.label || null });
      });
    } else if (i < steps.length - 1) {
      nextCards.push({ step: steps[i + 1], branchLabel: null });
    }

    return (
      <div className="s7-node-inspector">

        {/* SOURCE column */}
        <div className="s7-ni-col s7-ni-source">
          <div className="s7-ni-col-hdr">Source</div>
          <div className="s7-ni-cards">
            {i > 0
              ? renderMiniCard({ step: steps[i - 1] })
              : renderMiniCard({ isTerminal: true, terminalType: 'start' })
            }
          </div>
          <div className="s7-ni-arrow">→</div>
        </div>

        {/* CURRENT column */}
        <div className="s7-ni-col s7-ni-current">
          <div className="s7-detail-hdr">
            <span className="s7-detail-step-num">Step {s.number}</span>
            <div className="s7-detail-nav">
              <button type="button" className="s7-detail-nav-btn" onClick={() => { setExpandedStepIdx(i - 1); setActiveIdx(i - 1); }} disabled={i === 0} title="Previous step">‹</button>
              <button type="button" className="s7-detail-nav-btn" onClick={() => { setExpandedStepIdx(i + 1); setActiveIdx(i + 1); }} disabled={i === steps.length - 1} title="Next step">›</button>
            </div>
            <button type="button" className="s7-detail-close" onClick={() => setExpandedStepIdx(null)} title="Close panel">×</button>
          </div>

          {/* Step name + delete row — always visible */}
          <div className="s7-detail-name-row">
            <input
              type="text"
              className="s7-detail-name-input"
              placeholder="Step name..."
              value={s.name}
              onChange={(e) => updateStep(i, 'name', e.target.value)}
              onFocus={(e) => { focusNameRef.current[i] = e.target.value; }}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== (focusNameRef.current[i] || '').trim()) addAuditEvent({ type: 'step_edit', detail: `Renamed step ${i + 1} to "${v}"` }); }}
            />
            {s.name.trim() && (
              <button type="button" className="s7-detail-del-btn" title="Save as snippet" onClick={() => { const next = saveSnippet(null, s); setSnippets(next); }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              </button>
            )}
            <button type="button" className="s7-detail-del-btn" onClick={() => { handleDeleteNode(i); setExpandedStepIdx(null); }} disabled={steps.length <= 1} title="Delete step">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
            </button>
          </div>

          {s.name.trim() && (
            <>
              {/* Tab bar */}
              <div className="s7-ni-tabs">
                {[
                  { id: 'type',      label: 'Type'      },
                  { id: 'owner',     label: 'Owner'     },
                  { id: 'timing',    label: 'Timing'    },
                  { id: 'systems',   label: 'Systems'   },
                  ...(i < steps.length - 1 ? [{ id: 'handoff', label: 'Handoff' }] : []),
                  { id: 'checklist', label: s.checklist?.length > 0 ? `Checklist (${s.checklist.filter(c=>c.checked).length}/${s.checklist.length})` : 'Checklist' },
                ].map((tab) => (
                  <button key={tab.id} type="button" className={`s7-ni-tab${detailTab === tab.id ? ' active' : ''}`} onClick={() => setDetailTab(tab.id)}>
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab body */}
              <div className="s7-ni-tab-body">

                {/* TYPE tab */}
                {detailTab === 'type' && (
                  <div className="s7-ni-tab-pane">
                    <div className="s7-detail-section-label">Node type <SectionHint text="How this step behaves in the flow. Step = action. Exclusive (XOR) = one path. Parallel (AND) = all paths simultaneously. Inclusive (OR) = one or more paths. Merge = where branches rejoin." /></div>
                    <div className="s7-node-type-grid">
                      {NODE_TYPE_OPTIONS.map((opt) => (
                        <button key={opt.id} type="button" className={`s7-node-type-btn${activeNodeType === opt.id ? ' active' : ''}`} onClick={() => changeNodeType(i, opt)}>
                          <span className="s7-node-type-icon">{opt.icon}</span>
                          <span className="s7-node-type-label">{opt.isDecision ? `Decision: ${opt.label}` : opt.label}</span>
                          <span onClick={(e) => e.stopPropagation()}><SectionHint text={opt.desc} /></span>
                        </button>
                      ))}
                    </div>
                    {s.isDecision && (
                      <div style={{ marginTop: 16 }}>
                        <div className="s7-detail-section-label">Branch routes <SectionHint text="Label each path out of this decision and link it to the step where that route leads. Add a Merge step to show where the branches converge." /></div>
                        {(s.branches || []).map((br, bi) => (
                          <div key={bi} className="s7-branch-row">
                            <input type="text" className="s7-input s7-branch-label-input" placeholder="Label..." value={br.label || ''} onChange={(e) => updateBranch(i, bi, 'label', e.target.value)} />
                            <select className="s7-select s7-branch-target-select" value={br.target || ''} onChange={(e) => updateBranch(i, bi, 'target', e.target.value)}>
                              <option value="">(unlinked)</option>
                              {steps.map((st, si) => si !== i ? <option key={si} value={`Step ${st.number}`}>Step {st.number}{st.name ? `: ${st.name.slice(0, 22)}` : ''}</option> : null)}
                            </select>
                            {!s.parallel && (
                              <input type="number" className="s7-input s7-branch-prob" placeholder="%" min={0} max={100} step={1} title="Probability % — used to weight wait time predictions for this branch" value={br.probability ?? ''} onChange={(e) => { const v = e.target.value; updateBranch(i, bi, 'probability', v === '' ? undefined : Math.max(0, Math.min(100, parseFloat(v) || 0))); }} />
                            )}
                            <button type="button" className="s7-branch-add-step-btn" onClick={() => addStepInBranch(i, bi)} disabled={steps.length >= MAX_STEPS} title="Add step in branch">+</button>
                            <button type="button" className="s7-branch-del" onClick={() => removeBranch(i, bi)}>×</button>
                          </div>
                        ))}
                        <div className="s7-branch-footer">
                          <button type="button" className="s7-link-btn" onClick={() => addBranch(i)}>+ Route</button>
                          {(s.branches || []).length >= 2 && <button type="button" className="s7-link-btn" onClick={() => addMergeStep(i)} disabled={steps.length >= MAX_STEPS}>+ Merge step</button>}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* OWNER tab */}
                {detailTab === 'owner' && (
                  <div className="s7-ni-tab-pane">
                    <div className="s7-detail-section-label">Team</div>
                    <div className="s7-detail-row">
                      <select className="s7-select s7-dept-select" value={s.department} onChange={(e) => { const v = e.target.value; updateStep(i, 'department', v); if (v !== 'Other') { setCustomDeptInput((p) => ({ ...p, [i]: '' })); addAuditEvent({ type: 'step_edit', detail: `Set step ${i + 1} owner to "${v}"` }); } }}>
                        <option value="">Team...</option>
                        <optgroup label="Internal">{DEPT_INTERNAL.map((d) => <option key={d} value={d}>{d}</option>)}</optgroup>
                        <optgroup label="External">{DEPT_EXTERNAL.map((d) => <option key={d} value={d}>{d}</option>)}</optgroup>
                        {customDepartments?.length > 0 && <optgroup label="Custom">{customDepartments.map((d) => <option key={d} value={d}>{d}</option>)}</optgroup>}
                        <option value="Other">+ Custom</option>
                      </select>
                      <div className="s7-toggle-group">
                        <button type="button" className={`s7-toggle-btn${!s.isExternal ? ' active' : ''}`} onClick={() => { updateStep(i, 'isExternal', false); if (s.isExternal) addAuditEvent({ type: 'step_edit', detail: `Step ${i + 1}${s.name ? ` "${s.name}"` : ''} set to Internal` }); }}>Int</button>
                        <button type="button" className={`s7-toggle-btn${s.isExternal ? ' active' : ''}`} onClick={() => { updateStep(i, 'isExternal', true); if (!s.isExternal) addAuditEvent({ type: 'step_edit', detail: `Step ${i + 1}${s.name ? ` "${s.name}"` : ''} set to External` }); }}>Ext</button>
                      </div>
                    </div>
                    {s.department === 'Other' && (
                      <div className="s7-detail-row" style={{ marginTop: 6 }}>
                        <input type="text" className="s7-input" placeholder="Team name..." value={customDeptInput[i] || ''} onChange={(e) => setCustomDeptInput((p) => ({ ...p, [i]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCustomDept(i, customDeptInput[i]); } }} />
                        <button type="button" className="s7-btn-sm" onClick={() => handleAddCustomDept(i, customDeptInput[i])}>Add</button>
                      </div>
                    )}
                  </div>
                )}

                {/* TIMING tab */}
                {detailTab === 'timing' && (() => {
                  const unit = s.durationUnit || 'hours';
                  const mult = unit === 'hours' ? 60 : 1440;
                  const unitLabel = unit === 'hours' ? 'hrs' : 'days';
                  const toDisplay = (m) => m == null ? '' : (unit === 'hours' ? m / 60 : m / 1440).toFixed(2).replace(/\.?0+$/, '');
                  const wp = waitProfile[i];
                  const waitPlaceholder = wp?.predicted != null && s.waitMinutes == null
                    ? `~${toDisplay(wp.predicted)} (est.)`
                    : '';
                  const hasWait = (s.waitMinutes ?? 0) > 0 || wp?.predicted != null;
                  const total = (s.workMinutes ?? 0) + (s.waitMinutes ?? 0);
                  return (
                    <div className="s7-ni-tab-pane s7-timing-pane">
                      <div className="s7-timing-simple-grid">
                        <label className="s7-timing-simple-label">Active work</label>
                        <input type="number" className="s7-input s7-timing-simple-input" min={0} step={0.25} placeholder="0" value={toDisplay(s.workMinutes ?? null)} onChange={(e) => { const v = e.target.value; updateStep(i, 'workMinutes', v === '' ? undefined : Math.max(0, parseFloat(v) || 0) * mult); }} onBlur={(e) => { if (e.target.value !== '') addAuditEvent({ type: 'step_edit', detail: `Set step ${i + 1} work time to ${e.target.value} ${unit}` }); }} />
                        <span className="s7-timing-simple-unit">{unitLabel}</span>

                        <label className="s7-timing-simple-label">Wait time</label>
                        <input type="number" className="s7-input s7-timing-simple-input" min={0} step={0.25} placeholder={waitPlaceholder || '0'} value={toDisplay(s.waitMinutes ?? null)} onChange={(e) => { const v = e.target.value; updateStep(i, 'waitMinutes', v === '' ? undefined : Math.max(0, parseFloat(v) || 0) * mult); }} onBlur={(e) => { if (e.target.value !== '') addAuditEvent({ type: 'step_edit', detail: `Set step ${i + 1} wait time to ${e.target.value} ${unit}` }); }} />
                        <span className="s7-timing-simple-unit">{unitLabel}</span>
                      </div>

                      <div className="s7-timing-unit-switch">
                        <button type="button" className={`s7-toggle-btn${unit === 'hours' ? ' active' : ''}`} onClick={() => updateStep(i, 'durationUnit', 'hours')}>Hours</button>
                        <button type="button" className={`s7-toggle-btn${unit === 'days' ? ' active' : ''}`} onClick={() => updateStep(i, 'durationUnit', 'days')}>Days</button>
                      </div>

                      {hasWait && (
                        <div className="s7-timing-reason-row">
                          <label className="s7-timing-simple-label">Why it waits</label>
                          <select className="s7-input s7-timing-reason-select" value={s.waitType || ''} onChange={(e) => { updateStep(i, 'waitType', e.target.value || undefined); addAuditEvent({ type: 'step_edit', detail: `Set step ${i + 1} wait reason to ${e.target.value}` }); }}>
                            <option value="">—</option>
                            <option value="dependency">Waiting on someone</option>
                            <option value="blocked">Blocked: missing info</option>
                            <option value="capacity">Person unavailable</option>
                            <option value="wip">In queue</option>
                          </select>
                        </div>
                      )}

                      {hasWait && s.waitType && s.waitType !== 'wip' && (
                        <input type="text" className="s7-input s7-timing-reason-note" placeholder={
                          s.waitType === 'dependency' ? 'Waiting for what or who? e.g. Legal review, client sign-off' :
                          s.waitType === 'blocked' ? 'What is missing or unclear?' :
                          'Which role or team?'
                        } value={s.waitNote || ''} onChange={(e) => updateStep(i, 'waitNote', e.target.value)} onBlur={(e) => { if (e.target.value) addAuditEvent({ type: 'step_edit', detail: `Step ${i + 1} wait note: ${e.target.value}` }); }} />
                      )}

                      {total > 0 && (
                        <div className="s7-timing-total">Total: {unit === 'hours' ? (total / 60).toFixed(2).replace(/\.?0+$/, '') + ' h' : (total / 1440).toFixed(2).replace(/\.?0+$/, '') + ' d'}</div>
                      )}
                    </div>
                  );
                })()}

                {/* SYSTEMS tab */}
                {detailTab === 'systems' && (
                  <div className="s7-ni-tab-pane">
                    <div className="s7-detail-section-label">Systems & tools <SectionHint text="Apps, platforms, or tools used in this step (e.g. Salesforce, Excel, Slack). Helps identify where automation or integration could save time." /></div>
                    {(s.systems || []).length > 0 && (
                      <div className="s7-tags">{s.systems.map((sys) => <span key={sys} className="s7-tag">{sys}<button type="button" onClick={() => removeStepSystem(i, sys)}>×</button></span>)}</div>
                    )}
                    <input type="text" className="s7-input s7-system-input" placeholder="Type + Enter..." value={systemInputs[i] || ''} onChange={(e) => setSystemInputs((p) => ({ ...p, [i]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); const v = (systemInputs[i] || '').trim(); if (v) addStepSystem(i, v); setSystemInputs((p) => ({ ...p, [i]: '' })); } }} />
                    <div className="s7-quick-chips">
                      {COMMON_SYSTEMS.filter((x) => !(s.systems || []).map((y) => y.toLowerCase()).includes(x.toLowerCase())).slice(0, 8).map((n) => (
                        <button key={n} type="button" className="s7-quick-chip" onClick={() => addStepSystem(i, n)}>+ {n}</button>
                      ))}
                    </div>
                  </div>
                )}

                {/* HANDOFF tab */}
                {detailTab === 'handoff' && i < steps.length - 1 && (
                  <div className="s7-ni-tab-pane">
                    <div className="s7-detail-section-label">Transfer method → Step {s.number + 1} <SectionHint text="How work moves from this step to the next. Pick the transfer method used and flag if the handover tends to cause confusion or rework." /></div>
                    {ho.method
                      ? <div className="s7-tags"><span className="s7-tag s7-tag-handoff">{HANDOFF_METHODS.find((m) => m.value === ho.method)?.label || ho.method}<button type="button" onClick={() => updateHandoff(i, 'method', '')}>×</button></span></div>
                      : <div className="s7-quick-chips">{HANDOFF_METHODS.map((m) => <button key={m.value} type="button" className="s7-quick-chip" onClick={() => updateHandoff(i, 'method', m.value)}>{m.label}</button>)}</div>
                    }
                    <div className="s7-detail-section-label" style={{ marginTop: 16 }}>Clarification needed? <SectionHint text="Does the person receiving this work usually need extra context or clarification? Flagging this helps surface friction in the handover." /></div>
                    {ho.clarity
                      ? <div className="s7-tags"><span className="s7-tag s7-tag-clarity">{CLARITY_OPTIONS.find((c) => c.value === ho.clarity)?.label || ho.clarity}<button type="button" onClick={() => updateHandoff(i, 'clarity', '')}>×</button></span></div>
                      : <div className="s7-quick-chips">{CLARITY_OPTIONS.map((c) => <button key={c.value} type="button" className="s7-quick-chip" onClick={() => updateHandoff(i, 'clarity', c.value)}>{c.label}</button>)}</div>
                    }
                  </div>
                )}

                {/* CHECKLIST tab */}
                {detailTab === 'checklist' && (
                  <div className="s7-ni-tab-pane">
                    {(s.checklist || []).map((item, ci) => (
                      <div key={item.id || ci} className={`s7-checklist-item${item.checked ? ' checked' : ''}`}>
                        <input type="checkbox" checked={!!item.checked} onChange={() => { const next = [...(s.checklist || [])]; next[ci] = { ...next[ci], checked: !next[ci].checked }; updateStep(i, 'checklist', next); addAuditEvent({ type: 'checklist', detail: `${next[ci].checked ? 'Completed' : 'Unchecked'} "${item.text}" on step ${i + 1}` }); }} />
                        <label>{item.text}</label>
                        <button type="button" onClick={() => { updateStep(i, 'checklist', (s.checklist || []).filter((_, j) => j !== ci)); }}>×</button>
                      </div>
                    ))}
                    <div className="s7-checklist-add">
                      <input type="text" placeholder="Add item..." value={checklistInputs[i] || ''} onChange={(e) => setChecklistInputs(p => ({ ...p, [i]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const text = (checklistInputs[i] || '').trim(); if (text) { updateStep(i, 'checklist', [...(s.checklist || []), { id: Math.random().toString(36).slice(2, 8), text, checked: false }]); setChecklistInputs(p => ({ ...p, [i]: '' })); addAuditEvent({ type: 'checklist', detail: `Added "${text}" to step ${i + 1}` }); } } }} />
                      <button type="button" onClick={() => { const text = (checklistInputs[i] || '').trim(); if (text) { updateStep(i, 'checklist', [...(s.checklist || []), { id: Math.random().toString(36).slice(2, 8), text, checked: false }]); addAuditEvent({ type: 'checklist', detail: `Added "${text}" to step ${i + 1}` }); setChecklistInputs(p => ({ ...p, [i]: '' })); } }}>+</button>
                    </div>
                  </div>
                )}

                {(stepWarnings[i] || []).length > 0 && (
                  <div className="s7-detail-warn" style={{ margin: '12px 16px 0' }}>⚠ Missing: {(stepWarnings[i] || []).join(', ')}</div>
                )}
              </div>

              {/* Save bar — always at bottom of current column */}
              <div className="s7-detail-save-bar">
                {stepSaveUrl[i] ? (
                  <div className="s7-step-save-link">
                    <input type="text" className="s7-step-save-link-input" readOnly value={stepSaveUrl[i]} onClick={(e) => e.target.select()} />
                    <button type="button" className="s7-step-save-copy" onClick={() => { if (navigator.clipboard) navigator.clipboard.writeText(stepSaveUrl[i]); }}>Copy</button>
                    <button type="button" className="s7-step-save-dismiss" onClick={() => setStepSaveUrl((p) => { const n = { ...p }; delete n[i]; return n; })}>×</button>
                  </div>
                ) : (
                  <button type="button" className="s7-step-save-btn" onClick={() => handleStepSave(i)} disabled={stepSaving[i]}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                    {stepSaving[i] ? 'Saving...' : 'Save & get link'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* NEXT column */}
        <div className="s7-ni-col s7-ni-next">
          <div className="s7-ni-col-hdr">Next</div>
          <div className="s7-ni-arrow">←</div>
          <div className="s7-ni-cards">
            {nextCards.length > 0
              ? nextCards.map((nc, ni) => (
                  <div key={ni}>{renderMiniCard({ step: nc.step, branchLabel: nc.branchLabel })}</div>
                ))
              : renderMiniCard({ isTerminal: true, terminalType: 'end' })
            }
          </div>
        </div>

      </div>
    );
  })() : null;


  const chatContent = (
    <div className={`s7-chat-inner${chatDragOver ? ' s7-chat-drop-active' : ''}`} onDrop={handleChatDrop} onDragOver={handleChatDragOver} onDragLeave={handleChatDragLeave}>
      {chatDragOver && (
        <div className="s7-chat-drop-overlay">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <span>Drop files here</span>
        </div>
      )}
      <div className="s7-chat-messages">
        {chatMessages.map((m, i) => {
          const isLast = i === chatMessages.length - 1;
          const showSuggestions = isLast && m.role === 'assistant' && m.suggestions?.length > 0 && !chatLoading;
          const showChips = isLast && m.role === 'assistant' && m.chips?.length > 0 && !chatLoading;
          const isAssistant = m.role === 'assistant';
          const showActions = isAssistant && !!m.content && !(isLast && chatLoading);
          return (
            <div key={i} className={`s7-msg s7-msg-${m.role}`}>
              {isAssistant && <div className="sharp-avatar sharp-avatar-sm" title="Reina">R</div>}
              <div className="s7-msg-content">
                <div className={`s7-msg-bubble${isAssistant ? ' s7-msg-bubble--md' : ''}`}>
                  {isAssistant ? <ChatMessageContent content={m.content} /> : m.content}
                </div>
                {showActions && (
                  <div className="s7-msg-actions">
                    <CopyButton text={m.content} className="s7-msg-action-btn" label="Copy" copiedLabel="Copied" />
                    {isLast && (
                      <button
                        type="button"
                        className="s7-msg-action-btn"
                        onClick={() => sendChat(null, true)}
                        aria-label="Regenerate response"
                      >
                        Regenerate
                      </button>
                    )}
                  </div>
                )}
                {showSuggestions && (
                  <div className="s7-redesign-suggestions">
                    {m.suggestions.map((s, si) => (
                      <button key={si} type="button" className="s7-redesign-suggestion-chip" onClick={() => sendChat(null, false, s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                )}
                {showChips && (
                  <div className="s7-redesign-suggestions">
                    {m.chips.map((c, ci) => (
                      <button
                        key={ci}
                        type="button"
                        className="s7-redesign-suggestion-chip"
                        onClick={() => c.segmentId ? handleSegmentChip(c.segmentId, c.name) : sendChat(null, false, c.name)}
                      >
                        <span>{c.name}</span>
                        {c.tagline && <span style={{ display: 'block', fontSize: '0.75em', opacity: 0.65, fontWeight: 400 }}>{c.tagline}</span>}
                      </button>
                    ))}
                  </div>
                )}
                {m.reportActions && (
                  <div className="s7-report-actions">
                    <button
                      type="button"
                      className="s7-report-action-btn s7-report-action-btn--primary"
                      onClick={() => setInlineReportId(m.reportActions.id)}
                    >
                      View report
                    </button>
                    <a href={`/report?id=${m.reportActions.id}&portal=1`} target="_blank" rel="noopener noreferrer" className="s7-report-action-btn">
                      Open in new tab ↗
                    </a>
                  </div>
                )}
                {Array.isArray(m.costProposals) && m.costProposals.length > 0 && editingReportId && (
                  <div className="s7-report-actions">
                    {m.costProposals.map((p, pi) => {
                      let label = '';
                      if (p.kind === 'set_labour_rate') {
                        const unit = p.rateType === 'annual' ? '/yr' : '/hr';
                        label = `Apply: ${p.department} → ${p.rateInput}${unit}`;
                      } else if (p.kind === 'set_non_labour_cost') {
                        label = `Apply: ${p.key} → ${p.amount}`;
                      } else if (p.kind === 'set_investment') {
                        label = `Apply: investment → ${p.amount}`;
                      } else {
                        label = 'Apply';
                      }
                      return (
                        <button
                          key={pi}
                          type="button"
                          className="s7-report-action-btn s7-report-action-btn--primary"
                          onClick={() => applyCostProposal(p)}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
                {m.dealSetup && !dealId && (
                  <DealSetupCard
                    platformCompany={m.dealSetup.platformCompany}
                    onSubmit={handleDealSetupSubmit}
                  />
                )}
              </div>
            </div>
          );
        })}
        {chatLoading && (
          <div className="s7-msg s7-msg-assistant">
            <div className="sharp-avatar sharp-avatar-sm" title="Reina">R</div>
            <div className="s7-msg-content">
              <div className={`s7-msg-bubble${chatStreamedText ? ' s7-msg-bubble--md' : ' s7-typing'}`}>
                {chatStreamedText ? (
                  <ChatMessageContent content={chatStreamedText} streaming />
                ) : chatProgress ? (
                  <span className="s7-typing-text">{chatProgress}</span>
                ) : (
                  <><span /><span /><span /></>
                )}
              </div>
              <div className="s7-msg-actions">
                <button
                  type="button"
                  className="s7-msg-action-btn s7-msg-action-btn--stop"
                  onClick={stopChat}
                  aria-label="Stop generating"
                >
                  Stop
                </button>
              </div>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>
      {chatError && (
        <div className="s7-chat-error-banner">
          <span>{chatError}</span>
          <button type="button" className="s7-chat-retry-btn" onClick={() => sendChat(null, true)}>
            Try again
          </button>
        </div>
      )}
      {readingChatFilesHint && (
        <div className="s7-chat-read-status" role="status">{readingChatFilesHint}</div>
      )}
      {chatAttachments.length > 0 && (
        <div className="s7-chat-attachments">
          {chatAttachments.map((a, i) => (
            <span key={i} className="s7-chat-attachment-chip">
              {a.name}
              <button type="button" onClick={() => removeChatAttachment(i)} aria-label="Remove">&times;</button>
            </span>
          ))}
        </div>
      )}
      <div className="s7-chat-input-area">
        <input type="file" ref={chatFileRef} className="s7-chat-file-input" multiple accept="image/*,.pdf,.xlsx,.xls,.csv,.doc,.docx,.txt,.json" onChange={handleChatFileSelect} />
        <div className="s7-chat-composer">
          <div className="s7-chat-composer-field">
            <textarea
              ref={chatTextareaRef}
              className="s7-chat-textarea"
              placeholder={editingRedesign ? 'Ask about changes or request modifications…' : 'Describe your process flow...'}
              value={chatInput}
              rows={1}
              onChange={(e) => {
                setChatInput(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = e.target.scrollHeight + 'px';
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                // Alt+Enter: new line (insert manually so behavior is consistent across browsers)
                if (e.altKey) {
                  e.preventDefault();
                  const el = e.currentTarget;
                  const start = el.selectionStart ?? 0;
                  const end = el.selectionEnd ?? 0;
                  const v = chatInput;
                  const next = `${v.slice(0, start)}\n${v.slice(end)}`;
                  setChatInput(next);
                  queueMicrotask(() => {
                    const pos = start + 1;
                    el.selectionStart = el.selectionEnd = pos;
                    el.style.height = 'auto';
                    el.style.height = `${el.scrollHeight}px`;
                  });
                  return;
                }
                // Shift+Enter: default new line in textarea
                if (e.shiftKey) return;
                // Enter: send
                e.preventDefault();
                sendChat();
              }}
              disabled={chatLoading}
            />
          </div>
          <div className="s7-chat-input-actions">
            <button type="button" className="s7-chat-attach" onClick={() => chatFileRef.current?.click()} title="Attach files (images, Excel, PDF, etc.)" disabled={chatLoading}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            </button>
            <div className="s7-chat-input-actions-end">
              <span className="s7-chat-input-hint">Enter to send · Alt+Enter new line</span>
              <button type="button" className="s7-chat-send" onClick={() => sendChat()} disabled={(!chatInput.trim() && chatAttachments.length === 0) || chatLoading}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // Show chat history panel or regular chat depending on state
  const activeChatContent = showChatHistory
    ? <ChatHistoryPanel onClose={() => setShowChatHistory(false)} onLoadReport={handleLoadReport} onRedesignReport={handleRedesignInChat} />
    : chatContent;

  const handleFlowStepClick = useCallback((idx) => {
    if (idx >= 0 && idx < steps.length) {
      setActiveIdx(idx);
      setExpandedStepIdx(idx);
      requestAnimationFrame(() => {
        const item = document.querySelector(`.s7-step-item[data-idx="${idx}"]`);
        item?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }
  }, [steps.length]);

  // Positions are stored as {dx, dy} offsets keyed by step count only — no layout
  // — so the same manual adjustments apply in grid, wrap, and swimlane views.
  const getFlowPositionsKey = () => `${steps.length}`;
  const storedPositions = flowNodePositions[getFlowPositionsKey()] || null;
  const onFlowPositionsChange = useCallback((offsets, _layout) => {
    const key = getFlowPositionsKey();
    setFlowNodePositions((p) => {
      const next = { ...p, [key]: offsets };
      queueMicrotask(() => updateProcessData({ flowNodePositions: next }));
      return next;
    });
  }, [steps.length, updateProcessData]);
  const onFlowCustomEdgesChange = useCallback((edges) => {
    // Update ref FIRST so the functional setSteps updater sees the latest value
    flowCustomEdgesRef.current = edges;
    setFlowCustomEdges(edges);
    // Immediately reconcile decision branches — no async effect needed
    setSteps((prev) => {
      const r = reconcileDecisionBranches(prev, flowCustomEdgesRef.current, flowDeletedEdgesRef.current);
      return r.every((s, i) => s === prev[i]) ? prev : r;
    });
    queueMicrotask(() => updateProcessData({ flowCustomEdges: edges }));
  }, [updateProcessData]);
  const onFlowDeletedEdgesChange = useCallback((ids) => {
    // Update ref FIRST so the functional setSteps updater sees the latest value
    flowDeletedEdgesRef.current = ids;
    setFlowDeletedEdges(ids);
    // Immediately reconcile decision branches — no async effect needed
    setSteps((prev) => {
      const r = reconcileDecisionBranches(prev, flowCustomEdgesRef.current, flowDeletedEdgesRef.current);
      return r.every((s, i) => s === prev[i]) ? prev : r;
    });
    queueMicrotask(() => updateProcessData({ flowDeletedEdges: ids }));
  }, [updateProcessData]);

  const handleDeleteNode = useCallback((idx) => {
    const prevLen = steps.length;
    if (prevLen <= 1) return;
    const oldKey = `${prevLen}`;
    const newKey = `${prevLen - 1}`;
    const oldOffsets = flowNodePositions[oldKey] || {};
    // Remap offsets: drop the deleted step, shift indices after it down by 1.
    const merged = {};
    for (let j = 0; j < prevLen; j++) {
      if (j === idx) continue;
      const o = oldOffsets[`step-${j}`];
      if (o) merged[`step-${j < idx ? j : j - 1}`] = o;
    }
    if (Object.keys(merged).length > 0) {
      setFlowNodePositions((p) => {
        const next = { ...p, [newKey]: merged };
        queueMicrotask(() => updateProcessData({ flowNodePositions: next }));
        return next;
      });
    }
    const shiftIdx = (n) => (n > idx ? n - 1 : n);
    const remapStepId = (id) => {
      const mm = id?.match(/^step-(\d+)$/);
      if (!mm) return id;
      const n = parseInt(mm[1]);
      if (n === idx) return null; // edge touching deleted node — drop it
      return `step-${shiftIdx(n)}`;
    };
    const remappedCustom = (flowCustomEdgesRef.current || [])
      .map((ce) => {
        const src = remapStepId(ce.source);
        const tgt = remapStepId(ce.target);
        if (!src || !tgt) return null;
        return { ...ce, source: src, target: tgt };
      })
      .filter(Boolean);
    const remappedDeleted = (flowDeletedEdgesRef.current || [])
      .map((id) => {
        const seqM = id.match(/^e-seq-(\d+)-(\d+)$/);
        if (seqM) {
          const a = parseInt(seqM[1]), b = parseInt(seqM[2]);
          if (a === idx || b === idx) return null;
          return `e-seq-${shiftIdx(a)}-${shiftIdx(b)}`;
        }
        const decM = id.match(/^e-dec-(\d+)-(\d+)-(\d+)$/);
        if (decM) {
          const a = parseInt(decM[1]), b = parseInt(decM[2]);
          if (a === idx || b === idx) return null;
          return `e-dec-${shiftIdx(a)}-${shiftIdx(b)}-${decM[3]}`;
        }
        const mergeM = id.match(/^e-merge-(\d+)-(\d+)$/);
        if (mergeM) {
          const a = parseInt(mergeM[1]), b = parseInt(mergeM[2]);
          if (a === idx || b === idx) return null;
          return `e-merge-${shiftIdx(a)}-${shiftIdx(b)}`;
        }
        return id;
      })
      .filter(Boolean);
    const newDeleted = [...new Set(remappedDeleted)];
    flowCustomEdgesRef.current = remappedCustom; setFlowCustomEdges(remappedCustom);
    flowDeletedEdgesRef.current = newDeleted; setFlowDeletedEdges(newDeleted);
    queueMicrotask(() => updateProcessData({ flowCustomEdges: remappedCustom, flowDeletedEdges: newDeleted }));
    removeStep(idx);
  }, [steps.length, flowNodePositions, removeStep, updateProcessData]);

  const previewContent = (
    <div ref={previewCanvasRef} className="s7-preview-canvas s7-preview-canvas-interactive">
      {namedSteps.length > 0 && (
        <InteractiveFlowCanvas
          process={{ ...processData, steps, handoffs: ensureHandoffs(steps, handoffs) }}
          layout={previewViewMode}
          darkTheme={theme === 'dark'}
          onStepClick={handleFlowStepClick}
          className="s7-interactive-flow"
          storedPositions={storedPositions}
          onPositionsChange={onFlowPositionsChange}
          customEdges={flowCustomEdges}
          onCustomEdgesChange={onFlowCustomEdgesChange}
          deletedEdges={flowDeletedEdges}
          onDeletedEdgesChange={onFlowDeletedEdgesChange}
          onDeleteNode={handleDeleteNode}
          onAddNodeBetween={(insertIdx, isDecisionEdgeInsert) => {
            const prevLen = steps.length;
            const oldKey = `${prevLen}`;
            insertStepWithRemap(insertIdx, isDecisionEdgeInsert);
            const newKey = `${prevLen + 1}`;
            const oldOffsets = flowNodePositions[oldKey] || {};
            // Remap stored position offsets: nodes before insertIdx keep their offset,
            // nodes at or after shift to the next index. processToReactFlow handles
            // the actual layout — we just preserve any manual drag adjustments.
            const merged = {};
            for (let j = 0; j < insertIdx; j++) {
              const o = oldOffsets[`step-${j}`];
              if (o) merged[`step-${j}`] = o;
            }
            for (let j = insertIdx; j < prevLen; j++) {
              const o = oldOffsets[`step-${j}`];
              if (o) merged[`step-${j + 1}`] = o;
            }
            if (Object.keys(merged).length > 0) {
              setFlowNodePositions((p) => {
                const next = { ...p, [newKey]: merged };
                queueMicrotask(() => updateProcessData({ flowNodePositions: next }));
                return next;
              });
            }
            // Helper: bump a step index if at or after the insertion point
            const bumpIdx = (n) => n >= insertIdx ? n + 1 : n;

            // Remap custom edges: update step-N source/target IDs for the shift
            const remappedCustom = (flowCustomEdgesRef.current || []).map((ce) => {
              const remapStepId = (id) => {
                const mm = id?.match(/^step-(\d+)$/);
                return mm ? `step-${bumpIdx(parseInt(mm[1]))}` : id;
              };
              return { ...ce, source: remapStepId(ce.source), target: remapStepId(ce.target) };
            });

            // Remap all deleted edge IDs for the shift (handles seq, dec, and merge formats)
            const remappedDeleted = (flowDeletedEdgesRef.current || []).map((id) => {
              const seqM = id.match(/^e-seq-(\d+)-(\d+)$/);
              if (seqM) {
                const a = bumpIdx(parseInt(seqM[1])), b = bumpIdx(parseInt(seqM[2]));
                return `e-seq-${a}-${b}`;
              }
              const decM = id.match(/^e-dec-(\d+)-(\d+)-(\d+)$/);
              if (decM) return `e-dec-${bumpIdx(parseInt(decM[1]))}-${bumpIdx(parseInt(decM[2]))}-${decM[3]}`;
              const mergeM = id.match(/^e-merge-(\d+)-(\d+)$/);
              if (mergeM) return `e-merge-${bumpIdx(parseInt(mergeM[1]))}-${bumpIdx(parseInt(mergeM[2]))}`;
              return id;
            });

            // Only carry forward remapped deletions — don't suppress the new
            // auto-generated edges touching the inserted node. processToReactFlow
            // skips sequential edges where the source is a decision or the target
            // is a branch target, so the correct in/out edges are always produced.
            const newDeleted = [...new Set(remappedDeleted)];

            flowCustomEdgesRef.current = remappedCustom;
            setFlowCustomEdges(remappedCustom);
            flowDeletedEdgesRef.current = newDeleted;
            setFlowDeletedEdges(newDeleted);
            queueMicrotask(() => updateProcessData({ flowCustomEdges: remappedCustom, flowDeletedEdges: newDeleted }));
          }}
        />
      )}
      {namedSteps.length === 0 && (
        <div className="s7-preview-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="8.5" y="14" width="7" height="7" rx="1" /><line x1="6.5" y1="10" x2="6.5" y2="14" /><line x1="17.5" y1="10" x2="17.5" y2="14" /></svg>
          <p>Add steps to see your flow diagram</p>
          <p className="s7-preview-hint">Click any node to jump to that step</p>
        </div>
      )}
    </div>
  );


  const [savingToReport, setSavingToReport] = useState(false);
  const [saveRedesignModal, setSaveRedesignModal] = useState(null); // { redesign } when open

  const buildRedesignPayload = useCallback(() => {
    const freshPd = buildFreshProcessData();
    const rawProcesses = [{
      processName: freshPd.processName,
      processType: freshPd.processType,
      definition: freshPd.definition,
      lastExample: freshPd.lastExample,
      userTime: freshPd.userTime,
      performance: freshPd.performance,
      issues: freshPd.issues,
      biggestDelay: freshPd.biggestDelay,
      delayDetails: freshPd.delayDetails,
      steps: freshPd.steps,
      handoffs: freshPd.handoffs,
      systems: freshPd.systems,
      approvals: freshPd.approvals,
      knowledge: freshPd.knowledge,
      newHire: freshPd.newHire,
      frequency: freshPd.frequency,
      costs: freshPd.costs,
      priority: freshPd.priority,
      bottleneck: freshPd.bottleneck,
      savings: freshPd.savings,
    }];
    const acceptedProcesses = rawProcesses.map(p => ({
      processName: p.processName,
      processType: p.processType,
      steps: (p.steps || []).map((s, si) => ({
        number: s.number ?? si + 1,
        name: s.name,
        department: s.department,
        isDecision: s.isDecision,
        isMerge: s.isMerge,
        isExternal: s.isExternal,
        parallel: s.parallel,
        branches: s.branches || [],
      })),
      handoffs: p.handoffs || [],
    }));
    return { acceptedProcesses, optimisedProcesses: acceptedProcesses };
  }, [buildFreshProcessData]);

  const doSaveRedesign = useCallback(async (mode) => {
    if (!editingReportId) return;
    setSaveRedesignModal(null);
    setSavingToReport(true);
    try {
      const redesign = buildRedesignPayload();
      const resp = await apiFetch('/api/save-redesign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: editingReportId, redesign, mode, source: 'human' }),
      }, accessToken);
      let data;
      try { data = await resp.json(); } catch (e) { alert('Invalid response from server. Please try again.'); return; }
      if (resp.ok && data.success) {
        window.location.href = `/portal`;
      } else {
        alert(data.error || 'Failed to save redesign.');
      }
    } catch {
      alert('Network error. Please try again.');
    } finally {
      setSavingToReport(false);
    }
  }, [editingReportId, buildRedesignPayload, accessToken]);

  const handleSaveToReport = useCallback(async () => {
    if (!editingReportId) return;
    if (editingRedesign) {
      setSavingToReport(true);
      try {
        const resp = await apiFetch(`/api/report-redesigns?reportId=${encodeURIComponent(editingReportId)}`, {}, accessToken);
        let data;
        try { data = await resp.json(); } catch (e) { data = {}; }
        if (!resp.ok) {
          alert(data.error || 'Failed to check redesigns.');
          return;
        }
        const count = data.redesigns?.length ?? 0;
        if (count > 0) {
          setSaveRedesignModal({ redesign: buildRedesignPayload() });
        } else {
          await doSaveRedesign('overwrite');
        }
      } catch {
        alert('Network error. Please try again.');
      } finally {
        setSavingToReport(false);
      }
      return;
    }
    setSavingToReport(true);
    try {
      const freshPd = buildFreshProcessData();
      const email = contact?.email || authUser?.email || '';
      const rawProcesses = [{
        processName: freshPd.processName,
        processType: freshPd.processType,
        definition: freshPd.definition,
        lastExample: freshPd.lastExample,
        userTime: freshPd.userTime,
        performance: freshPd.performance,
        issues: freshPd.issues,
        biggestDelay: freshPd.biggestDelay,
        delayDetails: freshPd.delayDetails,
        steps: freshPd.steps,
        handoffs: freshPd.handoffs,
        systems: freshPd.systems,
        approvals: freshPd.approvals,
        knowledge: freshPd.knowledge,
        newHire: freshPd.newHire,
        frequency: freshPd.frequency,
        costs: freshPd.costs,
        priority: freshPd.priority,
        bottleneck: freshPd.bottleneck,
        savings: freshPd.savings,
        flowCustomEdges: flowCustomEdgesRef.current || [],
        flowDeletedEdges: flowDeletedEdgesRef.current || [],
        flowNodePositions: flowNodePositionsRef.current || {},
      }];
      const acceptedProcesses = rawProcesses.map(p => ({
        processName: p.processName,
        processType: p.processType,
        steps: (p.steps || []).map((s, si) => ({
          number: s.number ?? si + 1,
          name: s.name,
          department: s.department,
          isDecision: s.isDecision,
          isMerge: s.isMerge,
          isExternal: s.isExternal,
          parallel: s.parallel,
          branches: s.branches || [],
        })),
        handoffs: p.handoffs || [],
      }));
      const summaryProcesses = rawProcesses.map(p => ({
        name: p.processName, type: p.processType,
        elapsedDays: p.lastExample?.elapsedDays || 0,
        teamSize: p.costs?.teamSize || 1,
        stepsCount: (p.steps || []).length,
        steps: (p.steps || []).map((s, si) => ({
          number: si + 1, name: s.name, department: s.department,
          isDecision: s.isDecision, isMerge: s.isMerge, isExternal: s.isExternal, parallel: s.parallel,
          branches: s.branches || [],
        })),
      }));
      const updates = {
        rawProcesses,
        processes: summaryProcesses,
        contactName: contact?.name,
        contactEmail: email,
        company: contact?.company,
        contact,
      };
      const resp = await apiFetch('/api/update-diagnostic', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: editingReportId, updates }),
      }, accessToken);
      let data;
      try { data = await resp.json(); } catch (e) { alert('Invalid response from server. Please try again.'); return; }
      if (resp.ok && data.success) {
        window.location.href = `/portal`;
      } else {
        alert(data.error || 'Failed to save changes.');
      }
    } catch {
      alert('Network error. Please try again.');
    } finally {
      setSavingToReport(false);
    }
  }, [editingReportId, editingRedesign, contact, buildFreshProcessData, accessToken, buildRedesignPayload, doSaveRedesign]);

  const handleSaveRedesignChoice = useCallback((mode) => {
    setSavingToReport(true);
    doSaveRedesign(mode);
  }, [doSaveRedesign]);

  const diagnosticNav = useDiagnosticNav();
  const registerNav = diagnosticNav?.registerNav;
  useEffect(() => {
    if (!registerNav) return;
    registerNav({
      onBack: editingReportId ? () => { window.location.href = '/portal'; } : () => goToScreen(teamMode ? 1 : 0),
      onContinue: editingReportId ? undefined : handleContinue,
      onSaveToReport: editingReportId ? handleSaveToReport : undefined,
      savingToReport,
      saveLabel: editingRedesign ? 'Save Redesign' : undefined,
    });
    return () => registerNav(null);
  }, [registerNav, teamMode, handleContinue, goToScreen, editingReportId, handleSaveToReport, savingToReport]);

  // Mobile block — show message only at the canvas screen, not earlier in the flow
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  const [mobileSaveStatus, setMobileSaveStatus] = useState('idle'); // idle | saving | done | error
  const [mobileSaveUrl, setMobileSaveUrl] = useState('');
  const [mobileLinkCopied, setMobileLinkCopied] = useState(false);
  const [mobileEmailSent, setMobileEmailSent] = useState(null); // null | true | false after save
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  if (isMobile) {
    const knownEmail = contact?.email || authUser?.email || '';

    const handleMobileSave = async () => {
      setMobileSaveStatus('saving');
      try {
        const result = await saveProgressToCloud(knownEmail || null);
        if (result?.resumeUrl) {
          setMobileSaveUrl(result.resumeUrl);
          setMobileSaveStatus('done');
          try { navigator.clipboard.writeText(result.resumeUrl); } catch { /* ignore */ }
        } else {
          setMobileSaveStatus('error');
        }
      } catch {
        setMobileSaveStatus('error');
      }
    };

    const handleMobileCopy = () => {
      if (!mobileSaveUrl) return;
      navigator.clipboard.writeText(mobileSaveUrl).then(() => {
        setMobileLinkCopied(true);
        setTimeout(() => setMobileLinkCopied(false), 2500);
      }).catch(() => {});
    };

    return (
      <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px', textAlign: 'center', gap: 20, color: 'var(--text)' }}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
        <div style={{ maxWidth: 320 }}>
          <p style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Desktop required for this step</p>
          <p style={{ fontSize: 13, color: 'var(--text-mid)', lineHeight: 1.6 }}>The process mapping canvas needs a larger screen. Save your progress and continue on a desktop or laptop.</p>
        </div>

        {mobileSaveStatus !== 'done' && (
          <div style={{ width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {knownEmail && (
              <p style={{ fontSize: 12, color: 'var(--text-mid)', margin: 0 }}>We'll email the link to <strong style={{ color: 'var(--text)' }}>{knownEmail}</strong></p>
            )}
            <button
              type="button"
              onClick={handleMobileSave}
              disabled={mobileSaveStatus === 'saving'}
              style={{ padding: '11px 20px', borderRadius: 8, border: 'none', background: 'var(--accent, #0d9488)', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer', opacity: mobileSaveStatus === 'saving' ? 0.7 : 1 }}
            >
              {mobileSaveStatus === 'saving' ? 'Saving...' : knownEmail ? 'Save & email link' : 'Save & copy link'}
            </button>
            {mobileSaveStatus === 'error' && (
              <p style={{ fontSize: 12, color: '#ef4444', margin: 0 }}>Something went wrong. Please try again.</p>
            )}
          </div>
        )}

        {mobileSaveStatus === 'done' && (
          <div style={{ width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
            <p style={{ fontSize: 13, color: '#10b981', fontWeight: 600, margin: 0 }}>
              {knownEmail && mobileEmailSent === true
                ? `Resume link sent to ${knownEmail}.`
                : knownEmail && mobileEmailSent === false
                  ? 'Progress saved. Email could not be sent automatically — use Copy below or open this page on desktop.'
                  : knownEmail
                    ? 'Progress saved.'
                    : 'Link copied to clipboard.'}
            </p>
            <div style={{ display: 'flex', width: '100%', gap: 8 }}>
              <input
                type="text"
                readOnly
                value={mobileSaveUrl}
                onClick={(e) => e.target.select()}
                style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-alt, #1e1e1e)', color: 'var(--text-mid)', fontSize: 12, minWidth: 0 }}
              />
              <button
                type="button"
                onClick={handleMobileCopy}
                style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                {mobileLinkCopied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
        )}

        <button type="button" onClick={() => window.location.href = '/process-audit'} style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-mid)', cursor: 'pointer', fontSize: 13 }}>← Start over</button>
      </div>
    );
  }


  return (
    <>
      <div className="s7-workspace" data-theme={theme}>

        {/* ── Redesign mode banner ── */}
        {editingRedesign && (
          <div className="s7-redesign-mode-bar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            <span className="s7-redesign-mode-label">Redesign Mode</span>
            {processData.processName && <span className="s7-redesign-mode-name">{processData.processName}</span>}
          </div>
        )}

        {/* ── Redesign error state ── */}
        {aiRedesignMode && redesignPhase === 'error' && (
          <div className="s7-redesign-error-bar">
            <span>{redesignProgress || 'Failed to generate redesign.'}</span>
            <button type="button" onClick={() => { triggerRedesignRef.current = false; setRedesignPhase('idle'); triggerAiRedesign(); }}>Retry</button>
          </div>
        )}

        {/* ── Validation toast ── */}
        {validationToast && (
          <div className="s7-validation-toast" role="alert">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            {validationToast}
            <button type="button" onClick={() => setValidationToast('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', lineHeight: 1 }}>&times;</button>
          </div>
        )}

        {/* ── Main row: canvas + detail panel ── */}
        <div className="s7-workspace-main">

        {/* ── AI redesign loading overlay ── */}
        {aiRedesignMode && redesignPhase === 'loading' && (
          <div className="s7-redesign-overlay">
            <div className="s7-redesign-overlay-card">
              <div className="s7-redesign-spinner" />
              <p className="s7-redesign-overlay-title">Generating your optimised process</p>
              <p className="s7-redesign-overlay-progress">{redesignProgress}</p>
            </div>
          </div>
        )}

        {/* ── Before flowchart: full-width describe + floating chat. After: rail + chat + resize + canvas ── */}
        {hasFlowArtifact ? (
        <div ref={splitAreaRef} className="s7-canvas-area s7-canvas-area--split">
          <nav className="s7-split-rail" data-theme={theme} aria-label="Mapping tools">
            <div className="s7-split-rail-body">
            <MapRailPrimaryTools
              editingReportId={editingReportId}
              onViewReport={(id) => { setInlineCostReportId(null); setInlineReportId(id); }}
              onViewCost={(id) => { setInlineReportId(null); setInlineCostReportId(id); }}
              onHandover={editingReportId ? undefined : openHandoverModal}
              onContinue={editingReportId ? undefined : handleContinue}
              onSaveToReport={editingReportId ? handleSaveToReport : undefined}
              savingToReport={savingToReport}
              sessionUser={sessionUser}
              hasCostAccess={hasCostAccess}
            />
            <div className="s7-split-rail-sep" role="separator" aria-hidden />
            <button type="button" className={`s7-split-rail-btn${showChatHistory ? ' active' : ''}`} onClick={() => setShowChatHistory((v) => !v)} title="Chat history">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/><line x1="9" y1="10" x2="15" y2="10"/><line x1="9" y1="14" x2="13" y2="14"/></svg>
            </button>
            <button type="button" className="s7-split-rail-btn" onClick={() => setShowFloatingFlow(true)} title="Expand flow in window">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 3 21 3 21 9"/><line x1="21" y1="3" x2="14" y2="10"/><path d="M10 5H5a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-5"/></svg>
            </button>
            <button type="button" className={`s7-split-rail-btn${floatingPanel === 'steps' ? ' active' : ''}`} onClick={() => setFloatingPanel((p) => (p === 'steps' ? null : 'steps'))} title="Steps list">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1.5"/><circle cx="4" cy="12" r="1.5"/><circle cx="4" cy="18" r="1.5"/></svg>
              {steps.length > 0 && <span className="s7-split-rail-count">{steps.length}</span>}
            </button>
            {snippets.length > 0 && (
              <button type="button" className="s7-split-rail-btn" onClick={() => setShowSnippetPicker(true)} title="Snippets">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>
              </button>
            )}
            {sessionUser && typeof onAuditTrailToggle === 'function' && (
              <button type="button" className={`s7-split-rail-btn${auditTrailOpen ? ' active' : ''}`} onClick={onAuditTrailToggle} title="Activity log">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </button>
            )}
            </div>
            <div className="s7-split-rail-footer">
              <MapRailPortalFooter sessionUser={sessionUser} onSignOut={signOut} />
            </div>
          </nav>
          <div
            className="s7-inline-chat s7-inline-chat--sized"
            data-theme={theme}
            style={{ width: splitChatWidthPx, flex: '0 0 auto' }}
          >
            <div className="s7-inline-chat-header">
              <div className="sharp-avatar sharp-avatar-sm" title="Reina">R</div>
              <span className="s7-inline-chat-title">{showChatHistory ? 'History' : 'AI Assistant'}</span>
            </div>
            {activeChatContent}
          </div>
          <div
            className="s7-split-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize chat and canvas"
            onPointerDown={handleSplitResizeStart}
          />
          <div className="s7-canvas-column">
          {inlineCostReportId ? (
            <>
              <div className="s7-canvas-topbar s7-canvas-topbar--report">
                <button type="button" className="s7-report-back-btn" onClick={() => setInlineCostReportId(null)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
                  </svg>
                  Flow
                </button>
                <a
                  href={`/cost-analysis?id=${inlineCostReportId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="s7-report-newtab-link"
                >
                  Open in new tab
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
                    <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                </a>
              </div>
              <div className="s7-canvas s7-canvas--report">
                <iframe
                  ref={costIframeRef}
                  src={`/cost-analysis?id=${encodeURIComponent(inlineCostReportId)}&embed=1`}
                  title="Cost analysis"
                  className="s7-report-iframe"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                />
              </div>
            </>
          ) : inlineReportId ? (
            <>
              <div className="s7-canvas-topbar s7-canvas-topbar--report">
                <button type="button" className="s7-report-back-btn" onClick={() => setInlineReportId(null)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
                  </svg>
                  Flow
                </button>
                <a
                  href={`/report?id=${inlineReportId}&portal=1`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="s7-report-newtab-link"
                >
                  Open in new tab
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
                    <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                </a>
              </div>
              <div className="s7-canvas s7-canvas--report">
                <iframe
                  src={`/report?id=${encodeURIComponent(inlineReportId)}&embed=1`}
                  title="Report"
                  className="s7-report-iframe"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                />
              </div>
            </>
          ) : (
            <>
              <div className="s7-canvas-topbar">
                <div className="s7-view-toggle">
                  {['grid', 'swimlane'].map(m => (
                    <button key={m} type="button" className={`s7-view-btn${previewViewMode === m ? ' active' : ''}`} onClick={() => setPreviewViewMode(m)}>
                      {m === 'grid' ? 'Grid' : 'Swimlane'}
                    </button>
                  ))}
                </div>
              </div>
              <div ref={previewCanvasRef} className="s7-canvas">
                <InteractiveFlowCanvas
                  process={{ ...processData, steps, handoffs: ensureHandoffs(steps, handoffs) }}
                  layout={previewViewMode}
                  darkTheme={theme === 'dark'}
                  onStepClick={handleFlowStepClick}
                  className="s7-interactive-flow"
                  storedPositions={storedPositions}
                  onPositionsChange={onFlowPositionsChange}
                  customEdges={flowCustomEdges}
                  onCustomEdgesChange={onFlowCustomEdgesChange}
                  deletedEdges={flowDeletedEdges}
                  onDeletedEdgesChange={onFlowDeletedEdgesChange}
                  onDeleteNode={handleDeleteNode}
                  onAddNodeBetween={(insertIdx, isDecisionEdgeInsert) => {
                    const prevLen = steps.length;
                    const oldKey = `${prevLen}`;
                    insertStepWithRemap(insertIdx, isDecisionEdgeInsert);
                    const newKey = `${prevLen + 1}`;
                    const oldOffsets = flowNodePositions[oldKey] || {};
                    const merged = {};
                    for (let j = 0; j < insertIdx; j++) { const o = oldOffsets[`step-${j}`]; if (o) merged[`step-${j}`] = o; }
                    for (let j = insertIdx; j < prevLen; j++) { const o = oldOffsets[`step-${j}`]; if (o) merged[`step-${j + 1}`] = o; }
                    if (Object.keys(merged).length > 0) { setFlowNodePositions((p) => { const next = { ...p, [newKey]: merged }; queueMicrotask(() => updateProcessData({ flowNodePositions: next })); return next; }); }
                    const bumpIdx = (n) => n >= insertIdx ? n + 1 : n;
                    const remappedCustom = (flowCustomEdgesRef.current || []).map((ce) => {
                      const remapStepId = (id) => { const mm = id?.match(/^step-(\d+)$/); return mm ? `step-${bumpIdx(parseInt(mm[1]))}` : id; };
                      return { ...ce, source: remapStepId(ce.source), target: remapStepId(ce.target) };
                    });
                    const remappedDeleted = (flowDeletedEdgesRef.current || []).map((id) => {
                      const seqM = id.match(/^e-seq-(\d+)-(\d+)$/);
                      if (seqM) { const a = bumpIdx(parseInt(seqM[1])), b = bumpIdx(parseInt(seqM[2])); return `e-seq-${a}-${b}`; }
                      const decM = id.match(/^e-dec-(\d+)-(\d+)-(\d+)$/);
                      if (decM) return `e-dec-${bumpIdx(parseInt(decM[1]))}-${bumpIdx(parseInt(decM[2]))}-${decM[3]}`;
                      const mergeM = id.match(/^e-merge-(\d+)-(\d+)$/);
                      if (mergeM) return `e-merge-${bumpIdx(parseInt(mergeM[1]))}-${bumpIdx(parseInt(mergeM[2]))}`;
                      return id;
                    });
                    const newDeleted = [...new Set(remappedDeleted)];
                    flowCustomEdgesRef.current = remappedCustom;
                    setFlowCustomEdges(remappedCustom);
                    flowDeletedEdgesRef.current = newDeleted;
                    setFlowDeletedEdges(newDeleted);
                    queueMicrotask(() => updateProcessData({ flowCustomEdges: remappedCustom, flowDeletedEdges: newDeleted }));
                  }}
                />
              </div>
            </>
          )}
          </div>
        </div>
        ) : (
        <div className="s7-canvas-area s7-canvas-area--with-rail">
          <nav className="s7-split-rail" data-theme={theme} aria-label="Mapping tools">
            <div className="s7-split-rail-body">
              <MapRailPrimaryTools
                editingReportId={editingReportId}
                onViewReport={(id) => { setInlineCostReportId(null); setInlineReportId(id); }}
                onViewCost={(id) => { setInlineReportId(null); setInlineCostReportId(id); }}
                onHandover={editingReportId ? undefined : openHandoverModal}
                onContinue={editingReportId ? undefined : handleContinue}
                onSaveToReport={editingReportId ? handleSaveToReport : undefined}
                savingToReport={savingToReport}
                sessionUser={sessionUser}
                hasCostAccess={hasCostAccess}
              />
              <div className="s7-split-rail-sep" role="separator" aria-hidden />
              <button type="button" className={`s7-split-rail-btn${showChatHistory ? ' active' : ''}`} onClick={() => setShowChatHistory((v) => !v)} title="Chat history">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/><line x1="9" y1="10" x2="15" y2="10"/><line x1="9" y1="14" x2="13" y2="14"/></svg>
              </button>
              <button type="button" className="s7-split-rail-btn" onClick={() => setShowFloatingFlow(true)} title="Expand flow in window">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 3 21 3 21 9"/><line x1="21" y1="3" x2="14" y2="10"/><path d="M10 5H5a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-5"/></svg>
              </button>
              <button type="button" className={`s7-split-rail-btn${floatingPanel === 'steps' ? ' active' : ''}`} onClick={() => setFloatingPanel((p) => (p === 'steps' ? null : 'steps'))} title="Add steps manually">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1.5"/><circle cx="4" cy="12" r="1.5"/><circle cx="4" cy="18" r="1.5"/></svg>
              </button>
              {snippets.length > 0 && (
                <button type="button" className="s7-split-rail-btn" onClick={() => setShowSnippetPicker(true)} title="Snippets">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>
                </button>
              )}
              {typeof onAuditTrailToggle === 'function' && (
                <button type="button" className={`s7-split-rail-btn${auditTrailOpen ? ' active' : ''}`} onClick={onAuditTrailToggle} title="Activity log">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                </button>
              )}
            </div>
            <div className="s7-split-rail-footer">
              <MapRailPortalFooter sessionUser={sessionUser} onSignOut={signOut} />
            </div>
          </nav>
          <div className="s7-map-landing" data-theme={theme}>
            {activeChatContent}
          </div>
        </div>
        )}

        {/* ── Right detail panel (split view only) ── */}
        {hasFlowArtifact && (
          <div className={`s7-detail-panel${activeStep ? ' open' : ''}`}>
            {stepDetailContent}
          </div>
        )}

        </div>{/* /s7-workspace-main */}
      </div>

      {/* Floating panels (Steps list only — chat is always inline) */}

      {floatingPanel === 'steps' && createPortal(
        <div className="s7-floating-panel" data-theme={theme}>
          <div className="s7-floating-panel-header">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1.5"/><circle cx="4" cy="12" r="1.5"/><circle cx="4" cy="18" r="1.5"/></svg>
            <span>Steps {steps.length > 0 ? `(${steps.length})` : ''}</span>
            <button type="button" className="s7-floating-panel-close" onClick={() => setFloatingPanel(null)} title="Close">&times;</button>
          </div>
          <div className="s7-floating-panel-body">
            {stepListContent}
          </div>
        </div>,
        document.body
      )}

      {/* Floating flow viewer */}
      {showFloatingFlow && (
        <FloatingFlowViewer
          proc={{ ...processData, steps, handoffs: ensureHandoffs(steps, handoffs) }}
          initialViewMode={previewViewMode}
          onStepClick={(idx) => { setActiveIdx(idx); setExpandedStepIdx(idx); }}
          onClose={() => setShowFloatingFlow(false)}
          flowNodePositions={flowNodePositions}
          onPositionsChange={onFlowPositionsChange}
          customEdges={flowCustomEdges}
          onCustomEdgesChange={onFlowCustomEdgesChange}
          deletedEdges={flowDeletedEdges}
          onDeletedEdgesChange={onFlowDeletedEdgesChange}
          stepsLength={steps.length}
          onDeleteNode={handleDeleteNode}
          stepListContent={stepListContent}
          chatContent={hasFlowArtifact ? null : chatContent}
          chatLoading={chatLoading}
          stepDetailContent={stepDetailContent}
          onAddNodeBetween={(insertIdx, isDecisionEdgeInsert) => {
            const prevLen = steps.length;
            const oldKey = `${prevLen}`;
            insertStepWithRemap(insertIdx, isDecisionEdgeInsert);
            const newKey = `${prevLen + 1}`;
            const oldOffsets = flowNodePositions[oldKey] || {};
            const merged = {};
            for (let j = 0; j < insertIdx; j++) { const o = oldOffsets[`step-${j}`]; if (o) merged[`step-${j}`] = o; }
            for (let j = insertIdx; j < prevLen; j++) { const o = oldOffsets[`step-${j}`]; if (o) merged[`step-${j + 1}`] = o; }
            if (Object.keys(merged).length > 0) {
              setFlowNodePositions((p) => {
                const next = { ...p, [newKey]: merged };
                queueMicrotask(() => updateProcessData({ flowNodePositions: next }));
                return next;
              });
            }
            const bumpIdx = (n) => n >= insertIdx ? n + 1 : n;
            const remappedCustom = (flowCustomEdgesRef.current || []).map((ce) => {
              const remapStepId = (id) => { const mm = id?.match(/^step-(\d+)$/); return mm ? `step-${bumpIdx(parseInt(mm[1]))}` : id; };
              return { ...ce, source: remapStepId(ce.source), target: remapStepId(ce.target) };
            });
            const remappedDeleted = (flowDeletedEdgesRef.current || []).map((id) => {
              const seqM = id.match(/^e-seq-(\d+)-(\d+)$/);
              if (seqM) { const a = bumpIdx(parseInt(seqM[1])), b = bumpIdx(parseInt(seqM[2])); return `e-seq-${a}-${b}`; }
              const decM = id.match(/^e-dec-(\d+)-(\d+)-(\d+)$/);
              if (decM) return `e-dec-${bumpIdx(parseInt(decM[1]))}-${bumpIdx(parseInt(decM[2]))}-${decM[3]}`;
              const mergeM = id.match(/^e-merge-(\d+)-(\d+)$/);
              if (mergeM) return `e-merge-${bumpIdx(parseInt(mergeM[1]))}-${bumpIdx(parseInt(mergeM[2]))}`;
              return id;
            });
            const newDeleted = [...new Set(remappedDeleted)];
            flowCustomEdgesRef.current = remappedCustom;
            setFlowCustomEdges(remappedCustom);
            flowDeletedEdgesRef.current = newDeleted;
            setFlowDeletedEdges(newDeleted);
            queueMicrotask(() => updateProcessData({ flowCustomEdges: remappedCustom, flowDeletedEdges: newDeleted }));
          }}
        />
      )}

      {/* Snippet picker modal */}
      {showSnippetPicker && createPortal(
        <div className="s7-snippet-overlay" onClick={() => setShowSnippetPicker(false)}>
          <div className="s7-snippet-modal" data-theme={theme} onClick={(e) => e.stopPropagation()}>
            <div className="s7-snippet-modal-header">
              <span>Saved snippets</span>
              <button type="button" className="s7-floating-panel-close" onClick={() => setShowSnippetPicker(false)}>&times;</button>
            </div>
            <div className="s7-snippet-modal-body">
              {snippets.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--fg-muted)', textAlign: 'center', padding: '24px 0' }}>No snippets saved yet. Save a step using the floppy disk icon.</p>
              ) : snippets.map((sn, idx) => (
                <div key={idx} className="s7-snippet-row">
                  <button
                    type="button"
                    className="s7-snippet-load-btn"
                    onClick={() => {
                      if (activeStep !== null) {
                        setSteps((prev) => prev.map((s, i) => i === activeStep ? { ...s, name: sn.name || s.name, department: sn.department || s.department, systems: sn.systems || s.systems, workMinutes: sn.workMinutes ?? s.workMinutes, waitMinutes: sn.waitMinutes ?? s.waitMinutes } : s));
                      } else {
                        setSteps((prev) => [...prev, { number: prev.length + 1, name: sn.name || '', department: sn.department || '', systems: sn.systems || '', workMinutes: sn.workMinutes || 0, waitMinutes: sn.waitMinutes || 0 }]);
                      }
                      setShowSnippetPicker(false);
                    }}
                  >
                    <span className="s7-snippet-name">{sn.name || '(unnamed)'}</span>
                    {sn.department && <span className="s7-snippet-dept">{sn.department}</span>}
                    {(sn.workMinutes || sn.waitMinutes) ? <span className="s7-snippet-time">{(sn.workMinutes || 0) + (sn.waitMinutes || 0)} min</span> : null}
                  </button>
                  <button
                    type="button"
                    className="s7-detail-del-btn"
                    title="Delete snippet"
                    onClick={() => { const next = deleteSnippet(null, idx); setSnippets(next); }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Cross-process dependency mapping modal */}
      {showDepsModal && createPortal(
        <div className="s7-snippet-overlay" onClick={() => { if (!pendingNavAfterDeps) setShowDepsModal(false); }}>
          <div className="s7-deps-modal" data-theme={theme} onClick={(e) => e.stopPropagation()}>
            <div className="s7-snippet-modal-header">
              <span>Does this process connect to others?</span>
              <button type="button" className="s7-floating-panel-close" onClick={() => { setShowDepsModal(false); if (pendingNavAfterDeps) { setPendingNavAfterDeps(false); commitAndNavigate(depsLinks); } }}>&times;</button>
            </div>
            <div className="s7-deps-modal-body">
              <p className="s7-deps-modal-hint">Add any processes that feed into, or receive output from, <strong>{processData.processName || 'this process'}</strong>. This helps map your end-to-end workflow.</p>

              {depsLinks.length > 0 && (
                <div className="s7-deps-list">
                  {depsLinks.map((d, i) => (
                    <div key={i} className="s7-deps-item">
                      <span className="s7-deps-badge">{DEP_TYPE_LABELS[d.type] || d.type}</span>
                      <span className="s7-deps-process">{d.toProcess}</span>
                      <button type="button" className="s7-detail-del-btn" onClick={() => setDepsLinks((prev) => prev.filter((_, j) => j !== i))} title="Remove">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="s7-deps-add-row">
                <select className="s7-deps-type-select" value={depsNewType} onChange={(e) => setDepsNewType(e.target.value)}>
                  {Object.entries(DEP_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <input
                  className="s7-deps-input"
                  type="text"
                  placeholder="Process name, e.g. Purchase Order"
                  value={depsNewProcess}
                  onChange={(e) => setDepsNewProcess(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && depsNewProcess.trim()) {
                      setDepsLinks((prev) => [...prev, { fromProcess: processData.processName || '', toProcess: depsNewProcess.trim(), type: depsNewType }]);
                      setDepsNewProcess('');
                    }
                  }}
                />
                <button
                  type="button"
                  className="s7-deps-add-btn"
                  disabled={!depsNewProcess.trim()}
                  onClick={() => {
                    if (!depsNewProcess.trim()) return;
                    setDepsLinks((prev) => [...prev, { fromProcess: processData.processName || '', toProcess: depsNewProcess.trim(), type: depsNewType }]);
                    setDepsNewProcess('');
                  }}
                >Add</button>
              </div>
            </div>
            <div className="s7-deps-modal-footer">
              <button type="button" className="s7-deps-skip-btn" onClick={() => { setShowDepsModal(false); setPendingNavAfterDeps(false); commitAndNavigate(depsLinks); }}>
                {depsLinks.length === 0 ? 'No dependencies, Continue' : 'Done, Continue →'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Save redesign modal (Overwrite vs Save as new) */}
      {saveRedesignModal && (
        <div className="portal-modal-overlay" onClick={() => setSaveRedesignModal(null)}>
          <div className="portal-save-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="portal-save-modal-title">Save redesign</h3>
            <p className="portal-save-modal-desc">How would you like to save this redesign?</p>
            <div className="portal-save-modal-actions">
              <button type="button" className="portal-flow-btn" onClick={() => handleSaveRedesignChoice('overwrite')} disabled={savingToReport}>
                Overwrite existing
              </button>
              <button type="button" className="portal-flow-btn portal-build-btn" onClick={() => handleSaveRedesignChoice('save_new')} disabled={savingToReport}>
                Save as new version
              </button>
              <button type="button" className="portal-flow-btn compact" onClick={() => setSaveRedesignModal(null)} disabled={savingToReport}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* First-visit guide tour */}
      {showGuide && <MapGuide onDismiss={dismissGuide} />}

      {/* Handover modal */}
      {handoverModalOpen && (
        <div className="handover-overlay" onClick={() => setHandoverModalOpen(false)}>
          <div className="handover-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="handover-close" onClick={() => setHandoverModalOpen(false)}>&times;</button>
            <h3 className="handover-title">Handover to colleague</h3>

            {handoverState.status === 'done' ? (
              <div className="handover-done">
                <div className="handover-done-icon">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent, #0d9488)" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <p className="handover-done-text">Link ready! {handoverState.emailSent ? 'An email has also been sent.' : 'Copy the link below to share.'}</p>
                <div className="handover-link-row">
                  <input type="text" className="handover-link-input" readOnly value={handoverState.url} onClick={(e) => e.target.select()} />
                  <button type="button" className={`handover-copy-btn${linkCopied ? ' copied' : ''}`} onClick={handleCopyLink}>{linkCopied ? 'Copied!' : 'Copy'}</button>
                </div>
                <button type="button" className="handover-close-btn" onClick={() => setHandoverModalOpen(false)}>Done</button>
              </div>
            ) : (
              <>
                <p className="handover-desc">Share your progress with a colleague so they can continue from where you left off.</p>
                <div className="handover-field">
                  <label>Your name</label>
                  <input type="text" placeholder="So they know who sent it..." value={handoverState.senderName} onChange={(e) => setHandoverState((p) => ({ ...p, senderName: e.target.value }))} />
                </div>
                <div className="handover-field">
                  <label>Recipient email <span className="handover-optional">(optional)</span></label>
                  <input type="email" placeholder="colleague@company.com" value={handoverState.email} onChange={(e) => setHandoverState((p) => ({ ...p, email: e.target.value }))} />
                </div>
                <div className="handover-field">
                  <label>Comments <span className="handover-optional">(optional)</span></label>
                  <textarea rows={3} placeholder="Any notes for your colleague..." value={handoverState.comments} onChange={(e) => setHandoverState((p) => ({ ...p, comments: e.target.value }))} />
                </div>
                {handoverState.error && <p className="handover-error">{handoverState.error}</p>}
                <div className="handover-actions">
                  <button type="button" className="handover-btn-primary" onClick={() => submitHandover(true)} disabled={handoverState.status === 'saving'}>
                    {handoverState.status === 'saving' ? 'Saving...' : handoverState.email.trim() ? 'Send & copy link' : 'Get link'}
                  </button>
                  {handoverState.email.trim() && (
                    <button type="button" className="handover-btn-secondary" onClick={() => submitHandover(false)} disabled={handoverState.status === 'saving'}>
                      Copy link only
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}