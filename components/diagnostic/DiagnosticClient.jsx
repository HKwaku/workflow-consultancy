'use client';

import { useEffect, useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { DiagnosticProvider, useDiagnostic } from './DiagnosticContext';
import ProgressBar from './ProgressBar';
import { DiagnosticNavProvider, DiagnosticNavBar } from './DiagnosticNavContext';
import IntroChatScreen from './IntroChatScreen';
import GuidedChatScreen from './GuidedChatScreen';
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
    ? ` — "${bottleneckDetail || biggestDelay}"`
    : '';

  const savingsClause = savingsPct > 0 ? ` with a ~${savingsPct}% estimated saving opportunity` : '';

  const findingsLine = findings.length > 0
    ? `I've reviewed your **${name}** diagnostic (${stepCount} steps). We found ${findings.join(', ')}${detailClause}${savingsClause}.`
    : `I've reviewed your **${name}** diagnostic (${stepCount} steps)${savingsClause}.`;

  return `${findingsLine}\n\nWould you like to start with the highest bottleneck area, or focus on the highest cost savings first?`;
}

/* Lazy load heavy screens and panels – diagnostic opens with minimal bundle */
const Screen2MapSteps = dynamic(() => import('./screens/Screen2MapSteps'), {
  ssr: false,
  loading: () => <div className="loading-state"><div className="loading-spinner" /><p>Loading step editor...</p></div>,
});
const ScreenLoading = () => <div className="loading-state"><div className="loading-spinner" /><p>Loading...</p></div>;
const Screen1SelectTemplate = dynamic(() => import('./screens/Screen1SelectTemplate'), { ssr: false, loading: ScreenLoading });
const Screen4Cost = dynamic(() => import('./screens/Screen4Cost'), { ssr: false, loading: ScreenLoading });
const Screen5YourDetails = dynamic(() => import('./screens/Screen5YourDetails'), { ssr: false, loading: ScreenLoading });
const Screen6Complete = dynamic(() => import('./screens/Screen6Complete'), { ssr: false, loading: ScreenLoading });
const SaveProgressModal = dynamic(() => import('./SaveProgressModal'), { ssr: false });
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
    id: 'highstakes',
    variant: 'rose',
    label: 'High-stakes Event',
    tagline: 'Carve-out, ERP, VC-backed scale-up',
    icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width={22} height={22}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  },
];

function AuditGate({ onComplete }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [segment, setSegment] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      setError('Please enter your name and email to continue.');
      return;
    }
    if (!segment) {
      setError('Please select which best describes your situation.');
      return;
    }
    onComplete({ name: name.trim(), email: email.trim(), segment });
  };

  return (
    <div className="audit-gate-screen">
      <div className="audit-gate-inner">
        <header className="audit-gate-hero">
          <div className="audit-gate-brand">
            Vesno<span>.</span>
          </div>
          <h1 className="audit-gate-hero-title">Start your process audit</h1>
          <p className="audit-gate-hero-lede">
            We&apos;ll tailor the audit to your situation and send your report to your inbox.
          </p>
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
          </div>

          <p className="audit-gate-seg-head">Which best describes your situation?</p>
          <div className="audit-gate-paths">
            {AUDIT_SEGMENTS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`audit-seg-btn audit-seg-btn--${s.variant}${segment === s.id ? ' selected' : ''}`}
                onClick={() => setSegment(s.id)}
              >
                <span className="audit-seg-icon">{s.icon}</span>
                <span className="audit-seg-label">{s.label}</span>
                <span className="audit-seg-meta">{s.tagline}</span>
              </button>
            ))}
          </div>

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

function DiagnosticContent() {
  const searchParams = useSearchParams();
  const {
    currentScreen, loadProgress, restoreProgress, goToScreen,
    setAuthUser, authUser,
    updateProcessData,
    setEditingReportId, editingReportId, setEditingRedesign, setDiagnosticMode,
    setChatMessages, addAuditEvent, auditTrail,
  } = useDiagnostic();
  const [showResume, setShowResume] = useState(false);
  const [savedData, setSavedData] = useState(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [resumeChecked, setResumeChecked] = useState(false);
  const [initialStepIdx, setInitialStepIdx] = useState(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState(null);
  const [showAuditTrail, setShowAuditTrail] = useState(false);
  const [gateCompleted, setGateCompleted] = useState(false);
  const { user: sessionUser, accessToken, loading: authLoading, signOut: sessionSignOut } = useAuth();

  // Skip gate when already authenticated via Supabase
  useEffect(() => {
    if (sessionUser?.email) {
      setGateCompleted(true);
      if (!authUser?.email) {
        setAuthUser({ email: sessionUser.email, name: sessionUser.user_metadata?.full_name || sessionUser.email });
      }
    }
  }, [sessionUser, authUser, setAuthUser]);

  // Skip gate when restoring a session that already has identity
  useEffect(() => {
    if (authUser?.email) setGateCompleted(true);
  }, [authUser?.email]);

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

  // Handle ?resume=xxx — load from API; ?step=N deep-links to a specific step
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

  useEffect(() => {
    const handler = () => setShowSaveModal(true);
    window.addEventListener('open-save-modal', handler);
    return () => window.removeEventListener('open-save-modal', handler);
  }, []);

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

  const renderScreen = () => {
    switch (currentScreen) {
      case 0:
        return <IntroChatScreen />;
      case 1:
        return <GuidedChatScreen />;
      case 1.5:
        return <Screen1SelectTemplate />;
      case 2:
        return (
          <Screen2MapSteps
            initialStepIdx={initialStepIdx}
            onAuditTrailToggle={() => setShowAuditTrail((v) => !v)}
            auditTrailOpen={showAuditTrail}
            onOpenSaveModal={() => setShowSaveModal(true)}
          />
        );
      case 4:
        return <Screen4Cost />;
      case 5:
        return <Screen5YourDetails />;
      case 6:
        return <Screen6Complete />;
      default:
        return <IntroChatScreen />;
    }
  };

  const handleGateComplete = ({ name, email, segment }) => {
    setAuthUser({ name, email });
    updateProcessData({ segment });
    setGateCompleted(true);
  };

  if (!gateCompleted && !authLoading) {
    return <AuditGate onComplete={handleGateComplete} />;
  }

  if (editLoading || editError) {
    return (
      <div className="loading-state" style={{ padding: 80, textAlign: 'center' }}>
        {editError ? (
          <>
            <p style={{ color: 'var(--red, #dc2626)', marginBottom: 16 }}>{editError}</p>
            <a href="/portal" style={{ color: 'var(--accent)', fontWeight: 500 }}>Back to Portal</a>
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
      <div className={`container${currentScreen === 2 ? ' container-wide' : ''}`}>
        <DiagnosticNavProvider>
          <ProgressBar onSaveClick={() => setShowSaveModal(true)} currentScreen={currentScreen} />
          <DiagnosticNavBar currentScreen={currentScreen} />
          <SaveProgressModal isOpen={showSaveModal} onClose={() => setShowSaveModal(false)} />

          {currentScreen === 2 ? (
            renderScreen()
          ) : (
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
        )}
        </DiagnosticNavProvider>
      </div>

      {currentScreen !== 0 && currentScreen !== 1 && currentScreen > 0 && (
        <>
          {sessionUser && (
            <>
              {currentScreen !== 2 && (
                <button type="button" className="audit-trail-toggle" onClick={() => setShowAuditTrail((v) => !v)} title="Activity log">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                </button>
              )}
              {showAuditTrail && <AuditTrailPanel auditTrail={auditTrail || []} onClose={() => setShowAuditTrail(false)} />}
            </>
          )}

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
