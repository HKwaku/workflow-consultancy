'use client';

import { useState, useCallback, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
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
import { computePhaseState, INTAKE_PHASES } from '@/lib/diagnostic/intakePhases';
import ModelPicker from '@/components/diagnostic/chat/ModelPicker';
import DealsRailButton from '@/components/diagnostic/chat/DealsRailButton';
import HomeRailButton from '@/components/diagnostic/chat/HomeRailButton';
import WorkspaceRailButton from '@/components/diagnostic/chat/WorkspaceRailButton';
import WorkspaceContextStrip from '@/components/diagnostic/chat/WorkspaceContextStrip';
const WorkspaceCanvasClient = dynamic(() => import('@/app/workspace/WorkspaceClient'), { ssr: false });
// When a deal is in scope, the "Open workspace" affordance mounts the
// deal-flavoured workspace inline on the canvas instead of the
// org-wide one. Same tab UX, scoped to the deal's participants + flows.
const DealWorkspaceCanvasClient = dynamic(() => import('@/app/deals/[id]/workspace/DealWorkspaceClient'), { ssr: false });
// Top-level scope nav + the bare Deals/Analytics tabs the overlay
// renders when the user picks those scopes.
import WorkspaceScopeNav from '@/components/workspace/WorkspaceScopeNav';
import WorkspaceDealsTab from '@/components/workspace/WorkspaceDealsTab';
import WorkspaceOutputsTab from '@/components/workspace/WorkspaceOutputsTab';
import WorkspaceModelsTab from '@/components/workspace/WorkspaceModelsTab';
import RecentProcessesRow from '@/components/diagnostic/chat/RecentProcessesRow';
import SettingsRailButton from '@/components/diagnostic/chat/SettingsRailButton';
import DocsRailButton from '@/components/diagnostic/chat/DocsRailButton';
import AnalyticsRailButton from '@/components/diagnostic/chat/AnalyticsRailButton';
import DealContextChip from '@/components/diagnostic/chat/DealContextChip';
import FlowPresenceBar from '@/components/diagnostic/chat/FlowPresenceBar';
import { useFlowPresence } from '@/lib/useFlowPresence';
import RailSlidePanel from '@/components/diagnostic/chat/RailSlidePanel';
import CreditsWidget from '@/components/diagnostic/chat/CreditsWidget';
import { IconEdit, IconArchive, IconDelete } from '@/components/diagnostic/actionIcons';
import MobileViewGate from '@/components/MobileViewGate';
import { CanvasActionProvider, useCanvasAction } from '@/components/diagnostic/chat/CanvasActionContext';

const INTAKE_PHASES_BY_ID = Object.fromEntries(INTAKE_PHASES.map((p) => [p.id, p]));
import { generateReportInline } from '@/lib/diagnostic';
import ChatMessageContent, { CopyButton } from '../ChatMessageContent';

// Bundle-split heavy panels that only render on demand. Keeps the
// /workspace/map initial bundle slim — these are loaded only when the
// user actually opens the floating flow viewer / audit log / inline
// analysis / chat history.
const FloatingFlowViewer = dynamic(() => import('../FloatingFlowViewer'), { ssr: false });
const AuditTrailPanel = dynamic(() => import('@/components/diagnostic/AuditTrailPanel'), { ssr: false });
const ChatHistoryPanel = dynamic(() => import('../ChatHistoryPanel'), { ssr: false });

const MAP_SPLIT_RAIL_PX = 48;
const MAP_SPLIT_HANDLE_PX = 8;
const MOBILE_BREAKPOINT_PX = 768;

/**
 * Returns true when viewport width <= MOBILE_BREAKPOINT_PX. Hydration-safe:
 * the SSR/initial-paint value is `false` (desktop) so server and client
 * markup match, then re-evaluates after mount + on resize. Used to gate
 * desktop-only affordances like the split-resize drag, the pixel width
 * restored from localStorage, and the rail-reservation calculation.
 */
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);
    const handler = (e) => setIsMobile(e.matches);
    setIsMobile(mql.matches);
    if (mql.addEventListener) mql.addEventListener('change', handler);
    else mql.addListener(handler);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', handler);
      else mql.removeListener(handler);
    };
  }, []);
  return isMobile;
}

const MIN_STEPS = 3;
const MAX_STEPS = 50;
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

/* ── First-visit guide tour — walks the rail top-to-bottom ──────── */

// Walkthrough order MUST match the rail top-to-bottom so the spotlight
// always moves downward. Canonical rail (DiagnosticWorkspace):
//   Home · Admin dashboard · Processes · Deals · Chat history · Artefacts
//   · Open process summary · Save changes · Cost analysis · Steps list
//   · Handover to colleague · Analytics · Docs & guides
//   · Replay walkthrough · Activity log · Settings (footer)
// Conditional icons (View / Save / Cost / Handover) are auto-skipped
// when their selector doesn't resolve (see MapGuide effect).
const GUIDE_TOUR = [
  {
    title: "Hi, I'm Reina",
    desc: "I help you design and run your operating model. Describe any process in plain language, or upload a doc, spreadsheet, or diagram, and I'll build the flow for you in real time. Let me walk you through the rail on the left — top to bottom.",
    selector: null,
    cta: "Show me around →",
  },
  {
    title: "Home",
    desc: "Returns you to a fresh chat. Clears the deal scope, the canvas, and any in-flight conversation. Your processes, deals, and analytics are still in the rail below — nothing is deleted.",
    selector: '[title="Home — fresh chat"]',
    cta: "Next →",
  },
  {
    title: "Admin dashboard",
    desc: "Manage your organisation — members and roles, BYO API keys, model allowlist, monthly token budget, usage analytics. Opens the org admin page in a new tab.",
    selector: '[title="Admin dashboard"]',
    cta: "Next →",
  },
  {
    title: "Your processes",
    desc: "Open any process you've mapped. The slide-in panel groups them by company → recency. Each row collapses to title + status dots; expand to see the current state and any in-flight redesigns. Edit or delete at the child level; the redesign affordance is always there so you can spawn a target variant.",
    selector: '[title^="Switch report"],[title^="Open one of your reports"]',
    cta: "Next →",
  },
  {
    title: "Deals",
    desc: "Bring an M&A deal, PE roll-up, or scaling project into the chat. Deals are sorted by risk score (Σ severity × confidence) so the ones needing attention float to the top — coloured pill on each name. Pick a deal to scope the conversation, then click Open workspace for the full surface: data room (any file format, OCR for scanned PDFs, AI categorisation, expected-docs checklist), Q&A queue, evidence-cited findings with inline tags / comments / staleness flags, and a one-page scorecard.",
    selector: '[title^="Switch deal context"],[title^="Bring a deal into this chat"]',
    cta: "Next →",
  },
  {
    title: "Chat history",
    desc: "Every conversation is autosaved. Open this panel to jump back into any prior audit — your flow, chat, and progress all come back exactly as you left them.",
    selector: '[title="Chat history"]',
    cta: "Next →",
  },
  {
    title: "Artefacts",
    desc: "Snapshots of your flow, generated reports, cost analyses — every artefact created in this chat session, one click away.",
    selector: '[title^="Artefacts"]',
    cta: "Next →",
  },
  {
    title: "Open process summary",
    desc: "See the readout for this process — bottlenecks, automation candidates, and recommendations. Appears once you've mapped enough to summarise.",
    selector: '[title="Open process summary"]',
    cta: "Next →",
  },
  {
    title: "Save changes",
    desc: "Persist your edits to the process so the workspace reflects the current state.",
    selector: '[title="Save changes"],[title^="Saving"]',
    cta: "Next →",
  },
  {
    title: "Cost analysis",
    desc: "See the financial impact of this process — annual cost, estimated savings, payback, and ROI. Available once a report has been generated.",
    selector: '[title="Cost analysis"]',
    cta: "Next →",
  },
  {
    title: "Steps list",
    desc: "Open the steps panel to add or edit steps manually. Useful for fine-tuning names, reordering, or adding details Reina hasn't filled in yet.",
    selector: '[title="Steps list"],[title="Add steps manually"]',
    cta: "Next →",
  },
  {
    title: "Handover to a colleague",
    desc: "Pass the in-progress audit to someone else without losing state. Captures the recipient's email, your name, and any notes you'd like them to see, then emails them a resume link that drops them straight into this conversation with the full canvas, chat history, and progress intact. Use it for a teammate who owns one of the steps, the actual process owner, or just to send yourself a link from another device.",
    selector: '[title="Handover to a colleague"]',
    cta: "Next →",
  },
  {
    title: "Analytics",
    desc: "A compact analytics panel: total processes mapped, savings, automation grades, recent activity. The same data the old dashboard used to show.",
    selector: '[title="Analytics"]',
    cta: "Next →",
  },
  {
    title: "Docs & guides",
    desc: "Searchable documentation grouped by Getting started · Tutorials (your first audit, running a deal, the data room, the deal workspace, BYO API keys, citations) · Reference (audit log, entitlements, exports, finding shape, model picker). Each topic opens in a new tab.",
    selector: '[title="Docs & guides"]',
    cta: "Next →",
  },
  {
    title: "Replay walkthrough",
    desc: "You can re-open this tour anytime via this icon — handy after we ship new rail features.",
    selector: '[title="Replay walkthrough"]',
    cta: "Next →",
  },
  {
    title: "Activity log",
    desc: "Every change is tracked. Open the activity log to see a full audit trail of edits made during this session.",
    selector: '[title="Activity log"]',
    cta: "Next →",
  },
  {
    title: "Settings",
    desc: "The gear icon at the bottom of the rail is your account menu. Signed in: shows your email, lets you sign out, export your data (GDPR right to portability), or schedule account deletion (30-day cancel window). Signed out: it's a sign-in shortcut. The popover anchors from the rail bottom so it never clips against the viewport.",
    selector: '[title="Settings"],[title="Account"],[title="Sign in"]',
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
      // Selector didn't match - skip this stop so we don't show a pointer to nothing.
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
      {/* Spotlight ring - its box-shadow creates the dark overlay when active */}
      {spotlightStyle && (
        <div className="s7-guide-spotlight" style={spotlightStyle} />
      )}

      {/* Tour card - positioned next to highlighted element */}
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

/** In-chat PE deal setup card - rendered as part of an assistant message. */
function DealSetupCard({ platformCompany, onSubmit, dealKind = 'pe' }) {
  // Per-kind copy. PE roll-up: platform + portfolio. M&A: acquirer +
  // target. The submit shape stays the same — handleDealSetupSubmit
  // routes the kind to the correct deal type and participant roles.
  const COPY = {
    pe: {
      namePlaceholder: 'e.g. ABC Capital 2026 Roll-up',
      targetLabel: 'First portfolio company',
      targetPlaceholder: 'Portfolio company name',
      ownerLabel: 'Platform',
      ownerPlaceholder: 'Platform company name',
      ownerEmailLabel: 'Platform lead email (optional)',
      targetEmailLabel: 'Portfolio lead email (optional)',
      missingTarget: 'Enter at least one portfolio company.',
      missingOwner: 'Enter the platform company name.',
    },
    ma: {
      namePlaceholder: 'e.g. Acme acquires Beta — 2026',
      targetLabel: 'Target company',
      targetPlaceholder: 'Company being acquired',
      ownerLabel: 'Acquirer',
      ownerPlaceholder: 'Acquirer name',
      ownerEmailLabel: 'Acquirer lead email (optional)',
      targetEmailLabel: 'Target lead email (optional)',
      missingTarget: 'Enter the target company.',
      missingOwner: 'Enter the acquirer name.',
    },
  };
  const copy = COPY[dealKind] || COPY.pe;

  // Seed the owner field from authUser.company (passed in via the
  // platformCompany prop) UNLESS it's the placeholder fallback the
  // chat opener uses ("your company" / "your platform company"). When
  // we got a real company name, prefill it; otherwise leave the field
  // empty so the user actively types the acquirer / platform name.
  const isPlaceholderOwner = !platformCompany
    || /^your (platform )?company$/i.test(platformCompany.trim());
  const [dealName, setDealName] = useState('');
  const [targetCompany, setTargetCompany] = useState('');
  const [ownerCompany, setOwnerCompany] = useState(isPlaceholderOwner ? '' : platformCompany);
  // Optional lead email for each side. When set, the participant gets
  // an invite link in their email; the participant_email column also
  // gets populated so any later handover-to-colleague auto-attaches
  // to the right participant scope.
  const [ownerEmail, setOwnerEmail] = useState('');
  const [targetEmail, setTargetEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const isValidEmail = (s) => !s || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const name = dealName.trim();
    const target = targetCompany.trim();
    const owner = ownerCompany.trim();
    const ownerEm = ownerEmail.trim();
    const targetEm = targetEmail.trim();
    if (!name) { setError('Enter a deal name.'); return; }
    if (!owner) { setError(copy.missingOwner); return; }
    if (!target) { setError(copy.missingTarget); return; }
    if (!isValidEmail(ownerEm)) { setError('Owner email looks invalid.'); return; }
    if (!isValidEmail(targetEm)) { setError('Target email looks invalid.'); return; }
    setSubmitting(true);
    const res = await onSubmit({
      dealName: name,
      targetCompany: target,
      platformCompany: owner,
      ownerEmail: ownerEm || null,
      targetEmail: targetEm || null,
      dealKind,
    });
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
          placeholder={copy.namePlaceholder}
          autoComplete="off"
          disabled={submitting}
        />
      </label>
      <label className="s7-deal-setup-field">
        <span className="s7-deal-setup-label">{copy.ownerLabel}</span>
        <input
          type="text"
          className="s7-deal-setup-input"
          value={ownerCompany}
          onChange={(e) => setOwnerCompany(e.target.value)}
          placeholder={copy.ownerPlaceholder}
          autoComplete="organization"
          disabled={submitting}
        />
      </label>
      <label className="s7-deal-setup-field">
        <span className="s7-deal-setup-label">{copy.ownerEmailLabel}</span>
        <input
          type="email"
          className="s7-deal-setup-input"
          value={ownerEmail}
          onChange={(e) => setOwnerEmail(e.target.value)}
          placeholder="lead@acquirer.com"
          autoComplete="email"
          disabled={submitting}
        />
      </label>
      <label className="s7-deal-setup-field">
        <span className="s7-deal-setup-label">{copy.targetLabel}</span>
        <input
          type="text"
          className="s7-deal-setup-input"
          value={targetCompany}
          onChange={(e) => setTargetCompany(e.target.value)}
          placeholder={copy.targetPlaceholder}
          autoComplete="off"
          disabled={submitting}
        />
      </label>
      <label className="s7-deal-setup-field">
        <span className="s7-deal-setup-label">{copy.targetEmailLabel}</span>
        <input
          type="email"
          className="s7-deal-setup-input"
          value={targetEmail}
          onChange={(e) => setTargetEmail(e.target.value)}
          placeholder="lead@target.com"
          autoComplete="email"
          disabled={submitting}
        />
      </label>
      {error && <div className="s7-deal-setup-error">{error}</div>}
      <div className="s7-deal-setup-footer">
        <button type="submit" className="s7-deal-setup-submit" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create deal & continue'}
        </button>
      </div>
    </form>
  );
}

/** Save + optional view report - top of icon rail */
function MapRailPrimaryTools({ editingReportId, onViewReport, onViewCost, onHandover, onContinue, onSaveToReport, savingToReport, sessionUser, hasCostAccess, readyToGenerate }) {
  return (
    <>
      {/* Dashboard icon removed — the Admin dashboard rail icon (above) is the
          single canonical link to /org-admin. Keeping a second grid
          icon here was confusing and pointed at the legacy /portal redirect. */}
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
        // Replaces the old "View report" file icon with a flow-diagram glyph
        // — the user is opening the process map, not a deliverable.
        <button type="button" className="s7-split-rail-btn" onClick={() => onViewReport?.(editingReportId)} title="Open process summary">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="6" cy="6" r="2.5"/>
            <circle cx="18" cy="6" r="2.5"/>
            <circle cx="12" cy="18" r="2.5"/>
            <line x1="8" y1="7.5" x2="11" y2="16"/>
            <line x1="16" y1="7.5" x2="13" y2="16"/>
          </svg>
        </button>
      )}
      {onSaveToReport && (
        // Was "Save to report" with a file/floppy. Now "Save changes" — the
        // user is saving an edit to a process they already own, not producing
        // an output. Cloud/sync icon reinforces the workspace metaphor.
        <button type="button" className="s7-split-rail-btn" onClick={onSaveToReport} disabled={savingToReport} title={savingToReport ? 'Saving…' : 'Save changes'}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M17 17a4 4 0 0 0 .8-7.93A6 6 0 0 0 6.34 8.5 4.5 4.5 0 0 0 7 17h10z"/>
            <polyline points="9 13 12 10 15 13"/>
            <line x1="12" y1="10" x2="12" y2="17"/>
          </svg>
        </button>
      )}
      {onContinue && (
        // Was "Generate report" framed as a terminal verb. Now "Add to model"
        // — the action drops a designed process into the workspace, not into
        // a stack of deliverables. Inbox/folder icon over the chevron.
        <button
          type="button"
          className="s7-split-rail-btn"
          onClick={onContinue}
          title={readyToGenerate ? 'Add to model (ready)' : 'Add to model'}
          aria-label={readyToGenerate ? 'Add to model (ready)' : 'Add to model'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M22 12h-6l-2 3h-4l-2-3H2"/>
            <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
          </svg>
        </button>
      )}
    </>
  );
}

function MapRailPortalFooter({ sessionUser, onSignOut }) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);

  // If not signed in, keep the simple sign-in link.
  if (!sessionUser) {
    return (
      <a href="/signin" className="s7-split-rail-btn s7-split-rail-link" title="Sign in">
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

function ArtefactsPanel({ artefacts, onClose, onOpenReport, onOpenFlow, onOpenCost, onPin }) {
  const count = artefacts.length;
  const labelFor = (kind) => (
    kind === 'flow_snapshot' ? 'Flow snapshot'
      : kind === 'report' ? 'Report'
        : kind === 'cost_analysis' ? 'Cost analysis'
          : kind === 'deal_analysis' ? 'Deal analysis'
            : 'Artefact'
  );
  const iconFor = (kind) => (kind === 'flow_snapshot' ? '◫' : kind === 'report' ? '▤' : '◉');
  const handle = (a) => {
    if (a.kind === 'report' && a.refId) onOpenReport?.(a.refId);
    else if (a.kind === 'cost_analysis' && a.refId) onOpenCost?.(a.refId);
    else if (a.kind === 'flow_snapshot') onOpenFlow?.(a.snapshot);
  };
  return (
    <div className="s7-chat-inner s7-artefacts-panel">
      <div className="s7-artefacts-panel-hd">
        <div className="s7-artefacts-panel-title">
          <span aria-hidden>◫</span> Artefacts <span className="s7-artefacts-panel-count">{count}</span>
        </div>
        <div className="s7-artefacts-panel-actions">
          {onPin ? (
            <button type="button" className="s7-artefacts-panel-pin" onClick={onPin} title="Snapshot the current flow">
              <span aria-hidden>📌</span> Pin current
            </button>
          ) : null}
          <button type="button" className="s7-artefacts-panel-close" onClick={onClose} aria-label="Close">×</button>
        </div>
      </div>
      <div className="s7-artefacts-panel-body">
        {count === 0 ? (
          <div className="s7-artefacts-panel-empty">
            <p>No artefacts in this chat yet.</p>
            <p className="s7-artefacts-panel-empty-hint">Redesigns, generated reports, and upload reshapes will show up here so you can jump back to them.</p>
          </div>
        ) : (
          <ul className="s7-artefacts-panel-list">
            {artefacts.map((a, i) => (
              <li key={i}>
                <button type="button" className="s7-artefacts-panel-item" onClick={() => handle(a)}>
                  <span className="s7-artefacts-panel-item-icon" aria-hidden>{iconFor(a.kind)}</span>
                  <span className="s7-artefacts-panel-item-body">
                    <span className="s7-artefacts-panel-item-label">{a.label || labelFor(a.kind)}</span>
                    <span className="s7-artefacts-panel-item-kind">{labelFor(a.kind)}</span>
                  </span>
                  <span className="s7-artefacts-panel-item-arrow" aria-hidden>→</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ArtefactPill({ artefact, onOpenFlow }) {
  if (!artefact || !artefact.kind) return null;
  const label = artefact.label || (
    artefact.kind === 'flow_snapshot' ? 'Flow snapshot' : 'Artefact'
  );
  const icon = artefact.kind === 'flow_snapshot' ? '◫' : '◉';
  const handle = () => {
    if (artefact.kind === 'flow_snapshot') onOpenFlow?.(artefact.snapshot);
  };
  return (
    <button type="button" className="s7-artefact-pill" onClick={handle} title={`Open ${label}`}>
      <span className="s7-artefact-pill-icon" aria-hidden>{icon}</span>
      <span className="s7-artefact-pill-label">{label}</span>
    </button>
  );
}

/**
 * Fetch a signed URL for a deal document. Returns the full {url, filename,
 * mime_type, byte_size} payload or null on failure.
 */
async function fetchDealDocSignedUrl({ dealId, documentId, accessToken }) {
  if (!dealId || !documentId) return null;
  try {
    const r = await apiFetch(
      `/api/deals/${dealId}/documents/${documentId}/signed-url`,
      {},
      accessToken,
    );
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/**
 * Lightbox-style modal that renders a deal document inline. PDFs go in an
 * iframe; non-PDFs (docx, xlsx, images) get an "Open in new tab" fallback
 * because most browsers won't render them directly. Closing dismisses.
 */
function DealDocViewer({ open, onClose, doc }) {
  if (!open || !doc?.url) return null;
  const isPdf = (doc.mime_type || '').toLowerCase().includes('pdf');
  const isImage = (doc.mime_type || '').toLowerCase().startsWith('image/');
  return (
    <div className="deal-doc-viewer-overlay" role="dialog" aria-modal aria-label={`Viewing ${doc.filename}`} onClick={onClose}>
      <div className="deal-doc-viewer-frame" onClick={(e) => e.stopPropagation()}>
        <div className="deal-doc-viewer-bar">
          <span className="deal-doc-viewer-name" title={doc.filename}>{doc.filename}</span>
          <div className="deal-doc-viewer-actions">
            <a className="deal-doc-viewer-btn" href={doc.url} target="_blank" rel="noopener noreferrer">Open in new tab</a>
            <button type="button" className="deal-doc-viewer-btn" onClick={onClose} aria-label="Close">Close</button>
          </div>
        </div>
        {isPdf && <iframe src={doc.url} className="deal-doc-viewer-iframe" title={doc.filename} />}
        {!isPdf && isImage && <img src={doc.url} alt={doc.filename} className="deal-doc-viewer-image" />}
        {!isPdf && !isImage && (
          <div className="deal-doc-viewer-fallback">
            <p>This file type ({doc.mime_type || 'unknown'}) can't render inline. Open it in a new tab.</p>
            <a className="deal-doc-viewer-btn deal-doc-viewer-btn--primary" href={doc.url} target="_blank" rel="noopener noreferrer">Open in new tab</a>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Open a document in a new tab via the deal-viewer signed-URL endpoint.
 * Returns false on failure so callers can show a small inline error.
 */
async function openDealDocument({ dealId, documentId, accessToken }) {
  const data = await fetchDealDocSignedUrl({ dealId, documentId, accessToken });
  if (!data?.url) return false;
  window.open(data.url, '_blank', 'noopener,noreferrer');
  return true;
}

/**
 * Render the data-room chunks the search_deal_documents tool returned during
 * an assistant turn as cards under the bubble. Filenames are clickable —
 * fetches a signed Storage URL and opens the original document in a new tab.
 */
function DealDocsSources({ groups, dealId, accessToken }) {
  const [busyChunkId, setBusyChunkId] = useState(null);
  const [errorChunkId, setErrorChunkId] = useState(null);
  const [viewing, setViewing] = useState(null); // { url, filename, mime_type }
  if (!groups?.length) return null;
  const all = groups.flatMap((g) => g.chunks || []);
  if (!all.length) return null;
  const formatLoc = (c) => [
    c.page ? `p.${c.page}` : null,
    c.slide ? `slide ${c.slide}` : null,
    c.sheet ? `sheet ${c.sheet}` : null,
    c.cellRange ? `range ${c.cellRange}` : null,
    c.section,
  ].filter(Boolean).join(' · ');

  const open = async (c) => {
    if (!dealId || !c.documentId) return;
    setBusyChunkId(c.chunkId);
    setErrorChunkId(null);
    const data = await fetchDealDocSignedUrl({ dealId, documentId: c.documentId, accessToken });
    setBusyChunkId(null);
    if (!data?.url) { setErrorChunkId(c.chunkId); return; }
    setViewing({ url: data.url, filename: c.filename || data.filename, mime_type: data.mime_type });
  };

  return (
    <div className="s7-msg-deal-sources" role="region" aria-label="Sources from the data room">
      <div className="s7-msg-deal-sources-head">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <span>{all.length} source{all.length === 1 ? '' : 's'} from the data room</span>
      </div>
      <ul className="s7-msg-deal-sources-list">
        {all.map((c, i) => (
          <li key={c.chunkId || i} className="s7-msg-deal-sources-item">
            <div className="s7-msg-deal-sources-meta">
              {c.documentId && dealId ? (
                <button
                  type="button"
                  className="s7-msg-deal-sources-name s7-msg-deal-sources-name--link"
                  onClick={() => open(c)}
                  disabled={busyChunkId === c.chunkId}
                  title="View the source document inline"
                >
                  {c.filename || 'Untitled document'}
                </button>
              ) : (
                <span className="s7-msg-deal-sources-name">{c.filename || 'Untitled document'}</span>
              )}
              {formatLoc(c) && <span className="s7-msg-deal-sources-loc"> · {formatLoc(c)}</span>}
              {busyChunkId === c.chunkId && <span className="s7-msg-deal-sources-loading"> · opening…</span>}
              {errorChunkId === c.chunkId && <span className="s7-msg-deal-sources-err"> · failed to open</span>}
            </div>
            {c.snippet && <div className="s7-msg-deal-sources-snippet">{c.snippet}</div>}
          </li>
        ))}
      </ul>
      <DealDocViewer open={Boolean(viewing)} onClose={() => setViewing(null)} doc={viewing} />
    </div>
  );
}

/**
 * Loading state that renders inside the right canvas area while a long-
 * running action (analysis / export / etc) is in flight. Reads from
 * CanvasActionContext. Renders nothing when no action is in flight, so
 * existing canvas content shows through normally.
 *
 * Two modes via the `inline` prop:
 *   inline=false (default): centered card filling the canvas — used when
 *     there's no flow chart to show (deal mode / pre-map)
 *   inline=true: smaller floating chip top-right of the canvas — used when
 *     a flow chart is rendered behind it so the user keeps editing
 */
function CanvasActionOverlay({ inline = false }) {
  const { action, endAction } = useCanvasAction();
  if (!action) return null;
  const elapsed = Math.max(0, Math.floor((Date.now() - (action.startedAt || Date.now())) / 1000));
  const cls = inline ? 'canvas-action-overlay canvas-action-overlay--inline' : 'canvas-action-overlay canvas-action-overlay--card';
  return (
    <div className={cls} role="status" aria-live="polite">
      <div className="canvas-action-overlay-spinner" />
      <div className="canvas-action-overlay-body">
        <div className="canvas-action-overlay-label">
          {action.label || 'Working…'}
          {action.detail && <span className="canvas-action-overlay-detail"> · {action.detail}</span>}
        </div>
        <div className="canvas-action-overlay-status">
          {action.status || 'in progress'} · {elapsed}s
        </div>
      </div>
      <button type="button" className="canvas-action-overlay-dismiss" onClick={() => endAction({ id: action.id })} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}

/**
 * Render structured deal metadata (documents list / findings list) emitted by
 * the deal-metadata tools as compact cards under the assistant bubble.
 * Document filenames are clickable (signed URL → new tab). Findings deep-link
 * to the deal page focused on the finding's review row.
 */
function DealMetaCards({ groups, dealId, accessToken }) {
  const [busyId, setBusyId] = useState(null);
  const [viewing, setViewing] = useState(null);
  if (!groups?.length) return null;
  const openDoc = async (d) => {
    if (!dealId || !d.id) return;
    setBusyId(d.id);
    const data = await fetchDealDocSignedUrl({ dealId, documentId: d.id, accessToken });
    setBusyId(null);
    if (data?.url) setViewing({ url: data.url, filename: d.filename || data.filename, mime_type: data.mime_type });
  };
  return (
    <div className="s7-msg-deal-meta">
      {groups.map((g, gi) => {
        if (g.kind === 'documents') {
          return (
            <div key={gi} className="s7-msg-deal-meta-block">
              <div className="s7-msg-deal-meta-head">{g.items.length} document{g.items.length === 1 ? '' : 's'} in the data room</div>
              <ul className="s7-msg-deal-meta-list">
                {g.items.map((d) => (
                  <li key={d.id} className="s7-msg-deal-meta-row">
                    <span className={`s7-msg-deal-meta-status s7-msg-deal-meta-status--${d.status}`}>{d.status}</span>
                    {dealId && d.status === 'ready' ? (
                      <button
                        type="button"
                        className="s7-msg-deal-meta-name s7-msg-deal-meta-name--link"
                        onClick={() => openDoc(d)}
                        disabled={busyId === d.id}
                        title="Open the document in a new tab"
                      >
                        {d.filename}
                      </button>
                    ) : (
                      <span className="s7-msg-deal-meta-name">{d.filename}</span>
                    )}
                    <span className="s7-msg-deal-meta-sub">
                      {[d.sourceParty, d.pageCount ? `${d.pageCount}p` : null, d.byteSize ? `${(d.byteSize / 1024).toFixed(0)} KB` : null].filter(Boolean).join(' · ')}
                      {busyId === d.id && ' · opening…'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        }
        if (g.kind === 'changes') {
          return (
            <div key={gi} className="s7-msg-deal-meta-block">
              <div className="s7-msg-deal-meta-head">{g.items.length} change{g.items.length === 1 ? '' : 's'}</div>
              <ul className="s7-msg-deal-meta-list">
                {g.items.map((c) => (
                  <li key={c.id} className="s7-msg-deal-meta-row">
                    <span className={`s7-msg-deal-meta-status s7-msg-deal-meta-status--${c.state}`}>{c.state}</span>
                    {dealId ? (
                      <a
                        className="s7-msg-deal-meta-name s7-msg-deal-meta-name--link"
                        href={c.deepLink || `/workspace/map?deal=${encodeURIComponent(dealId)}&focusChange=${encodeURIComponent(c.id)}`}
                        title="Focus this change (Cmd/Ctrl+click to open in new tab)"
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
                          e.preventDefault();
                          if (typeof window === 'undefined') return;
                          const sp = new URLSearchParams(window.location.search);
                          sp.set('focusChange', c.id);
                          window.history.replaceState(null, '', window.location.pathname + (sp.toString() ? `?${sp.toString()}` : ''));
                          window.dispatchEvent(new CustomEvent('vesno:focus-change', { detail: { changeId: c.id } }));
                        }}
                      >
                        {(c.agentName === 'redesign' ? 'Redesign' : c.agentName === 'chat' ? 'Reina' : (c.actorEmail || 'system'))} {c.kind} {c.subjectSummary}
                      </a>
                    ) : (
                      <span className="s7-msg-deal-meta-name">{c.kind} {c.subjectSummary}</span>
                    )}
                    <span className="s7-msg-deal-meta-sub">
                      {[c.principle, c.outcomeSummary, c.rationale ? c.rationale.slice(0, 80) : null].filter(Boolean).join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        }
        if (g.kind === 'findings') {
          return (
            <div key={gi} className="s7-msg-deal-meta-block">
              <div className="s7-msg-deal-meta-head">{g.items.length} finding{g.items.length === 1 ? '' : 's'}</div>
              <ul className="s7-msg-deal-meta-list">
                {g.items.map((f) => (
                  <li key={f.key} className="s7-msg-deal-meta-row">
                    {f.severity && <span className={`s7-msg-deal-meta-sev s7-msg-deal-meta-sev--${f.severity}`}>{f.severity}</span>}
                    {dealId ? (
                      <a
                        className="s7-msg-deal-meta-name s7-msg-deal-meta-name--link"
                        href={`/workspace/map?deal=${encodeURIComponent(dealId)}&focusFinding=${encodeURIComponent(f.key)}`}
                        title="Focus this finding (Cmd/Ctrl+click to open in new tab)"
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
                          e.preventDefault();
                          if (typeof window === 'undefined') return;
                          const sp = new URLSearchParams(window.location.search);
                          sp.set('focusFinding', f.key);
                          window.history.replaceState(null, '', window.location.pathname + (sp.toString() ? `?${sp.toString()}` : ''));
                          window.dispatchEvent(new CustomEvent('vesno:focus-finding', { detail: { findingKey: f.key } }));
                        }}
                      >
                        {f.title}
                      </a>
                    ) : (
                      <span className="s7-msg-deal-meta-name">{f.title}</span>
                    )}
                    <span className="s7-msg-deal-meta-sub">
                      {[f.section || f.category, f.evidenceCount != null ? `${f.evidenceCount} evidence` : null, `review: ${f.reviewStatus}`].filter(Boolean).join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        }
        return null;
      })}
      <DealDocViewer open={Boolean(viewing)} onClose={() => setViewing(null)} doc={viewing} />
    </div>
  );
}

/**
 * Render staged deal mutation proposals (currently `finding_review`) as
 * confirm-to-apply cards under the assistant bubble. The chat agent only
 * stages — the actual mutation is the user's click. Mirrors the cost-proposal
 * pattern (set_labour_rate etc.) but for deal-side actions.
 */
function DealProposalCards({ proposals, accessToken }) {
  const [stateById, setStateById] = useState({});
  const { beginAction, updateAction, endAction } = useCanvasAction();
  if (!proposals?.length) return null;

  const apply = async (idx, p) => {
    setStateById((s) => ({ ...s, [idx]: { busy: true } }));
    try {
      if (p.kind === 'upload_document') {
        // No real mutation — just navigate to the deal's data-room area.
        // The deal page reads ?focus=documents (Phase 6 pattern) to scroll
        // and highlight that section.
        window.open(`/deals/${p.dealId}?focus=documents`, '_blank', 'noopener,noreferrer');
        setStateById((s) => ({
          ...s,
          [idx]: { applied: true, info: 'Opened the data-room upload page' },
        }));
        return;
      }

      if (p.kind === 'undo_link_participant_report') {
        // No PATCH path clears report_id — call PATCH with reportId='' will fail
        // validation. Instead use the participant DELETE-style helper if one
        // exists, OR clear via a direct deal_participants update. Fastest v1:
        // surface that this requires the deal-page UI for now.
        const r = await apiFetch(
          `/api/deals/${p.dealId}/participants/${p.participantId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              report_id: null,
              ...(p.changeId ? { change_id: p.changeId } : {}),
            }),
          },
          accessToken,
        );
        if (!r.ok) {
          throw new Error('Server can\'t unlink reports yet — visit the deal page to clear it manually.');
        }
        setStateById((s) => ({
          ...s,
          [idx]: { applied: true, info: `Unlinked report from ${p.participantCompany}` },
        }));
        return;
      }

      if (p.kind === 'link_participant_report') {
        const r = await apiFetch(
          `/api/deals/${p.dealId}/participants`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              participantId: p.participantId,
              reportId: p.reportId,
              ...(p.changeId ? { change_id: p.changeId } : {}),
            }),
          },
          accessToken,
        );
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data?.error || `Apply failed (${r.status})`);
        setStateById((s) => ({
          ...s,
          [idx]: { applied: true, info: `Linked to ${p.participantCompany} (${p.participantRole})` },
        }));
        return;
      }

      if (p.kind === 'reprocess_document') {
        const url = `/api/deals/${p.dealId}/documents/${p.documentId}/reprocess${p.wipe ? '?wipe=1' : ''}`;
        const r = await apiFetch(
          url,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: p.changeId ? JSON.stringify({ change_id: p.changeId }) : undefined,
          },
          accessToken,
        );
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data?.error || `Apply failed (${r.status})`);
        setStateById((s) => ({
          ...s,
          [idx]: { applied: true, info: `Reprocess queued — ${p.filename} is now pending` },
        }));
        return;
      }

      if (p.kind === 'invite_participant') {
        const r = await apiFetch(
          `/api/deals/${p.dealId}/participants`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              role: p.role,
              companyName: p.companyName,
              ...(p.email ? { participantEmail: p.email } : {}),
              ...(p.name  ? { participantName:  p.name  } : {}),
              invite: Boolean(p.sendInviteEmail && p.email),
              ...(p.changeId ? { change_id: p.changeId } : {}),
            }),
          },
          accessToken,
        );
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data?.error || `Apply failed (${r.status})`);
        const info = p.sendInviteEmail && p.email
          ? `Participant added · invite emailed to ${p.email}`
          : `Participant added · invite link copied below`;
        setStateById((s) => ({ ...s, [idx]: { applied: true, info, inviteUrl: data?.participant?.inviteUrl || null } }));
        return;
      }
    } catch (e) {
      setStateById((s) => ({ ...s, [idx]: { error: e?.message || 'Network error' } }));
    }
  };

  const dismiss = (idx) => setStateById((s) => ({ ...s, [idx]: { dismissed: true } }));

  return (
    <div className="s7-msg-deal-proposals">
      {proposals.map((p, idx) => {
        const st = stateById[idx] || {};
        if (st.dismissed) return null;

        let head, body, applyLabel, modifier;
        if (p.kind === 'link_participant_report') {
          modifier = 'link';
          applyLabel = 'Link report to slot';
          head = <span className="s7-msg-deal-proposal-action">Proposed: Link report</span>;
          body = (
            <>
              <div className="s7-msg-deal-proposal-title">{p.participantCompany} <span style={{ fontWeight: 400, color: 'var(--text-mid, #64748b)' }}>· {p.participantRole}</span></div>
              <div className="s7-msg-deal-proposal-section">Report id: <code>{String(p.reportId).slice(0, 12)}…</code></div>
            </>
          );
        } else if (p.kind === 'upload_document') {
          modifier = 'upload';
          applyLabel = 'Open data room';
          head = <span className="s7-msg-deal-proposal-action">Proposed: Upload documents</span>;
          body = (
            <>
              <ul className="s7-msg-deal-proposal-list">
                {p.docTypes.map((d, di) => (<li key={di}>{d}</li>))}
              </ul>
              {p.reason && <div className="s7-msg-deal-proposal-note">{p.reason}</div>}
            </>
          );
        } else if (p.kind === 'undo_link_participant_report') {
          modifier = 'undo';
          applyLabel = 'Unlink report';
          head = <span className="s7-msg-deal-proposal-action">Proposed: Unlink participant report</span>;
          body = (
            <>
              <div className="s7-msg-deal-proposal-title">Unlink from {p.participantCompany}</div>
              <div className="s7-msg-deal-proposal-section">Previous report id: <code>{String(p.previousReportId).slice(0, 12)}…</code></div>
            </>
          );
        } else if (p.kind === 'reprocess_document') {
          modifier = 'reprocess';
          applyLabel = p.wipe ? 'Wipe chunks & reprocess' : 'Reprocess document';
          head = <span className="s7-msg-deal-proposal-action">Proposed: Reprocess document</span>;
          body = (
            <>
              <div className="s7-msg-deal-proposal-title">{p.filename}</div>
              <div className="s7-msg-deal-proposal-section">
                Current status: {p.currentStatus}{p.wipe ? ' · existing chunks will be deleted' : ''}
              </div>
              {p.reason && <div className="s7-msg-deal-proposal-note">{p.reason}</div>}
            </>
          );
        } else if (p.kind === 'invite_participant') {
          modifier = 'invite';
          applyLabel = p.sendInviteEmail && p.email ? 'Add & email invite' : 'Add participant';
          head = <span className="s7-msg-deal-proposal-action">Proposed: Invite participant</span>;
          body = (
            <>
              <div className="s7-msg-deal-proposal-title">{p.companyName} <span style={{ fontWeight: 400, color: 'var(--text-mid, #64748b)' }}>· {p.role}</span></div>
              {(p.email || p.name) && (
                <div className="s7-msg-deal-proposal-section">
                  {[p.name, p.email].filter(Boolean).join(' · ')}
                </div>
              )}
            </>
          );
        } else {
          return null;
        }

        return (
          <div key={idx} className={`s7-msg-deal-proposal s7-msg-deal-proposal--${modifier}`}>
            <div className="s7-msg-deal-proposal-head">{head}</div>
            <div className="s7-msg-deal-proposal-body">{body}</div>
            {st.applied ? (
              <>
                <div className="s7-msg-deal-proposal-applied">✓ {st.info || 'Applied'}</div>
                {st.inviteUrl && (
                  <div className="s7-msg-deal-proposal-section" style={{ marginTop: 6, wordBreak: 'break-all' }}>
                    <a href={st.inviteUrl} target="_blank" rel="noopener noreferrer">{st.inviteUrl}</a>
                  </div>
                )}
              </>
            ) : (
              <div className="s7-msg-deal-proposal-actions">
                <button
                  type="button"
                  className="s7-msg-deal-proposal-btn s7-msg-deal-proposal-btn--primary"
                  onClick={() => apply(idx, p)}
                  disabled={st.busy}
                >
                  {st.busy ? 'Applying…' : applyLabel}
                </button>
                <button
                  type="button"
                  className="s7-msg-deal-proposal-btn"
                  onClick={() => dismiss(idx)}
                  disabled={st.busy}
                >
                  Dismiss
                </button>
              </div>
            )}
            {st.error && <div className="s7-msg-deal-proposal-err">{st.error}</div>}
          </div>
        );
      })}
    </div>
  );
}

/* ── Workspace proposal cards ───────────────────────────────────────
   Mirror of DealProposalCards but for chat-staged operating-model
   mutations (propose_add_function / propose_add_role / propose_add_system).
   On Confirm, POSTs to the relevant /api/operating-models/[id]/* endpoint
   and dispatches `vesno:workspace-changed` so the canvas re-fetches.
   ────────────────────────────────────────────────────────────────── */
function WorkspaceProposalCards({ proposals, accessToken }) {
  const [stateById, setStateById] = useState({});
  if (!proposals?.length) return null;

  // Map a proposal kind to the REST call that commits it. add_* create
  // (POST collection); Tier-1/2 also edit (PATCH item) and remove
  // (DELETE item). Returns { method, url, body }.
  const resolveCall = (p) => {
    const base = `/api/operating-models/${p.operatingModelId}`;
    const pl = p.payload || {};
    switch (p.kind) {
      case 'add_function':
        return { method: 'POST', url: `${base}/functions`, body: {
          name: pl.name, parent_function_id: pl.parent_function_id || null, description: pl.description || null,
        } };
      case 'add_role':
        return { method: 'POST', url: `${base}/roles`, body: pl };
      case 'add_system':
        return { method: 'POST', url: `${base}/systems`, body: pl };
      // Tier 1 — process lifecycle
      case 'create_process':
        return { method: 'POST', url: `${base}/processes`, body: { name: pl.name, function_id: pl.function_id || null } };
      case 'duplicate_process':
        return { method: 'POST', url: `${base}/processes`, body: { source_process_id: pl.source_process_id, name: pl.name || null } };
      case 'file_process':
        return { method: 'PATCH', url: `${base}/processes/${pl.process_id}`, body: { function_id: pl.function_id ?? null } };
      case 'delete_process':
        return { method: 'DELETE', url: `${base}/processes/${pl.process_id}`, body: null };
      // Tier 2 — model edit / delete (move_function emits kind=update_function)
      case 'update_function':
        return { method: 'PATCH', url: `${base}/functions/${pl.function_id}`, body: pl.patch || {} };
      case 'delete_function':
        return { method: 'DELETE', url: `${base}/functions/${pl.function_id}`, body: null };
      case 'update_role':
        return { method: 'PATCH', url: `${base}/roles/${pl.role_id}`, body: pl.patch || {} };
      case 'delete_role':
        return { method: 'DELETE', url: `${base}/roles/${pl.role_id}`, body: null };
      case 'update_system':
        return { method: 'PATCH', url: `${base}/systems/${pl.system_id}`, body: pl.patch || {} };
      case 'delete_system':
        return { method: 'DELETE', url: `${base}/systems/${pl.system_id}`, body: null };
      default:
        throw new Error(`Unknown workspace proposal kind: ${p.kind}`);
    }
  };

  const apply = async (idx, p) => {
    setStateById((s) => ({ ...s, [idx]: { busy: true } }));
    try {
      const { method, url, body } = resolveCall(p);
      const opts = { method, headers: {} };
      if (body != null) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
      const r = await apiFetch(url, opts, accessToken);
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data?.error || `Apply failed (${r.status})`);
      }
      setStateById((s) => ({ ...s, [idx]: { done: true } }));
      // Tell any mounted WorkspaceClient to re-fetch its data.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('vesno:workspace-changed', { detail: { kind: p.kind } }));
      }
    } catch (e) {
      setStateById((s) => ({ ...s, [idx]: { error: e.message || String(e) } }));
    }
  };

  const isDestructive = (k) => k === 'delete_process' || k === 'delete_function' || k === 'delete_role' || k === 'delete_system';

  const cancel = (idx) => setStateById((s) => ({ ...s, [idx]: { done: true, cancelled: true } }));

  const titleFor = (p) => {
    const pl = p.payload || {};
    switch (p.kind) {
      case 'add_function':       return `Add function: ${pl.name || '?'}`;
      case 'add_role':           return `Add role: ${pl.name || '?'}`;
      case 'add_system':         return `Add system: ${pl.name || '?'}`;
      case 'create_process':     return `New process: ${pl.name || '?'}`;
      case 'duplicate_process':  return `Duplicate process${pl.name ? `: ${pl.name}` : ''}`;
      case 'file_process':       return pl.function_id ? 'File process under a function' : 'Unfile process';
      case 'delete_process':     return `Delete process: ${pl.process_name || pl.process_id || '?'}`;
      case 'update_function':    return pl.patch && 'parent_function_id' in pl.patch && Object.keys(pl.patch).length === 1
        ? 'Move function' : `Edit function${pl.patch?.name ? `: → ${pl.patch.name}` : ''}`;
      case 'delete_function':    return `Delete function: ${pl.function_name || pl.function_id || '?'}`;
      case 'update_role':        return `Edit role${pl.patch?.name ? `: → ${pl.patch.name}` : ''}`;
      case 'delete_role':        return `Delete role: ${pl.role_name || pl.role_id || '?'}`;
      case 'update_system':      return `Edit system${pl.patch?.name ? `: → ${pl.patch.name}` : ''}`;
      case 'delete_system':      return `Delete system: ${pl.system_name || pl.system_id || '?'}`;
      default:                   return p.kind;
    }
  };

  const subtitleFor = (p) => {
    const pl = p.payload || {};
    const bits = [];
    if (p.kind === 'add_function') {
      if (pl.parent_function_id) bits.push('nested under existing function');
      if (pl.description) bits.push(pl.description);
    } else if (p.kind === 'add_role') {
      if (pl.headcount != null) bits.push(`${pl.headcount} FTE`);
      if (pl.owner_email) bits.push(pl.owner_email);
    } else if (p.kind === 'add_system') {
      if (pl.vendor) bits.push(`vendor: ${pl.vendor}`);
      if (pl.category) bits.push(pl.category);
      if (pl.layer) bits.push(pl.layer);
    } else if (p.kind === 'create_process' && pl.function_id) {
      bits.push('filed under a function');
    } else if (p.kind?.startsWith('update_') && pl.patch) {
      bits.push(Object.keys(pl.patch).join(', '));
    } else if (isDestructive(p.kind)) {
      bits.push('This cannot be undone.');
    }
    return bits.join(' · ');
  };

  return (
    <div className="s7-deal-proposals">
      {proposals.map((p, idx) => {
        const st = stateById[idx] || {};
        return (
          <div key={idx} className="s7-deal-proposal-card">
            <div className="s7-deal-proposal-title">{titleFor(p)}</div>
            {subtitleFor(p) && (
              <div className="s7-deal-proposal-sub">{subtitleFor(p)}</div>
            )}
            {st.error && <div className="s7-deal-proposal-error">{st.error}</div>}
            <div className="s7-deal-proposal-actions">
              {st.done
                ? <span className="s7-deal-proposal-done">{st.cancelled ? 'Cancelled' : (isDestructive(p.kind) ? 'Deleted' : 'Applied')}</span>
                : (
                  <>
                    <button
                      type="button"
                      className="s7-deal-proposal-btn s7-deal-proposal-btn--primary"
                      onClick={() => apply(idx, p)}
                      disabled={!!st.busy}
                    >
                      {st.busy ? 'Working…' : (isDestructive(p.kind) ? 'Confirm delete' : 'Confirm')}
                    </button>
                    <button
                      type="button"
                      className="s7-deal-proposal-btn"
                      onClick={() => cancel(idx)}
                      disabled={!!st.busy}
                    >
                      Cancel
                    </button>
                  </>
                )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Workspace bulk-setup card ──────────────────────────────────────
   Renders the structured plan emitted by propose_workspace_bulk_setup
   (functions + roles + systems together). The user can untick rows
   they don't want, then "Apply all" creates them in dependency order:
   functions first (parents before children, resolved by parent_path),
   then roles + systems in parallel. After success, fires
   `vesno:workspace-changed` so the canvas re-fetches.
   ────────────────────────────────────────────────────────────────── */
function WorkspaceBulkProposalCard({ plan, accessToken }) {
  const [rowKept, setRowKept] = useState(() => {
    // Default: every row kept. Map keyed by `${kind}:${idx}`.
    const m = {};
    (plan.functions || []).forEach((_, i) => { m[`function:${i}`] = true; });
    (plan.roles     || []).forEach((_, i) => { m[`role:${i}`]     = true; });
    (plan.systems   || []).forEach((_, i) => { m[`system:${i}`]   = true; });
    return m;
  });
  const [busy, setBusy]   = useState(false);
  const [done, setDone]   = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null); // { written, total }

  const toggle = (k) => setRowKept((s) => ({ ...s, [k]: !s[k] }));

  const apply = async () => {
    setBusy(true);
    setError(null);
    const fns     = (plan.functions || []).filter((_, i) => rowKept[`function:${i}`]);
    const roles   = (plan.roles     || []).filter((_, i) => rowKept[`role:${i}`]);
    const systems = (plan.systems   || []).filter((_, i) => rowKept[`system:${i}`]);
    const total   = fns.length + roles.length + systems.length;
    if (total === 0) { setError('Nothing selected.'); setBusy(false); return; }
    setProgress({ written: 0, total });

    // Track newly-created function name → id so child rows + roles can resolve.
    const nameToId = new Map();
    let written = 0;
    const bump = () => { written += 1; setProgress({ written, total }); };

    try {
      // 1. Functions in order; resolve parent_path against earlier rows.
      // We only support a single-level resolve here — if the parent_path
      // has slashes we use the LAST segment as the lookup key.
      for (const f of fns) {
        const parentName = f.parent_path
          ? f.parent_path.split('/').map((s) => s.trim()).filter(Boolean).slice(-1)[0]
          : null;
        const parentId = parentName ? (nameToId.get(parentName.toLowerCase()) || null) : null;
        const r = await apiFetch(
          `/api/operating-models/${plan.operatingModelId}/functions`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: f.name,
              parent_function_id: parentId,
              description: f.description || null,
            }),
          },
          accessToken,
        );
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          throw new Error(`Function "${f.name}": ${data?.error || r.status}`);
        }
        const body = await r.json().catch(() => ({}));
        if (body?.id) nameToId.set(f.name.toLowerCase(), body.id);
        bump();
      }

      // 2. Roles + systems in parallel — they have no inter-dependencies.
      const roleResults = await Promise.allSettled(roles.map(async (rl) => {
        const function_ids = (rl.function_names || [])
          .map((n) => nameToId.get(String(n).toLowerCase()))
          .filter(Boolean);
        const r = await apiFetch(
          `/api/operating-models/${plan.operatingModelId}/roles`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: rl.name,
              headcount: rl.headcount,
              owner_email: rl.owner_email,
              function_ids,
              description: rl.description,
            }),
          },
          accessToken,
        );
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          throw new Error(`Role "${rl.name}": ${data?.error || r.status}`);
        }
        bump();
      }));

      const sysResults = await Promise.allSettled(systems.map(async (sy) => {
        const r = await apiFetch(
          `/api/operating-models/${plan.operatingModelId}/systems`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sy),
          },
          accessToken,
        );
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          throw new Error(`System "${sy.name}": ${data?.error || r.status}`);
        }
        bump();
      }));

      const failures = [...roleResults, ...sysResults].filter((x) => x.status === 'rejected');
      if (failures.length) {
        const messages = failures.map((f) => f.reason?.message || String(f.reason)).join('; ');
        setError(`${failures.length} item(s) failed: ${messages}`);
      }
      setDone(true);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('vesno:workspace-changed', { detail: { kind: 'bulk' } }));
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => setDone(true);

  if (!plan || (!plan.functions?.length && !plan.roles?.length && !plan.systems?.length)) return null;

  return (
    <div className="s7-deal-proposal-card s7-workspace-bulk-card">
      <div className="s7-deal-proposal-title">Bulk workspace setup</div>
      {plan.notes && <div className="s7-deal-proposal-sub">{plan.notes}</div>}
      {progress && (
        <div className="s7-deal-proposal-sub">Applied {progress.written} of {progress.total}…</div>
      )}
      {error && <div className="s7-deal-proposal-error">{error}</div>}

      {!done && (
        <>
          {plan.functions?.length > 0 && (
            <div className="s7-workspace-bulk-section">
              <div className="s7-workspace-bulk-heading">Functions ({plan.functions.length})</div>
              {plan.functions.map((f, i) => {
                const k = `function:${i}`;
                return (
                  <label key={k} className="s7-workspace-bulk-row">
                    <input type="checkbox" checked={!!rowKept[k]} onChange={() => toggle(k)} disabled={busy} />
                    <span className="s7-workspace-bulk-row-name">{f.name}</span>
                    {f.parent_path && <span className="s7-workspace-bulk-row-meta">under {f.parent_path}</span>}
                  </label>
                );
              })}
            </div>
          )}
          {plan.roles?.length > 0 && (
            <div className="s7-workspace-bulk-section">
              <div className="s7-workspace-bulk-heading">Roles ({plan.roles.length})</div>
              {plan.roles.map((r, i) => {
                const k = `role:${i}`;
                const meta = [
                  r.headcount != null ? `${r.headcount} FTE` : null,
                  r.owner_email,
                  r.function_names?.length ? `→ ${r.function_names.join(', ')}` : null,
                ].filter(Boolean).join(' · ');
                return (
                  <label key={k} className="s7-workspace-bulk-row">
                    <input type="checkbox" checked={!!rowKept[k]} onChange={() => toggle(k)} disabled={busy} />
                    <span className="s7-workspace-bulk-row-name">{r.name}</span>
                    {meta && <span className="s7-workspace-bulk-row-meta">{meta}</span>}
                  </label>
                );
              })}
            </div>
          )}
          {plan.systems?.length > 0 && (
            <div className="s7-workspace-bulk-section">
              <div className="s7-workspace-bulk-heading">Systems ({plan.systems.length})</div>
              {plan.systems.map((s, i) => {
                const k = `system:${i}`;
                const meta = [s.vendor, s.category, s.layer].filter(Boolean).join(' · ');
                return (
                  <label key={k} className="s7-workspace-bulk-row">
                    <input type="checkbox" checked={!!rowKept[k]} onChange={() => toggle(k)} disabled={busy} />
                    <span className="s7-workspace-bulk-row-name">{s.name}</span>
                    {meta && <span className="s7-workspace-bulk-row-meta">{meta}</span>}
                  </label>
                );
              })}
            </div>
          )}
        </>
      )}

      <div className="s7-deal-proposal-actions">
        {done
          ? <span className="s7-deal-proposal-done">{error ? 'Partially applied' : 'Applied'}</span>
          : (
            <>
              <button
                type="button"
                className="s7-deal-proposal-btn s7-deal-proposal-btn--primary"
                onClick={apply}
                disabled={busy}
              >
                {busy ? 'Applying…' : 'Apply all'}
              </button>
              <button
                type="button"
                className="s7-deal-proposal-btn"
                onClick={cancel}
                disabled={busy}
              >
                Cancel
              </button>
            </>
          )}
      </div>
    </div>
  );
}

export default function DiagnosticWorkspace({ initialStepIdx: initialStepIdxProp, onAuditTrailToggle, auditTrailOpen, reportToLoad, onReportLoaded }) {
  const {
    processData, updateProcessData, goToScreen,
    customDepartments, addCustomDepartment, removeCustomDepartment,
    teamMode, chatMessages, addChatMessage, setChatMessages,
    buildFullSnapshot, editingReportId, viewOnlyProcessId, editingSurface, contact, authUser, setContact,
    selectedFunctionPath, selectedOperatingModelName, selectedOperatingModelId, setWorkspaceAnchors,
    addAuditEvent,
    moduleId, setModuleId, dealCanonicalProcessName, dealName, dealRole, dealId, setDeal, dealParticipants,
    completedProcesses, auditTrail, sendDiagnosticReport,
    setEditingReportId, setViewOnlyProcessId,
  } = useDiagnostic();
  const { accessToken, user: sessionUser, signOut } = useAuth();
  const { theme } = useTheme();
  const isMobile = useIsMobile();
  const router = useRouter();
  const navSearchParams = useSearchParams();
  // 'chat' | 'canvas' — only meaningful on mobile, where we hide
  // whichever surface isn't selected. Phase-1 stacked them vertically
  // which still felt cramped on phones; the toggle gives the user
  // 100% of the viewport for whichever they're focused on.
  const [mobileView, setMobileView] = useState('chat');

  /* ── Cloud chat persistence ── */
  const chatSessionIdRef = useRef(null);
  const sessionCreateInFlightRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = editingReportId ? `vesno_chat_session_${editingReportId}` : 'vesno_chat_session_active';
    try { chatSessionIdRef.current = localStorage.getItem(key) || null; } catch { /* ignore */ }
  }, [editingReportId]);

  /* ── Deal participants for the artefacts panel ── */
  // The artefacts panel shows mapped processes in scope, not just chat-
  // pinned objects. For a deal-scoped chat, each participant.report is a
  // "mapped process" and should surface here regardless of whether it
  // was mentioned in a chat message.
  const [dealParticipantsForArtefacts, setDealParticipantsForArtefacts] = useState([]);
  // Process name pulled from the deal record (deals.process_name) — used
  // as the second-level group in the artefacts tree.
  const [dealProcessName, setDealProcessName] = useState(null);
  useEffect(() => {
    if (!dealId || !accessToken) {
      setDealParticipantsForArtefacts([]);
      setDealProcessName(null);
      return;
    }
    let cancelled = false;
    apiFetch(`/api/deals/${dealId}`, { dedupe: false }, accessToken)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((dealData) => {
        if (cancelled) return;
        setDealParticipantsForArtefacts(Array.isArray(dealData?.participants) ? dealData.participants : []);
        setDealProcessName(dealData?.deal?.processName || null);
      });
    return () => { cancelled = true; };
  }, [dealId, accessToken]);

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
      } catch { /* ignore - icon just won't render */ }
    })();
    return () => { cancelled = true; };
  }, [accessToken]);

  const persistMessageToCloud = useCallback(async ({ role, content, actions, attachments: attachmentsArg, snapshot, artefact }) => {
    if (!accessToken) {
      if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
        console.warn('[chat-save] skipped - no accessToken (user not signed in)');
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
          kind: 'map',
          title: (snapshot?.processData?.processName || snapshot?.processName || processData.processName) || undefined,
          role,
          content: typeof content === 'string' ? content : String(content ?? ''),
          actions: actions || undefined,
          attachments: attachmentsArg && attachmentsArg.length
            ? attachmentsArg.map((a) => ({ name: a.name, type: a.type, size: a.content?.length || a.textContent?.length || 0 }))
            : undefined,
          processSnapshot,
          artefact: artefact || undefined,
        }),
      }, accessToken);
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        console.warn('[chat-save] failed', resp.status, errText);
        return;
      }
      const data = await resp.json().catch(() => null);
      if (artefact && process.env.NODE_ENV !== 'production') {
        if (data?.artefactId) console.info('[chat-save] artefact saved', { kind: artefact.kind, artefactId: data.artefactId });
        else console.warn('[chat-save] artefact sent but server returned no artefactId (migration chat_artefacts likely not applied)', { kind: artefact.kind });
      }
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
  }, [accessToken, editingReportId, processData]);

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
    // No session yet - create one carrying the snapshot so autosave
    // produces recoverable state before the first chat message is sent.
    if (sessionCreateInFlightRef.current) return;
    sessionCreateInFlightRef.current = true;
    try {
      const resp = await apiFetch('/api/chat-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId: editingReportId || undefined,
          kind: 'map',
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
  }, [accessToken, editingReportId, processData]);

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
  // Elapsed-seconds counter shown next to the spinner once a request
  // crosses 4 s. Helps the user see whether the response is still
  // making progress or has actually hung — without it, a 30 s wait
  // and a 30 ms wait look identical.
  const [chatElapsedSeconds, setChatElapsedSeconds] = useState(0);
  // Bump on every completed chat turn so the CreditsWidget re-fetches
  // /api/me/budget and the count drops live.
  const [creditsRefreshKey, setCreditsRefreshKey] = useState(0);
  const [chatAttachments, setChatAttachments] = useState([]);
  // Sticks for the session — picker hydrates from /api/me/models on mount.
  const [selectedModel, setSelectedModel] = useState(null);
  const [chatError, setChatError] = useState(null);
  const [chatDragOver, setChatDragOver] = useState(false);
  /** Shown while FileReader is loading selected files into the composer */
  const [readingChatFilesHint, setReadingChatFilesHint] = useState('');
  const [dragStepIdx, setDragStepIdx] = useState(null);
  const [dragOverStepIdx, setDragOverStepIdx] = useState(null);
  const [expandedStepIdx, setExpandedStepIdx] = useState(initialStepIdxProp ?? null);
  const [checklistInputs, setChecklistInputs] = useState({});
  const [showFloatingFlow, setShowFloatingFlow] = useState(false);
  // Track which artefact-tree groups are collapsed. Keys are namespaced
  // ("deal:<dealKey>" / "process:<dealKey>/<processKey>" /
  // "variant:<dealKey>/<processKey>/<variantKey>") so sibling group
  // names don't collide. Default = empty Set (everything expanded).
  const [collapsedArtefactKeys, setCollapsedArtefactKeys] = useState(() => new Set());
  const toggleArtefactKey = useCallback((key) => {
    setCollapsedArtefactKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);
  const [inlineGenerateStatus, setInlineGenerateStatus] = useState('idle'); // 'idle' | 'generating' | 'error'
  const [inlineGenerateProgress, setInlineGenerateProgress] = useState('');
  const [inlineGenerateError, setInlineGenerateError] = useState('');
  // Per-device archived-artefact set. We store ids in localStorage rather
  // than a server column so we can ship the action without a schema
  // migration; archive is a UI-only filter and unarchiving means clearing
  // this list. Keys are stable ids from sessionArtefacts: refId for
  // report / cost_analysis / deal_analysis, and `flow:<idx>` for snapshots.
  const [archivedArtefactIds, setArchivedArtefactIds] = useState(() => {
    if (typeof window === 'undefined') return new Set();
    try { return new Set(JSON.parse(localStorage.getItem('vesno_archived_artefacts') || '[]')); }
    catch { return new Set(); }
  });
  const archiveArtefact = useCallback((id) => {
    if (!id) return;
    setArchivedArtefactIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev); next.add(id);
      try { localStorage.setItem('vesno_archived_artefacts', JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  // URL -> deal context hydration. Used to live inside DealsRailButton,
  // but the rail button moved into the workspace's Deals tab so the
  // chat surface needs its own hook for ?deal=<id> survival across
  // refreshes / direct navigation.
  useEffect(() => {
    if (dealId || !accessToken) return;
    if (typeof window === 'undefined') return;
    const urlDealId = new URLSearchParams(window.location.search).get('deal');
    if (!urlDealId) return;
    let cancelled = false;
    apiFetch(`/api/deals/${encodeURIComponent(urlDealId)}`, {}, accessToken)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.deal) return;
        // Mirror the shape DealsRailButton.normaliseForContext used so
        // downstream consumers (DealContextChip, system prompt, etc.)
        // keep the same fields they expect.
        const d = data.deal;
        setDeal({
          dealId: d.id,
          dealCode: d.dealCode || null,
          dealName: d.name || null,
          dealRole: d.role || null,
          dealParticipants: data.participants || [],
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [accessToken, dealId, setDeal]);

  // (Per-device desktop-hint flags moved to the shared MobileViewGate
  // component — keys: vesno_mobile_view_acknowledged.)
  // Analytics is consolidated into the workspace Analysis tab; the rail
  // button now opens that view, so there is no separate analytics embed.

  // Workspace teams + functions — fetched once when the chat is scoped
  // to an operating model. Powers the step-inspector "Team" picker so a
  // step can be tagged with a model_role; selection writes step.roleId,
  // step.functionId (= role.function_ids[0]), and step.department
  // (= role.name) together, keeping function attribution accurate without
  // asking the user to think about three separate fields.
  const [workspaceTeams, setWorkspaceTeams] = useState([]); // [{ id, name, function_ids[] }]
  const [workspaceFunctions, setWorkspaceFunctions] = useState([]); // [{ id, name, parent_function_id }]
  useEffect(() => {
    if (!accessToken) {
      setWorkspaceTeams([]);
      setWorkspaceFunctions([]);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        // Resolve the model id: prefer the explicit anchor (set during
        // intake / mapping), fall back to the user's default model so
        // the swimlane toggle still has data when viewing a process via
        // ?view=<id> without an active workspace anchor.
        let modelId = selectedOperatingModelId;
        if (!modelId) {
          const meR = await apiFetch('/api/me/operating-model', {}, accessToken);
          const me = meR.ok ? await meR.json() : null;
          if (cancelled) return;
          modelId = me?.modelId || null;
        }
        if (!modelId) {
          setWorkspaceTeams([]);
          setWorkspaceFunctions([]);
          return;
        }
        const r = await apiFetch(`/api/operating-models/${modelId}`, {}, accessToken);
        const m = r.ok ? await r.json() : null;
        if (cancelled || !m) return;
        setWorkspaceTeams(Array.isArray(m.roles) ? m.roles : []);
        setWorkspaceFunctions(Array.isArray(m.functionsFlat) ? m.functionsFlat : []);
      } catch { /* silent — picker just shows nothing */ }
    })();
    return () => { cancelled = true; };
  }, [selectedOperatingModelId, accessToken]);

  // Refresh teams when chat-driven workspace mutations land (so a newly-
  // added role appears in the picker without a page reload).
  useEffect(() => {
    const onChange = () => {
      if (!selectedOperatingModelId || !accessToken) return;
      apiFetch(`/api/operating-models/${selectedOperatingModelId}`, {}, accessToken)
        .then((r) => (r.ok ? r.json() : null))
        .then((m) => { if (m) setWorkspaceTeams(Array.isArray(m.roles) ? m.roles : []); })
        .catch(() => {});
    };
    window.addEventListener('vesno:workspace-changed', onChange);
    return () => window.removeEventListener('vesno:workspace-changed', onChange);
  }, [selectedOperatingModelId, accessToken]);

  // Mobile-only: when AnalyticsRailButton dispatches the event we mount
  // the analytics embed inline in the canvas column. Tapping the Chat
  // tab still hides it (data-mobile-view selectors), tapping the close
  // button clears it.
  const [workspaceCanvasOpen, setWorkspaceCanvasOpen] = useState(false);
  // Canvas overlay state - DELIBERATELY independent of the chat
  // context's dealId / selectedOperatingModelId. Earlier these were
  // derived from context as a fallback, but that meant every setDeal /
  // setWorkspaceAnchors triggered a re-derivation of the overlay's
  // selection, which felt like the canvas was being "overridden"
  // whenever the user picked a deal (since picking a deal also pushes
  // it into chat context, which fed back into the overlay derivation).
  // Now the overlay owns its selection outright; chat-context updates
  // are one-way (overlay → chat), never the reverse.
  //
  // When the overlay first opens, it seeds from chat scope so the user
  // doesn't have to re-pick what's already in scope (effect below).
  const [canvasScope, setCanvasScope]     = useState('deals');
  const [canvasDealId, setCanvasDealId]   = useState(null);
  const [canvasModelId, setCanvasModelId] = useState(null);
  // Picker row stash: lets DealWorkspaceClient render its shell with
  // name + type + status immediately, instead of a "Loading…" flash
  // while /api/deals/[id] resolves. The full payload (participants +
  // flows) overwrites this once the fetch returns.
  const [canvasDealSeed, setCanvasDealSeed] = useState(null);
  const effectiveCanvasScope    = canvasScope;
  const effectiveCanvasDealId   = canvasDealId;
  const effectiveCanvasModelId  = canvasModelId;
  // Seed the overlay's selection from chat scope the first time it
  // opens. After that, overlay state is owned by the overlay and the
  // chat context can change without affecting it.
  const overlaySeededRef = useRef(false);
  // When true, the helpers (addStep / removeStep / moveStep / …) skip
  // their own changes-row writes because processActions records the
  // whole agent turn in one batch at the end. Without this guard, every
  // agent-emitted add_step would dual-record (once from the helper,
  // once from the batch). User-direct UI clicks happen with this flag
  // false, so the helpers attribute the row to the user.
  const inAgentTurnRef = useRef(false);
  useEffect(() => {
    const onOpenWorkspace = (e) => {
      setWorkspaceCanvasOpen(true);
      setMobileView('canvas');
      // Honour an explicit `scope` from the dispatch (e.g. the /workspace
      // shell pins 'standard'). Re-seed on every standard request so a
      // user landing at /workspace always sees the model surface even
      // after they previously navigated into a deal.
      const hint = e?.detail?.scope || null;
      if (hint === 'standard') {
        overlaySeededRef.current = true;
        setCanvasScope('standard');
        const mid = e?.detail?.modelId || selectedOperatingModelId;
        if (mid) setCanvasModelId(mid);
        return;
      }
      if (hint === 'deals') {
        overlaySeededRef.current = true;
        setCanvasScope('deals');
        const did = e?.detail?.dealId || dealId;
        if (did) setCanvasDealId(did);
        return;
      }
      if (hint === 'outputs') {
        // Rail Artefacts slider routed a generated artefact here. The
        // Outputs tab resolves its own model + honours the pending
        // selection (window.__vesnoPendingOutputArtefact) on mount.
        overlaySeededRef.current = true;
        setCanvasScope('outputs');
        return;
      }
      if (!overlaySeededRef.current) {
        overlaySeededRef.current = true;
        if (dealId) {
          setCanvasScope('deals');
          setCanvasDealId(dealId);
        } else if (selectedOperatingModelId) {
          setCanvasScope('standard');
          setCanvasModelId(selectedOperatingModelId);
        } else {
          setCanvasScope('deals');
        }
      }
    };
    window.addEventListener('vesno:open-workspace', onOpenWorkspace);
    return () => window.removeEventListener('vesno:open-workspace', onOpenWorkspace);
  }, [dealId, selectedOperatingModelId]);
  const [artefactPreview, setArtefactPreview] = useState(null); // flow_snapshot viewer payload
  const [hasCostAccess, setHasCostAccess] = useState(false);
  const [snippets, setSnippets] = useState(() => { try { return loadSnippets(null); } catch { return []; } });
  const [showSnippetPicker, setShowSnippetPicker] = useState(false);
  const [previewViewMode, setPreviewViewMode] = useState('grid');
  // Swimlane lane-grouping mode: 'role' | 'subfunction' | 'function'.
  // Only consulted when previewViewMode === 'swimlane'. Persisted across
  // sessions so the user's preferred grouping survives a reload.
  const [swimlaneBy, setSwimlaneBy] = useState(() => {
    if (typeof window === 'undefined') return 'role';
    const v = window.localStorage.getItem('vesno_swimlane_by');
    return v === 'subfunction' || v === 'function' ? v : 'role';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { window.localStorage.setItem('vesno_swimlane_by', swimlaneBy); } catch { /* ignore */ }
  }, [swimlaneBy]);
  const [flowNodePositions, setFlowNodePositions] = useState(() => processData.flowNodePositions || {});
  const [flowCustomEdges, setFlowCustomEdges] = useState(() => processData.flowCustomEdges || []);
  const [flowDeletedEdges, setFlowDeletedEdges] = useState(() => processData.flowDeletedEdges || []);

  /* ═══════ Chat history panel ═══════ */
  const [showChatHistory, setShowChatHistory] = useState(false);
  const [showArtefactsPanel, setShowArtefactsPanel] = useState(false);

  /* ═══════ Rail slide-in anchors ═══════
     Steps / Artefacts / Activity log open as slide-in panels (same UX as
     Reports). The refs anchor the panel to the rail's right edge — only
     one rail (with-flow OR no-flow) renders at a time, so a single ref
     per panel is sufficient. */
  const stepsBtnRef = useRef(null);
  const artefactsBtnRef = useRef(null);
  const activityBtnRef = useRef(null);

  /* Ref for first-paint context inside the one-shot chat seeding effect */
  const chatSeedCtxRef = useRef(null);
  // Resolve which company the current user is mapping for: match their email
  // against deal_participants — if they're a participant, use that company.
  const myEmail = (sessionUser?.email || '').toLowerCase();
  const myDealCompany = (dealParticipants || []).find(
    (p) => (p.participant_email || p.participantEmail || '').toLowerCase() === myEmail,
  )?.company_name || (dealParticipants || []).find(
    (p) => (p.participant_email || p.participantEmail || '').toLowerCase() === myEmail,
  )?.companyName || null;

  chatSeedCtxRef.current = { processData, moduleId, dealCanonicalProcessName, dealName, dealRole, chatMessages, myDealCompany };

  /* ═══════ Real-time flow presence ═══════
     Subscribes to the Supabase Realtime channel keyed on the active
     flow scope. Other authenticated users on the same scope appear in
     the FlowPresenceBar below the deal context chip. Soft presence —
     no locks; collisions just become visible. */
  const myParticipantId = (dealParticipants || []).find(
    (p) => (p.participant_email || p.participantEmail || '').toLowerCase() === myEmail,
  )?.id || null;
  const { peers: presencePeers } = useFlowPresence({
    user: sessionUser ? { email: sessionUser.email, name: sessionUser.name } : null,
    dealId: dealId || null,
    participantId: myParticipantId,
    reportId: !dealId ? (editingReportId || null) : null,
    // The currently-edited step is the one expanded in the inspector
    // (or null when no step is selected). Peers see "editing step N"
    // and the bar highlights collisions when two users are on the
    // same step.
    currentlyEditingStep: typeof expandedStepIdx === 'number' && expandedStepIdx >= 0
      ? expandedStepIdx + 1
      : null,
    enabled: !!sessionUser?.email,
  });

  /* ═══════ Walkthrough — first-visit only, re-openable via rail ═══════ */
  const GUIDE_SEEN_KEY = 'workflow-walkthrough-seen-v1';
  const [showGuide, setShowGuide] = useState(false);
  const dismissGuide = useCallback(() => {
    setShowGuide(false);
    try { window.localStorage.setItem(GUIDE_SEEN_KEY, '1'); } catch { /* ignore */ }
  }, []);
  // Replay handler exposed to the rail's help icon.
  const replayGuide = useCallback(() => setShowGuide(true), []);
  // Have they seen it before? Only auto-open on the FIRST chat-workspace
  // load this device has ever had. After that, the user opens it via
  // the rail's "Replay walkthrough" icon — never automatically.
  const guideSeenRef = useRef(false);
  // Per-mount guard: even within a single page-load, the seed effect's
  // multiple branches must never auto-open the guide more than once.
  // Without this, restoring a session + a stale state both fire
  // maybeAutoShowGuide and the modal flickers up on re-render.
  const guideAutoOpenedRef = useRef(false);
  useEffect(() => {
    try { guideSeenRef.current = window.localStorage.getItem(GUIDE_SEEN_KEY) === '1'; } catch { /* ignore */ }
  }, []);
  // Convenience: only call setShowGuide(true) automatically if not yet
  // seen AND this mount hasn't already opened it.
  const maybeAutoShowGuide = useCallback(() => {
    if (guideSeenRef.current) return;
    if (guideAutoOpenedRef.current) return;
    guideAutoOpenedRef.current = true;
    setShowGuide(true);
  }, []);

  /* ═══════ Layout state (floating panels) ═══════ */
  const [floatingPanel, setFloatingPanel] = useState(null); // null | 'steps' | 'chat'

  const SPLIT_CHAT_WIDTH_KEY = 'workflow-s7-map-split-chat-w';
  const [splitChatWidthPx, setSplitChatWidthPx] = useState(() => {
    if (typeof window === 'undefined') return 360;
    const v = parseInt(window.localStorage.getItem(SPLIT_CHAT_WIDTH_KEY) || '', 10);
    return Number.isFinite(v) && v >= 260 && v <= 640 ? v : 360;
  });
  const splitAreaRef = useRef(null);

  const SEGMENT_CHIPS = [
    { name: 'Scaling Business', segmentId: 'scaling', tagline: 'Growing fast, processes breaking' },
    { name: 'M&A Integration', segmentId: 'ma', tagline: 'Day 1 baseline, integration clarity' },
    { name: 'Private Equity', segmentId: 'pe', tagline: 'Acquisition baseline to exit-ready' },
    { name: 'High Risk Ops', segmentId: 'high-risk-ops', tagline: 'Compliance gaps, key-person risk' },
  ];

  const buildOpeningMessage = ({ mid, dName, dRole, canonical, processName, stepCount, viewOnlyProcessId: voPid }) => {
    // Canvas already shows a flow → acknowledge it and offer help on it,
    // instead of treating the user as a first-time mapper.
    if (stepCount > 0 && processName) {
      if (voPid) {
        return `"${processName}" is on the canvas (${stepCount} step${stepCount === 1 ? '' : 's'}). Ask me anything about it: who owns each step, where the bottlenecks are, end-to-end timing, what I'd change. If you want to make changes, just tell me what to change and I'll switch into edit mode.`;
      }
      return `"${processName}" is on the canvas (${stepCount} step${stepCount === 1 ? '' : 's'}). Ask me anything about it, or tell me what to change. I can refine steps, retime work/wait, redraw handoffs, propose a redesign, or estimate cost.`;
    }
    if (processName) {
      return `Hi, I'm Reina! Let's map "${processName}" together. What's the very first thing that happens? What triggers it, and who kicks it off?`;
    }
    const isPE = mid === 'pe';
    const isPort = dRole === 'portfolio_company';
    const isPlat = dRole === 'platform_company';
    if (isPE && dName) {
      if (isPlat) return `Your roll-up "${dName}" is set up.\n\nWhich process are you mapping first? Tell me the name, then describe the first step - what triggers it and who kicks it off?`;
      if (isPort && canonical) return `Welcome! You're mapping the "${canonical}" process for the roll-up "${dName}".\n\nWhat's the very first step - what triggers it, and who kicks it off?`;
      return `Hi, I'm Reina! Let's map your processes for "${dName}".\n\nWhat process are you focusing on, and what's the first step?`;
    }
    return `Hi, I'm Reina! Let's map your process.\n\nWhat's the name of this process, and what's the very first thing that happens - what triggers it, and who kicks it off?`;
  };

  // On first arrival with no steps: seed Reina's opening message (no guided prompt questionnaire)
  const hasSeededChatRef = useRef(false);
  useEffect(() => {
    if (hasSeededChatRef.current) return;

    const { processData: pd, moduleId: mid, dealCanonicalProcessName: canonical, dealName: dName, dealRole: dRole, chatMessages: ctxMsgs, myDealCompany: myCo } = chatSeedCtxRef.current;
    const processName = pd?.processName?.trim() || canonical?.trim() || '';

    // First-load alignment with the Home button: when there's no real
    // conversation (no user turn) AND no URL param explicitly scoping
    // the chat to a deal / report / module, we treat the persisted
    // state as stale and seed the same four-pillar intro the Home
    // button shows. Without this, a returning user lands on whatever
    // moduleId / dealName was saved last time, which produces a
    // different intro than they'd see clicking Home.
    const hasUrlScope = (() => {
      if (typeof window === 'undefined') return false;
      const sp = new URLSearchParams(window.location.search);
      return !!(sp.get('deal') || sp.get('chatSession') || sp.get('edit')
        || sp.get('reaudit') || sp.get('editAnalysis') || sp.get('editFromDeal')
        || sp.get('focusFinding'));
    })();

    // Steps already on the canvas → don't seed a fresh "let's map" intro
    // unless the persisted greeting is a stale edit-mode opener that no
    // longer matches the URL state. In that case, wipe the stale messages
    // and fall through so a canvas-aware greeting gets seeded below.
    const looksStaleEdit = ctxMsgs.length > 0
      && ctxMsgs.every((m) => m.role === 'assistant')
      && ctxMsgs.some((m) => /you'?re editing/i.test(String(m.content || '')))
      && !hasUrlScope;
    if (initialSteps.length > 0) {
      if (!looksStaleEdit) return;
      setChatMessages([]);
      // fall through to seed a canvas-aware greeting
    }
    // Helper: nuke the stale persistence keys that DiagnosticClient's
    // pre-report hydrate effect (lib/.../DiagnosticClient.jsx ~line
    // 1205) reads after this seed runs. Without this, the hydrate
    // effect refetches the previous chat session async and overwrites
    // our fresh seeded chips, producing the "chips load then vanish"
    // flicker the user reported.
    const wipeStalePersistence = () => {
      if (typeof window === 'undefined') return;
      try {
        window.localStorage.removeItem('vesno_chat_session_active');
        window.localStorage.removeItem('processDiagnosticProgress');
        for (let i = window.localStorage.length - 1; i >= 0; i--) {
          const k = window.localStorage.key(i);
          if (k && k.startsWith('vesno_chat_session_')) window.localStorage.removeItem(k);
        }
      } catch {}
    };
    let mutableMid = mid;
    let mutableDealId = dealId;
    let mutableDName = dName;
    let mutableDRole = dRole;
    let mutableCanonical = canonical;
    let mutableProcessName = processName;
    let mutableMyCo = myCo;
    if (ctxMsgs.length > 0) {
      // Heuristic: if every persisted message is from the assistant (no user
      // turns yet), this is a stale opener leaking from localStorage. Drop
      // it so the pillar / deal-aware intro can re-seed for the current
      // scope. Real conversations always have at least one user turn.
      const hasUserTurn = ctxMsgs.some((m) => m.role === 'user');
      if (!hasUserTurn) {
        setChatMessages([]);
        // No user turn AND no URL scope → fully reset to a fresh chat,
        // matching what the Home button produces. Also wipe the stale
        // persistence keys so DiagnosticClient's async hydrate effect
        // doesn't refetch and overwrite our seed.
        if (!hasUrlScope) {
          mutableMid = null;
          mutableDealId = null;
          mutableDName = null;
          mutableDRole = null;
          mutableCanonical = null;
          mutableProcessName = '';
          mutableMyCo = null;
          wipeStalePersistence();
        }
        // fall through — let the seed below run
      } else {
        hasSeededChatRef.current = true;
        if (!editingReportId) maybeAutoShowGuide();
        return;
      }
    } else if (!hasUrlScope) {
      // Empty chat history AND no URL scope = blank canvas → show the
      // canonical intro every time, ignoring stale localStorage scope.
      mutableMid = null;
      mutableDealId = null;
      mutableDName = null;
      mutableDRole = null;
      mutableCanonical = null;
      mutableProcessName = '';
      mutableMyCo = null;
      wipeStalePersistence();
    }

    hasSeededChatRef.current = true;

    if (mutableDealId && !mutableMid && !mutableProcessName) {
      // Deal-scoped chat with no module / no map yet — seed a deal-aware
      // opener with one-click action chips. Don't show pillars: the user
      // has already chosen a scope by picking the deal.
      addChatMessage({
        role: 'assistant',
        content:
          (mutableMyCo
            ? `I'm scoped to **${mutableDName || 'this deal'}** — and you're mapping for **${mutableMyCo}**. Pick something to get started — or just ask me anything about the deal:`
            : `I'm scoped to **${mutableDName || 'this deal'}**. Pick something to get started — or just ask me anything about the deal:`),
        chips: [
          { name: 'Summarise the data room',     tagline: 'Top-line read of every document' },
          { name: 'Run a diligence analysis',    tagline: 'Findings, red flags, Day-1 / TSA / Separation' },
          { name: 'Show me the latest findings', tagline: 'Approve, reject, edit, or add notes' },
          { name: 'List the data room',          tagline: 'See what is uploaded — open & cite docs' },
          { name: 'Who is on this deal?',        tagline: 'Participants, roles, completion status' },
          { name: 'What is missing?',            tagline: 'Suggest documents we should still upload' },
        ],
      });
    } else if (!mutableMid && !mutableDName) {
      // No segment selected yet - introduce Reina and ask which situation fits
      addChatMessage({
        role: 'assistant',
        content: `Hi, I'm Reina — I help you design and run your operating model.\n\nDescribe any process in plain language and I'll build the flow for you in real time: steps, handoffs, decision branches, timings, and systems. You can also drop in docs, spreadsheets, screenshots, or diagrams and I'll extract the process from them.\n\nOnce it's in your model, I'll spot bottlenecks, estimate cost, and propose a redesigned target you can promote when ready. Every change lands in your workspace timeline so you can see what shipped and what moved.\n\nTo frame the conversation, which best describes you?`,
        chips: SEGMENT_CHIPS,
      });
      if (!editingReportId) maybeAutoShowGuide();
    } else {
      addChatMessage({ role: 'assistant', content: buildOpeningMessage({ mid: mutableMid, dName: mutableDName, dRole: mutableDRole, canonical: mutableCanonical, processName: mutableProcessName, stepCount: initialSteps.length, viewOnlyProcessId }) });
      if (!editingReportId) maybeAutoShowGuide();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Agent-driven intro replacement ────────────────────────────────
  // When the user is anchored to a deal or operating model and no
  // specific process is open, fetch Reina's data-driven opening from
  // /api/chat/intro and replace the static seed greeting. Runs once per
  // anchor change. Soft-fail: if the intro endpoint is unreachable we
  // leave the static greeting in place so the chat is still usable.
  //
  // Model resolution: prefer the explicit Standard-tab pick
  // (selectedOperatingModelId); fall back to /api/me/operating-model
  // for the user's default — that's the common path for a fresh chat
  // with no explicit pick. Self-contained so it doesn't depend on the
  // workspace probe further down in this file.
  const agentIntroRef = useRef({ dealId: null, modelId: null });
  const chatMessagesRef = useRef(chatMessages);
  useEffect(() => { chatMessagesRef.current = chatMessages; }, [chatMessages]);
  useEffect(() => {
    if (!sessionUser || !accessToken) return;
    if (editingReportId || viewOnlyProcessId) return;
    const activeDeal = dealId || null;
    let cancelled = false;
    (async () => {
      let activeModel = activeDeal ? null : (selectedOperatingModelId || null);
      // No explicit Standard pick — resolve the user's default model.
      if (!activeDeal && !activeModel) {
        try {
          const meR = await apiFetch('/api/me/operating-model', {}, accessToken);
          if (cancelled) return;
          const me = meR.ok ? await meR.json() : null;
          activeModel = me?.modelId || null;
        } catch { /* fall through — no model */ }
      }
      if (!activeDeal && !activeModel) return;
      if (agentIntroRef.current.dealId === activeDeal && agentIntroRef.current.modelId === activeModel) return;
      agentIntroRef.current = { dealId: activeDeal, modelId: activeModel };

      try {
        const qs = activeDeal ? `dealId=${encodeURIComponent(activeDeal)}` : `modelId=${encodeURIComponent(activeModel)}`;
        const r = await apiFetch(`/api/chat/intro?${qs}`, {}, accessToken);
        if (!r.ok || cancelled) return;
        const { intro } = await r.json();
        if (!intro || cancelled) return;
        // Replace the first assistant greeting with the agent intro.
        // setChatMessages is a useReducer dispatcher (not a React
        // setter), so we MUST pass an array, not a functional updater.
        // Read the current array from chatMessagesRef to avoid the
        // race window between this async block resolving and the
        // current closure's stale snapshot.
        const list = Array.isArray(chatMessagesRef.current) ? chatMessagesRef.current : [];
        if (list.length === 0) {
          setChatMessages([{ role: 'assistant', content: intro }]);
        } else {
          const firstIdx = list.findIndex((m) => m.role === 'assistant');
          if (firstIdx === -1) {
            setChatMessages([{ role: 'assistant', content: intro }, ...list]);
          } else {
            const next = [...list];
            // Drop chips from the seed greeting — the agent intro is
            // markdown text and the chips don't match the new framing.
            next[firstIdx] = { ...next[firstIdx], content: intro, chips: undefined };
            setChatMessages(next);
          }
        }
      } catch { /* swallow — static greeting stays */ }
    })();
    return () => { cancelled = true; };
  }, [sessionUser, accessToken, dealId, selectedOperatingModelId, editingReportId, viewOnlyProcessId, setChatMessages]);

  // ── Workspace probe ───────────────────────────────────────────────
  // Two distinct truths to track: does the user have a model at all
  // (workspace mode vs. trial mode), and does that model have any
  // functions yet (function chips vs. no-functions empty state).
  // The chip-swap logic uses both — pillars only stay for users who
  // genuinely don't have a workspace.
  const [workspaceProbe, setWorkspaceProbe] = useState(null); // null=loading, { hasModel, modelId, functions }
  useEffect(() => {
    if (!sessionUser || !accessToken) { setWorkspaceProbe({ hasModel: false, functions: [] }); return; }
    let cancelled = false;
    (async () => {
      try {
        const meR = await apiFetch('/api/me/operating-model', {}, accessToken);
        const me = meR.ok ? await meR.json() : null;
        if (cancelled) return;
        if (!me?.modelId) { setWorkspaceProbe({ hasModel: false, functions: [] }); return; }
        const mR = await apiFetch(`/api/operating-models/${me.modelId}`, {}, accessToken);
        const m = mR.ok ? await mR.json() : null;
        if (cancelled) return;
        setWorkspaceProbe({
          hasModel: true,
          modelId: me.modelId,
          functions: Array.isArray(m?.functionsFlat) ? m.functionsFlat : [],
        });
      } catch { if (!cancelled) setWorkspaceProbe({ hasModel: false, functions: [] }); }
    })();
    return () => { cancelled = true; };
  }, [sessionUser, accessToken]);
  const workspaceCaps = workspaceProbe?.functions || [];

  // Path-prefixed labels for nested functions ("Finance / AR / Cash collection").
  // Centralised so the chip swap and the click-handler share one definition.
  const capabilityPathFor = useCallback((funcId) => {
    if (!Array.isArray(workspaceCaps) || !workspaceCaps.length) return '';
    const byId = new Map(workspaceCaps.map((c) => [c.id, c]));
    const walk = (id, seen = new Set()) => {
      const c = byId.get(id);
      if (!c || seen.has(id)) return [];
      seen.add(id);
      if (!c.parent_function_id) return [c.name];
      return [...walk(c.parent_function_id, seen), c.name];
    };
    return walk(funcId).join(' / ');
  }, [workspaceCaps]);

  // Post-process: once the workspace probe lands, replace the seeded
  // pillar chips. Two cases:
  //   1. Model has functions → function chips (file on click)
  //   2. Model has no functions yet → drop chips entirely + change
  //      the copy so the user just describes their process and we file
  //      under a default later (or they file from /workspace).
  // Only runs when the chat has a single seeded assistant message with
  // pillar chips — leaves real conversations alone.
  // setChatMessages is a wrapper around dispatch that takes a value, NOT
  // a (prev) => next updater function — passing a function would store
  // the function and break the .map() call downstream. Read the current
  // chatMessages from the closure, decide based on current state, and
  // dispatch a new array. Includes a swappedRef guard so re-runs from
  // workspaceProbe / chatMessages changes don't cycle.
  const swappedChipsRef = useRef(false);
  useEffect(() => {
    if (swappedChipsRef.current) return;
    if (!workspaceProbe?.hasModel) return;
    if (dealId || editingReportId) return;
    if (!Array.isArray(chatMessages) || chatMessages.length !== 1) return;
    const m = chatMessages[0];
    if (m.role !== 'assistant' || !Array.isArray(m.chips) || m.chips.length === 0) return;
    if (!m.chips.some((c) => c.segmentId)) return;

    let next;
    if (workspaceCaps.length > 0) {
      const newChips = workspaceCaps.slice(0, 8).map((c) => {
        const path = capabilityPathFor(c.id);
        const parentPath = path.includes(' / ') ? path.split(' / ').slice(0, -1).join(' / ') : '';
        return {
          name: c.name,
          tagline: parentPath
            || (c.layer === 'enabling' ? 'Enabling' : c.layer === 'governance' ? 'Governance' : 'Value chain'),
          functionId: c.id,
        };
      });
      const newContent = m.content.replace(
        /To frame the conversation, which best describes you\?$/,
        "Pick a function to file this process under, or just describe what you're mapping — I'll suggest one as we go.",
      );
      next = [{ ...m, content: newContent, chips: newChips }];
    } else {
      const noCapContent = m.content.replace(
        /To frame the conversation, which best describes you\?$/,
        "Describe a process below to start mapping. You can file it under a function later from the workspace — open it via the link in the top bar.",
      );
      next = [{ ...m, content: noCapContent, chips: [] }];
    }

    swappedChipsRef.current = true;
    setChatMessages(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceProbe, chatMessages, dealId, editingReportId]);

  const MODULE_LABELS = { scaling: 'Scaling Business', ma: 'M&A Integration', pe: 'Private Equity', 'high-risk-ops': 'High Risk Ops' };
  const BOTTLENECK_LABELS = { waiting: 'Waiting time', approvals: 'Approval bottlenecks', 'manual-work': 'Manual work', handoffs: 'Handoff issues', systems: 'System issues', rework: 'Rework / errors' };

  const handleLoadReport = useCallback((report) => {
    const dd = report.diagnosticData || {};
    const raw = (report.rawProcesses || dd.rawProcesses || [])[0] || {};
    const processName = raw.processName || report.contactName || 'Untitled process';
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

  const handleSegmentChip = useCallback((segmentId, label) => {
    setModuleId(segmentId);
    updateProcessData({ segment: segmentId });
    addChatMessage({ role: 'user', content: label });
    // Both PE roll-up and M&A run on the same deal-scoped chat surface.
    // Collect minimal deal setup in-chat before the opening question so
    // the deal context chip can mount and the user gets the workspace
    // (data room, participants, findings) right away.
    if ((segmentId === 'pe' || segmentId === 'ma') && !dealId) {
      const knownCompany = (authUser?.company || '').trim();
      // Use the real company name when we have it; the form's owner
      // field will be prefilled with this. When we don't, pass the
      // placeholder so the form recognises it (`/^your (platform )?
      // company$/i`) and starts the field empty for the user to type.
      const ownerCompany = knownCompany
        || (segmentId === 'ma' ? 'your company' : 'your platform company');
      const intro = segmentId === 'ma'
        ? (knownCompany
            ? `Great — let's set up the M&A. I'll create a deal with **${knownCompany}** as the acquirer and one target company to start (you can add more participants later).`
            : `Great — let's set up the M&A. Tell me the acquirer and the target company below; I'll create the deal so you can add documents and findings as we go.`)
        : (knownCompany
            ? `Great — let's set up your roll-up. I'll create a deal for **${knownCompany}** and one portfolio company to start (you can invite more later).`
            : `Great — let's set up your roll-up. Tell me the platform company and a first portfolio company below; we can invite more later.`);
      addChatMessage({
        role: 'assistant',
        content: intro,
        dealSetup: {
          platformCompany: ownerCompany,
          dealKind: segmentId,
        },
      });
    } else {
      const opening = buildOpeningMessage({ mid: segmentId, dName: null, dRole: null, canonical: null, processName: null });
      addChatMessage({ role: 'assistant', content: opening });
    }
    // The walkthrough only auto-opens on the very first chat-workspace
    // load (handled by the seed effect's maybeAutoShowGuide). Picking
    // a segment chip is NOT a fresh load — don't reopen it here. The
    // user can replay it any time via the rail's "Replay walkthrough"
    // icon.
  }, [setModuleId, updateProcessData, addChatMessage, editingReportId, dealId, authUser]); // eslint-disable-line react-hooks/exhaustive-deps

  // Capability-chip click handler. Mirrors handleSegmentChip but instead
  // of setting moduleId/segment, it stashes the function anchor so
  // sendDiagnosticReport files the new process under the picked
  // function on insert. The agent runs in pillar-less "neutral" mode
  // — its system prompt picks up the function path via the
  // <workspace_context> block (Phase 5 plumbing).
  const handleCapabilityChip = useCallback((funcId, label) => {
    const path = capabilityPathFor(funcId) || label;
    setWorkspaceAnchors({ functionId: funcId, functionPath: path });
    addChatMessage({ role: 'user', content: label });
    addChatMessage({
      role: 'assistant',
      content: `Great — we'll file this under **${path}**. Describe the process in plain language: who does what, in what order, and where things wait or need approval. You can also drop in a doc, spreadsheet, screenshot, or diagram and I'll extract the steps.`,
    });
  }, [capabilityPathFor, setWorkspaceAnchors, addChatMessage]);

  /* ── In-chat deal setup submission (PE roll-up + M&A) ── */
  const handleDealSetupSubmit = useCallback(async ({ dealName: name, targetCompany, platformCompany, ownerEmail, targetEmail, dealKind = 'pe' }) => {
    if (!accessToken) {
      addChatMessage({ role: 'assistant', content: 'You need to be signed in to create a deal. [Sign in](/signin?returnTo=%2Fprocess-audit)' });
      return { error: 'not signed in' };
    }
    // Map the kind onto the deal API's `type` and the right pair of
    // participant roles. The API treats both deal types the same way
    // downstream (data room, findings, redesigns); this mapping just
    // controls the labels and the role each participant occupies.
    const isMA = dealKind === 'ma';
    const dealType = isMA ? 'ma' : 'pe_rollup';
    const ownerRole = isMA ? 'acquirer' : 'platform_company';
    const counterpartRole = isMA ? 'target' : 'portfolio_company';
    const counterpartLabel = isMA ? 'Target' : 'Portfolio';
    const segmentForState = isMA ? 'ma' : 'pe';
    try {
      const resp = await apiFetch('/api/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: dealType,
          name,
          participants: [
            { role: ownerRole, companyName: platformCompany, ...(ownerEmail ? { participantEmail: ownerEmail } : {}) },
            { role: counterpartRole, companyName: targetCompany, ...(targetEmail ? { participantEmail: targetEmail } : {}) },
          ],
        }),
      }, accessToken);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || 'Failed to create deal');
      const d = data.deal;
      setDeal({
        dealId: d.id,
        dealCode: d.dealCode,
        dealRole: ownerRole,
        dealName: d.name,
        dealParticipants: data.participants || [],
        canonicalProcessName: d.processName || null,
      });
      updateProcessData({ dealCode: d.dealCode, segment: segmentForState });
      addChatMessage({ role: 'user', content: `Deal "${name}" · ${counterpartLabel}: ${targetCompany}` });
      addChatMessage({
        role: 'assistant',
        content: buildOpeningMessage({ mid: segmentForState, dName: d.name, dRole: ownerRole, canonical: null, processName: null }),
      });
      return { ok: true };
    } catch (err) {
      return { error: err.message || 'Something went wrong.' };
    }
  }, [accessToken, addChatMessage, setDeal, updateProcessData]); // eslint-disable-line react-hooks/exhaustive-deps

  const [detailTab, setDetailTab] = useState('type'); // active tab in node inspector

  const focusNameRef = useRef({});
  const chatEndRef = useRef(null);
  const chatFileRef = useRef(null);
  const chatTextareaRef = useRef(null);
  const lastFailedChatPayloadRef = useRef(null);
  const chatAbortRef = useRef(null);
  const chatHistoryStackRef = useRef([]); // Undo stack for chat-applied mutations
  const previewCanvasRef = useRef(null);
  const stepsSyncTimerRef = useRef(null);
  const stepsSyncMountedRef = useRef(false);
  // Refs hold the LATEST canvas edge state synchronously - no stale closures
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
      return; // skip initial mount - no change yet
    }
    clearTimeout(stepsSyncTimerRef.current);
    stepsSyncTimerRef.current = setTimeout(() => {
      updateProcessData({ steps, handoffs });
    }, 350);
    return () => clearTimeout(stepsSyncTimerRef.current);
  }, [steps, handoffs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Workspace snapshot sync - fires whenever steps/handoffs/flow canvas
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

  // Fire-and-forget changes-row write for a direct user mutation. The
  // agent-turn guard suppresses recording when this helper is reached
  // via processActions (which records the whole turn in one batch).
  const recordUserCanvasChange = useCallback((kind, subjectRef) => {
    if (inAgentTurnRef.current || !editingReportId) return;
    const actorEmail = contact?.email || authUser?.email || null;
    (async () => {
      try {
        const { recordChanges } = await import('@/lib/changes/repo');
        await recordChanges([{
          process_id: editingReportId,
          subject_type: 'process_step',
          subject_ref: subjectRef || {},
          kind,
          state: 'applied',
          actor_kind: 'user',
          actor_email: actorEmail,
          agent_name: null,
        }]);
      } catch { /* fire-and-forget */ }
    })();
  }, [editingReportId, contact?.email, authUser?.email]);

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
    recordUserCanvasChange('added', { position: finalPos, ...(init.name ? { stepName: init.name } : {}) });
  }, [addAuditEvent, recordUserCanvasChange]);

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
    recordUserCanvasChange('removed', { stepNumber: idx + 1, ...(removedName ? { stepName: removedName } : {}) });
  }, [addAuditEvent, recordUserCanvasChange]);

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
    recordUserCanvasChange('reordered', { fromPosition: fromIdx + 1, toPosition: toIdx + 1, ...(movedName ? { stepName: movedName } : {}) });
  }, [addAuditEvent, recordUserCanvasChange]);

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
        // NOT be bumped - it now correctly points to the new node.
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

  const runInlineGenerate = useCallback(async (pd) => {
    setInlineGenerateStatus('generating');
    setInlineGenerateProgress('Saving…');
    setInlineGenerateError('');
    try {
      const processes = (completedProcesses && completedProcesses.length > 0) ? completedProcesses : [pd];
      const effectiveEmail = contact?.email || authUser?.email || sessionUser?.email;
      const effectiveContact = {
        name: contact?.name || authUser?.name || sessionUser?.user_metadata?.full_name || sessionUser?.email || '',
        email: effectiveEmail || '',
        company: contact?.company || '',
        title: contact?.title || '',
        industry: contact?.industry || '',
        teamSize: contact?.teamSize || '',
        segment: moduleId || pd?.segment || '',
      };
      if (!effectiveContact.email) {
        throw new Error('Contact email is required to save this process.');
      }
      const out = await generateReportInline(
        {
          processes,
          contact: effectiveContact,
          moduleId: moduleId || pd?.segment || '',
          editingReportId,
          customDepartments,
          auditTrail,
          authUser,
          sessionUser,
          accessToken,
          // Pass deal scope so the save endpoint can auto-link the canvas
          // to the signed-in user's participant on this deal. Linking only
          // attaches process_id; it does not flip any status to 'complete'
          // (participants keep editing on the canvas in the living model).
          dealId: dealId || null,
        },
        {
          sendDiagnosticReport,
          onProgress: (msg) => setInlineGenerateProgress(msg),
        },
      );
      if (!out.reportId) {
        throw new Error('Save failed. Please try again.');
      }
      if (!out.storedInSupabase) {
        const detail = out.supabaseError ? ` (${out.supabaseError})` : '';
        throw new Error(`Couldn't save the process${detail}. Please try again.`);
      }
      // Living-workspace contract: once the row exists, the canvas is
      // the live row — flip editingReportId so subsequent edits PATCH
      // the same row, not create a new one. No "report ready" artefact;
      // the canvas IS the artefact.
      if (setEditingReportId && out.reportId && !editingReportId) {
        setEditingReportId(out.reportId);
      }
      addAuditEvent({ type: 'save', detail: `Saved process to workspace (${out.reportId})` });
      const readyMsg = 'Saved. Keep editing whenever you like — your changes land live.';
      addChatMessage({ role: 'assistant', content: readyMsg });
      try {
        persistMessageToCloud({
          role: 'assistant',
          content: readyMsg,
          snapshot: buildFullSnapshot(pd),
        });
      } catch { /* best-effort */ }
      setInlineGenerateStatus('idle');
    } catch (err) {
      setInlineGenerateError(err.message || 'Something went wrong. Please try again.');
      setInlineGenerateStatus('error');
    }
  }, [completedProcesses, contact, authUser, sessionUser, moduleId, editingReportId, customDepartments, auditTrail, accessToken, sendDiagnosticReport, setEditingReportId, addAuditEvent, addChatMessage, buildFullSnapshot, persistMessageToCloud]);

  const commitAndNavigate = useCallback((deps) => {
    const valid = steps.filter((s) => s.name.trim());
    const reconciled = reconcileDecisionBranches(valid, flowCustomEdgesRef.current, flowDeletedEdgesRef.current);
    const { steps: repairedValid } = repairFlow(reconciled);
    const h = ensureHandoffs(repairedValid, handoffs);
    const allSys = [...new Set(repairedValid.flatMap((s) => s.systems || []).filter(Boolean))];
    const updates = { steps: repairedValid, handoffs: h, systems: allSys.length > 0 ? allSys : processData.systems, processDependencies: deps };
    updateProcessData(updates);
    if (authUser?.email && !contact?.email) {
      setContact({ name: authUser.name || '', email: authUser.email, company: authUser.company || '', title: authUser.title || '' });
    }
    setError('');
    addAuditEvent({ type: 'navigate', detail: `Completed step mapping with ${valid.length} steps` });

    // Living-workspace contract: every flow — PE, M&A, scaling, team —
    // goes through the same inline save. No Screen 6, no "team survey
    // submission" branch, no deal-completion redirect. The save creates
    // (or updates) the live row; the canvas stays mounted; the user
    // keeps editing.
    const pd = { ...processData, ...updates };
    runInlineGenerate(pd);
  }, [steps, handoffs, processData, updateProcessData, addAuditEvent, authUser, contact, setContact, runInlineGenerate]);

  const handleContinue = useCallback(() => {
    const valid = steps.filter((s) => s.name.trim());
    if (valid.length < MIN_STEPS) {
      const missing = MIN_STEPS - valid.length;
      showValidationToast(`Add at least ${missing} more step${missing > 1 ? 's' : ''} before continuing. You need ${MIN_STEPS} named steps minimum.`);
      return;
    }
    commitAndNavigate(processData.processDependencies || []);
  }, [steps, showValidationToast, commitAndNavigate, processData.processDependencies]);

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

  const snapshotCurrentFlow = useCallback(() => {
    try {
      return buildFullSnapshot({
        ...processData,
        steps,
        handoffs,
        flowCustomEdges: flowCustomEdgesRef.current || [],
        flowDeletedEdges: flowDeletedEdgesRef.current || [],
        flowNodePositions: flowNodePositionsRef.current || {},
      });
    } catch { return null; }
  }, [buildFullSnapshot, processData, steps, handoffs]);

  // Snapshot the flow when the intake phase advances (structure → owners →
  // timings → ... ). Each transition is a natural "milestone" the user may
  // want to roll back to. Skip when a turn-level artefact (upload reshape
  // or replace_all_steps) was just emitted for the same canvas - that pill
  // already covers this milestone.
  const lastPhaseIdRef = useRef(null);
  const lastArtefactAtRef = useRef(0);
  useEffect(() => {
    const state = computePhaseState({ steps, handoffs });
    const currId = state.current?.id || (state.overallComplete ? '__complete__' : null);
    const prev = lastPhaseIdRef.current;
    lastPhaseIdRef.current = currId;
    if (!prev || !currId || prev === currId) return;
    // Only snapshot when we have enough structure to be worth keeping.
    const namedCount = steps.filter((s) => (s.name || '').trim()).length;
    if (namedCount < 2) return;
    // Dedupe: if a chat turn just produced a flow_snapshot (upload reshape,
    // AI replace_all_steps, pin), don't also emit a near-identical phase pill.
    if (Date.now() - lastArtefactAtRef.current < 2500) return;
    const completedPhase = INTAKE_PHASES_BY_ID[prev];
    if (!completedPhase) return;
    const snap = snapshotCurrentFlow();
    if (!snap) return;
    const pn = processData?.processName ? `: ${processData.processName}` : '';
    const artefact = {
      kind: 'flow_snapshot',
      snapshot: snap,
      label: `After ${completedPhase.label.toLowerCase()}${pn}`,
    };
    addChatMessage({ role: 'assistant', content: `Phase complete: ${completedPhase.label}.`, artefact });
    lastArtefactAtRef.current = Date.now();
    try { persistMessageToCloud({ role: 'assistant', content: `Phase complete: ${completedPhase.label}.`, snapshot: snap, artefact }); } catch { /* best-effort */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, handoffs]);

  // One-shot "ready to generate" banner in chat once all intake phases are
  // satisfied. The deps modal used to be the prompt to continue; now the chat
  // surfaces the cue and the canvas does the rest.
  const announcedReadyRef = useRef(false);
  useEffect(() => {
    if (editingReportId) return;
    const state = computePhaseState({ steps, handoffs });
    if (!state.overallComplete) {
      announcedReadyRef.current = false;
      return;
    }
    if (announcedReadyRef.current) return;
    const namedCount = steps.filter((s) => (s.name || '').trim()).length;
    if (namedCount < MIN_STEPS) return;
    announcedReadyRef.current = true;
    const msg = "I've got enough to wrap this up. Hit Add to model when you're ready — the process will land in your workspace and the summary will appear on the canvas.";
    addChatMessage({ role: 'assistant', content: msg, generateAction: true });
    try { persistMessageToCloud({ role: 'assistant', content: msg, generateAction: true }); } catch { /* best-effort */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, handoffs, editingReportId]);

  const pinCurrentFlow = useCallback(() => {
    const snap = snapshotCurrentFlow();
    if (!snap) return;
    const pn = processData?.processName ? `: ${processData.processName}` : '';
    const namedCount = steps.filter((s) => (s.name || '').trim()).length;
    const label = `Pinned snapshot${pn} (${namedCount} step${namedCount === 1 ? '' : 's'})`;
    const artefact = { kind: 'flow_snapshot', snapshot: snap, label };
    addChatMessage({ role: 'user', content: `Pinned current flow as artefact.`, artefact });
    lastArtefactAtRef.current = Date.now();
    try { persistMessageToCloud({ role: 'user', content: `Pinned current flow as artefact.`, snapshot: snap, artefact }); } catch { /* best-effort */ }
  }, [snapshotCurrentFlow, processData, steps, addChatMessage, persistMessageToCloud]);

  /* ═══════ Handover / Save-Progress flows removed ═══════
   *
   * The old "handover to a colleague" modal and per-step "Save & get link"
   * affordances posted to /api/progress, which is gone with the living-
   * workspace migration (the diagnostic_progress table was a snapshot-era
   * resume-link store). The workspace now autosaves every edit via PUT
   * /api/processes/[id]; sharing a deal/process is done by adding the
   * collaborator on the deal, not by sending a one-shot resume URL.
   */

  /* ═══════ Flow model - predicted wait times ═══════ */
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
    // Suppress helper-level changes recording for the duration of this
    // synchronous loop — the batch write below records the whole turn.
    inAgentTurnRef.current = true;

    // Capture one snapshot per batch for undo - chat actions often come in
    // groups (e.g. replace_all_steps + multiple add_step tool calls in one
    // agent turn). A single undo reverts the whole turn rather than rolling
    // back tool-call-by-tool-call.
    const MUTATING = new Set(['replace_all_steps', 'add_step', 'update_step', 'remove_step', 'set_handoff', 'add_custom_department', 'add_connector', 'remove_connector', 'redirect_connector', 'insert_step_between', 'set_branch_target', 'set_branch_probability', 'set_branch_label', 'remove_branch', 'add_branch', 'reorder_step', 'set_process_name', 'set_process_definition', 'set_step_details', 'set_cost_input', 'set_bottleneck', 'set_frequency_details', 'set_pe_context', 'add_step_system', 'remove_step_system', 'add_checklist_item', 'toggle_checklist_item', 'remove_checklist_item', 'remove_custom_department']);
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
            if (updates.functionId !== undefined) s.functionId = updates.functionId || null;
            if (updates.roleId !== undefined) {
              s.roleId = updates.roleId || null;
              // Snapshot the role's first function + name onto the step so
              // workspace attribution stays coherent with team ownership.
              const role = workspaceTeams.find((r) => r.id === s.roleId);
              if (role) {
                if (Array.isArray(role.function_ids) && role.function_ids[0]) {
                  s.functionId = role.function_ids[0];
                }
                if (role.name) s.department = role.name;
              }
            }
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
        case 'add_connector': {
          const fromIdx = (action.input?.fromStep || 0) - 1;
          const toIdx = (action.input?.toStep || 0) - 1;
          if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) break;
          const source = `step-${fromIdx}`;
          const target = `step-${toIdx}`;
          const toCustomId = (c) => `e-custom-${c.source}-${c.target}-${c.sourceHandle || 'r'}-${c.targetHandle || 'l'}`;
          const newEdge = { source, target, sourceHandle: 'right', targetHandle: 'left' };
          const newId = toCustomId(newEdge);
          const existing = flowCustomEdgesRef.current || [];
          if (existing.some((c) => toCustomId(c) === newId)) break;
          const next = [...existing, newEdge];
          flowCustomEdgesRef.current = next;
          setFlowCustomEdges(next);
          queueMicrotask(() => updateProcessData({ flowCustomEdges: next }));
          queueMicrotask(() => addAuditEvent({ type: 'step_edit', detail: `AI connected step ${action.input.fromStep} → ${action.input.toStep}` }));
          break;
        }
        case 'remove_connector': {
          const fromIdx = (action.input?.fromStep || 0) - 1;
          const toIdx = (action.input?.toStep || 0) - 1;
          if (fromIdx < 0 || toIdx < 0) break;
          const source = `step-${fromIdx}`;
          const target = `step-${toIdx}`;
          const customs = flowCustomEdgesRef.current || [];
          const match = customs.find((c) => c.source === source && c.target === target);
          if (match) {
            const toCustomId = (c) => `e-custom-${c.source}-${c.target}-${c.sourceHandle || 'r'}-${c.targetHandle || 'l'}`;
            const matchId = toCustomId(match);
            const next = customs.filter((c) => toCustomId(c) !== matchId);
            flowCustomEdgesRef.current = next;
            setFlowCustomEdges(next);
            queueMicrotask(() => updateProcessData({ flowCustomEdges: next }));
          } else if (toIdx === fromIdx + 1) {
            const seqId = `e-seq-${fromIdx}-${toIdx}`;
            const deleted = flowDeletedEdgesRef.current || [];
            if (!deleted.includes(seqId)) {
              const next = [...deleted, seqId];
              flowDeletedEdgesRef.current = next;
              setFlowDeletedEdges(next);
              queueMicrotask(() => updateProcessData({ flowDeletedEdges: next }));
            }
          } else {
            // Attempt decision-branch removal: drop branches from fromStep that point to toStep
            setSteps((prev) => {
              if (fromIdx >= prev.length) return prev;
              const src = prev[fromIdx];
              if (!src?.isDecision || !Array.isArray(src.branches)) return prev;
              const nextBranches = src.branches.filter((b) => {
                const tgt = (b.target || b.targetStep || '').toString().match(/step\s*(\d+)/i);
                const tIdx = tgt ? parseInt(tgt[1], 10) - 1 : -1;
                return tIdx !== toIdx;
              });
              if (nextBranches.length === src.branches.length) return prev;
              return prev.map((s, i) => i === fromIdx ? { ...s, branches: nextBranches } : s);
            });
          }
          queueMicrotask(() => addAuditEvent({ type: 'step_edit', detail: `AI removed connector ${action.input.fromStep} → ${action.input.toStep}` }));
          break;
        }
        case 'redirect_connector': {
          const fromIdx = (action.input?.fromStep || 0) - 1;
          const toIdx = (action.input?.toStep || 0) - 1;
          const newFromIdx = action.input?.newFromStep != null ? action.input.newFromStep - 1 : fromIdx;
          const newToIdx = action.input?.newToStep != null ? action.input.newToStep - 1 : toIdx;
          if (fromIdx < 0 || toIdx < 0 || newFromIdx < 0 || newToIdx < 0) break;
          if (newFromIdx === fromIdx && newToIdx === toIdx) break;
          const source = `step-${fromIdx}`;
          const target = `step-${toIdx}`;
          const newSource = `step-${newFromIdx}`;
          const newTarget = `step-${newToIdx}`;
          const customs = flowCustomEdgesRef.current || [];
          const toCustomId = (c) => `e-custom-${c.source}-${c.target}-${c.sourceHandle || 'r'}-${c.targetHandle || 'l'}`;
          const match = customs.find((c) => c.source === source && c.target === target);
          const newCustom = { source: newSource, target: newTarget, sourceHandle: 'right', targetHandle: 'left' };
          let nextCustoms;
          if (match) {
            const matchId = toCustomId(match);
            nextCustoms = [...customs.filter((c) => toCustomId(c) !== matchId), newCustom];
          } else if (toIdx === fromIdx + 1) {
            // Rewire a default sequence edge: delete it + add custom replacement
            const seqId = `e-seq-${fromIdx}-${toIdx}`;
            const deleted = flowDeletedEdgesRef.current || [];
            if (!deleted.includes(seqId)) {
              const nextDeleted = [...deleted, seqId];
              flowDeletedEdgesRef.current = nextDeleted;
              setFlowDeletedEdges(nextDeleted);
            }
            nextCustoms = [...customs, newCustom];
          } else {
            nextCustoms = [...customs, newCustom];
          }
          flowCustomEdgesRef.current = nextCustoms;
          setFlowCustomEdges(nextCustoms);
          queueMicrotask(() => updateProcessData({
            flowCustomEdges: nextCustoms,
            flowDeletedEdges: flowDeletedEdgesRef.current,
          }));
          queueMicrotask(() => addAuditEvent({ type: 'step_edit', detail: `AI rewired connector ${action.input.fromStep}→${action.input.toStep} to ${newFromIdx + 1}→${newToIdx + 1}` }));
          break;
        }
        case 'insert_step_between': {
          const { fromStep, toStep, name, department, isExternal, isDecision, isMerge, parallel, inclusive, workMinutes, waitMinutes, systems, branches, owner, checklist } = action.input || {};
          const fromIdx = (fromStep || 0) - 1;
          const toIdx = (toStep || 0) - 1;
          if (fromIdx < 0 || toIdx < 0) break;
          if (isCustomDepartment(department)) addCustomDepartment(department.trim());
          // Drop any custom edge that spans the two endpoints - the new step replaces that connection.
          const customs = flowCustomEdgesRef.current || [];
          const source = `step-${fromIdx}`;
          const target = `step-${toIdx}`;
          const toCustomId = (c) => `e-custom-${c.source}-${c.target}-${c.sourceHandle || 'r'}-${c.targetHandle || 'l'}`;
          const match = customs.find((c) => c.source === source && c.target === target);
          let nextCustoms = customs;
          if (match) {
            const matchId = toCustomId(match);
            nextCustoms = customs.filter((c) => toCustomId(c) !== matchId);
            flowCustomEdgesRef.current = nextCustoms;
            setFlowCustomEdges(nextCustoms);
          }
          const init = {
            name: name || 'New step',
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
          const insertAfterIdx = Math.min(fromIdx, toIdx);
          addStep(insertAfterIdx, init);
          queueMicrotask(() => updateProcessData({ flowCustomEdges: nextCustoms }));
          if (name) addedNames.push(name);
          break;
        }
        case 'add_branch': {
          const stepIdx = (action.input?.stepNumber || 0) - 1;
          if (stepIdx < 0) break;
          const label = action.input?.label || '';
          const target = action.input?.target || '';
          const probRaw = action.input?.probability;
          const prob = (probRaw == null || Number.isNaN(probRaw)) ? undefined : Math.max(0, Math.min(100, Number(probRaw)));
          setSteps((prev) => {
            if (stepIdx >= prev.length) return prev;
            const s = prev[stepIdx];
            const branches = Array.isArray(s.branches) ? s.branches : [];
            const newBranch = { label, target };
            if (prob != null) newBranch.probability = prob;
            const next = { ...s, branches: [...branches, newBranch], isDecision: true };
            return prev.map((p, i) => i === stepIdx ? next : p);
          });
          setActiveIdx(stepIdx);
          queueMicrotask(() => addAuditEvent({ type: 'step_edit', detail: `AI added branch on step ${action.input.stepNumber}${label ? ` "${label}"` : ''}` }));
          break;
        }
        case 'reorder_step': {
          const fromIdx = (action.input?.stepNumber || 0) - 1;
          const rawPos = action.input?.position;
          if (fromIdx < 0 || rawPos == null) break;
          const toIdx = Math.max(0, Math.min(steps.length - 1, rawPos - 1));
          if (fromIdx === toIdx) break;
          moveStep(fromIdx, toIdx);
          break;
        }
        case 'set_process_name': {
          const name = (action.input?.name || '').trim();
          if (!name) break;
          updateProcessData({ processName: name });
          queueMicrotask(() => addAuditEvent({ type: 'step_edit', detail: `AI renamed process to "${name}"` }));
          break;
        }
        case 'set_process_definition': {
          const { startsWhen, completesWhen, complexity } = action.input || {};
          const prevDef = processData?.definition || {};
          const nextDef = { ...prevDef };
          if (startsWhen !== undefined) nextDef.startsWhen = startsWhen;
          if (completesWhen !== undefined) nextDef.completesWhen = completesWhen;
          if (complexity !== undefined) nextDef.complexity = complexity;
          updateProcessData({ definition: nextDef });
          queueMicrotask(() => addAuditEvent({ type: 'step_edit', detail: 'AI updated process definition' }));
          break;
        }
        case 'set_step_details': {
          const stepIdx = (action.input?.stepNumber || 0) - 1;
          if (stepIdx < 0) break;
          const { waitType, waitNote, capacity, description } = action.input || {};
          setSteps((prev) => {
            if (stepIdx >= prev.length) return prev;
            const s = { ...prev[stepIdx] };
            if (waitType !== undefined) s.waitType = waitType || undefined;
            if (waitNote !== undefined) s.waitNote = waitNote;
            if (capacity !== undefined) s.capacity = capacity;
            if (description !== undefined) s.description = description;
            return prev.map((p, i) => i === stepIdx ? s : p);
          });
          setActiveIdx(stepIdx);
          queueMicrotask(() => addAuditEvent({ type: 'step_edit', detail: `AI updated details on step ${action.input.stepNumber}` }));
          break;
        }
        case 'set_cost_input': {
          const { frequency, teamSize, hoursPerInstance } = action.input || {};
          const FREQ_ANNUAL = { daily: 365, 'few-per-week': 150, weekly: 52, 'twice-monthly': 24, monthly: 12, quarterly: 4, 'twice-yearly': 2, yearly: 1 };
          const updates = {};
          if (frequency !== undefined) {
            const annual = FREQ_ANNUAL[frequency] ?? processData?.frequency?.annual ?? 0;
            updates.frequency = { ...(processData?.frequency || {}), type: frequency, annual };
          }
          if (teamSize !== undefined || hoursPerInstance !== undefined) {
            updates.costs = { ...(processData?.costs || {}) };
            if (teamSize !== undefined) updates.costs.teamSize = teamSize;
            if (hoursPerInstance !== undefined) updates.costs.hoursPerInstance = hoursPerInstance;
          }
          if (Object.keys(updates).length) updateProcessData(updates);
          queueMicrotask(() => addAuditEvent({ type: 'step_edit', detail: 'AI updated cost inputs' }));
          break;
        }
        case 'set_bottleneck': {
          const { reason, why } = action.input || {};
          const prev = processData?.bottleneck || {};
          const next = { ...prev };
          if (reason !== undefined) next.reason = reason;
          if (why !== undefined) next.why = why;
          updateProcessData({ bottleneck: next });
          queueMicrotask(() => addAuditEvent({ type: 'step_edit', detail: `AI set bottleneck${reason ? ` reason="${reason}"` : ''}` }));
          break;
        }
        case 'set_frequency_details': {
          const { inFlight } = action.input || {};
          const prev = processData?.frequency || {};
          const next = { ...prev };
          if (inFlight !== undefined) next.inFlight = inFlight;
          updateProcessData({ frequency: next });
          queueMicrotask(() => addAuditEvent({ type: 'step_edit', detail: `AI set frequency details (inFlight=${inFlight})` }));
          break;
        }
        case 'set_pe_context': {
          const { peSopStatus, peKeyPerson, peReportingImpact } = action.input || {};
          const updates = {};
          if (peSopStatus !== undefined) updates.peSopStatus = peSopStatus;
          if (peKeyPerson !== undefined) updates.peKeyPerson = peKeyPerson;
          if (peReportingImpact !== undefined) updates.peReportingImpact = peReportingImpact;
          if (Object.keys(updates).length) updateProcessData(updates);
          queueMicrotask(() => addAuditEvent({ type: 'step_edit', detail: 'AI set PE portfolio context' }));
          break;
        }
        case 'add_step_system': {
          const stepIdx = (action.input?.stepNumber || 0) - 1;
          const sys = (action.input?.system || '').trim();
          if (stepIdx < 0 || !sys) break;
          setSteps((prev) => {
            if (stepIdx >= prev.length) return prev;
            const s = prev[stepIdx];
            const existing = s.systems || [];
            if (existing.some((x) => x.toLowerCase() === sys.toLowerCase())) return prev;
            return prev.map((p, i) => i === stepIdx ? { ...p, systems: [...existing, sys] } : p);
          });
          setActiveIdx(stepIdx);
          queueMicrotask(() => addAuditEvent({ type: 'step_edit', detail: `AI added system "${sys}" to step ${action.input.stepNumber}` }));
          break;
        }
        case 'remove_step_system': {
          const stepIdx = (action.input?.stepNumber || 0) - 1;
          const sys = (action.input?.system || '').trim();
          if (stepIdx < 0 || !sys) break;
          setSteps((prev) => {
            if (stepIdx >= prev.length) return prev;
            const s = prev[stepIdx];
            const next = (s.systems || []).filter((x) => x.toLowerCase() !== sys.toLowerCase());
            return prev.map((p, i) => i === stepIdx ? { ...p, systems: next } : p);
          });
          setActiveIdx(stepIdx);
          queueMicrotask(() => addAuditEvent({ type: 'step_edit', detail: `AI removed system "${sys}" from step ${action.input.stepNumber}` }));
          break;
        }
        case 'add_checklist_item': {
          const stepIdx = (action.input?.stepNumber || 0) - 1;
          const text = (action.input?.text || '').trim();
          if (stepIdx < 0 || !text) break;
          setSteps((prev) => {
            if (stepIdx >= prev.length) return prev;
            const s = prev[stepIdx];
            const item = { id: Math.random().toString(36).slice(2, 8), text, checked: false };
            const next = { ...s, checklist: [...(s.checklist || []), item] };
            return prev.map((p, i) => i === stepIdx ? next : p);
          });
          setActiveIdx(stepIdx);
          queueMicrotask(() => addAuditEvent({ type: 'checklist', detail: `AI added "${text}" to step ${action.input.stepNumber}` }));
          break;
        }
        case 'toggle_checklist_item': {
          const stepIdx = (action.input?.stepNumber || 0) - 1;
          if (stepIdx < 0) break;
          const locate = (list) => {
            if (!Array.isArray(list) || !list.length) return -1;
            if (action.input?.itemIndex != null) {
              const i = action.input.itemIndex - 1;
              return i >= 0 && i < list.length ? i : -1;
            }
            if (action.input?.text) {
              const needle = String(action.input.text).trim().toLowerCase();
              return list.findIndex((it) => (it?.text || '').trim().toLowerCase() === needle);
            }
            return -1;
          };
          let toggledText = '';
          let nextChecked = null;
          setSteps((prev) => {
            if (stepIdx >= prev.length) return prev;
            const s = prev[stepIdx];
            const list = s.checklist || [];
            const ci = locate(list);
            if (ci < 0) return prev;
            const target = action.input?.checked == null ? !list[ci].checked : !!action.input.checked;
            nextChecked = target;
            toggledText = list[ci].text || '';
            const nextList = list.map((it, i) => i === ci ? { ...it, checked: target } : it);
            return prev.map((p, i) => i === stepIdx ? { ...p, checklist: nextList } : p);
          });
          setActiveIdx(stepIdx);
          if (toggledText) queueMicrotask(() => addAuditEvent({ type: 'checklist', detail: `AI ${nextChecked ? 'completed' : 'unchecked'} "${toggledText}" on step ${action.input.stepNumber}` }));
          break;
        }
        case 'remove_checklist_item': {
          const stepIdx = (action.input?.stepNumber || 0) - 1;
          if (stepIdx < 0) break;
          const locate = (list) => {
            if (!Array.isArray(list) || !list.length) return -1;
            if (action.input?.itemIndex != null) {
              const i = action.input.itemIndex - 1;
              return i >= 0 && i < list.length ? i : -1;
            }
            if (action.input?.text) {
              const needle = String(action.input.text).trim().toLowerCase();
              return list.findIndex((it) => (it?.text || '').trim().toLowerCase() === needle);
            }
            return -1;
          };
          let removedText = '';
          setSteps((prev) => {
            if (stepIdx >= prev.length) return prev;
            const s = prev[stepIdx];
            const list = s.checklist || [];
            const ci = locate(list);
            if (ci < 0) return prev;
            removedText = list[ci].text || '';
            const nextList = list.filter((_, i) => i !== ci);
            return prev.map((p, i) => i === stepIdx ? { ...p, checklist: nextList } : p);
          });
          setActiveIdx(stepIdx);
          if (removedText) queueMicrotask(() => addAuditEvent({ type: 'checklist', detail: `AI removed "${removedText}" from step ${action.input.stepNumber}` }));
          break;
        }
        case 'remove_custom_department': {
          const name = (action.input?.name || '').trim();
          if (!name) break;
          removeCustomDepartment(name);
          queueMicrotask(() => addAuditEvent({ type: 'step_edit', detail: `AI removed custom department "${name}"` }));
          break;
        }
        // trigger_redesign / pin_flow_snapshot: removed in living-workspace
        // migration. Tools no longer registered with the agent.
        case 'set_branch_target':
        case 'set_branch_probability':
        case 'set_branch_label':
        case 'remove_branch': {
          const stepNumber = action.input?.stepNumber;
          const stepIdx = (stepNumber || 0) - 1;
          if (stepIdx < 0) break;
          const locateBranchIdx = (branches) => {
            if (!Array.isArray(branches) || !branches.length) return -1;
            if (action.input?.branchIndex != null) {
              const i = action.input.branchIndex - 1;
              return i >= 0 && i < branches.length ? i : -1;
            }
            if (action.input?.branchLabel) {
              const needle = String(action.input.branchLabel).trim().toLowerCase();
              return branches.findIndex((b) => (b?.label || '').trim().toLowerCase() === needle);
            }
            return -1;
          };
          setSteps((prev) => {
            if (stepIdx >= prev.length) return prev;
            const s = prev[stepIdx];
            if (!s?.isDecision || !Array.isArray(s.branches)) return prev;
            const bi = locateBranchIdx(s.branches);
            if (bi < 0) return prev;
            let nextBranches;
            if (action.name === 'remove_branch') {
              nextBranches = s.branches.filter((_, i) => i !== bi);
            } else if (action.name === 'set_branch_target') {
              const n = action.input?.newTargetStep;
              if (!n) return prev;
              nextBranches = s.branches.map((b, i) => i === bi ? { ...b, target: `Step ${n}` } : b);
            } else if (action.name === 'set_branch_label') {
              const v = action.input?.newLabel;
              if (v == null) return prev;
              nextBranches = s.branches.map((b, i) => i === bi ? { ...b, label: String(v) } : b);
            } else {
              const p = action.input?.probability;
              const clamped = (p == null || Number.isNaN(p)) ? undefined : Math.max(0, Math.min(100, Number(p)));
              nextBranches = s.branches.map((b, i) => {
                if (i !== bi) return b;
                const next = { ...b };
                if (clamped == null) delete next.probability;
                else next.probability = clamped;
                return next;
              });
            }
            return prev.map((p, i) => i === stepIdx ? { ...p, branches: nextBranches } : p);
          });
          setActiveIdx(stepIdx);
          queueMicrotask(() => addAuditEvent({ type: 'step_edit', detail: `AI ${action.name.replace(/_/g, ' ')} on step ${stepNumber}` }));
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
        // open_panel: removed in living-workspace migration. No inline
        // report/cost panel surface anymore.
        case 'open_workspace_view':
        case 'open_deal_view': {
          // Both events share a listener on the embedded WorkspaceClient /
          // DealWorkspaceClient — they switch the active tab. The dispatch
          // is fire-and-forget; if nothing's mounted, the event is ignored.
          const view = action.input?.view;
          if (view && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('vesno:set-workspace-view', { detail: { view } }));
          }
          break;
        }
        case 'focus_function': {
          const functionId = action.input?.functionId ?? null;
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('vesno:focus-function', { detail: { functionId } }));
          }
          break;
        }
        case 'focus_participant': {
          const participantId = action.input?.participantId ?? null;
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('vesno:focus-participant', { detail: { participantId } }));
          }
          break;
        }
        case 'open_process': {
          const reportId = action.input?.reportId;
          const intent   = action.input?.intent === 'edit' ? 'edit' : 'view';
          if (!reportId) break;
          // Inline load — fetch the report and swap the canvas's flow
          // WITHOUT touching the URL via Next router (which would
          // re-trigger DiagnosticClient's URL-watching loader and
          // reset chatMessages to a static greeting). We do silently
          // update window.history so refresh / share preserves state.
          (async () => {
            try {
              const r = await apiFetch(`/api/get-diagnostic?id=${encodeURIComponent(reportId)}`, {}, accessToken);
              if (!r.ok) return;
              const data = await r.json();
              const report = data?.report;
              if (!report) return;
              const dd  = report.diagnosticData || {};
              const raw = (report.rawProcesses || dd.rawProcesses || [])[0] || {};

              const newSteps = (raw.steps || []).map((s, i) => ({
                number:       s.number || i + 1,
                name:         s.name || '',
                department:   s.department || '',
                isDecision:   !!s.isDecision,
                isExternal:   !!s.isExternal,
                isMerge:      !!s.isMerge,
                parallel:     !!s.parallel,
                inclusive:    !!s.inclusive,
                workMinutes:  s.workMinutes ?? undefined,
                waitMinutes:  s.waitMinutes ?? undefined,
                durationUnit: s.durationUnit || 'hours',
                branches:     s.branches || [],
                systems:      s.systems   || [],
                contributor:  s.contributor || s.owner || '',
                roleId:       s.roleId       ?? null,
                functionId:   s.functionId   ?? s.function_id   ?? null,
                capabilityId: s.capabilityId ?? s.capability_id ?? null,
                checklist:    (s.checklist || []).map((c) => typeof c === 'string' ? { text: c, checked: false } : c),
              }));
              const newHandoffs = (raw.handoffs || []).map((h) => ({
                from:    h.from    || {},
                to:      h.to      || {},
                method:  h.method  || '',
                clarity: h.clarity || '',
              }));

              setSteps(newSteps);
              setHandoffs(ensureHandoffs(newSteps, newHandoffs));
              updateProcessData({
                processName: raw.processName || '',
                rawProcesses: report.rawProcesses || dd.rawProcesses || [],
              });
              // Living-workspace contract: there's one focused process
              // id; intent is no longer a UI mode (no view-only chrome).
              // The agent still emits intent for SEO of its own
              // reasoning, but we just focus the id regardless.
              setEditingReportId && setEditingReportId(reportId);
              setWorkspaceCanvasOpen(false);
              void intent;

              // Silent URL update — keeps the URL honest (refresh /
              // share still works) without tripping useSearchParams,
              // so the URL-driven loader effect doesn't re-fire and
              // doesn't reset chatMessages.
              if (typeof window !== 'undefined') {
                const sp = new URLSearchParams(window.location.search);
                sp.delete('view');
                sp.delete('edit');
                sp.set(intent, reportId);
                const url = window.location.pathname + (sp.toString() ? `?${sp.toString()}` : '');
                window.history.replaceState(null, '', url);
              }
            } catch { /* swallow — chat continues */ }
          })();
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
        // generate_report / generate_cost: removed in living-workspace
        // migration. No more snapshot deliverables.
        case 'set_labour_rate':
        case 'set_non_labour_cost':
        case 'set_investment':
        case 'propose_change':
        case 'ask_discovery':
          // No client-side state change - the agent's natural-language reply
          // (built from the tool result text) is the user-facing surface.
          break;
        default:
          break;
      }
    }

    // End of synchronous agent turn — release the guard so subsequent
    // direct user mutations record under actor_kind='user'.
    inAgentTurnRef.current = false;

    // Living-workspace contract: every mutation gets a row in the
    // `changes` relational changelog at state='applied'. The JSONB
    // `rawProcesses` is the live canvas state; this table is the
    // canonical "what happened on this process" timeline. Fire-and-
    // forget — a failed write doesn't roll back the canvas mutation.
    if (turnMutates && editingReportId) {
      (async () => {
        try {
          const [{ actionsToChangeRows }, { recordChanges }] = await Promise.all([
            import('@/lib/changes/canvasMutations'),
            import('@/lib/changes/repo'),
          ]);
          const rows = actionsToChangeRows(actions, {
            processId: editingReportId,
            actorEmail: contact?.email || authUser?.email || null,
            actorKind: 'agent',
            agentName: 'chat',
          });
          if (rows.length) await recordChanges(rows);
        } catch { /* fire-and-forget; canvas state survives */ }
      })();
    }

    return addedNames;
  }, [addStep, removeStep, moveStep, addCustomDepartment, removeCustomDepartment, updateProcessData, addAuditEvent, steps, handoffs, editingReportId, accessToken, handleContinue, processData, addChatMessage, persistMessageToCloud, snapshotCurrentFlow, pinCurrentFlow, chatMessages, contact, authUser]);

  // External requests to swap the canvas to a specific process — fired
  // by the embedded workspace (`/workspace`) when the user clicks a row
  // in ProcessesPanel. Routes through the same `open_process` action
  // path the chat agent uses, so the load is silent (no remount, chat
  // thread continues, URL updated in place).
  useEffect(() => {
    const onOpenProcess = (e) => {
      const reportId = e?.detail?.reportId;
      if (!reportId) return;
      const intent = e?.detail?.intent === 'edit' ? 'edit' : 'view';
      processActions([{ name: 'open_process', input: { reportId, intent } }]);
    };
    window.addEventListener('vesno:open-process', onOpenProcess);
    return () => window.removeEventListener('vesno:open-process', onOpenProcess);
  }, [processActions]);

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

  const handleChatPaste = useCallback((e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const files = items
      .filter((i) => i.kind === 'file')
      .map((i) => i.getAsFile())
      .filter(Boolean);
    if (files.length) {
      e.preventDefault();
      processFiles(files);
    }
  }, [processFiles]);

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
    // Immediate visible feedback: don't wait for the server's first
    // SSE 'progress' to land — that takes one round-trip + Anthropic
    // setup time (often 1-3 s), during which the typing dots alone
    // don't make it clear *anything* is happening. Seed locally and
    // upgrade the copy as elapsed time grows so the user always knows
    // we're still on it.
    setChatProgress(
      attachmentsToSend.length > 0
        ? 'Sending files to the assistant…'
        : 'Reina is reading your message…',
    );
    // Client-side fallback timer messages. These only fire if the
    // server hasn't sent a more specific 'progress' event in the
    // meantime — every regex match guards on the previous client
    // copy, so the moment the agent emits "Drafting reply…" or
    // "Searching the data room…", the timer chain stops upgrading.
    const progressTimers = [
      setTimeout(() => { setChatProgress((cur) => cur && /reading your message|thinking/i.test(cur) ? 'Thinking through your request…' : cur); }, 4000),
      setTimeout(() => { setChatProgress((cur) => cur && /thinking through|thinking/i.test(cur) ? 'Still working on it — almost there…' : cur); }, 10000),
      setTimeout(() => { setChatProgress((cur) => cur && /working|almost there/i.test(cur) ? 'Pulling together a thorough reply…' : cur); }, 18000),
      setTimeout(() => { setChatProgress((cur) => cur && /pulling|thorough/i.test(cur) ? 'This is taking longer than usual — still going…' : cur); }, 32000),
    ];
    const clearProgressTimers = () => progressTimers.forEach((t) => clearTimeout(t));

    // Abort any in-flight request before starting a new one.
    if (chatAbortRef.current) {
      try { chatAbortRef.current.abort(); } catch {}
    }
    const controller = new AbortController();
    chatAbortRef.current = controller;
    let streamedSoFar = '';
    let aborted = false;
    // Accumulate per-turn deal-document chunks emitted by the search_deal_documents
    // tool so we can attach them to the assistant message and render source cards.
    const dealDocsForTurn = [];
    // Accumulate structured metadata payloads (documents/findings list events)
    // emitted by the deal-metadata tools.
    const dealMetaForTurn = [];
    // Accumulate staged mutation proposals (e.g. finding_review). Each is one
    // Apply card under the bubble; the user clicks to commit via the existing
    // mutation endpoint.
    const dealProposalsForTurn = [];
    // Workspace-setup proposals (add_function / add_role / add_system) flow
    // through the same pattern as deal proposals — collected per turn,
    // attached to the assistant bubble, rendered as Confirm cards.
    const workspaceProposalsForTurn = [];
    // Bulk-setup proposals: a single SSE event carrying many items at once.
    // Rendered as a per-row review card with one "Apply all" action.
    const workspaceBulkForTurn = [];
    // Schema-free artefacts the agent emitted this turn (saved server
    // side). Surfaced as a chip on the message; the Artefacts panel
    // shows the full content.
    const artefactsForTurn = [];

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
      viewOnlyProcessId: viewOnlyProcessId || undefined,
      dealId: dealId || undefined,
      model: selectedModel || undefined,
      // Workspace context — Reina uses the picked function path to
      // frame her questions ("you're mapping a Finance / AR process").
      functionPath:     selectedFunctionPath     || undefined,
      operatingModelName: selectedOperatingModelName || undefined,
      // Active model = explicit Standard-tab pick, else the model open
      // in the canvas overlay. (When neither is set the server resolves
      // the process's model or the user's default — see
      // resolveActiveModelId — so model-scoped tools always have a home.)
      operatingModelId:   selectedOperatingModelId || effectiveCanvasModelId || undefined,
      // Explicit agent scope. Tells the server-side router which
      // agent to fire when both dealId AND operatingModelId are in
      // context (common: a chat session reused across surfaces, or
      // a default operating model coexisting with a deal from an
      // earlier session).
      //
      // Priority order (matches the user's most recent explicit
      // intent):
      //   1. process — a specific process is open on the canvas
      //   2. deal — user EXPLICITLY picked a deal in this session
      //      (canvas overlay is on deals scope with a deal selected)
      //   3. model — user EXPLICITLY picked a model in this session
      //      (canvas overlay is on standard scope with a model selected)
      //   4. model — an operating model is anchored at all (default
      //      model from /api/me/operating-model); beats a stale dealId
      //   5. deal — only dealId is set
      chatScope: (editingReportId || viewOnlyProcessId)
        ? 'process'
        : effectiveCanvasScope === 'deals' && effectiveCanvasDealId
          ? 'deal'
        : effectiveCanvasScope === 'standard' && effectiveCanvasModelId
          ? 'model'
        : selectedOperatingModelId
          ? 'model'
        : dealId
          ? 'deal'
        : undefined,
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
              else if (event === 'deal_documents') {
                if (Array.isArray(parsed.chunks) && parsed.chunks.length) {
                  dealDocsForTurn.push({ query: parsed.query || '', chunks: parsed.chunks });
                }
              }
              else if (event === 'deal_metadata') {
                if (Array.isArray(parsed.items) && parsed.items.length) {
                  dealMetaForTurn.push({ kind: parsed.kind, items: parsed.items });
                }
              }
              else if (event === 'deal_proposal') {
                if (parsed && parsed.kind) dealProposalsForTurn.push(parsed);
              }
              else if (event === 'workspace_proposal') {
                if (parsed && parsed.kind) workspaceProposalsForTurn.push(parsed);
              }
              else if (event === 'workspace_bulk_proposal') {
                if (parsed) workspaceBulkForTurn.push(parsed);
              }
              else if (event === 'artefact') {
                // The agent emitted a schema-free artefact (saved server
                // side). Tell any mounted Artefacts panel to refetch so
                // it shows up live, like a Claude artefacts panel.
                if (parsed && parsed.id && typeof window !== 'undefined') {
                  artefactsForTurn.push(parsed);
                  window.dispatchEvent(new CustomEvent('vesno:artefact-created', { detail: parsed }));
                }
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
      // If the assistant's reply reshapes the canvas (replace_all_steps),
      // snapshot the intended new flow as an artefact attached to this turn.
      const reshapeAction = (data.actions || []).find((a) => a.name === 'replace_all_steps');
      let artefactForTurn;
      if (reshapeAction && Array.isArray(reshapeAction.input?.steps) && reshapeAction.input.steps.length) {
        const snap = buildFullSnapshot({
          ...processData,
          steps: reshapeAction.input.steps,
          handoffs: [],
          flowCustomEdges: [],
          flowDeletedEdges: [],
          flowNodePositions: {},
        });
        const pn = processData?.processName || snap?.processData?.processName;
        artefactForTurn = {
          kind: 'flow_snapshot',
          snapshot: snap,
          label: pn ? `Flowchart: ${pn}` : `Flowchart (${reshapeAction.input.steps.length} steps)`,
        };
      }
      addChatMessage({
        role: 'assistant',
        content: data.reply,
        ...(costProposals.length ? { costProposals } : {}),
        ...(artefactForTurn ? { artefact: artefactForTurn } : {}),
        ...(dealDocsForTurn.length ? { dealDocs: dealDocsForTurn } : {}),
        ...(dealMetaForTurn.length ? { dealMeta: dealMetaForTurn } : {}),
        ...(dealProposalsForTurn.length ? { dealProposals: dealProposalsForTurn } : {}),
        ...(workspaceProposalsForTurn.length ? { workspaceProposals: workspaceProposalsForTurn } : {}),
        ...(workspaceBulkForTurn.length ? { workspaceBulk: workspaceBulkForTurn } : {}),
        ...(artefactsForTurn.length ? { artefacts: artefactsForTurn } : {}),
      });
      if (artefactForTurn) lastArtefactAtRef.current = Date.now();
      persistMessageToCloud({ role: 'assistant', content: data.reply, actions: data.actions, snapshot: buildLiveSnapshot(), artefact: artefactForTurn });
      if (data.actions?.length > 0) {
        const addedNames = processActions(data.actions);
        if (!isSystem && addedNames.length > 0) {
          const lastReply = (data.reply || '').trim();
          const replyWasMinimal = !lastReply || /^Done\s*[-\-]?\s*(added|updated|removed|set)/i.test(lastReply) || lastReply.length < 80;
          if (replyWasMinimal) {
            setTimeout(() => {
              sendChat(`[system] New steps were just added: ${addedNames.join(', ')}. Ask about 1-2 missing details (decision points, departments, or systems) for these steps. Do NOT repeat any question you already asked in your last message - check the conversation history. Keep it conversational.`);
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
    clearProgressTimers();
    setChatLoading(false);
    setChatProgress('');
    setChatStreamedText('');
    // Re-fetch the credits widget — token spend is recorded server-side
    // by the time the stream finishes, so the count drops near-real-time.
    setCreditsRefreshKey((k) => k + 1);
  };

  const stopChat = useCallback(() => {
    const c = chatAbortRef.current;
    if (!c) return;
    try { c.abort(); } catch {}
    chatAbortRef.current = null;
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);
  useEffect(() => {
    if (!chatStreamedText) return;
    chatEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [chatStreamedText]);
  // Keep the typing/progress indicator in view from the moment the
  // request fires — without this, the pending bubble can land just
  // below the viewport on long threads and the user thinks nothing's
  // happening.
  useEffect(() => {
    if (chatLoading) chatEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [chatLoading, chatProgress]);
  // Tick the elapsed-seconds counter while a chat request is in flight.
  // Reset on each new request via the chatLoading transition.
  useEffect(() => {
    if (!chatLoading) { setChatElapsedSeconds(0); return undefined; }
    const startedAt = Date.now();
    const id = setInterval(() => {
      setChatElapsedSeconds(Math.round((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [chatLoading]);

  /* ═══════ Computed ═══════ */
  const namedSteps = steps.filter((s) => s.name.trim());
  /** Flowchart / canvas artifact is present - switch to chat-left + canvas-right */
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
    // and react-flow canvas while dragging - belt-and-braces against
    // mid-drag stutter.
    try { handle.setPointerCapture(e.pointerId); } catch { /* ignore */ }

    // Require the pointer to travel past a small threshold before the drag
    // "engages" - avoids micro-resizes from accidental clicks or hand jitter
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

  /* ═══════ Step detail panel - 3-column node inspector ═══════ */
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

          {/* Step name + delete row - always visible */}
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
                              <input type="number" className="s7-input s7-branch-prob" placeholder="%" min={0} max={100} step={1} title="Probability % - used to weight wait time predictions for this branch" value={br.probability ?? ''} onChange={(e) => { const v = e.target.value; updateBranch(i, bi, 'probability', v === '' ? undefined : Math.max(0, Math.min(100, parseFloat(v) || 0))); }} />
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
                    {/* Workspace team picker — when set, snapshots the team's
                        first function onto the step so heatmap / graph / map
                        attribute the work correctly. Below it, the legacy
                        free-text dropdown stays available for steps that
                        don't yet map to a workspace team. */}
                    {workspaceTeams.length > 0 && (
                      <>
                        <div className="s7-detail-section-label">Team (workspace)</div>
                        <div className="s7-detail-row">
                          <select
                            className="s7-select s7-dept-select"
                            value={s.roleId || ''}
                            onChange={(e) => {
                              const roleId = e.target.value || null;
                              const role = workspaceTeams.find((r) => r.id === roleId) || null;
                              const fnId = role && Array.isArray(role.function_ids) ? (role.function_ids[0] || null) : null;
                              updateStep(i, 'roleId', roleId);
                              updateStep(i, 'functionId', fnId);
                              if (role?.name) updateStep(i, 'department', role.name);
                              addAuditEvent({ type: 'step_edit', detail: `Set step ${i + 1} team to "${role?.name || 'none'}"` });
                            }}
                          >
                            <option value="">— pick a team —</option>
                            {workspaceTeams.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}{r.headcount != null ? ` (${r.headcount} FTE)` : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      </>
                    )}
                    <div className="s7-detail-section-label">{workspaceTeams.length > 0 ? 'Or free-text' : 'Team'}</div>
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
                            <option value="">-</option>
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

              {/* "Save & get link" affordance removed — autosave via
                  /api/processes/[id] is the only save path now. */}
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
      <DealContextChip />
      {presencePeers.length > 0 && (
        <div style={{ margin: '6px 16px 0', display: 'flex', justifyContent: 'flex-start' }}>
          <FlowPresenceBar
            peers={presencePeers}
            currentlyEditingStep={typeof expandedStepIdx === 'number' && expandedStepIdx >= 0 ? expandedStepIdx + 1 : null}
          />
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
                {isAssistant && Array.isArray(m.dealDocs) && m.dealDocs.length > 0 && (
                  <DealDocsSources groups={m.dealDocs} dealId={dealId} accessToken={accessToken} />
                )}
                {isAssistant && Array.isArray(m.dealMeta) && m.dealMeta.length > 0 && (
                  <DealMetaCards groups={m.dealMeta} dealId={dealId} accessToken={accessToken} />
                )}
                {isAssistant && Array.isArray(m.dealProposals) && m.dealProposals.length > 0 && (
                  <DealProposalCards proposals={m.dealProposals} accessToken={accessToken} />
                )}
                {isAssistant && Array.isArray(m.workspaceProposals) && m.workspaceProposals.length > 0 && (
                  <WorkspaceProposalCards proposals={m.workspaceProposals} accessToken={accessToken} />
                )}
                {isAssistant && Array.isArray(m.workspaceBulk) && m.workspaceBulk.length > 0 && (
                  m.workspaceBulk.map((bulk, i) => (
                    <WorkspaceBulkProposalCard key={i} plan={bulk} accessToken={accessToken} />
                  ))
                )}
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
                        onClick={() =>
                          c.functionId ? handleCapabilityChip(c.functionId, c.name) :
                          c.segmentId    ? handleSegmentChip(c.segmentId, c.name) :
                          sendChat(null, false, c.name)
                        }
                      >
                        <span>{c.name}</span>
                        {c.tagline && <span style={{ display: 'block', fontSize: '0.75em', opacity: 0.65, fontWeight: 400 }}>{c.tagline}</span>}
                      </button>
                    ))}
                  </div>
                )}
                {/* Inline "Add to model" button — gated to NON-deal chats.
                    Deal-scoped chats land processes via the participant flow. */}
                {m.generateAction && !editingReportId && !dealId && (
                  <div className="s7-report-actions">
                    <button
                      type="button"
                      className="s7-report-action-btn s7-report-action-btn--primary"
                      disabled={inlineGenerateStatus === 'generating'}
                      onClick={handleContinue}
                    >
                      {inlineGenerateStatus === 'generating' ? 'Adding…' : 'Add to model'}
                    </button>
                  </div>
                )}
                {m.artefact && !(m.reportActions && m.artefact.kind === 'report') && (
                  <ArtefactPill artefact={m.artefact} onOpenFlow={(snap) => setArtefactPreview(snap)} />
                )}
                {m.dealSetup && !dealId && (
                  <DealSetupCard
                    platformCompany={m.dealSetup.platformCompany}
                    dealKind={m.dealSetup.dealKind || 'pe'}
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
                ) : (
                  <span
                    className="s7-typing-text"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: '50%',
                        border: '2px solid currentColor',
                        borderTopColor: 'transparent',
                        animation: 'spin 0.9s linear infinite',
                        flex: '0 0 auto',
                      }}
                    />
                    {/* Always show *something*. Even if neither chatProgress
                        nor chatStreamedText has landed yet, this guarantees
                        the user sees a clear "we're working on it" cue. */}
                    <span>{chatProgress || 'Reina is thinking…'}</span>
                    {chatElapsedSeconds >= 4 && (
                      <span style={{ opacity: 0.6, fontSize: '0.85em' }}>
                        ({chatElapsedSeconds}s)
                      </span>
                    )}
                  </span>
                )}
              </div>
              {/* Secondary progress line — shows BELOW the bubble whenever
                  text has streamed but the agent is still working (i.e.,
                  text complete, now executing tools). Without this, the
                  user sees a streamed paragraph end and then just a
                  blinking cursor while Reina builds the flow / searches
                  the data room / runs the redesign. The message tracks
                  chatProgress, which the server updates per-tool. */}
              {chatStreamedText && chatLoading && (
                <div
                  className="s7-typing-text"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '4px 10px',
                    fontSize: 12,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 11,
                      height: 11,
                      borderRadius: '50%',
                      border: '2px solid currentColor',
                      borderTopColor: 'transparent',
                      animation: 'spin 0.9s linear infinite',
                      flex: '0 0 auto',
                    }}
                  />
                  <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {chatProgress || 'Working on it…'}
                  </span>
                  {chatElapsedSeconds >= 4 && (
                    <span style={{ opacity: 0.6, flex: '0 0 auto' }}>
                      ({chatElapsedSeconds}s)
                    </span>
                  )}
                </div>
              )}
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
      {/* ── "Continue mapping" row ── recent in-progress processes
           scoped to the current context (deal > operating model > user).
           Suppressed in edit mode and once the user is past the initial
           greeting bubble. */}
      <RecentProcessesRow
        accessToken={accessToken}
        operatingModelId={selectedOperatingModelId || null}
        dealId={dealId || null}
        hide={!sessionUser || !!editingReportId || (chatMessages?.length || 0) > 1}
      />
      <div className="s7-chat-input-area">
        <input type="file" ref={chatFileRef} className="s7-chat-file-input" multiple accept="image/*,application/pdf,.pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,.xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,.doc,.docx,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pptx,application/vnd.ms-powerpoint,.ppt,.txt,text/plain,.json,application/json,.tsv,text/tab-separated-values,.md" onChange={handleChatFileSelect} />
        <div className="s7-chat-composer">
          <div className="s7-chat-composer-field">
            <textarea
              ref={chatTextareaRef}
              className="s7-chat-textarea"
              placeholder={viewOnlyProcessId ? 'Ask about this flow, or tell me what you want to change.' : 'Describe your process flow (paste files or screenshots with Ctrl+V)'}
              value={chatInput}
              rows={1}
              onPaste={handleChatPaste}
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
            <ModelPicker
              accessToken={accessToken}
              selected={selectedModel}
              onChange={setSelectedModel}
              phase={computePhaseState({ steps, handoffs })?.phase || 'map'}
              hasAttachments={chatAttachments.length > 0}
            />
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

  // Gather artefacts in scope: chat-message-attached + implicit (mapped
  // processes that exist regardless of chat history). The user-facing
  // contract is "if a process is mapped, it should appear here" — that
  // includes deal participant reports the user has access to and the
  // user's own live map when not in deal scope.
  const sessionArtefacts = useMemo(() => {
    const list = [];
    const seenReportIds = new Set();

    // Lookup so we can attach a "deal · process" label to each entry —
    // see the row's secondary line in the artefacts panel below. Keys
    // are the diagnostic_report id; values capture the process and
    // company context.
    const reportIdToParticipant = new Map();
    if (Array.isArray(dealParticipantsForArtefacts)) {
      for (const p of dealParticipantsForArtefacts) {
        const rid = p?.reportId || p?.report_id || p?.report?.id;
        if (rid) reportIdToParticipant.set(rid, p);
      }
    }
    const dealLabel = dealId ? (dealName || 'This deal') : null;

    // Each artefact carries four levels of context for the panel tree:
    //   dealLabel    — outer group (deal name)
    //   processLabel — second level (process name, e.g. "Customer onboarding")
    //   variantLabel — third level ("Current" / "Redesign" / "Diligence" / …)
    //   companyLabel — leaf row (company + role, e.g. "Acme HQ (Platform)")
    // Levels can be null for non-deal contexts; the renderer collapses
    // missing levels gracefully.
    const ROLE_LABEL = {
      platform_company: 'Platform',
      portfolio_company: 'Portfolio',
      target: 'Target',
      acquirer: 'Acquirer',
    };
    const formatCompany = (p) => {
      if (!p) return null;
      const company = p.companyName || p.company_name || p.company || null;
      const role = ROLE_LABEL[p.role] || (p.role ? p.role.replace(/_/g, ' ') : null);
      if (company && role) return `${company} (${role})`;
      return company || role || null;
    };
    // Prefer the deal-level process name (deals.process_name fetched in
    // the participants effect) over the canonical-process-name from
    // DiagnosticContext, which is only populated when the user enters
    // via a deal-flow or participant-token path. Falls back to either
    // if one is missing.
    const resolvedProcessName = dealProcessName || dealCanonicalProcessName || null;

    // 1. Chat-message-attached artefacts (existing behaviour)
    chatMessages.forEach((m, idx) => {
      if (m.artefact && m.artefact.kind) {
        const p = m.artefact.refId ? reportIdToParticipant.get(m.artefact.refId) : null;
        const processLabel = resolvedProcessName || (p ? (p.companyName || p.company_name || p.company) : (processData?.processName || null));
        list.push({
          ...m.artefact,
          messageIdx: idx,
          preview: (m.content || '').slice(0, 80),
          dealLabel,
          processLabel,
          variantLabel: m.artefact.kind === 'report' ? 'Current'
            : m.artefact.kind === 'flow_snapshot' ? 'Current'
            : m.artefact.kind === 'deal_analysis' ? 'Redesign'
            : m.artefact.kind === 'cost_analysis' ? 'Cost analysis'
            : 'Other',
          companyLabel: formatCompany(p),
        });
        if (m.artefact.kind === 'report' && m.artefact.refId) seenReportIds.add(m.artefact.refId);
      }
      if (m.reportActions && m.reportActions.id && !m.artefact) {
        const p = reportIdToParticipant.get(m.reportActions.id);
        const processLabel = m.reportActions.processName
          || resolvedProcessName
          || (p ? (p.companyName || p.company_name || p.company) : null)
          || null;
        list.push({
          kind: 'report',
          refId: m.reportActions.id,
          label: m.reportActions.processName ? `Process: ${m.reportActions.processName}` : 'Process canvas',
          messageIdx: idx,
          preview: (m.content || '').slice(0, 80),
          dealLabel,
          processLabel,
          variantLabel: 'Current',
          companyLabel: formatCompany(p),
        });
        seenReportIds.add(m.reportActions.id);
      }
    });

    // 2. Deal participants' mapped processes — implicit artefacts.
    //    Each participant's report is the **current** state of the
    //    process for their company. The panel groups these under
    //    Customer onboarding → Current → Acme HQ (Platform).
    if (dealId && Array.isArray(dealParticipantsForArtefacts)) {
      dealParticipantsForArtefacts.forEach((p) => {
        const reportId = p?.reportId || p?.report_id || p?.report?.id;
        if (!reportId || seenReportIds.has(reportId)) return;
        const company = p?.companyName || p?.company_name || p?.company || 'Participant';
        list.push({
          kind: 'report',
          refId: reportId,
          label: company,
          source: 'deal_participant',
          dealLabel,
          processLabel: resolvedProcessName || company,
          variantLabel: 'Current',
          companyLabel: formatCompany(p),
        });
        seenReportIds.add(reportId);
      });
    }

    // 3. Live current map — the user's working canvas should appear as
    //    an artefact even before they generate a report or call
    //    replace_all_steps. Previously gated on !dealId, which meant
    //    deal-scoped users couldn't see their in-progress work in the
    //    panel until the (one-shot) report generation finished. Now
    //    surfaced for both contexts: outside a deal it's just "Current",
    //    inside a deal it's tagged with the user's participant company
    //    so it groups under the right deal/process/company tree.
    if (Array.isArray(processData?.steps) && processData.steps.length > 0) {
      // Find the current user's participant row (if any) so we can
      // attach company + role context to the live entry.
      const myEmail = (sessionUser?.email || '').toLowerCase();
      const me = (dealParticipantsForArtefacts || []).find(
        (p) => (p.participant_email || p.participantEmail || '').toLowerCase() === myEmail,
      );
      const liveProcessLabel = resolvedProcessName
        || processData.processName
        || (me ? (me.companyName || me.company_name || me.company) : null);
      list.push({
        kind: 'flow_snapshot',
        label: 'Current',
        snapshot: processData,
        dealLabel,
        processLabel: liveProcessLabel,
        variantLabel: 'Current',
        companyLabel: dealId ? formatCompany(me) : null,
        source: 'live',
      });
    }

    return list;
  }, [chatMessages, dealId, dealName, dealCanonicalProcessName, dealProcessName, dealParticipantsForArtefacts, processData]);

  // Persistent generated outputs (workspace_artefacts) merged into the
  // rail Artefacts slider so every artefact — however it was produced
  // (emit_artefact, manual create) — sits in one list. Selecting one
  // opens the Outputs canvas focused on it. Fetched lazily when the
  // panel opens; the Outputs tab owns its own live refresh.
  const [outputsArtefacts, setOutputsArtefacts] = useState([]);
  useEffect(() => {
    if (!showArtefactsPanel || !accessToken) return undefined;
    let cancelled = false;
    (async () => {
      try {
        let mid = selectedOperatingModelId;
        if (!mid) {
          const meR = await apiFetch('/api/me/operating-model', {}, accessToken);
          const me = meR.ok ? await meR.json() : null;
          mid = me?.modelId || null;
        }
        if (!mid || cancelled) return;
        const r = await apiFetch(`/api/operating-models/${mid}/artefacts`, { dedupe: false }, accessToken);
        const d = r.ok ? await r.json() : null;
        if (!cancelled && d) setOutputsArtefacts(Array.isArray(d.artefacts) ? d.artefacts : []);
      } catch { /* slider falls back to session artefacts only */ }
    })();
    return () => { cancelled = true; };
  }, [showArtefactsPanel, selectedOperatingModelId, accessToken]);

  // Show only the latest of each version lineage (mirrors the Outputs tab).
  const outputsTips = useMemo(() => {
    const arr = outputsArtefacts || [];
    const byId = new Map(arr.map((a) => [a.id, a]));
    const superseded = new Set(
      arr.map((a) => a.meta?.supersedes).filter((p) => p && byId.has(p)),
    );
    return arr.filter((a) => !superseded.has(a.id));
  }, [outputsArtefacts]);

  const artefactCount = sessionArtefacts.length + outputsTips.length;

  // Open the Outputs canvas focused on a specific generated artefact.
  const openOutputArtefact = (a) => () => {
    setShowArtefactsPanel(false);
    if (isMobile) setMobileView('canvas');
    if (typeof window !== 'undefined') {
      window.__vesnoPendingOutputArtefact = a.id;
      window.dispatchEvent(new CustomEvent('vesno:open-workspace', { detail: { scope: 'outputs', artefactId: a.id } }));
      window.dispatchEvent(new CustomEvent('vesno:open-output-artefact', { detail: { id: a.id } }));
    }
  };

  // Show chat history panel or regular chat. Artefacts opens as a slide-in
  // alongside the rail (see the RailSlidePanel below) so it doesn't displace
  // the conversation surface — same UX as Reports / Deals / Docs.
  let activeChatContent;
  if (showChatHistory) {
    activeChatContent = <ChatHistoryPanel onClose={() => setShowChatHistory(false)} onLoadReport={handleLoadReport} />;
  } else {
    activeChatContent = chatContent;
  }

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

  // Positions are stored as {dx, dy} offsets keyed by step count only - no layout
  // - so the same manual adjustments apply in grid, wrap, and swimlane views.
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
    // Immediately reconcile decision branches - no async effect needed
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
    // Immediately reconcile decision branches - no async effect needed
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
      if (n === idx) return null; // edge touching deleted node - drop it
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
          swimlaneBy={swimlaneBy}
          functionsFlat={workspaceFunctions}
          roles={workspaceTeams}
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
            // the actual layout - we just preserve any manual drag adjustments.
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

            // Only carry forward remapped deletions - don't suppress the new
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

  const handleSaveToReport = useCallback(async () => {
    if (!editingReportId) return;
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
      // surface=target routes the canvas updates into target_data on the
      // server. The client knows which surface it loaded from
      // editingSurface (set in DiagnosticClient when it processed the
      // ?surface= URL param).
      const surface = editingSurface === 'target' ? 'target' : undefined;
      const resp = await apiFetch('/api/update-diagnostic', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: editingReportId, updates, ...(surface ? { surface } : {}) }),
      }, accessToken);
      let data;
      try { data = await resp.json(); } catch (e) { alert('Invalid response from server. Please try again.'); return; }
      if (resp.ok && data.success) {
        // Target-surface saves return the user to the design surface so they
        // see the updated diff alongside current. Deal-scoped saves keep
        // their existing flow (back into the chat with deal context).
        if (surface === 'target') {
          // Preserve the deal scope across the post-save redirect.
          window.location.href = `/workspace/map?view=${encodeURIComponent(editingReportId)}`
            + (dealId ? `&deal=${encodeURIComponent(dealId)}` : '');
        } else if (dealId) {
          window.location.href = `/workspace/map?deal=${encodeURIComponent(dealId)}`;
        } else {
          window.location.href = `/workspace/map`;
        }
      } else {
        alert(data.error || 'Failed to save changes.');
      }
    } catch {
      alert('Network error. Please try again.');
    } finally {
      setSavingToReport(false);
    }
  }, [editingReportId, editingSurface, dealId, contact, buildFreshProcessData, accessToken]);

  const readyToGenerate = useMemo(() => {
    if (editingReportId) return false;
    const valid = steps.filter((s) => (s.name || '').trim());
    if (valid.length < MIN_STEPS) return false;
    try {
      return computePhaseState({ steps, handoffs }).overallComplete;
    } catch { return false; }
  }, [steps, handoffs, editingReportId]);

  const diagnosticNav = useDiagnosticNav();
  const registerNav = diagnosticNav?.registerNav;
  useEffect(() => {
    if (!registerNav) return;
    registerNav({
      onBack: editingReportId ? () => { window.location.href = '/workspace/map'; } : () => goToScreen(teamMode ? 1 : 0),
      onContinue: editingReportId ? undefined : handleContinue,
      onSaveToReport: editingReportId ? handleSaveToReport : undefined,
      savingToReport,
      saveLabel: undefined,
    });
    return () => registerNav(null);
  }, [registerNav, teamMode, handleContinue, goToScreen, editingReportId, handleSaveToReport, savingToReport]);

  return (
    <>
      <div className="s7-workspace" data-theme={theme}>

        {/* ── Workspace context banner ── for signed-in users with a model.
             Renders nothing for anonymous users, deal-scoped chats, or
             edit-mode chats (those have their own banners). */}
        <WorkspaceContextStrip
          accessToken={accessToken}
          hide={!sessionUser || !!dealId || !!editingReportId}
        />

        {/* ── Target-surface banner ── shown when ?surface=target was used
             to enter the chat. Saves write to target_data, not the canvas. */}
        {editingSurface === 'target' && editingReportId && (
          <div className="s7-target-mode-bar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
            </svg>
            <span>
              Editing <strong>target state</strong> — changes save to <code>target_data</code>.
              {' '}
              <a href={`/workspace/map?view=${encodeURIComponent(editingReportId)}${dealId ? `&deal=${encodeURIComponent(dealId)}` : ''}`}>&larr; Back to current view</a>
            </span>
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

        {/* ── Inline save overlay ── shown while the canvas is being
             saved to the live `processes` row. The underlying call is a
             plain upsert (no LLM, no analysis); the overlay just exists
             so the page doesn't feel frozen on a slow network. */}
        {inlineGenerateStatus === 'generating' && (
          <div className="s7-redesign-overlay" role="status" aria-live="polite">
            <div className="s7-redesign-overlay-card">
              <div className="s7-redesign-spinner" />
              <p className="s7-redesign-overlay-title">Saving your process</p>
              <p className="s7-redesign-overlay-progress">{inlineGenerateProgress || 'Saving to the workspace…'}</p>
            </div>
          </div>
        )}
        {inlineGenerateStatus === 'error' && (
          <div className="s7-redesign-error-bar" role="alert">
            <span>{inlineGenerateError || 'Save failed. Please try again.'}</span>
            <button type="button" onClick={() => { setInlineGenerateStatus('idle'); runInlineGenerate(processData); }}>Retry</button>
            <button type="button" onClick={() => setInlineGenerateStatus('idle')}>Dismiss</button>
          </div>
        )}

        {/* ── Before flowchart: full-width describe + floating chat. After: rail + chat + resize + canvas ──
            Also use the split layout when an inline report or cost analysis
            is open, even with no flow yet — that's how clicked artefacts
            from the panel render their iframe (with the "Open in new tab"
            link in the canvas topbar) instead of becoming silent no-ops. */}
        {/* Mobile chat ⇄ canvas toggle. Lifted OUT of the split-view
            branch so it shows even when no flow / artefact is open
            yet — without this the user has no toggle visible during
            an early deal chat (which is what was reported). The
            "Canvas" tab does the right thing depending on what's
            available: existing canvas column when a flow / inline
            artefact exists, otherwise a friendly empty-state below. */}
        {isMobile && (
          <div className="s7-mobile-view-toggle" role="tablist" aria-label="Workspace view">
            <button
              type="button"
              role="tab"
              aria-selected={mobileView === 'chat'}
              className={`s7-mobile-view-tab${mobileView === 'chat' ? ' active' : ''}`}
              onClick={() => setMobileView('chat')}
            >Chat</button>
            <button
              type="button"
              role="tab"
              aria-selected={mobileView === 'canvas'}
              className={`s7-mobile-view-tab${mobileView === 'canvas' ? ' active' : ''}`}
              onClick={() => setMobileView('canvas')}
            >Canvas</button>
          </div>
        )}
        {(hasFlowArtifact || workspaceCanvasOpen) ? (
        <div
          ref={splitAreaRef}
          className="s7-canvas-area s7-canvas-area--split"
          data-mobile-view={isMobile ? mobileView : undefined}
        >
          <nav className="s7-split-rail" data-theme={theme} aria-label="Mapping tools">
            <div className="s7-split-rail-body">
              {/* Order: Home · Dashboard · Reports · Deals · Chat · Artefacts ·
                  View report · Save to report · Cost analysis · Steps list ·
                  Docs · Replay walkthrough · Activity log. Settings is in the
                  footer below. */}
              <HomeRailButton />
              {sessionUser && (
                <a
                  href="/org-admin"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="s7-split-rail-btn s7-split-rail-link"
                  title="Admin dashboard"
                  aria-label="Admin dashboard"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="3" y="3" width="7" height="7" rx="1" />
                    <rect x="14" y="3" width="7" height="7" rx="1" />
                    <rect x="3" y="14" width="7" height="7" rx="1" />
                    <rect x="14" y="14" width="7" height="7" rx="1" />
                  </svg>
                </a>
              )}
              {/* Deals + Analytics moved into the workspace tabs.
                  WorkspaceRailButton is the entry point; from the
                  workspace, the user picks Deals or Analytics tabs. */}
              {sessionUser && <WorkspaceRailButton />}
              <button type="button" className={`s7-split-rail-btn${showChatHistory ? ' active' : ''}`} onClick={() => setShowChatHistory((v) => !v)} title="Chat history">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/><line x1="9" y1="10" x2="15" y2="10"/><line x1="9" y1="14" x2="13" y2="14"/></svg>
              </button>
              <button ref={artefactsBtnRef} type="button" className={`s7-split-rail-btn${showArtefactsPanel ? ' active' : ''}${artefactCount > 0 ? ' has-artefacts' : ''}`} onClick={() => setShowArtefactsPanel((v) => !v)} title={`Artefacts${artefactCount ? ` (${artefactCount})` : ''}`}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
                {artefactCount > 0 && <span className="s7-split-rail-count">{artefactCount}</span>}
              </button>
              {editingReportId && (
                <button type="button" className="s7-split-rail-btn" onClick={handleSaveToReport} disabled={savingToReport} title={savingToReport ? 'Saving…' : 'Save changes'}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M17 17a4 4 0 0 0 .8-7.93A6 6 0 0 0 6.34 8.5 4.5 4.5 0 0 0 7 17h10z"/>
                    <polyline points="9 13 12 10 15 13"/>
                    <line x1="12" y1="10" x2="12" y2="17"/>
                  </svg>
                </button>
              )}
              <button ref={stepsBtnRef} type="button" className={`s7-split-rail-btn${floatingPanel === 'steps' ? ' active' : ''}`} onClick={() => setFloatingPanel((p) => (p === 'steps' ? null : 'steps'))} title="Steps list">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1.5"/><circle cx="4" cy="12" r="1.5"/><circle cx="4" cy="18" r="1.5"/></svg>
                {steps.length > 0 && <span className="s7-split-rail-count">{steps.length}</span>}
              </button>
              {/* Handover to a colleague — opens the modal that captures
                  recipient + comments + sender name and emails them a
                  resume link. Defined in this component (~line 2986)
                  but the rail JSX wasn't mounting it. */}
              {/* Handover-to-colleague button removed: relied on
                  /api/progress (410). Sharing happens via deal
                  collaborators now. */}
              {/* Analytics moved into the workspace's Analytics tab. */}
              {/* Bottom group — Docs · Replay walkthrough · Activity log.
                  margin-top: auto pushes them to the end of the rail body
                  so they sit just above the footer (Settings). */}
              <div className="s7-split-rail-bottom-group" style={{ marginTop: 'auto' }}>
                <DocsRailButton />
                <button
                  type="button"
                  className="s7-split-rail-btn"
                  onClick={replayGuide}
                  title="Replay walkthrough"
                  aria-label="Replay walkthrough"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </button>
                {sessionUser && typeof onAuditTrailToggle === 'function' && (
                  <button ref={activityBtnRef} type="button" className={`s7-split-rail-btn${auditTrailOpen ? ' active' : ''}`} onClick={onAuditTrailToggle} title="Activity log">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  </button>
                )}
              </div>
            </div>
            <div className="s7-split-rail-footer">
              {sessionUser ? (
                <SettingsRailButton accessToken={accessToken} sessionUser={sessionUser} onSignOut={signOut} />
              ) : (
                <MapRailPortalFooter sessionUser={sessionUser} onSignOut={signOut} />
              )}
            </div>
          </nav>
          <div
            className="s7-inline-chat s7-inline-chat--sized"
            data-theme={theme}
            // On mobile we let the CSS take over (full-width column).
            // The persisted desktop pixel width would otherwise win and
            // force horizontal overflow on phones.
            style={isMobile ? undefined : { width: splitChatWidthPx, flex: '0 0 auto' }}
          >
            <div className="s7-inline-chat-header">
              <div className="sharp-avatar sharp-avatar-sm" title="Reina">R</div>
              <span className="s7-inline-chat-title">{showChatHistory ? 'History' : 'AI Assistant'}</span>
              {/* Credits widget pinned to the top-right of the chat panel.
                  Re-fetches after each chat turn so the count drops live. */}
              <span style={{ marginLeft: 'auto' }}>
                <CreditsWidget accessToken={accessToken} refreshKey={creditsRefreshKey} />
              </span>
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
          {(viewOnlyProcessId || editingReportId) && (
            <div className="s7-canvas-back-bar" data-theme={theme}>
              <a
                href={dealId ? `/deals/${encodeURIComponent(dealId)}/workspace` : '/workspace'}
                className="s7-canvas-back-link"
                title={dealId
                  ? 'Back to deal workspace (Cmd/Ctrl+click to open in a new tab)'
                  : 'Back to workspace (Cmd/Ctrl+click to open in a new tab)'}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
                  e.preventDefault();
                  window.dispatchEvent(new CustomEvent('vesno:open-workspace'));
                }}
              >&larr; Back to {dealId ? 'deal workspace' : 'workspace'}</a>
              <span className="s7-canvas-back-bar-sep">·</span>
              <span className="s7-canvas-back-bar-title">
                {processData?.processName || 'Process'}
              </span>
            </div>
          )}
          {workspaceCanvasOpen && (
            <div className="s7-workspace-canvas-overlay">
              <div className="s7-workspace-canvas-bar">
                {/* Left group: scope nav + (when drilled in) a back-to-list
                    button. Wrapped in a div so the bar's space-between
                    keeps both anchored left and the actions group right. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <WorkspaceScopeNav
                    active={effectiveCanvasScope}
                    onSelect={(scope) => {
                      // Clicking the active pill while drilled in pops
                      // back to that scope's picker list. Since the
                      // overlay owns its selection outright now (no
                      // chat-context fallback), simply nulling the id
                      // shows the picker.
                      if (scope === 'deals' && effectiveCanvasScope === 'deals' && effectiveCanvasDealId) {
                        setCanvasDealId(null);
                        return;
                      }
                      if (scope === 'standard' && effectiveCanvasScope === 'standard' && effectiveCanvasModelId) {
                        setCanvasModelId(null);
                        return;
                      }
                      setCanvasScope(scope);
                    }}
                  />
                  {((effectiveCanvasScope === 'deals' && effectiveCanvasDealId)
                    || (effectiveCanvasScope === 'standard' && effectiveCanvasModelId)) && (
                    <button
                      type="button"
                      className="s7-workspace-canvas-back"
                      onClick={() => {
                        if (effectiveCanvasScope === 'deals') {
                          setCanvasDealId(null);
                          setCanvasDealSeed(null);
                        } else {
                          setCanvasModelId(null);
                        }
                      }}
                      title={effectiveCanvasScope === 'deals' ? 'Back to all deals' : 'Back to all models'}
                      style={{
                        padding: '4px 10px',
                        fontSize: 12,
                        border: '1px solid var(--border, #e2e8f0)',
                        borderRadius: 6,
                        background: 'transparent',
                        color: 'var(--text-mid, #64748b)',
                        cursor: 'pointer',
                        fontWeight: 500,
                      }}
                    >&larr; {effectiveCanvasScope === 'deals' ? 'All deals' : 'All models'}</button>
                  )}
                </div>
                <div className="s7-workspace-canvas-actions">
                  <a
                    className="s7-workspace-canvas-link"
                    href={
                      effectiveCanvasScope === 'outputs'
                        ? '/workspace?view=outputs'
                      : effectiveCanvasScope === 'standard'
                        ? (effectiveCanvasModelId
                            ? `/workspace?modelId=${encodeURIComponent(effectiveCanvasModelId)}`
                            : '/workspace?view=standard')
                      : (effectiveCanvasDealId
                            ? `/deals/${encodeURIComponent(effectiveCanvasDealId)}/workspace`
                            : '/workspace?view=deals')
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                  >Open in new tab</a>
                  <button
                    type="button"
                    className="chat-history-action-btn"
                    onClick={() => setWorkspaceCanvasOpen(false)}
                    aria-label="Close workspace"
                    title="Close"
                  >×</button>
                </div>
              </div>
              <div className="s7-workspace-canvas-body">
                {effectiveCanvasScope === 'outputs' && (
                  <WorkspaceOutputsTab modelId={effectiveCanvasModelId || null} accessToken={accessToken} />
                )}
                {effectiveCanvasScope === 'standard' && (
                  effectiveCanvasModelId
                    ? <WorkspaceCanvasClient embedded modelId={effectiveCanvasModelId} />
                    : <WorkspaceModelsTab
                        accessToken={accessToken}
                        onModelOpen={(id, m) => {
                          // Same atomic pattern as the deal picker:
                          // both state updates land in one React batch
                          // so the canvas swap and the chat-context
                          // anchor flow into a single render pass.
                          setCanvasModelId(id);
                          setWorkspaceAnchors({
                            operatingModelId: id,
                            operatingModelName: m?.name || null,
                          });
                          // Clear deal context so WorkspaceContextStrip
                          // (hidden when dealId is set) re-renders with
                          // the picked model. Without this, switching
                          // from a deal to Standard kept the deal chip
                          // pinned in the chat and the model name never
                          // appeared.
                          if (dealId) setDeal({});
                        }}
                      />
                )}
                {effectiveCanvasScope === 'deals' && (
                  effectiveCanvasDealId
                    ? <DealWorkspaceCanvasClient
                        dealId={effectiveCanvasDealId}
                        embedded
                        initialDeal={canvasDealSeed && canvasDealSeed.deal?.id === effectiveCanvasDealId ? canvasDealSeed : null}
                      />
                    : <WorkspaceDealsTab
                        accessToken={accessToken}
                        onDealOpen={(id, row) => {
                          // Atomic state update: canvas selection +
                          // shell seed + chat context all in one batch.
                          // The seed lets DealWorkspaceClient render
                          // immediately with name/type/status from the
                          // picker row, so there's no loading flash
                          // when its own /api/deals fetch resolves.
                          setCanvasDealId(id);
                          setCanvasDealSeed({
                            deal: {
                              id,
                              dealCode: row?.dealCode || row?.deal_code || null,
                              type: row?.type || null,
                              name: row?.name || null,
                              processName: row?.processName || row?.process_name || null,
                              status: row?.status || null,
                            },
                            participants: [],
                            flows: [],
                            summary: {},
                          });
                          setDeal({
                            dealId: id,
                            dealCode: row?.dealCode || row?.deal_code || null,
                            dealName: row?.name || null,
                            dealRole:
                              row?.ownerRole || row?.accessMode || row?.role || null,
                            dealParticipants: [],
                          });
                        }}
                      />
                )}
              </div>
            </div>
          )}
          {/* Full-screen mobile gate — fronts any flow / report surface
              until the user actively chooses to continue on mobile. */}
          <MobileViewGate active={!!(steps?.length > 0)} />
          {(
            <>
              <div className="s7-canvas-topbar">
                <div className="s7-view-toggle">
                  {['grid', 'swimlane'].map(m => (
                    <button key={m} type="button" className={`s7-view-btn${previewViewMode === m ? ' active' : ''}`} onClick={() => setPreviewViewMode(m)}>
                      {m === 'grid' ? 'Grid' : 'Swimlane'}
                    </button>
                  ))}
                </div>
                {previewViewMode === 'swimlane' && (
                  <div className="s7-view-toggle s7-swimlane-by-toggle" style={{ marginLeft: 8 }} title="Group swimlanes by">
                    {[
                      { id: 'role',        label: 'Role' },
                      { id: 'subfunction', label: 'Sub-function' },
                      { id: 'function',    label: 'Function' },
                    ].map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        className={`s7-view-btn${swimlaneBy === o.id ? ' active' : ''}`}
                        onClick={() => setSwimlaneBy(o.id)}
                      >{o.label}</button>
                    ))}
                  </div>
                )}
              </div>
              <div ref={previewCanvasRef} className="s7-canvas">
                <CanvasActionOverlay inline />
                {/* Guard the React Flow mount on namedSteps having content.
                    The split-view layout can now activate without a flow
                    (when an inline report/cost iframe is open from the
                    artefacts panel). During state transitions React can
                    briefly land in this else-branch with empty steps,
                    which made react-flow log "parent container needs a
                    width and a height" warnings even though the warning
                    was transient. Match the guard pattern at L4802. */}
                {namedSteps.length > 0 && (
                <InteractiveFlowCanvas
                  process={{ ...processData, steps, handoffs: ensureHandoffs(steps, handoffs) }}
                  layout={previewViewMode}
                  swimlaneBy={swimlaneBy}
                  functionsFlat={workspaceFunctions}
                  roles={workspaceTeams}
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
                )}
              </div>
            </>
          )}
          </div>
        </div>
        ) : (
        <div
          className="s7-canvas-area s7-canvas-area--with-rail"
          data-mobile-view={isMobile ? mobileView : undefined}
        >
          <nav className="s7-split-rail" data-theme={theme} aria-label="Mapping tools">
            <div className="s7-split-rail-body">
              {/* Same canonical order as the with-flow rail above. */}
              <HomeRailButton />
              {sessionUser && (
                <a
                  href="/org-admin"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="s7-split-rail-btn s7-split-rail-link"
                  title="Admin dashboard"
                  aria-label="Admin dashboard"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="3" y="3" width="7" height="7" rx="1" />
                    <rect x="14" y="3" width="7" height="7" rx="1" />
                    <rect x="3" y="14" width="7" height="7" rx="1" />
                    <rect x="14" y="14" width="7" height="7" rx="1" />
                  </svg>
                </a>
              )}
              {/* Deals + Analytics moved into the workspace tabs.
                  WorkspaceRailButton is the entry point; from the
                  workspace, the user picks Deals or Analytics tabs. */}
              {sessionUser && <WorkspaceRailButton />}
              <button type="button" className={`s7-split-rail-btn${showChatHistory ? ' active' : ''}`} onClick={() => setShowChatHistory((v) => !v)} title="Chat history">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/><line x1="9" y1="10" x2="15" y2="10"/><line x1="9" y1="14" x2="13" y2="14"/></svg>
              </button>
              <button ref={artefactsBtnRef} type="button" className={`s7-split-rail-btn${showArtefactsPanel ? ' active' : ''}${artefactCount > 0 ? ' has-artefacts' : ''}`} onClick={() => setShowArtefactsPanel((v) => !v)} title={`Artefacts${artefactCount ? ` (${artefactCount})` : ''}`}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
                {artefactCount > 0 && <span className="s7-split-rail-count">{artefactCount}</span>}
              </button>
              {editingReportId && (
                <button type="button" className="s7-split-rail-btn" onClick={handleSaveToReport} disabled={savingToReport} title={savingToReport ? 'Saving…' : 'Save changes'}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M17 17a4 4 0 0 0 .8-7.93A6 6 0 0 0 6.34 8.5 4.5 4.5 0 0 0 7 17h10z"/>
                    <polyline points="9 13 12 10 15 13"/>
                    <line x1="12" y1="10" x2="12" y2="17"/>
                  </svg>
                </button>
              )}
              <button ref={stepsBtnRef} type="button" className={`s7-split-rail-btn${floatingPanel === 'steps' ? ' active' : ''}`} onClick={() => setFloatingPanel((p) => (p === 'steps' ? null : 'steps'))} title="Steps list">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1.5"/><circle cx="4" cy="12" r="1.5"/><circle cx="4" cy="18" r="1.5"/></svg>
              </button>
              {/* Handover-to-colleague button removed: relied on
                  /api/progress (410). Sharing happens via deal
                  collaborators now. */}
              {/* Analytics moved into the workspace's Analytics tab. */}
              <div className="s7-split-rail-bottom-group" style={{ marginTop: 'auto' }}>
                <DocsRailButton />
                <button
                  type="button"
                  className="s7-split-rail-btn"
                  onClick={replayGuide}
                  title="Replay walkthrough"
                  aria-label="Replay walkthrough"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </button>
                {typeof onAuditTrailToggle === 'function' && (
                  <button ref={activityBtnRef} type="button" className={`s7-split-rail-btn${auditTrailOpen ? ' active' : ''}`} onClick={onAuditTrailToggle} title="Activity log">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  </button>
                )}
              </div>
            </div>
            <div className="s7-split-rail-footer">
              {sessionUser ? (
                <SettingsRailButton accessToken={accessToken} sessionUser={sessionUser} onSignOut={signOut} />
              ) : (
                <MapRailPortalFooter sessionUser={sessionUser} onSignOut={signOut} />
              )}
            </div>
          </nav>
          <div className="s7-map-landing" data-theme={theme} style={{ position: 'relative' }}>
            {/* Credits pill — also mounted here (no-flow chat surface) so the
                user sees their trial balance before any steps are mapped.
                The split-view branch above mounts its own copy in the chat
                header. */}
            <span className="chat-main-panel-topright">
              <CreditsWidget accessToken={accessToken} refreshKey={creditsRefreshKey} />
            </span>
            <CanvasActionOverlay />
            {activeChatContent}
          </div>
          {/* Mobile-only empty state for the Canvas tab when there's
              nothing yet to render — without this the user picks
              Canvas and sees a blank screen. CSS shows it only when
              data-mobile-view='canvas' on the parent. */}
          {isMobile && (
            <div className="s7-mobile-canvas-empty">
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>No canvas yet</div>
              <p style={{ fontSize: 13, color: 'var(--text-mid, #64748b)', maxWidth: 320, lineHeight: 1.5 }}>
                Map a process or open an analysis from the Artefacts panel — once a flow exists it'll show here.
              </p>
              <button
                type="button"
                onClick={() => setMobileView('chat')}
                className="s7-mobile-canvas-empty-cta"
              >Back to chat</button>
            </div>
          )}
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

      {/* Rail slide-in panels — Steps · Artefacts · Activity log all open
          as slide-ins anchored to the rail's right edge so every rail icon
          opens with the same UX as Reports / Deals / Docs. */}

      <RailSlidePanel
        open={floatingPanel === 'steps'}
        onClose={() => setFloatingPanel(null)}
        triggerRef={stepsBtnRef}
        title={`Steps${steps.length > 0 ? ` (${steps.length})` : ''}`}
      >
        <div className="s7-rail-pane-body s7-rail-pane-body--padded">
          {stepListContent}
        </div>
      </RailSlidePanel>

      <RailSlidePanel
        open={showArtefactsPanel}
        onClose={() => setShowArtefactsPanel(false)}
        triggerRef={artefactsBtnRef}
        title={`Artefacts${artefactCount > 0 ? ` (${artefactCount})` : ''}`}
        headerRight={(
          <button
            type="button"
            className="s7-rail-pane-clear"
            onClick={pinCurrentFlow}
            title="Snapshot the current flow"
          >Pin current</button>
        )}
      >
        <div className="s7-rail-pane-body">
          {outputsTips.length > 0 && (
            <div className="s7-rail-out-group">
              <div className="s7-rail-out-head">Outputs</div>
              <ul className="s7-rail-out-list">
                {outputsTips.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      className="s7-rail-out-item"
                      onClick={openOutputArtefact(a)}
                      title={a.title || 'Untitled'}
                    >
                      <span className="s7-rail-out-badge">{a.type}</span>
                      <span className="s7-rail-out-item-main">
                        <span className="s7-rail-out-item-title">{a.title || 'Untitled'}</span>
                        <span className="s7-rail-out-item-meta">
                          {a.source === 'agent' ? 'Assistant' : 'You'}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {sessionArtefacts.length === 0 ? (
            outputsTips.length === 0 ? (
              <div className="s7-rail-pane-empty">
                No artefacts yet. Generated outputs (tables, docs, code, plans), redesigns, and snapshots will appear here.
              </div>
            ) : null
          ) : (() => {
            // Build a 4-level tree from sessionArtefacts:
            //   Deal → Process → Variant (Current/Redesign/...) → leaves
            // Map preserves insertion order so the panel reads in the
            // same order the build pass produced (participants first,
            // then analyses, then live).
            const labelFor = (kind) => (
              kind === 'flow_snapshot' ? 'Flow snapshot'
                : kind === 'report' ? 'Report'
                  : kind === 'cost_analysis' ? 'Cost analysis'
                    : kind === 'deal_analysis' ? 'Deal analysis'
                      : 'Artefact'
            );
            // Per-kind suggestion chips. The user wanted the chat to
            // greet the user when an artefact opens with "you opened X,
            // here's what we can do" — so we drop a single assistant
            // message tagged with quick-action chips. Tapping a chip
            // sends the chip text into the chat (sendChat already
            // handles chips this way), which gives the agent direct
            // context about the artefact and what to do with it.
            const SUGGESTIONS = {
              report: [
                'Summarise this process',
                'Where are the bottlenecks?',
                'Suggest improvements',
              ],
              deal_analysis: [
                'How does it compare to the current process?',
                'Estimate the savings',
                'Highlight the biggest risks',
              ],
              cost_analysis: [
                'Summarise the cost picture',
                'Find the biggest line items',
                'Where can we save the most?',
              ],
              flow_snapshot: [
                'Walk me through this flow',
                'Identify pain points',
                'Suggest improvements',
              ],
            };
            const greet = (a) => {
              const kindLabel = labelFor(a.kind);
              const titleParts = [];
              if (a.processLabel) titleParts.push(a.processLabel);
              if (a.companyLabel) titleParts.push(a.companyLabel);
              const title = titleParts.length ? titleParts.join(' · ') : (a.label || kindLabel);
              const variantNote = a.variantLabel && a.variantLabel !== a.processLabel
                ? ` (${a.variantLabel})`
                : '';
              const chips = (SUGGESTIONS[a.kind] || []).map((name) => ({ name }));
              addChatMessage({
                role: 'assistant',
                content: `Opened **${title}**${variantNote} — ${kindLabel.toLowerCase()}.\n\nWhat would you like to do with it?`,
                chips,
              });
            };
            const handle = (a) => () => {
              setShowArtefactsPanel(false);
              if (isMobile) setMobileView('chat');
              if (a.kind === 'flow_snapshot') {
                setArtefactPreview(a.snapshot);
              }
              greet(a);
            };
            const FALLBACK_DEAL = 'Not in a deal';
            const FALLBACK_PROCESS = 'Other process';
            const FALLBACK_VARIANT = 'Other';
            // Stable id for archive filter — uses refId for persisted
            // artefacts and a synthetic key for in-memory snapshots.
            const artefactId = (a) => a.refId || `${a.kind}:${a.label || ''}:${a.variantLabel || ''}`;
            const tree = new Map(); // dealKey → Map<processKey, Map<variantKey, [artefact]>>
            for (const a of sessionArtefacts) {
              if (archivedArtefactIds.has(artefactId(a))) continue;
              const dKey = a.dealLabel || FALLBACK_DEAL;
              const pKey = a.processLabel || FALLBACK_PROCESS;
              const vKey = a.variantLabel || FALLBACK_VARIANT;
              if (!tree.has(dKey)) tree.set(dKey, new Map());
              const procs = tree.get(dKey);
              if (!procs.has(pKey)) procs.set(pKey, new Map());
              const variants = procs.get(pKey);
              if (!variants.has(vKey)) variants.set(vKey, []);
              variants.get(vKey).push(a);
            }
            const handleDeleteAnalysis = async (a) => {
              if (!a || a.kind !== 'deal_analysis' || !a.refId || !dealId) return;
              if (typeof window !== 'undefined' && !window.confirm('Delete this analysis? This cannot be undone.')) return;
              try {
                const resp = await fetch(`/api/deals/${encodeURIComponent(dealId)}/analyses/${encodeURIComponent(a.refId)}`, {
                  method: 'DELETE',
                  headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
                });
                if (!resp.ok) {
                  const err = await resp.json().catch(() => ({}));
                  alert(err.error || 'Delete failed.');
                  return;
                }
                // Hide locally now; the next deal-data refresh will drop it.
                archiveArtefact(a.refId);
              } catch (err) {
                alert('Delete failed: ' + err.message);
              }
            };
            const renderLeaf = (a, key) => {
              // Pencil routes to the canonical canvas edit mode:
              //   - report (current participant maps) → ?edit=<reportId>
              //   - deal_analysis (redesign output)   → ?editAnalysis=<id>&deal=<dealId>
              // Both URLs land in the existing /workspace/map edit
              // surface where the user gets the full canvas editor
              // (drag reorder, add/delete steps, step-detail panel).
              // Body click still uses the inline viewer so the user can
              // browse without leaving the deal chat.
              let editHref = null;
              if (a.kind === 'report' && a.refId) {
                editHref = `/workspace/map?edit=${encodeURIComponent(a.refId)}${dealId ? `&editFromDeal=${encodeURIComponent(dealId)}` : ''}`;
              } else if (a.kind === 'deal_analysis' && a.refId && dealId) {
                editHref = `/workspace/map?editAnalysis=${encodeURIComponent(a.refId)}&deal=${encodeURIComponent(dealId)}`;
              }
              const canDelete = a.kind === 'deal_analysis' && a.refId && dealId;
              const aId = artefactId(a);
              return (
                <li key={key}>
                  <div className="s7-rail-pane-item s7-rail-pane-item--row">
                    <button type="button" className="s7-rail-pane-item-body" onClick={handle(a)}>
                      <span className="s7-rail-pane-item-name">
                        {a.companyLabel || a.label || labelFor(a.kind)}
                      </span>
                      {!a.companyLabel && a.label && a.label !== a.variantLabel && (
                        <span className="s7-rail-pane-item-meta">{a.label}</span>
                      )}
                    </button>
                    <div className="s7-rail-pane-item-actions">
                      {editHref && (
                        <a href={editHref} className="chat-history-action-btn" title="Open in edit mode" aria-label="Edit"><IconEdit /></a>
                      )}
                      <button
                        type="button"
                        className="chat-history-action-btn"
                        title="Archive"
                        aria-label="Archive"
                        onClick={(e) => { e.stopPropagation(); archiveArtefact(aId); }}
                      ><IconArchive /></button>
                      {canDelete && (
                        <button
                          type="button"
                          className="chat-history-action-btn chat-history-action-btn--danger"
                          title="Delete"
                          aria-label="Delete"
                          onClick={(e) => { e.stopPropagation(); handleDeleteAnalysis(a); }}
                        ><IconDelete /></button>
                      )}
                    </div>
                  </div>
                </li>
              );
            };
            const isCollapsed = (k) => collapsedArtefactKeys.has(k);
            const ToggleHeader = ({ title, level, onClick, collapsed }) => {
              // Three depth presets so the visual hierarchy reads at a
              // glance: deal (level 0) is bold + uppercase eyebrow,
              // process (level 1) is bold primary text, variant (level
              // 2) is small mid-tone uppercase.
              const levelStyles = [
                { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.04, color: 'var(--text-mid, #64748b)' },
                { fontSize: 13, fontWeight: 700, color: 'var(--text, #1e293b)' },
                { fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.04, color: 'var(--text-mid, #64748b)' },
              ];
              return (
                <button
                  type="button"
                  className="s7-rail-pane-group-title"
                  onClick={onClick}
                  aria-expanded={!collapsed}
                  style={{ ...levelStyles[level], cursor: 'pointer' }}
                >
                  {/* Subtle chevron instead of the bordered +/- box. The
                      global .s7-rail-pane-group-toggle class adds a
                      border + sized square; override inline so the
                      indicator inherits the header's text colour and
                      reads as a quiet glyph rather than a button. */}
                  <span
                    aria-hidden
                    style={{
                      display: 'inline-block',
                      width: 10,
                      fontSize: 9,
                      lineHeight: 1,
                      color: 'inherit',
                      opacity: 0.55,
                      transform: collapsed ? 'rotate(-90deg)' : 'none',
                      transition: 'transform 120ms ease',
                    }}
                  >▾</span>
                  <span>{title}</span>
                </button>
              );
            };
            return (
              <div className="s7-rail-pane-groups">
                {[...tree.entries()].map(([dealKey, processes]) => {
                  const dealKeyId = `deal:${dealKey}`;
                  const dealCollapsed = isCollapsed(dealKeyId);
                  return (
                    <div className={`s7-rail-pane-group${dealCollapsed ? ' is-collapsed' : ''}`} key={dealKey}>
                      <ToggleHeader title={dealKey} level={0} onClick={() => toggleArtefactKey(dealKeyId)} collapsed={dealCollapsed} />
                      {!dealCollapsed && [...processes.entries()].map(([processKey, variants]) => {
                        const processKeyId = `process:${dealKey}/${processKey}`;
                        const processCollapsed = isCollapsed(processKeyId);
                        return (
                          <div key={processKey} style={{ marginLeft: 6 }} className={processCollapsed ? 'is-collapsed' : ''}>
                            <ToggleHeader title={processKey} level={1} onClick={() => toggleArtefactKey(processKeyId)} collapsed={processCollapsed} />
                            {!processCollapsed && [...variants.entries()].map(([variantKey, leaves]) => {
                              const variantKeyId = `variant:${dealKey}/${processKey}/${variantKey}`;
                              const variantCollapsed = isCollapsed(variantKeyId);
                              return (
                                <div key={variantKey} style={{ marginLeft: 10, marginTop: 2 }} className={variantCollapsed ? 'is-collapsed' : ''}>
                                  <ToggleHeader title={variantKey} level={2} onClick={() => toggleArtefactKey(variantKeyId)} collapsed={variantCollapsed} />
                                  {!variantCollapsed && (
                                    <ul className="s7-rail-pane-list">
                                      {leaves.map((a, i) => renderLeaf(a, `${dealKey}/${processKey}/${variantKey}/${i}`))}
                                    </ul>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      </RailSlidePanel>

      <RailSlidePanel
        open={!!auditTrailOpen}
        onClose={() => { if (typeof onAuditTrailToggle === 'function') onAuditTrailToggle(); }}
        triggerRef={activityBtnRef}
        title={`Activity log${auditTrail?.length ? ` (${auditTrail.length})` : ''}`}
      >
        <AuditTrailPanel
          auditTrail={auditTrail || []}
          onClose={() => { if (typeof onAuditTrailToggle === 'function') onAuditTrailToggle(); }}
          embedded
        />
      </RailSlidePanel>

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

      {/* First-visit guide tour */}
      {showGuide && <MapGuide onDismiss={dismissGuide} />}
      {/* CanvasActionOverlay is now rendered inline inside the canvas areas
          (see InteractiveFlowCanvas wrapper + s7-map-landing below) so the
          loading state visibly anchors to the right canvas / landing area
          rather than floating in the bottom-right corner of the screen. */}

      {artefactPreview && (() => {
        const pd = artefactPreview?.processData || artefactPreview || {};
        const pdSteps = Array.isArray(pd.steps) ? pd.steps : [];
        const pdHandoffs = Array.isArray(pd.handoffs) ? pd.handoffs : [];
        const restore = () => {
          if (!pdSteps.length) return;
          if (!confirm(`Replace the current canvas with this ${pdSteps.length}-step snapshot? Your current flow will be overwritten.`)) return;
          setSteps(pdSteps.map((s, i) => ({ ...s, number: i + 1 })));
          setHandoffs(ensureHandoffs(pdSteps, pdHandoffs));
          setFlowCustomEdges([]);
          setFlowDeletedEdges([]);
          flowCustomEdgesRef.current = [];
          flowDeletedEdgesRef.current = [];
          setFlowNodePositions(pd.flowNodePositions || {});
          setArtefactPreview(null);
          addChatMessage({ role: 'assistant', content: `Restored ${pdSteps.length}-step snapshot to the canvas.` });
        };
        return (
          <div className="s7-artefact-preview" role="dialog" aria-modal="true" onClick={() => setArtefactPreview(null)}>
            <div className="s7-artefact-preview-card" onClick={(e) => e.stopPropagation()}>
              <div className="s7-artefact-preview-hd">
                <strong>Flow snapshot{pd.processName ? ` - ${pd.processName}` : ''}</strong>
                <button type="button" className="s7-artefact-preview-close" onClick={() => setArtefactPreview(null)} aria-label="Close">×</button>
              </div>
              <div className="s7-artefact-preview-body">
                {!pdSteps.length ? (
                  <p className="s7-artefact-preview-empty">No steps captured.</p>
                ) : (
                  <ol className="s7-artefact-preview-list">
                    {pdSteps.map((s, i) => (
                      <li key={i}>
                        <span className="s7-artefact-preview-step-num">{i + 1}</span>
                        <span className="s7-artefact-preview-step-name">{s.name || 'Untitled step'}</span>
                        {s.department && <span className="s7-artefact-preview-step-dept">{s.department}</span>}
                        {s.isDecision && <span className="s7-artefact-preview-step-tag">decision</span>}
                        {s.isExternal && <span className="s7-artefact-preview-step-tag">external</span>}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              <div className="s7-artefact-preview-footer">
                <span className="s7-artefact-preview-count">{pdSteps.length} step{pdSteps.length === 1 ? '' : 's'}</span>
                <div className="s7-artefact-preview-actions">
                  <button type="button" className="s7-artefact-preview-btn s7-artefact-preview-btn--ghost" onClick={() => setArtefactPreview(null)}>Close</button>
                  <button type="button" className="s7-artefact-preview-btn s7-artefact-preview-btn--primary" onClick={restore} disabled={!pdSteps.length}>
                    Restore to canvas
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}