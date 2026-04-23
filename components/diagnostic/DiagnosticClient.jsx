'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { DiagnosticProvider, useDiagnostic } from './DiagnosticContext';
import { DiagnosticNavProvider } from './DiagnosticNavContext';
import { useAuth } from '@/lib/useAuth';
import { apiFetch } from '@/lib/api-fetch';
import { DEPT_INTERNAL, DEPT_EXTERNAL } from '@/lib/diagnostic/stepConstants';

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

/* Build a personalised redesign opening message from raw process data */
function buildAiRedesignGreeting(raw, processName) {
  const BOTTLENECK_LABELS = {
    waiting: 'waiting time',
    approvals: 'approval bottlenecks',
    handoffs: 'handoff issues',
    'manual-work': 'manual work',
    rework: 'rework and errors',
    systems: 'system and tool issues',
  };

  const name = processName || raw.processName || 'your process';
  const stepCount = (raw.steps || []).length;
  const bottleneckReason = raw.bottleneck?.reason;
  const bottleneckDetail = raw.bottleneck?.why;
  const biggestDelay = raw.biggestDelay;
  const issues = raw.issues || [];
  const waitMins = raw.userTime?.waiting || 0;
  const emailHandoffs = (raw.handoffs || []).filter(h => h.method === 'email').length;
  const savingsPct = raw.savings?.estimatedSavingsPercent || 0;

  const findings = [];
  if (bottleneckReason) {
    const label = BOTTLENECK_LABELS[bottleneckReason] || bottleneckReason;
    findings.push(`**${label}** flagged as the main bottleneck`);
  }
  if (issues.length > 0) findings.push(`${issues.length} issue${issues.length > 1 ? 's' : ''} identified`);
  if (emailHandoffs > 0) findings.push(`${emailHandoffs} email handoff${emailHandoffs > 1 ? 's' : ''} in the flow`);
  if (waitMins > 0) findings.push(`${waitMins} minutes of waiting time per run`);

  const detailClause = bottleneckDetail || biggestDelay
    ? ` - "${bottleneckDetail || biggestDelay}"`
    : '';

  const savingsClause = savingsPct > 0 ? ` with a ~${savingsPct}% estimated saving opportunity` : '';

  const findingsLine = findings.length > 0
    ? `I've reviewed your **${name}** diagnostic (${stepCount} steps). We found ${findings.join(', ')}${detailClause}${savingsClause}.`
    : `I've reviewed your **${name}** diagnostic (${stepCount} steps)${savingsClause}.`;

  return `${findingsLine}\n\nWould you like to start with the highest bottleneck area, or focus on the highest cost savings first?`;
}

/* Lazy load heavy screens and panels – diagnostic opens with minimal bundle */
const DiagnosticWorkspace = dynamic(() => import('./screens/DiagnosticWorkspace'), {
  ssr: false,
  loading: () => <div className="loading-state"><div className="loading-spinner" /><p>Loading workspace...</p></div>,
});
const ScreenLoading = () => <div className="loading-state"><div className="loading-spinner" /><p>Loading...</p></div>;
const Screen1SelectTemplate = dynamic(() => import('./screens/Screen1SelectTemplate'), { ssr: false, loading: ScreenLoading });
const Screen6Complete = dynamic(() => import('./screens/Screen6Complete'), { ssr: false, loading: ScreenLoading });
const AuditTrailPanel = dynamic(() => import('./AuditTrailPanel'), { ssr: false });
const AUDIT_SEGMENTS = [
  {
    id: 'scaling',
    variant: 'teal',
    label: 'Scaling Business',
    tagline: 'Growing fast, processes breaking',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width={22} height={22}><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>,
  },
  {
    id: 'ma',
    variant: 'violet',
    label: 'M&A Integration',
    tagline: 'Day 1 baseline, integration clarity',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width={22} height={22}><circle cx="8" cy="18" r="3"/><circle cx="16" cy="6" r="3"/><path d="M8 15V9a6 6 0 016-6"/><path d="M16 9v6a6 6 0 01-6 6"/></svg>,
  },
  {
    id: 'pe',
    variant: 'amber',
    label: 'Private Equity',
    tagline: 'Acquisition baseline to exit-ready',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width={22} height={22}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg>,
  },
  {
    id: 'high-risk-ops',
    variant: 'rose',
    label: 'High Risk Ops',
    tagline: 'Compliance gaps, key-person risk, failure points',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width={22} height={22}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  },
];

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

function AuditGate({ onComplete, dealContext, onDealCodeResolved, sessionUser }) {
  // dealContext: { participantToken, dealName, dealType, processName, companyName, role, participantName }
  const fromDeal = !!dealContext?.participantToken;

  const [name, setName] = useState(dealContext?.participantName || sessionUser?.user_metadata?.full_name || '');
  const [email, setEmail] = useState(sessionUser?.email || '');
  const [company, setCompany] = useState(dealContext?.companyName || '');
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');

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
              <h1 className="audit-gate-hero-title">Start your process audit</h1>
              <p className="audit-gate-hero-lede">
                We&apos;ll tailor the audit to your situation and send your report to your inbox.
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
            Start Audit →
          </button>
        </form>

        <p className="audit-gate-footer">
          Already have an account? <a href="/portal">Sign in</a>
        </p>
      </div>
    </div>
  );
}

/** Shared workspace shell for all pre-map-steps chat screens.
 *  Matches Screen2's s7-workspace / s7-workspace-main / s7-split-rail structure exactly. */
function ChatWorkspaceShell({ children, sessionUser }) {
  return (
    <div className="s7-workspace chat-workspace">
      <div className="s7-workspace-main">
        <nav className="s7-split-rail" aria-label="Chat tools">
          <div className="s7-split-rail-body" />
          <div className="s7-split-rail-footer">
            <a
              href="/portal"
              className="s7-split-rail-btn s7-split-rail-link"
              title={sessionUser ? 'Dashboard' : 'Sign in'}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </a>
          </div>
        </nav>
        <div className="chat-main-panel">
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
    setEditingReportId, editingReportId, setEditingRedesign, setDiagnosticMode,
    setChatMessages, addAuditEvent, auditTrail,
    dealId, setDeal,
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
  const [redesignReportId, setRedesignReportId] = useState(null); // trigger redesign in Screen2
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
        setChatMessages([]);
        goToScreen(2);
      } catch (e) {
        setEditError('Failed to open flow.');
      }
    })();
  }, [urlDealFlowId, accessToken, authLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore pending module context saved before a sign-in redirect
  // (e.g. a PE roll-up user who was sent to /portal?returnTo=/process-audit).
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

  // Skip gate for signed-in users arriving at /process-audit directly.
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
  const urlEditEmail = searchParams.get('email');
  const urlEditRedesign = searchParams.get('editRedesign') === '1';
  const urlAiRedesign = searchParams.get('aiRedesign') === '1';
  const urlViewCost = searchParams.get('view') === 'cost';
  const editLoadedRef = useRef(false);

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
        goToScreen(1.5);
      })
      .catch(() => { goToScreen(1.5); });
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
  const chatSessionLoadedRef = useRef(false);
  useEffect(() => {
    if (!urlChatSession || chatSessionLoadedRef.current) return;
    if (authLoading) return;
    if (!accessToken) {
      setEditError('Please sign in to resume this chat.');
      return;
    }
    chatSessionLoadedRef.current = true;
    setGateCompleted(true);
    (async () => {
      try {
        const r = await apiFetch(`/api/chat-sessions/${encodeURIComponent(urlChatSession)}`, {}, accessToken);
        const data = r.ok ? await r.json() : null;
        if (!data?.success || !Array.isArray(data.messages)) {
          setEditError('Could not load this chat. It may have been deleted.');
          return;
        }
        const snapshot = data.session?.process_snapshot;
        const hasSnapshot = snapshot && typeof snapshot === 'object' && snapshot.processData && typeof snapshot.processData === 'object';
        const reportId = data.session?.report_id || null;

        if (hasSnapshot) {
          restoreProgress(snapshot);
        } else if (snapshot && typeof snapshot === 'object') {
          updateProcessData(snapshot);
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
                diagnosticMode: report?.diagnosticMode || dd.diagnosticMode || 'comprehensive',
                editingReportId: reportId,
              });
            }
          } catch { /* best-effort */ }
        }

        if (reportId) {
          setEditingReportId(reportId);
          if (data.session.kind === 'redesign') setEditingRedesign(true);
        }
        try {
          const key = reportId ? `vesno_chat_session_${reportId}` : 'vesno_chat_session_active';
          localStorage.setItem(key, urlChatSession);
        } catch { /* ignore */ }
        const artefactsByMsg = {};
        for (const a of (data.artefacts || [])) {
          if (a.message_id) artefactsByMsg[a.message_id] = a;
        }
        setChatMessages(
          data.messages.map((m) => {
            const artefact = m.artefact_id ? artefactsByMsg[m.artefact_id] : null;
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
          })
        );
        goToScreen(2);
      } catch {
        setEditError('Could not load this chat.');
      }
    })();
  }, [urlChatSession, accessToken, authLoading, setChatMessages, goToScreen, updateProcessData, restoreProgress, setEditingReportId, setEditingRedesign]);

  useEffect(() => {
    if (!urlEdit || editLoadedRef.current) return;
    // When editing (editable=true), wait for auth to load so we have a token
    if (urlEditEmail && authLoading) return;
    if (urlEditEmail && !accessToken) {
      setEditError('Please sign in to edit this report.');
      setEditLoading(false);
      return; // Don't set editLoadedRef so we can retry when user signs in
    }
    editLoadedRef.current = true;
    setEditLoading(true);
    setEditError(null);

    const url = urlEditEmail
      ? `/api/get-diagnostic?id=${encodeURIComponent(urlEdit)}&editable=true${urlEditRedesign ? '&editRedesign=1' : ''}`
      : `/api/get-diagnostic?id=${encodeURIComponent(urlEdit)}`;

    apiFetch(url, {}, urlEdit ? accessToken : null)
      .then(async r => { try { return await r.json(); } catch { throw new Error('Invalid response'); } })
      .then(data => {
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

        const mode = r.diagnosticMode || dd.diagnosticMode || 'comprehensive';
        setEditingReportId(urlEdit);
        setDiagnosticMode(mode);
        const isEditRedesign = !!data.report?.editRedesign || urlAiRedesign;
        setEditingRedesign(isEditRedesign);
        const editGreeting = urlAiRedesign
          ? buildAiRedesignGreeting(raw, raw.processName)
          : urlViewCost
          ? "You're working on the cost analysis for this process. Update labour rates, non-labour costs, or implementation investment on the right - or ask me to adjust figures, explain the payback/ROI math, or call out where the biggest savings are. What would you like to do?"
          : isEditRedesign
          ? "You're editing your redesigned flow. I can help you refine steps, add details, or adjust the process. What would you like to change?"
          : "You're editing your process audit. I can help you refine steps, add details, or adjust the process. What would you like to change?";
        setChatMessages([{ role: 'assistant', content: editGreeting }]);
        const editContact = {
          name: r.contactName || contact.name || '',
          email: r.contactEmail || contact.email || urlEditEmail || '',
          company: r.company || contact.company || '',
          title: contact.title || '',
          teamSize: contact.teamSize || '',
          industry: contact.industry || '',
          phone: contact.phone || '',
        };
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
            })),
            handoffs: rp.handoffs || [],
          })),
          customDepartments: [...new Set([...(dd.customDepartments || []), ...extractCustomDepts(r.rawProcesses || dd.rawProcesses || [])])],
          stepCount: processData.steps.length,
          editingReportId: urlEdit,
          editingRedesign: isEditRedesign,
          aiRedesignMode: urlAiRedesign,
          diagnosticMode: mode,
        });
        queueMicrotask(() => addAuditEvent({ type: 'edit', detail: `Opened report ${urlEdit} for editing` }));

        setEditLoading(false);
      })
      .catch(() => {
        setEditError('Failed to load report. Please check your connection and try again.');
        setEditLoading(false);
      });
  }, [urlEdit, urlEditEmail, urlEditRedesign, authLoading, accessToken, restoreProgress, setEditingReportId, setEditingRedesign, setChatMessages, setDiagnosticMode, addAuditEvent]);

  // Handle ?resume=xxx - load from API; ?step=N deep-links to a specific step
  useEffect(() => {
    const resumeId = searchParams.get('resume');
    const stepParam = searchParams.get('step');
    if (stepParam != null) setInitialStepIdx(parseInt(stepParam, 10) || 0);
    if (resumeId && !resumeChecked) {
      setResumeChecked(true);
      fetch(`/api/progress?id=${encodeURIComponent(resumeId)}`)
        .then(async (r) => { try { return await r.json(); } catch { throw new Error('Invalid response'); } })
        .then((result) => {
          if (result.success && result.progress?.progressData) {
            const d = result.progress.progressData;
            setSavedData({
              currentScreen: d.currentScreen ?? result.progress.currentScreen,
              processData: d.processData,
              completedProcesses: d.completedProcesses || [],
              customDepartments: [...new Set([...(d.customDepartments || []), ...extractCustomDepts(d.processData ? [d.processData, ...(d.completedProcesses || [])] : [])])],
              stepCount: d.stepCount ?? 0,
              diagnosticMode: d.diagnosticMode || 'comprehensive',
              teamMode: d.teamMode || null,
              contact: d.contact || null,
              authUser: d.authUser || null,
              chatMessages: d.chatMessages,
              timestamp: result.progress.updatedAt || result.progress.createdAt || new Date().toISOString(),
              handoverSender: d.handoverSender || null,
              handoverComments: d.handoverComments || null,
              processName: d.processData?.processName || result.progress.processName || null,
            });
            setShowResume(true);
          }
        })
        .catch(() => setResumeChecked(true));
      return;
    }
    if (!resumeId && !resumeChecked) {
      setResumeChecked(true);
      const data = loadProgress();
      if (data && data.currentScreen > 0) {
        setSavedData(data);
        setShowResume(true);
      }
    }
  }, [searchParams, resumeChecked, loadProgress]);

  const handleResumeYes = () => {
    if (savedData) {
      restoreProgress(savedData);
      addAuditEvent({
        type: savedData.handoverSender ? 'handover' : 'resume',
        description: savedData.handoverSender
          ? `Handover accepted from ${savedData.handoverSender}`
          : 'Resumed from saved progress',
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

  const handleScreen6Complete = useCallback(async (reportId) => {
    try {
      const data = await apiFetch(`/api/get-diagnostic?id=${encodeURIComponent(reportId)}`, {}, accessToken || undefined);
      if (data.success && data.report) {
        setReportToLoad(data.report);
      }
    } catch { /* non-fatal - Screen2 will show an empty workspace */ }
    goToScreen(2);
  }, [accessToken, goToScreen]);

  const renderScreen = () => {
    switch (currentScreen) {
      case 1.5:
        return <Screen1SelectTemplate />;
      case 2:
        return (
          <DiagnosticWorkspace
            initialStepIdx={initialStepIdx}
            onAuditTrailToggle={() => setShowAuditTrail((v) => !v)}
            auditTrailOpen={showAuditTrail}
            reportToLoad={reportToLoad}
            onReportLoaded={() => setReportToLoad(null)}
            redesignReportId={redesignReportId}
            onRedesignConsumed={() => setRedesignReportId(null)}
          />
        );
      case 6:
        return <Screen6Complete onComplete={handleScreen6Complete} />;
      default:
        return (
          <DiagnosticWorkspace
            initialStepIdx={initialStepIdx}
            onAuditTrailToggle={() => setShowAuditTrail((v) => !v)}
            auditTrailOpen={showAuditTrail}
            reportToLoad={reportToLoad}
            onReportLoaded={() => setReportToLoad(null)}
            redesignReportId={redesignReportId}
            onRedesignConsumed={() => setRedesignReportId(null)}
          />
        );
    }
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

  const handleGateComplete = ({ name, email, company, title, segment, dealParticipantToken, dealCode }) => {
    const resolvedModuleId = segment ? normaliseModuleId(segment) : null;
    setAuthUser({
      name, email, company, title,
      dealParticipantToken: dealParticipantToken || null,
      dealCode: dealCode || null,
    });
    if (resolvedModuleId) setModuleId(resolvedModuleId);
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

  if (!gateCompleted) {
    return <AuditGate onComplete={handleGateComplete} dealContext={dealContext} onDealCodeResolved={handleDealCodeResolved} sessionUser={sessionUser} />;
  }

  if (editLoading || editError) {
    return (
      <div className="loading-state" style={{ padding: 80, textAlign: 'center' }}>
        {editError ? (
          <>
            <p style={{ color: 'var(--red, #dc2626)', marginBottom: 16 }}>{editError}</p>
            <a href="/portal" style={{ color: 'var(--accent)', fontWeight: 500 }}>Back to Dashboard</a>
          </>
        ) : (
          <>
            <div className="loading-spinner" />
            <p style={{ marginTop: 16, color: 'var(--text-mid)' }}>Loading audit data for editing...</p>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="diagnostic-shell container container-wide">
        <DiagnosticNavProvider>
          {currentScreen === 2 ? (
            renderScreen()
          ) : (
            <ChatWorkspaceShell sessionUser={sessionUser}>
              <>
                {showResume && savedData && (
                  savedData.handoverSender ? (
                    <div className="handover-fullscreen">
                      <video className="handover-fullscreen-video" autoPlay muted loop playsInline>
                        <source src="/videos/hero-bg.mp4" type="video/mp4" />
                      </video>
                      <div className="handover-fullscreen-overlay" />
                      <div className="handover-fullscreen-card">
                        <div className="resume-toast-icon">
                          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0d9488" strokeWidth="1.8"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                        </div>
                        <h4 className="resume-toast-title"><strong>{savedData.handoverSender}</strong> has sent you a process flow to complete</h4>
                        {savedData.processName && <p className="resume-toast-process">Process: <strong>{savedData.processName}</strong></p>}
                        {savedData.handoverComments && <p className="resume-toast-comments">&ldquo;{savedData.handoverComments}&rdquo;</p>}
                        <p className="resume-toast-cta">Click below to accept and complete your steps.</p>
                        <div className="resume-toast-actions">
                          <button type="button" className="resume-toast-btn resume-toast-btn-primary" onClick={handleResumeYes}>Accept &amp; continue</button>
                          <button type="button" className="resume-toast-btn resume-toast-btn-secondary-light" onClick={handleResumeNo}>Decline</button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="resume-toast">
                      <p>
                        You have saved progress{savedData.timestamp ? <> from <strong>{new Date(savedData.timestamp).toLocaleDateString('en-GB')}</strong></> : ''}.
                      </p>
                      <div className="resume-toast-actions">
                        <button type="button" className="resume-toast-btn resume-toast-btn-primary" onClick={handleResumeYes}>Continue</button>
                        <button type="button" className="resume-toast-btn resume-toast-btn-secondary" onClick={handleResumeNo}>Start fresh</button>
                      </div>
                    </div>
                  )
                )}
                {renderScreen()}
              </>
            </ChatWorkspaceShell>
          )}
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
