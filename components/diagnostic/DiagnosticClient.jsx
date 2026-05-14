'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { DiagnosticProvider, useDiagnostic } from './DiagnosticContext';
import { DiagnosticNavProvider } from './DiagnosticNavContext';
import { useAuth } from '@/lib/useAuth';
import { apiFetch } from '@/lib/api-fetch';
import { DEPT_INTERNAL, DEPT_EXTERNAL } from '@/lib/diagnostic/stepConstants';
import DealsRailButton from './chat/DealsRailButton';
import HomeRailButton from './chat/HomeRailButton';
import SettingsRailButton from './chat/SettingsRailButton';
import DocsRailButton from './chat/DocsRailButton';
import AnalyticsRailButton from './chat/AnalyticsRailButton';
import DealContextChip from './chat/DealContextChip';
import CreditsWidget from './chat/CreditsWidget';
import SignInRequired from './chat/SignInRequired';
import { CanvasActionProvider } from './chat/CanvasActionContext';
import CapabilityIntakePicker from './CapabilityIntakePicker';

const STANDARD_DEPTS = new Set([...DEPT_INTERNAL, ...DEPT_EXTERNAL]);

/** Extract non-standard department names from an array of rawProcess objects */
function extractCustomDepts(rawProcesses) {
  const custom = [];
  const seen = new Set();
  (rawProcesses || []).forEach((rp) => {
    (rp.steps || []).forEach((s) => {
      const d = (s.department || '').trim();
      if (d && !STANDARD_DEPTS.has(d) && !seen.has(d.toLowerCase())) {
        seen.add(d.toLowerCase());
        custom.push(d);
      }
    });
  });
  return custom;
}

/* Lazy load heavy screens and panels – diagnostic opens with minimal bundle */
const DiagnosticWorkspace = dynamic(() => import('./screens/DiagnosticWorkspace'), {
  ssr: false,
  loading: () => <div className="loading-state"><div className="loading-spinner" /><p>Loading workspace...</p></div>,
});
const ScreenLoading = () => <div className="loading-state"><div className="loading-spinner" /><p>Loading...</p></div>;
// Screen1SelectTemplate + Screen6Complete removed in living-workspace
// migration. There is no mandatory template-picker step (the chat agent
// can apply a template via replace_all_steps when the user asks) and no
// terminal "complete the audit" screen (saves land via inline upsert).
// AUDIT_SEGMENTS removed: it was a four-tile picker constant that was
// never actually rendered — pure dead code from the report-gen era.
const AuditTrailPanel = dynamic(() => import('./AuditTrailPanel'), { ssr: false });

// Map deal type + role to the closest audit segment for AI context
function dealRoleToSegment(dealType, role) {
  if (dealType === 'ma') return 'ma';
  if (dealType === 'pe_rollup') return 'pe';
  return 'scaling';
}

// Map legacy 'highstakes' stored value to current module ID
function normaliseModuleId(id) {
  if (id === 'highstakes') return 'high-risk-ops';
  return id || null;
}

const ROLE_LABEL = {
  platform_company: 'Platform Company',
  portfolio_company: 'Portfolio Company',
  acquirer: 'Acquirer',
  target: 'Target',
  self: 'Self',
};

function AuditGate({ onComplete, dealContext, onDealCodeResolved, sessionUser, accessToken }) {
  // dealContext: { participantToken, dealName, dealType, processName, companyName, role, participantName }
  const fromDeal = !!dealContext?.participantToken;

  const [name, setName] = useState(dealContext?.participantName || sessionUser?.user_metadata?.full_name || '');
  const [email, setEmail] = useState(sessionUser?.email || '');
  const [company, setCompany] = useState(dealContext?.companyName || '');
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  // Workspace anchors picked via CapabilityIntakePicker (signed-in users
  // with a default operating model only). Threaded into onComplete so the
  // new diagnostic_report row files under the chosen capability on insert.
  const [workspaceAnchor, setWorkspaceAnchor] = useState(null);

  const [dealCodeInput, setDealCodeInput] = useState('');
  const [dealCodeExpanded, setDealCodeExpanded] = useState(false);
  const [dealCodeLoading, setDealCodeLoading] = useState(false);
  const [dealCodeError, setDealCodeError] = useState('');
  const [resolvedFromCode, setResolvedFromCode] = useState(null);

  const handleDealCodeLookup = async () => {
    if (!dealCodeInput.trim()) return;
    setDealCodeLoading(true);
    setDealCodeError('');
    try {
      const resp = await fetch(`/api/deals/resolve?code=${encodeURIComponent(dealCodeInput.trim())}`);
      const data = await resp.json();
      if (!resp.ok) {
        setDealCodeError(data.error || 'Deal code not found.');
      } else {
        setResolvedFromCode(data);
        onDealCodeResolved(data);
      }
    } catch {
      setDealCodeError('Network error. Please try again.');
    } finally {
      setDealCodeLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      setError('Please enter your name and email to continue.');
      return;
    }
    const segment = fromDeal ? dealRoleToSegment(dealContext?.dealType, dealContext?.role) : null;
    onComplete({
      name: name.trim(),
      email: email.trim(),
      company: company.trim(),
      title: title.trim(),
      segment,
      dealParticipantToken: dealContext?.participantToken || null,
      dealCode: dealContext?.dealCode || resolvedFromCode?.dealCode || null,
      // Workspace anchors — only present for signed-in users who picked a
      // capability above. Deal-bound flows skip this; their anchoring
      // happens through deal_participants → deal_flows.
      operatingModelId:   !fromDeal ? (workspaceAnchor?.operatingModelId   || null) : null,
      functionId:       !fromDeal ? (workspaceAnchor?.functionId       || null) : null,
      functionPath:     !fromDeal ? (workspaceAnchor?.functionPath     || null) : null,
      operatingModelName: !fromDeal ? (workspaceAnchor?.modelName          || null) : null,
    });
  };

  return (
    <div className="audit-gate-screen">
      <div className="audit-gate-inner">
        <header className="audit-gate-hero">
          <div className="audit-gate-brand">
            Vesno<span>.</span>
          </div>
          {fromDeal ? (
            <>
              <h1 className="audit-gate-hero-title">You&apos;ve been invited to map a process</h1>
              <p className="audit-gate-hero-lede">
                <strong>{dealContext.dealName}</strong>
                {dealContext.processName ? ` · ${dealContext.processName}` : ''}
                {' - '}mapping for <strong>{dealContext.companyName}</strong>.
              </p>
              <div className="audit-gate-deal-notice">
                <span className="audit-gate-deal-notice-icon">🔒</span>
                <div>
                  <p className="audit-gate-deal-notice-text">
                    Your process map will be shared with the deal coordinator.
                    Other participants cannot see your data.
                  </p>
                  {dealContext.role && (
                    <p className="audit-gate-deal-notice-role">
                      Your role: <strong>{ROLE_LABEL[dealContext.role] || dealContext.role}</strong>
                      {dealContext.dealType === 'pe_rollup' && ' - your results will form part of the PE portfolio benchmark'}
                      {dealContext.dealType === 'ma' && dealContext.role === 'target' && ' - your baseline will be used for integration planning'}
                      {dealContext.dealType === 'ma' && dealContext.role === 'acquirer' && ' - your baseline will be compared with the target company'}
                    </p>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              <h1 className="audit-gate-hero-title">Map a new process</h1>
              <p className="audit-gate-hero-lede">
                Reina will walk you through it. Once you&apos;re done, the process lands in your workspace, already filed under the capability you pick.
              </p>
            </>
          )}
        </header>

        <form onSubmit={handleSubmit} noValidate>
          <div className="audit-gate-form">
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="audit-gate-name">Your name</label>
                <input
                  id="audit-gate-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Smith"
                  autoComplete="name"
                />
              </div>
              <div className="form-group">
                <label htmlFor="audit-gate-email">Work email</label>
                <input
                  id="audit-gate-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane@company.com"
                  autoComplete="email"
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="audit-gate-company">
                  Company{fromDeal ? '' : ' (optional)'}
                </label>
                <input
                  id="audit-gate-company"
                  type="text"
                  value={company}
                  onChange={fromDeal ? undefined : (e) => setCompany(e.target.value)}
                  readOnly={fromDeal}
                  placeholder="Acme Corp"
                  autoComplete="organization"
                  style={fromDeal ? { opacity: 0.65, cursor: 'default' } : undefined}
                />
              </div>
              <div className="form-group">
                <label htmlFor="audit-gate-title">Job title (optional)</label>
                <input
                  id="audit-gate-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Operations Manager"
                  autoComplete="organization-title"
                />
              </div>
            </div>
          </div>

          {!fromDeal && !resolvedFromCode && (
            <div className="audit-gate-deal-code-section">
              {!dealCodeExpanded ? (
                <button type="button" className="audit-gate-deal-code-toggle" onClick={() => setDealCodeExpanded(true)}>
                  Have a deal or invite code?
                </button>
              ) : (
                <div className="audit-gate-deal-code-form">
                  <label className="audit-gate-deal-code-label">Deal code</label>
                  <div className="audit-gate-deal-code-row">
                    <input
                      type="text"
                      className="audit-gate-deal-code-input"
                      placeholder="e.g. ABCD1234"
                      value={dealCodeInput}
                      onChange={(e) => setDealCodeInput(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === 'Enter' && handleDealCodeLookup()}
                      maxLength={20}
                    />
                    <button type="button" className="audit-gate-deal-code-btn" onClick={handleDealCodeLookup} disabled={dealCodeLoading}>
                      {dealCodeLoading ? 'Looking up…' : 'Find deal'}
                    </button>
                  </div>
                  {dealCodeError && <p className="audit-gate-deal-code-error">{dealCodeError}</p>}
                </div>
              )}
            </div>
          )}
          {!fromDeal && accessToken && (
            <CapabilityIntakePicker
              accessToken={accessToken}
              onChange={setWorkspaceAnchor}
            />
          )}
          {!fromDeal && resolvedFromCode && (
            <div className="audit-gate-deal-confirmed">
              <span className="audit-gate-deal-confirmed-icon">✓</span>
              <div>
                <p className="audit-gate-deal-confirmed-name">{resolvedFromCode.dealName}</p>
                <p className="audit-gate-deal-confirmed-meta">
                  {resolvedFromCode.dealType === 'pe_rollup' ? 'PE Roll-up' : resolvedFromCode.dealType === 'ma' ? 'M&A' : 'Scaling'}
                  {resolvedFromCode.processName ? ` · ${resolvedFromCode.processName}` : ''}
                </p>
              </div>
              <button type="button" className="audit-gate-deal-confirmed-clear" onClick={() => setResolvedFromCode(null)}>✕</button>
            </div>
          )}

          {error && <p className="audit-gate-error">{error}</p>}

          <button type="submit" className="audit-gate-submit">
            Map this process →
          </button>
        </form>

        <p className="audit-gate-footer">
          Already have an account? <a href="/signin">Sign in</a>
        </p>
      </div>
    </div>
  );
}

/** Shared workspace shell for all pre-map-steps chat screens.
 *  Matches Screen2's s7-workspace / s7-workspace-main / s7-split-rail structure exactly. */
function ChatWorkspaceShell({ children, sessionUser, accessToken, onSignOut }) {
  return (
    <div className="s7-workspace chat-workspace">
      <div className="s7-workspace-main">
        <nav className="s7-split-rail" aria-label="Chat tools">
          <div className="s7-split-rail-body">
            {/* Pre-map shell — narrower set (no map-tools yet). Order matches
                the canonical rail: Home · Dashboard · Reports · Deals · Docs.
                Settings sits in the footer below. */}
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
            {/* Deals + Analytics moved to the workspace tabs.
                Users get there via the "Open workspace" affordance. */}
            {/* Bottom group — Docs sits just above the Settings footer to
                match the canonical rail order in DiagnosticWorkspace. */}
            <div className="s7-split-rail-bottom-group" style={{ marginTop: 'auto' }}>
              <DocsRailButton />
            </div>
          </div>
          <div className="s7-split-rail-footer">
            {sessionUser ? (
              <SettingsRailButton accessToken={accessToken} sessionUser={sessionUser} onSignOut={onSignOut} />
            ) : (
              <a
                href="/signin"
                className="s7-split-rail-btn s7-split-rail-link"
                title="Sign in"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </a>
            )}
          </div>
        </nav>
        <div className="chat-main-panel">
          {/* Credits widget pinned to the top-right corner of the chat
              surface. The actual badge is positioned via .credits-widget
              CSS (position: absolute; right; top). */}
          <div className="chat-main-panel-topright">
            <CreditsWidget accessToken={accessToken} />
          </div>
          <DealContextChip />
          {children}
        </div>
      </div>
    </div>
  );
}


function DiagnosticContent() {
  const searchParams = useSearchParams();
  const {
    currentScreen, loadProgress, restoreProgress, goToScreen,
    setAuthUser, authUser,
    updateProcessData, setModuleId, moduleId,
    setEditingReportId, editingReportId, setViewOnlyProcessId, setEditingSurface, setWorkspaceAnchors,
    setChatMessages, addAuditEvent, auditTrail,
    dealId, setDeal, resetProcess, setCompletedProcesses,
  } = useDiagnostic();
  const [showResume, setShowResume] = useState(false);
  const [savedData, setSavedData] = useState(null);
  const [resumeChecked, setResumeChecked] = useState(false);
  const [initialStepIdx, setInitialStepIdx] = useState(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState(null);
  const [showAuditTrail, setShowAuditTrail] = useState(false);
  const [gateCompleted, setGateCompleted] = useState(false);
  const [dealContext, setDealContext] = useState(null); // resolved from ?participant=TOKEN
  const [reportToLoad, setReportToLoad] = useState(null); // report object to load into Screen2
  const { user: sessionUser, accessToken, loading: authLoading, signOut: sessionSignOut } = useAuth();

  // Resolve ?participant=TOKEN deal invite link
  const participantToken = searchParams.get('participant');
  useEffect(() => {
    if (!participantToken) return;
    fetch(`/api/deals/resolve?participant=${encodeURIComponent(participantToken)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.dealId) {
          setDealContext({
            participantToken,
            dealId: data.dealId,
            dealCode: data.dealCode,
            dealType: data.dealType,
            dealName: data.dealName,
            processName: data.processName,
            canonicalStart: data.canonicalStart || null,
            canonicalEnd: data.canonicalEnd || null,
            companyName: data.companyName,
            role: data.role,
            participantName: data.participantName,
          });
        }
      })
      .catch(() => {});
  }, [participantToken]);

  // Resolve ?dealFlowId=UUID - authed flow slot opened from the portal.
  // User is already logged in; skip the gate and seed authUser + dealContext,
  // then jump straight to Screen2 (the mapping canvas).
  const urlDealFlowId = searchParams.get('dealFlowId');
  const flowLoadedRef = useRef(false);
  useEffect(() => {
    if (!urlDealFlowId || flowLoadedRef.current) return;
    if (authLoading) return;
    if (!accessToken) return; // wait for auth to finish - dealFlowId requires session
    flowLoadedRef.current = true;
    (async () => {
      try {
        const r = await apiFetch(`/api/deals/resolve?flowId=${encodeURIComponent(urlDealFlowId)}`, {}, accessToken);
        const data = r.ok ? await r.json() : null;
        if (!data?.flowId) {
          setEditError(data?.error || 'Could not open this flow.');
          return;
        }
        setDealContext({
          participantToken: null,
          dealFlowId: data.flowId,
          dealId: data.dealId,
          dealCode: data.dealCode,
          dealType: data.dealType,
          dealName: data.dealName,
          processName: data.processName,
          canonicalStart: data.canonicalStart || null,
          canonicalEnd: data.canonicalEnd || null,
          companyName: data.companyName,
          role: data.role,
          participantName: data.participantName,
          flowLabel: data.flowLabel,
          flowKind: data.flowKind,
        });
        const segment = dealRoleToSegment(data.dealType, data.role);
        const resolvedModuleId = segment ? normaliseModuleId(segment) : null;
        setAuthUser({
          email: sessionUser?.email || '',
          name: data.participantName || sessionUser?.user_metadata?.full_name || sessionUser?.email || '',
          company: data.companyName || '',
          title: '',
          dealParticipantToken: null,
          dealCode: data.dealCode || null,
          dealFlowId: data.flowId,
        });
        if (resolvedModuleId) setModuleId(resolvedModuleId);
        updateProcessData({
          ...(resolvedModuleId ? { segment: resolvedModuleId } : {}),
          dealId: data.dealId,
          dealRole: data.role,
          dealName: data.dealName,
          dealProcessName: data.processName,
          dealFlowId: data.flowId,
        });
        setDeal({
          dealId: data.dealId,
          dealCode: data.dealCode,
          dealRole: data.role,
          dealName: data.dealName,
          dealParticipants: [],
          canonicalProcessName: data.processName || null,
          canonicalStart: data.canonicalStart || null,
          canonicalEnd: data.canonicalEnd || null,
        });
        setGateCompleted(true);
        goToScreen(2);

        // Hydrate cloud session (messages + artefacts) for this deal flow so a
        // refresh restores chat history and artefact pills. Falls through to
        // an empty thread if no session exists for the flow yet.
        let hydrated = false;
        try {
          const sessionId = typeof window !== 'undefined'
            ? localStorage.getItem('vesno_chat_session_active')
            : null;
          if (sessionId) {
            const sResp = await apiFetch(`/api/chat-sessions/${encodeURIComponent(sessionId)}`, {}, accessToken);
            const sd = sResp.ok ? await sResp.json() : null;
            if (sd?.success && Array.isArray(sd.messages) && sd.messages.length) {
              const artefactsByMsg = {};
              for (const a of (sd.artefacts || [])) {
                if (a.message_id) artefactsByMsg[a.message_id] = a;
              }
              setChatMessages(sd.messages.map((m) => {
                const artefact = artefactsByMsg[m.id] || (m.artefact_id ? artefactsByMsg[m.artefact_id] : null);
                const isReport = artefact && artefact.kind === 'report';
                return {
                  role: m.role,
                  content: m.content,
                  actions: m.actions || undefined,
                  attachments: m.attachments || undefined,
                  artefact: artefact ? {
                    id: artefact.id,
                    kind: artefact.kind,
                    refId: artefact.ref_id,
                    label: artefact.label,
                    snapshot: artefact.snapshot,
                  } : undefined,
                  reportActions: isReport ? { id: artefact.ref_id, processName: artefact.label || '' } : undefined,
                };
              }));
              hydrated = true;
            }
          }
        } catch { /* best-effort */ }
        if (!hydrated) setChatMessages([]);
      } catch (e) {
        setEditError('Failed to open flow.');
      }
    })();
  }, [urlDealFlowId, accessToken, authLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore pending module context saved before a sign-in redirect
  // (e.g. a PE roll-up user who was sent to /portal?returnTo=/workspace/map).
  // Only skips the audit gate when there is a context to restore - plain signed-in
  // visits from the marketing page should still see the gate (module selection).
  useEffect(() => {
    if (!sessionUser?.email) return;

    const raw = typeof window !== 'undefined' && localStorage.getItem('diagnosticModuleContext');
    if (raw) {
      // PE return-trip: restore context and bypass the gate
      try {
        const ctx = JSON.parse(raw);
        if (ctx?.moduleId) {
          setModuleId(ctx.moduleId);
          updateProcessData({ segment: ctx.segment || ctx.moduleId });
        }
        localStorage.removeItem('diagnosticModuleContext');
      } catch {}
      if (!authUser?.email) {
        setAuthUser({ email: sessionUser.email, name: sessionUser.user_metadata?.full_name || sessionUser.email });
      }
      setGateCompleted(true);
    }
    // For all other signed-in visits the gate still shows (email pre-populated via sessionUser prop).
  }, [sessionUser, authUser, setAuthUser, moduleId, setModuleId, updateProcessData]);

  // Skip gate when restoring a session that already has identity
  useEffect(() => {
    if (authUser?.email) setGateCompleted(true);
  }, [authUser?.email]);

  // Skip gate for signed-in users arriving at /workspace/map directly.
  // Segment selection happens via chips inside Screen2 so the gate isn't needed.
  // Deal participant flows still need the gate (they have a participantToken).
  // Deal flow slot (dealFlowId) is handled by its own resolver above, which seeds
  // authUser with the flow's company/role - don't race it here.
  useEffect(() => {
    if (!sessionUser?.email || authLoading || gateCompleted || dealContext?.participantToken || urlDealFlowId) return;
    setAuthUser({
      email: sessionUser.email,
      name: sessionUser.user_metadata?.full_name || sessionUser.email,
      company: sessionUser.user_metadata?.organization || sessionUser.user_metadata?.company || '',
      title: sessionUser.user_metadata?.title || '',
    });
    setGateCompleted(true);
    goToScreen(2);
  }, [sessionUser?.email, authLoading, gateCompleted, dealContext, urlDealFlowId]); // eslint-disable-line react-hooks/exhaustive-deps

  const sessionStartedRef = useRef(false);
  useEffect(() => {
    if (sessionStartedRef.current) return;
    if ((authUser?.email || sessionUser?.email) && currentScreen >= 2 && (auditTrail || []).length === 0) {
      sessionStartedRef.current = true;
      addAuditEvent({ type: 'created', detail: 'Diagnostic session started' });
    }
  }, [authUser, sessionUser, currentScreen, auditTrail, addAuditEvent]);

  const urlReaudit = searchParams.get('reaudit');
  const urlEdit = searchParams.get('edit');
  // ?view=<processId> → load the flow read-only on the canvas. Same data
  // path as ?edit, but we never set editingReportId so the chat / save
  // / mutation chrome stays inert. The user explicitly opts into editing
  // via the "Edit flow" CTA in the view-mode banner.
  const urlView = searchParams.get('view');
  const urlEditEmail = searchParams.get('email');
  // Resolve the load id once: edit takes precedence (full edit chrome),
  // otherwise view loads the same data without the editingReportId flag.
  const loadId = urlEdit || urlView || null;
  const isViewOnly = !!(urlView && !urlEdit);
  // surface=target → edits target_data instead of diagnostic_data. The
  // workspace's process design surface deep-links here when the user
  // clicks "Edit target in chat".
  const urlSurface = searchParams.get('surface') === 'target' ? 'target' : 'current';
  const urlViewCost = searchParams.get('view') === 'cost';
  // When the user enters edit mode from a deal artefact, this flag
  // tells the loader to also fetch the deal and rehydrate the
  // workspace's deal context (chip, rail, deal-scoped chat tools).
  // Without it, editing a participant map drops the user out of the
  // deal scope into a normal single-process edit.
  const urlEditFromDeal = searchParams.get('editFromDeal');
  const editLoadedRef = useRef(false);

  // Helper: fetch the deal record + the user's participation role and
  // return the slice of fields restoreProgress understands. Used by
  // the report-edit and analysis-edit paths so opening either from a
  // deal preserves dealId / dealName / processName / role on the
  // workspace, keeping the deal chip + rail tools live.
  const fetchDealContextSlice = useCallback(async (dealIdToLoad) => {
    if (!dealIdToLoad || !accessToken) return null;
    try {
      const r = await apiFetch(`/api/deals/${encodeURIComponent(dealIdToLoad)}`, {}, accessToken);
      if (!r.ok) return null;
      const d = await r.json();
      const deal = d?.deal;
      if (!deal) return null;
      const myEmail = (sessionUser?.email || '').toLowerCase();
      const me = (d.participants || []).find((p) => (p.participantEmail || '').toLowerCase() === myEmail);
      return {
        dealId: deal.id,
        dealCode: deal.dealCode,
        dealName: deal.name,
        dealRole: me?.role || null,
        dealParticipants: d.participants || [],
        dealCanonicalProcessName: deal.processName || null,
      };
    } catch { return null; }
  }, [accessToken, sessionUser]);

  // Handle re-audit: seed process names from original report, store parentReportId
  const reauditLoadedRef = useRef(false);
  useEffect(() => {
    if (!urlReaudit || reauditLoadedRef.current) return;
    reauditLoadedRef.current = true;
    setGateCompleted(true);
    fetch(`/api/get-diagnostic?id=${encodeURIComponent(urlReaudit)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.success || !data.report) return;
        const dd = data.report.diagnosticData || {};
        const processNames = (dd.rawProcesses || dd.processes || [])
          .map((p) => p.processName || p.name || '')
          .filter(Boolean);
        updateProcessData({ parentReportId: urlReaudit, seedProcessNames: processNames });
        goToScreen(2);
      })
      .catch(() => { goToScreen(2); });
  }, [urlReaudit]); // eslint-disable-line react-hooks/exhaustive-deps

  // Skip gate for portal editing flows
  useEffect(() => {
    if (urlEdit) setGateCompleted(true);
  }, [urlEdit]);

  // Skip gate for resume flows (resume link carries identity in saved data)
  const urlResume = searchParams.get('resume');
  useEffect(() => {
    if (urlResume) setGateCompleted(true);
  }, [urlResume]);

  // Resume a cloud chat session that has no saved report yet - fetch the
  // message thread and repopulate the chat UI so the user can pick up
  // where they left off.
  const urlChatSession = searchParams.get('chatSession');
  const chatSessionLoadedRef = useRef(null); // tracks the LAST loaded session id
  useEffect(() => {
    if (!urlChatSession) return;
    if (chatSessionLoadedRef.current === urlChatSession) return; // already loaded this one
    if (authLoading) return;
    if (!accessToken) {
      setEditError('Please sign in to resume this chat.');
      return;
    }
    chatSessionLoadedRef.current = urlChatSession;
    setGateCompleted(true);
    (async () => {
      try {
        const r = await apiFetch(`/api/chat-sessions/${encodeURIComponent(urlChatSession)}`, {}, accessToken);
        const data = r.ok ? await r.json() : null;
        if (!data?.success || !Array.isArray(data.messages)) {
          // Soft-fail: a stale chatSession URL (e.g. localStorage held
          // an id whose underlying session was deleted, or the deal it
          // belonged to was wiped + reseeded) shouldn't block the rest
          // of the page. Strip the param from the URL so the user can
          // proceed normally and refreshes don't keep retrying it.
          if (typeof window !== 'undefined') {
            const sp = new URLSearchParams(window.location.search);
            sp.delete('chatSession');
            const next = sp.toString();
            window.history.replaceState(null, '', window.location.pathname + (next ? `?${next}` : ''));
          }
          return;
        }
        const snapshot = data.session?.process_snapshot;
        const hasSnapshot = snapshot && typeof snapshot === 'object' && snapshot.processData && typeof snapshot.processData === 'object';
        const reportId = data.session?.report_id || null;

        if (hasSnapshot) {
          restoreProgress(snapshot);
        } else if (snapshot && typeof snapshot === 'object') {
          updateProcessData(snapshot);
        } else if (data.session?.kind === 'copilot') {
          // Deal copilot sessions don't carry a process map — wipe every
          // canvas-driving piece of state from any prior chat so the workspace
          // genuinely looks fresh. resetProcess() alone only clears
          // processData; editingReportId / reportToLoad / completedProcesses
          // would otherwise re-hydrate the canvas from the previous report.
          resetProcess();
          setEditingReportId(null);
          setReportToLoad(null);
          setCompletedProcesses([]);
        } else if (reportId) {
          // No snapshot (older session) - hydrate from the report's rawProcesses.
          try {
            const rep = await apiFetch(`/api/get-diagnostic?id=${encodeURIComponent(reportId)}`, {}, accessToken);
            const repData = rep.ok ? await rep.json() : null;
            const report = repData?.report;
            const dd = report?.diagnosticData || {};
            const raw = (report?.rawProcesses || dd.rawProcesses || [])[0];
            if (raw) {
              restoreProgress({
                currentScreen: 2,
                processData: {
                  processType: raw.processType || '',
                  processName: raw.processName || '',
                  definition: raw.definition || { startsWhen: '', completesWhen: '', complexity: '', departments: [] },
                  steps: raw.steps || [],
                  handoffs: raw.handoffs || [],
                  systems: raw.systems || [],
                  flowCustomEdges: raw.flowCustomEdges || [],
                  flowDeletedEdges: raw.flowDeletedEdges || [],
                  flowNodePositions: raw.flowNodePositions || {},
                  frequency: raw.frequency || { type: '', annual: 0 },
                  costs: raw.costs || { hourlyRate: 50, teamSize: 1 },
                },
                contact: dd.contact || report.contact || null,
                editingReportId: reportId,
              });
            }
          } catch { /* best-effort */ }
        }

        if (reportId) {
          setEditingReportId(reportId);
        }
        try {
          const key = reportId ? `vesno_chat_session_${reportId}` : 'vesno_chat_session_active';
          localStorage.setItem(key, urlChatSession);
        } catch { /* ignore */ }
        // Match artefacts to messages by the artefact's message_id. The
        // chat_messages.artefact_id back-link can be null if the link update
        // ever failed (e.g. pre-migration), but the artefact row itself
        // always carries message_id - that's the authoritative join.
        const artefactsByMsg = {};
        for (const a of (data.artefacts || [])) {
          if (a.message_id) artefactsByMsg[a.message_id] = a;
        }
        const restoredMessages = data.messages.map((m) => {
          const artefact = artefactsByMsg[m.id] || (m.artefact_id ? artefactsByMsg[m.artefact_id] : null);
          const isReport = artefact && artefact.kind === 'report';
          return {
            role: m.role,
            content: m.content,
            actions: m.actions || undefined,
            attachments: m.attachments || undefined,
            artefact: artefact ? {
              id: artefact.id,
              kind: artefact.kind,
              refId: artefact.ref_id,
              label: artefact.label,
              snapshot: artefact.snapshot,
            } : undefined,
            reportActions: isReport ? { id: artefact.ref_id, processName: artefact.label || '' } : undefined,
          };
        });

        // NOTE: do NOT seed a copilot welcome message here. Doing so persists
        // into localStorage via DiagnosticContext's save effect and prevents
        // DiagnosticWorkspace's pillar intro from ever firing on later fresh
        // visits (its seed effect bails if any messages are present). The
        // copilot intro is now seeded by DiagnosticWorkspace itself when it
        // sees a deal scope + no messages, alongside the pillars-fallback
        // for unscoped fresh chats.

        setChatMessages(restoredMessages);
        goToScreen(2);
      } catch {
        // Soft-fail (see comment above). Network blip / orphaned
        // session shouldn't kill the page.
        if (typeof window !== 'undefined') {
          const sp = new URLSearchParams(window.location.search);
          sp.delete('chatSession');
          const next = sp.toString();
          window.history.replaceState(null, '', window.location.pathname + (next ? `?${next}` : ''));
        }
      }
    })();
  }, [urlChatSession, accessToken, authLoading, setChatMessages, goToScreen, updateProcessData, restoreProgress, setEditingReportId, resetProcess, setCompletedProcesses]);

  useEffect(() => {
    if (!loadId || editLoadedRef.current) return;
    // Wait for auth when we need it: (a) editable=true mode requires
    // a token; (b) editFromDeal=<dealId> needs a token to fetch the
    // deal record so the workspace can rehydrate dealId / dealName /
    // dealRole. Without (b) the effect ran before accessToken was
    // ready, fetchDealContextSlice bailed null, and the deal chip /
    // rail tools disappeared during the edit session.
    const authRequired = !!(urlEditEmail || urlEditFromDeal || urlSurface === 'target');
    if (authRequired && authLoading) return;
    if (authRequired && !accessToken) {
      setEditError('Please sign in to edit this report.');
      setEditLoading(false);
      return; // Don't set editLoadedRef so we can retry when user signs in
    }
    editLoadedRef.current = true;
    setEditLoading(true);
    setEditError(null);

    // surface=target needs editable=true (writes go through the editable
    // codepath which gates on contact_email ownership). Force it on.
    const needsEditable = !!urlEditEmail || urlSurface === 'target';
    const surfaceQs = urlSurface === 'target' ? '&surface=target' : '';
    const url = needsEditable
      ? `/api/get-diagnostic?id=${encodeURIComponent(loadId)}&editable=true${surfaceQs}`
      : `/api/get-diagnostic?id=${encodeURIComponent(loadId)}`;

    apiFetch(url, {}, loadId ? accessToken : null)
      .then(async r => { try { return await r.json(); } catch { throw new Error('Invalid response'); } })
      .then(async data => {
        if (!data.success || !data.report) {
          setEditError('Could not load this report for editing. It may have been deleted.');
          setEditLoading(false);
          return;
        }
        const r = data.report;
        const dd = r.diagnosticData || {};
        const raw = (r.rawProcesses || dd.rawProcesses || [])[0] || {};
        const contact = dd.contact || r.contact || {};

        const processData = {
          processType: raw.processType || '',
          processName: raw.processName || '',
          definition: raw.definition || { startsWhen: '', completesWhen: '', complexity: '', departments: [] },
          lastExample: raw.lastExample || { name: '', startDate: '', endDate: '', elapsedDays: 0 },
          userTime: raw.userTime || { meetings: 0, emails: 0, execution: 0, waiting: 0, rework: 0, total: 0 },
          steps: (raw.steps || []).map((s, i) => ({
            number: s.number || i + 1,
            name: s.name || '',
            department: s.department || '',
            isDecision: !!s.isDecision,
            isExternal: !!s.isExternal,
            branches: s.branches || [],
            systems: s.systems || [],
            workMinutes: s.workMinutes,
            waitMinutes: s.waitMinutes,
            waitType: s.waitType,
            waitNote: s.waitNote,
            waitExternal: s.waitExternal,
            capacity: s.capacity,
            durationUnit: s.durationUnit,
            // Workspace anchors needed by the swimlane Sub-function /
            // Function toggle. Without these, the toggle has no data to
            // resolve from and silently falls back to the role label.
            roleId:       s.roleId       ?? null,
            functionId:   s.functionId   ?? s.function_id   ?? null,
            capabilityId: s.capabilityId ?? s.capability_id ?? null,
          })),
          handoffs: (raw.handoffs || []).map(h => ({
            from: h.from || {},
            to: h.to || {},
            method: h.method || '',
            clarity: h.clarity || '',
          })),
          systems: raw.systems || [],
          approvals: raw.approvals || [],
          knowledge: raw.knowledge || {},
          newHire: raw.newHire || {},
          frequency: raw.frequency || { type: '', annual: 0 },
          costs: raw.costs || { hourlyRate: 50, teamSize: 1 },
          priority: raw.priority || {},
          bottleneck: raw.bottleneck || {},
          savings: raw.savings || {},
          performance: raw.performance || '',
          issues: raw.issues || [],
          biggestDelay: raw.biggestDelay || '',
          delayDetails: raw.delayDetails || '',
          flowCustomEdges: raw.flowCustomEdges || [],
          flowDeletedEdges: raw.flowDeletedEdges || [],
          flowNodePositions: raw.flowNodePositions || {},
        };

        // In view-only mode we keep editingReportId null so the edit chrome
        // (save buttons, chat-driven mutation tools, etc.) stays inert.
        // viewOnlyProcessId carries the process id for the banner CTA.
        setEditingReportId(isViewOnly ? null : urlEdit);
        if (isViewOnly && setViewOnlyProcessId) setViewOnlyProcessId(loadId);
        // Surface comes from the API echo (preferred - survives query-string
        // edits) or falls back to the URL param. Determines whether the
        // upcoming save lands in diagnostic_data or target_data.
        setEditingSurface(r.surface || urlSurface);
        // Don't clobber the chat thread when opening a process from the
        // workspace — the chat is a continuous conversation, not a
        // per-process greeting surface. The hydrate-from-session block
        // below restores any prior turns for this report; otherwise the
        // pillar intro in DiagnosticWorkspace seeds the first message
        // when the chat is genuinely empty. The view-only banner already
        // tells the user they're viewing on the canvas, so we don't need
        // a canned assistant turn to repeat that.
        if (!isViewOnly) {
          const editGreeting = urlViewCost
            ? "You're working on the cost analysis for this process. Update labour rates, non-labour costs, or implementation investment on the right - or ask me to adjust figures, explain the payback/ROI math, or call out where the biggest savings are. What would you like to do?"
            : "You're editing this process. I can help you refine steps, add details, or adjust the flow. What would you like to change?";
          setChatMessages([{ role: 'assistant', content: editGreeting }]);
        }
        const editContact = {
          name: r.contactName || contact.name || '',
          email: r.contactEmail || contact.email || urlEditEmail || '',
          company: r.company || contact.company || '',
          title: contact.title || '',
          teamSize: contact.teamSize || '',
          industry: contact.industry || '',
          phone: contact.phone || '',
        };
        // If the user came in via a deal artefact (?editFromDeal=…),
        // pull the deal record + their participation role and stitch
        // it into the restoreProgress payload so the workspace keeps
        // the deal context (DealContextChip / rail tools).
        const dealCtx = urlEditFromDeal ? await fetchDealContextSlice(urlEditFromDeal) : null;
        restoreProgress({
          currentScreen: 2,
          processData,
          contact: editContact,
          completedProcesses: (r.rawProcesses || dd.rawProcesses || []).slice(1).map((rp, i) => ({
            processName: rp.processName,
            processType: rp.processType,
            steps: (rp.steps || []).map((s, si) => ({
              number: s.number || si + 1,
              name: s.name || '',
              department: s.department || '',
              isDecision: !!s.isDecision,
              isExternal: !!s.isExternal,
              branches: s.branches || [],
              systems: s.systems || [],
              workMinutes: s.workMinutes,
              waitMinutes: s.waitMinutes,
              waitType: s.waitType,
              waitNote: s.waitNote,
              waitExternal: s.waitExternal,
              capacity: s.capacity,
              durationUnit: s.durationUnit,
              roleId:       s.roleId       ?? null,
              functionId:   s.functionId   ?? s.function_id   ?? null,
              capabilityId: s.capabilityId ?? s.capability_id ?? null,
            })),
            handoffs: rp.handoffs || [],
          })),
          customDepartments: [...new Set([...(dd.customDepartments || []), ...extractCustomDepts(r.rawProcesses || dd.rawProcesses || [])])],
          stepCount: processData.steps.length,
          editingReportId: urlEdit, // null in view-only mode → no edit chrome
          viewOnlyProcessId: isViewOnly ? loadId : null,
          ...(dealCtx || {}),
        });
        queueMicrotask(() => addAuditEvent({
          type: isViewOnly ? 'view' : 'edit',
          detail: isViewOnly
            ? `Opened report ${loadId} (view only)`
            : `Opened report ${urlEdit} for editing`,
        }));

        // Hydrate chat + artefacts from the associated chat session so a
        // refresh preserves history (the greeting above is a fallback when
        // no session exists). Best-effort: fall through silently on error.
        try {
          const sessionId = typeof window !== 'undefined'
            ? localStorage.getItem(`vesno_chat_session_${urlEdit}`)
            : null;
          if (sessionId && accessToken) {
            apiFetch(`/api/chat-sessions/${encodeURIComponent(sessionId)}`, {}, accessToken)
              .then((resp) => (resp.ok ? resp.json() : null))
              .then((sd) => {
                if (!sd?.success || !Array.isArray(sd.messages) || !sd.messages.length) return;
                const artefactsByMsg = {};
                for (const a of (sd.artefacts || [])) {
                  if (a.message_id) artefactsByMsg[a.message_id] = a;
                }
                setChatMessages(sd.messages.map((m) => {
                  const artefact = artefactsByMsg[m.id] || (m.artefact_id ? artefactsByMsg[m.artefact_id] : null);
                  return {
                    role: m.role,
                    content: m.content,
                    actions: m.actions || undefined,
                    attachments: m.attachments || undefined,
                    artefact: artefact ? {
                      id: artefact.id,
                      kind: artefact.kind,
                      refId: artefact.ref_id,
                      label: artefact.label,
                      snapshot: artefact.snapshot,
                    } : undefined,
                  };
                }));
              })
              .catch(() => { /* keep greeting */ });
          }
        } catch { /* best-effort */ }

        setEditLoading(false);
      })
      .catch(() => {
        setEditError('Failed to load report. Please check your connection and try again.');
        setEditLoading(false);
      });
  }, [urlEdit, urlView, loadId, isViewOnly, urlEditEmail, urlEditFromDeal, fetchDealContextSlice, authLoading, accessToken, restoreProgress, setEditingReportId, setViewOnlyProcessId, setChatMessages, addAuditEvent]);

  // ?step=N deep-links to a specific step. ?resume=xxx was a resume-link
  // hydrator that read /api/progress (now 410, diagnostic_progress table
  // dropped). Resume URLs were a snapshot-era "send a colleague a link to
  // your half-done diagnostic" feature; superseded by autosave + deal
  // collaborators.
  useEffect(() => {
    const stepParam = searchParams.get('step');
    if (stepParam != null) setInitialStepIdx(parseInt(stepParam, 10) || 0);
    if (!resumeChecked) {
      setResumeChecked(true);
      const data = loadProgress();
      if (data && data.currentScreen > 0) {
        setSavedData(data);
        setShowResume(true);
      }
    }
  }, [searchParams, resumeChecked, loadProgress]);

  /*
   * Pre-report refresh hydration: plain /workspace/map (no ?chatSession,
   * no ?edit) relies on localStorage for chat history, which misses
   * cloud-persisted chat sessions. Pull the active session from
   * /api/chat-sessions so pills (flow snapshots, phase transitions, pins)
   * survive a refresh before any process row exists.
   */
  const preReportHydrateRef = useRef(false);
  // Explicit "New chat" intent (?new=1): clear the active-session pointer
  // and any saved progress once, so we don't auto-resume into the last chat.
  // Then strip the param so a subsequent refresh doesn't keep wiping state.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (searchParams.get('new') !== '1') return;
    try {
      localStorage.removeItem('vesno_chat_session_active');
      localStorage.removeItem('processDiagnosticProgress');
    } catch { /* ignore */ }
    preReportHydrateRef.current = true;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('new');
      window.history.replaceState({}, '', url.pathname + (url.search ? url.search : '') + url.hash);
    } catch { /* ignore */ }
  }, [searchParams]);

  // Silent localStorage fallback: restores just chatMessages (with artefact refs
  // intact via sanitizeChatMessagesForPersist) so pills survive refresh even when
  // cloud hydration can't run (unauthenticated, no session pointer, or fetch empty).
  // Does NOT trigger Resume dialog semantics - only repopulates the chat thread.
  const restoreChatFromLocal = useCallback(() => {
    if (typeof window === 'undefined') return false;
    try {
      const raw = localStorage.getItem('processDiagnosticProgress');
      if (!raw) return false;
      const data = JSON.parse(raw);
      const age = (new Date() - new Date(data.timestamp || 0)) / (1000 * 60 * 60);
      if (age >= 24) return false;
      if (!Array.isArray(data.chatMessages) || !data.chatMessages.length) return false;
      setChatMessages(data.chatMessages);
      if (process.env.NODE_ENV !== 'production') console.info('[hydrate-preReport] localStorage fallback restored', { count: data.chatMessages.length });
      return true;
    } catch {
      return false;
    }
  }, [setChatMessages]);

  useEffect(() => {
    if (preReportHydrateRef.current) return;
    if (urlChatSession || urlEdit) return;
    if (searchParams.get('resume')) return;
    if (searchParams.get('new') === '1') return;
    if (typeof window === 'undefined') return;

    // Auth not yet resolved or unavailable - use localStorage fallback so pills
    // don't vanish. Mark hydrate done so auth arriving later doesn't overwrite.
    if (authLoading || !accessToken) {
      if (!authLoading) {
        if (restoreChatFromLocal()) preReportHydrateRef.current = true;
      }
      return;
    }

    const sessionId = (() => {
      try { return localStorage.getItem('vesno_chat_session_active'); } catch { return null; }
    })();
    if (!sessionId) {
      if (process.env.NODE_ENV !== 'production') console.info('[hydrate-preReport] no cloud session - trying localStorage');
      if (restoreChatFromLocal()) preReportHydrateRef.current = true;
      return;
    }

    preReportHydrateRef.current = true;
    if (process.env.NODE_ENV !== 'production') console.info('[hydrate-preReport] fetching session', sessionId);
    apiFetch(`/api/chat-sessions/${encodeURIComponent(sessionId)}`, {}, accessToken)
      .then((resp) => {
        // 404 means the pointed-to session no longer exists OR doesn't
        // belong to this user OR the deal access was revoked. All three
        // are legitimate; the pointer is stale either way. Drop it so we
        // don't ask again on every page load.
        if (resp.status === 404) {
          try { localStorage.removeItem('vesno_chat_session_active'); } catch { /* ignore */ }
          return null;
        }
        return resp.ok ? resp.json() : null;
      })
      .then((sd) => {
        if (!sd?.success || !Array.isArray(sd.messages) || !sd.messages.length) {
          if (process.env.NODE_ENV !== 'production') console.warn('[hydrate-preReport] empty cloud - falling back to localStorage', { sessionId, success: sd?.success, messageCount: sd?.messages?.length });
          restoreChatFromLocal();
          return;
        }
        const artefactCount = (sd.artefacts || []).length;
        if (process.env.NODE_ENV !== 'production') console.info('[hydrate-preReport] loaded', { messages: sd.messages.length, artefacts: artefactCount });

        const snapshot = sd.session?.process_snapshot;
        if (snapshot && typeof snapshot === 'object' && snapshot.processData && typeof snapshot.processData === 'object') {
          restoreProgress(snapshot);
        }

        const artefactsByMsg = {};
        for (const a of (sd.artefacts || [])) {
          if (a.message_id) artefactsByMsg[a.message_id] = a;
        }
        let matchedCount = 0;
        const mapped = sd.messages.map((m) => {
          const artefact = artefactsByMsg[m.id] || (m.artefact_id ? artefactsByMsg[m.artefact_id] : null);
          if (artefact) matchedCount += 1;
          const isReport = artefact && artefact.kind === 'report';
          return {
            role: m.role,
            content: m.content,
            actions: m.actions || undefined,
            attachments: m.attachments || undefined,
            artefact: artefact ? {
              id: artefact.id,
              kind: artefact.kind,
              refId: artefact.ref_id,
              label: artefact.label,
              snapshot: artefact.snapshot,
            } : undefined,
            reportActions: isReport ? { id: artefact.ref_id, processName: artefact.label || '' } : undefined,
          };
        });
        if (process.env.NODE_ENV !== 'production') console.info('[hydrate-preReport] artefact→message match', { matched: matchedCount, totalArtefacts: artefactCount, orphans: artefactCount - matchedCount });
        setChatMessages(mapped);

        // Cloud is authoritative - suppress the localStorage Resume dialog.
        setShowResume(false);
        setSavedData(null);

        if (snapshot && typeof snapshot === 'object' && snapshot.processData) {
          goToScreen(2);
        }
      })
      .catch((err) => {
        if (process.env.NODE_ENV !== 'production') console.error('[hydrate-preReport] fetch failed - falling back to localStorage', err?.message || err);
        restoreChatFromLocal();
      });
  }, [urlChatSession, urlEdit, authLoading, accessToken, searchParams, setChatMessages, restoreProgress, goToScreen, restoreChatFromLocal]);

  const handleResumeYes = () => {
    if (savedData) {
      restoreProgress(savedData);
      addAuditEvent({
        type: 'resume',
        description: 'Resumed from saved progress',
        actor: authUser?.name || authUser?.email || sessionUser?.email || null,
      });
      setShowResume(false);
      setSavedData(null);
    }
  };

  const handleResumeNo = () => {
    setShowResume(false);
    setSavedData(null);
  };

  /*
   * Mobile layout uses CSS to drop html/body min-height for chat steps. Browser back/forward
   * (BFCache) can restore a snapshot where :has() doesn’t re-match - set a real attribute so
   * styles always apply after return navigation.
   */
  const currentScreenRef = useRef(currentScreen);
  currentScreenRef.current = currentScreen;
  const showDiagnosticShell = gateCompleted && !editLoading && !editError;
  const showDiagnosticShellRef = useRef(showDiagnosticShell);
  showDiagnosticShellRef.current = showDiagnosticShell;

  useEffect(() => {
    const root = document.documentElement;
    const applyDiagnosticViewAttr = () => {
      if (!showDiagnosticShellRef.current) {
        root.removeAttribute('data-diagnostic-view');
        return;
      }
      root.setAttribute('data-diagnostic-view', currentScreenRef.current === 2 ? 'map' : 'flow');
    };
    applyDiagnosticViewAttr();
    const onPageShow = () => {
      queueMicrotask(applyDiagnosticViewAttr);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      root.removeAttribute('data-diagnostic-view');
    };
  }, [currentScreen, gateCompleted, editLoading, editError]);

  useEffect(() => {
    if (currentScreen === 2) {
      document.documentElement.style.overflowX = 'hidden';
      document.body.style.overflowX = 'hidden';
      return () => {
        document.documentElement.style.overflowX = '';
        document.body.style.overflowX = '';
      };
    }
  }, [currentScreen]);

  // handleScreen6Complete removed: the completion screen is gone, so
  // there's no terminal callback to hook. Saves transition the canvas
  // in place via setEditingReportId.

  // Force-remount the workspace when the bound context changes —
  // opening a different report or chat session, or unbinding either.
  // Earlier this also keyed on dealId so picking a deal would reset
  // local state, but that wiped the canvas overlay (workspaceCanvasOpen)
  // every time the user picked a deal in the in-canvas Deals picker
  // — which read like the canvas was being "overridden". Deal context
  // now flows through React context only; DiagnosticWorkspace adapts
  // without remounting.
  const workspaceKey = `ws:${editingReportId || ''}:${urlChatSession || ''}`;

  const renderScreen = () => {
    // Living-workspace contract: there is one render — the canvas.
    // No screen switch, no template-picker step, no completion screen.
    // The `currentScreen` field survives only as a back-compat hook for
    // legacy persisted state (it's no longer driving render branches).
    return (
      <DiagnosticWorkspace
        key={workspaceKey}
        initialStepIdx={initialStepIdx}
        onAuditTrailToggle={() => setShowAuditTrail((v) => !v)}
        auditTrailOpen={showAuditTrail}
        reportToLoad={reportToLoad}
        onReportLoaded={() => setReportToLoad(null)}
      />
    );
  };

  const handleDealCodeResolved = useCallback((data) => {
    setDealContext({
      participantToken: null,
      dealId: data.dealId,
      dealCode: data.dealCode,
      dealType: data.dealType,
      dealName: data.dealName,
      processName: data.processName || null,
      companyName: null,
      role: null,
      fromCode: true,
    });
  }, []);

  const handleGateComplete = ({ name, email, company, title, segment, dealParticipantToken, dealCode, operatingModelId, functionId, functionPath, operatingModelName }) => {
    const resolvedModuleId = segment ? normaliseModuleId(segment) : null;
    setAuthUser({
      name, email, company, title,
      dealParticipantToken: dealParticipantToken || null,
      dealCode: dealCode || null,
    });
    if (resolvedModuleId) setModuleId(resolvedModuleId);
    // Stash workspace anchors so sendDiagnosticReport pulls them in on
    // submit, and so the chat agent's system prompt can mention the
    // picked capability. Setting nulls is fine — context allows it.
    setWorkspaceAnchors({
      operatingModelId:   operatingModelId   || null,
      functionId:       functionId       || null,
      functionPath:     functionPath     || null,
      operatingModelName: operatingModelName || null,
    });
    updateProcessData({
      ...(resolvedModuleId ? { segment: resolvedModuleId } : {}),
      ...(dealParticipantToken ? { dealParticipantToken } : {}),
      ...(dealCode ? { dealCode } : {}),
      ...(dealContext ? {
        dealId: dealContext.dealId,
        dealRole: dealContext.role,
        dealName: dealContext.dealName,
        dealProcessName: dealContext.processName,
      } : {}),
    });
    // If joining a deal as a portfolio company via invite token, store deal context in state
    if (dealContext?.dealId) {
      setDeal({
        dealId: dealContext.dealId,
        dealCode: dealContext.dealCode,
        dealRole: dealContext.role,
        dealName: dealContext.dealName,
        dealParticipants: [],
        canonicalProcessName: dealContext.processName || null,
        canonicalStart: dealContext.canonicalStart || null,
        canonicalEnd: dealContext.canonicalEnd || null,
      });
    }
    setGateCompleted(true);
    setChatMessages([]);
    goToScreen(2);
  };

  // While auth is resolving, show a minimal spinner so Screen2 doesn't
  // mount prematurely (which would cause a double-mount / double seeding).
  if (authLoading && !gateCompleted) {
    return <div className="loading-state" style={{ minHeight: '100dvh' }}><div className="loading-spinner" /></div>;
  }

  // Sign-in is now required for the diagnostic surface. Two narrow
  // exceptions:
  //   1. Participant-token flow — the user followed a magic link from a
  //      deal invite email; they're identified by token, not by Supabase
  //      auth. Forcing them through sign-up would break the invite flow.
  //   2. dealFlowId=… — already requires an auth'd session above (sets
  //      flowLoadedRef), so by the time we get here they're signed in.
  // Anonymous diagnostics are no longer allowed because trial credits
  // can't be metered against an unidentified user.
  const isParticipantInvite = !!dealContext?.participantToken;
  if (!sessionUser && !isParticipantInvite) {
    return <SignInRequired returnTo="/workspace/map" />;
  }

  if (!gateCompleted) {
    // For signed-in, non-participant, non-deal-flow users the auto-complete
    // effect at L622 fires immediately and flips gateCompleted to true on
    // the next render. Don't flash the gate form in between — show the same
    // spinner the auth-resolving branch uses so the transition is invisible.
    const willAutoComplete = sessionUser?.email && !dealContext?.participantToken && !urlDealFlowId;
    if (willAutoComplete) {
      return <div className="loading-state" style={{ minHeight: '100dvh' }}><div className="loading-spinner" /></div>;
    }
    return <AuditGate onComplete={handleGateComplete} dealContext={dealContext} onDealCodeResolved={handleDealCodeResolved} sessionUser={sessionUser} accessToken={accessToken} />;
  }

  if (editLoading || editError) {
    // Scoped loader: keep the rail (and rest of the chrome) mounted so
    // the spinner only covers the chat / canvas area, not the whole
    // viewport. Without this, the loader mounts before any shell and
    // the user loses the workspace rail / nav while the flow hydrates.
    return (
      <div className="diagnostic-shell container container-wide">
        <ChatWorkspaceShell sessionUser={sessionUser} accessToken={accessToken} onSignOut={sessionSignOut}>
          <div className="loading-state" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', textAlign: 'center', padding: 32 }}>
            {editError ? (
              <>
                <p style={{ color: 'var(--red, #dc2626)', marginBottom: 16 }}>{editError}</p>
                <a
                  href="/workspace"
                  style={{ color: 'var(--accent)', fontWeight: 500 }}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
                    e.preventDefault();
                    window.dispatchEvent(new CustomEvent('vesno:open-workspace'));
                  }}
                >&larr; Back to workspace</a>
              </>
            ) : (
              <>
                <div className="loading-spinner" />
                <p style={{ marginTop: 16, color: 'var(--text-mid)' }}>{isViewOnly ? 'Loading flow...' : 'Loading process data for editing...'}</p>
              </>
            )}
          </div>
        </ChatWorkspaceShell>
      </div>
    );
  }

  return (
    <>
      <div className="diagnostic-shell container container-wide">
        <DiagnosticNavProvider>
        <CanvasActionProvider>
          {currentScreen === 2 ? (
            renderScreen()
          ) : (
            <ChatWorkspaceShell sessionUser={sessionUser} accessToken={accessToken} onSignOut={sessionSignOut}>
              <>
                {showResume && savedData && (
                  <div className="resume-toast">
                    <p>
                      You have saved progress{savedData.timestamp ? <> from <strong>{new Date(savedData.timestamp).toLocaleDateString('en-GB')}</strong></> : ''}.
                    </p>
                    <div className="resume-toast-actions">
                      <button type="button" className="resume-toast-btn resume-toast-btn-primary" onClick={handleResumeYes}>Continue</button>
                      <button type="button" className="resume-toast-btn resume-toast-btn-secondary" onClick={handleResumeNo}>Start fresh</button>
                    </div>
                  </div>
                )}
                {renderScreen()}
              </>
            </ChatWorkspaceShell>
          )}
        </CanvasActionProvider>
        </DiagnosticNavProvider>
      </div>

      {currentScreen !== 2 && sessionUser && (
        <>
          <button type="button" className="audit-trail-toggle" onClick={() => setShowAuditTrail((v) => !v)} title="Activity log">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </button>
          {showAuditTrail && <AuditTrailPanel auditTrail={auditTrail || []} onClose={() => setShowAuditTrail(false)} />}
        </>
      )}
    </>
  );
}

export default function DiagnosticClient() {
  return (
    <DiagnosticProvider>
      <DiagnosticContent />
    </DiagnosticProvider>
  );
}
