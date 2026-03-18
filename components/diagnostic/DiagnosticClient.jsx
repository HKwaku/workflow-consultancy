'use client';

import { useEffect, useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { DiagnosticProvider, useDiagnostic } from './DiagnosticContext';
import ProgressBar from './ProgressBar';
import { DiagnosticNavProvider, DiagnosticNavBar } from './DiagnosticNavContext';
import ThemeToggle from '@/components/ThemeToggle';
import IntroChatScreen from './IntroChatScreen';
import GuidedChatScreen from './GuidedChatScreen';
import { useAuth } from '@/lib/useAuth';
import { apiFetch } from '@/lib/api-fetch';

/* Lazy load heavy screens and panels – diagnostic opens with minimal bundle */
const Screen2MapSteps = dynamic(() => import('./screens/Screen2MapSteps'), {
  ssr: false,
  loading: () => <div className="loading-state"><div className="loading-spinner" /><p>Loading step editor...</p></div>,
});
const ScreenLoading = () => <div className="loading-state"><div className="loading-spinner" /><p>Loading...</p></div>;
const ScreenTeam = dynamic(() => import('./screens/ScreenTeam'), { ssr: false, loading: ScreenLoading });
const Screen4Cost = dynamic(() => import('./screens/Screen4Cost'), { ssr: false, loading: ScreenLoading });
const Screen5YourDetails = dynamic(() => import('./screens/Screen5YourDetails'), { ssr: false, loading: ScreenLoading });
const Screen6Complete = dynamic(() => import('./screens/Screen6Complete'), { ssr: false, loading: ScreenLoading });
const ChatPanel = dynamic(() => import('./ChatPanel'), { ssr: false });
const SaveProgressModal = dynamic(() => import('./SaveProgressModal'), { ssr: false });
const AuditTrailPanel = dynamic(() => import('./AuditTrailPanel'), { ssr: false });
const TeamAuthGate = dynamic(() => import('./TeamAuthGate'), { ssr: false });

function DiagnosticContent() {
  const searchParams = useSearchParams();
  const {
    currentScreen, loadProgress, restoreProgress, goToScreen,
    chatOpen, toggleChatOpen, setChatOpen,
    setAuthUser, authUser, setTeamMode,
    setEditingReportId, editingReportId, setEditingRedesign, setDiagnosticMode,
    setChatMessages, addAuditEvent, auditTrail,
  } = useDiagnostic();
  const [showResume, setShowResume] = useState(false);
  const [savedData, setSavedData] = useState(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [resumeChecked, setResumeChecked] = useState(false);
  const [initialStepIdx, setInitialStepIdx] = useState(null);
  const [showTeamUrlAuth, setShowTeamUrlAuth] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState(null);
  const [showAuditTrail, setShowAuditTrail] = useState(false);
  const { user: sessionUser, accessToken, loading: authLoading, signOut: sessionSignOut } = useAuth();

  useEffect(() => {
    if (sessionUser?.email && !authUser?.email) {
      setAuthUser({ email: sessionUser.email, name: sessionUser.user_metadata?.full_name || sessionUser.email });
    }
  }, [sessionUser, authUser, setAuthUser]);

  const sessionStartedRef = useRef(false);
  useEffect(() => {
    if (sessionStartedRef.current) return;
    if ((authUser?.email || sessionUser?.email) && currentScreen >= 2 && (auditTrail || []).length === 0) {
      sessionStartedRef.current = true;
      addAuditEvent({ type: 'created', detail: 'Diagnostic session started' });
    }
  }, [authUser, sessionUser, currentScreen, auditTrail, addAuditEvent]);

  const urlEdit = searchParams.get('edit');
  const urlEditEmail = searchParams.get('email');
  const urlEditRedesign = searchParams.get('editRedesign') === '1';
  const editLoadedRef = useRef(false);

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
        };

        const mode = 'process'; // single mode — legacy 'map-only'/'comprehensive' treated identically
        setEditingReportId(urlEdit);
        setDiagnosticMode(mode);
        const isEditRedesign = !!data.report?.editRedesign;
        setEditingRedesign(isEditRedesign);
        const editGreeting = isEditRedesign
          ? "You're editing your redesigned flow. I can help you refine steps, add details, or adjust the process. What would you like to change?"
          : "You're editing your diagnostic. I can help you refine steps, add details, or adjust the process. What would you like to change?";
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
            steps: rp.steps || [],
            handoffs: rp.handoffs || [],
          })),
          customDepartments: dd.customDepartments || [],
          stepCount: processData.steps.length,
          editingReportId: urlEdit,
          editingRedesign: !!data.report?.editRedesign,
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

  // Handle ?team=CODE — require auth then go to team setup
  const urlTeam = searchParams.get('team');
  useEffect(() => {
    if (urlTeam?.trim() && currentScreen === 0 && !urlEdit) {
      if (authUser?.email) {
        setTeamMode(true);
        goToScreen(-2);
      } else {
        setShowTeamUrlAuth(true);
      }
    }
  }, [urlTeam, currentScreen, goToScreen, urlEdit, authUser, setTeamMode]);

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
              customDepartments: d.customDepartments || [],
              stepCount: d.stepCount ?? 0,
              diagnosticMode: d.diagnosticMode || 'comprehensive',
              teamMode: d.teamMode || null,
              contact: d.contact || null,
              authUser: d.authUser || null,
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
        if (urlTeam && (!data.teamMode || data.teamMode.code !== urlTeam.toUpperCase())) {
          return;
        }
        setSavedData(data);
        setShowResume(true);
      }
    }
  }, [searchParams, resumeChecked, loadProgress, urlTeam]);

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
      case -2:
        return <ScreenTeam />;
      case 1:
        return <GuidedChatScreen />;
      case 2:
        return <Screen2MapSteps initialStepIdx={initialStepIdx} />;
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
            <p style={{ marginTop: 16, color: 'var(--text-mid)' }}>Loading diagnostic data for editing...</p>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="top-bar">
        <div className="top-bar-inner">
          <div className="top-bar-left">
            <a href="/">Sharpin<span className="top-bar-brand-dot">.</span></a>
            <div className="top-bar-divider" />
            <span className="top-bar-title">Diagnostic</span>
          </div>
          <div className="top-bar-nav">
            <ThemeToggle className="top-bar-theme-btn" />
            {editingReportId && <a href={`/report?id=${editingReportId}&portal=1`} className="top-bar-link">View Report</a>}
            {sessionUser?.email ? (
              <>
                <a href="/portal" className="top-bar-link">Portal</a>
                <span className="top-bar-email">{sessionUser.email}</span>
                <button type="button" className="top-bar-btn" onClick={sessionSignOut}>Sign Out</button>
              </>
            ) : (
              <a href="/portal" className="top-bar-link">Client Login</a>
            )}
          </div>
        </div>
      </div>

      <div className={`container${currentScreen === 2 ? ' container-wide' : ''}`}>
        <DiagnosticNavProvider>
          <ProgressBar onSaveClick={() => setShowSaveModal(true)} currentScreen={currentScreen} />
          <DiagnosticNavBar currentScreen={currentScreen} />
          <SaveProgressModal isOpen={showSaveModal} onClose={() => setShowSaveModal(false)} />

          {showTeamUrlAuth && !authUser?.email ? (
            <TeamAuthGate
              onAuthenticated={(user) => {
                setAuthUser(user);
                setShowTeamUrlAuth(false);
                setTeamMode(true);
                goToScreen(-2);
              }}
            />
          ) : currentScreen === 2 ? (
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
              <button type="button" className="audit-trail-toggle" onClick={() => setShowAuditTrail(v => !v)} title="Activity log">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </button>
              {showAuditTrail && <AuditTrailPanel auditTrail={auditTrail || []} onClose={() => setShowAuditTrail(false)} />}
            </>
          )}

          {currentScreen !== 2 && (
            <>
              <button type="button" className="diag-chat-fab" onClick={toggleChatOpen} title="AI Assistant">
                {chatOpen ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
                )}
              </button>
              {chatOpen && (
                <div className="diag-chat-widget">
                  <div className="diag-chat-widget-header">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
                    <span>AI Assistant</span>
                    <button type="button" className="diag-chat-close" onClick={() => setChatOpen(false)}>&times;</button>
                  </div>
                  <ChatPanel />
                </div>
              )}
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
