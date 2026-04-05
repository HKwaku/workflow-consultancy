'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useDiagnostic } from '../DiagnosticContext';
import { useDiagnosticNav } from '../DiagnosticNavContext';
import { computeDurationFromSteps } from '@/lib/diagnostic';

const FREQ_MAP = {
  daily: 365,
  'few-per-week': 150,
  weekly: 52,
  'twice-monthly': 24,
  monthly: 12,
  quarterly: 4,
  'twice-yearly': 2,
  yearly: 1,
};

const BOTTLENECK_REASONS = [
  { id: 'waiting', label: 'Waiting on someone else' },
  { id: 'approvals', label: 'Approvals / sign-offs' },
  { id: 'manual-work', label: 'Manual / repetitive work' },
  { id: 'handoffs', label: 'Handoffs between teams' },
  { id: 'systems', label: 'Switching between systems' },
  { id: 'unclear', label: 'Unclear ownership or next step' },
  { id: 'rework', label: 'Rework / errors' },
  { id: 'other', label: 'Other' },
];

function estimateSavingsPercent(processData) {
  let pct = 15;
  const steps = processData.steps || [];
  const handoffs = processData.handoffs || [];
  const depts = new Set(steps.map((s) => s.department).filter(Boolean));

  if (depts.size > 3) pct += 8;
  else if (depts.size > 1) pct += 4;

  const unclearHandoffs = handoffs.filter((h) => !h.clarity || h.clarity === 'unclear' || h.clarity === 'confusing').length;
  if (unclearHandoffs > 2) pct += 8;
  else if (unclearHandoffs > 0) pct += 4;

  const decisionSteps = steps.filter((s) => s.isDecision).length;
  if (decisionSteps > 2) pct += 5;

  return Math.min(pct, 60);
}

export default function Screen4Cost() {
  const { processData, updateProcessData, goToScreen, saveProgressToCloud, editingReportId, addAuditEvent } = useDiagnostic();

  const chatFreq = processData.frequency?.type || '';
  const initialFreq = FREQ_MAP[chatFreq] ? chatFreq : '';

  const [freq, setFreq] = useState(initialFreq);
  const [inFlight, setInFlight] = useState(processData.frequency?.inFlight ?? 0);

  const [bottleneckReason, setBottleneckReason] = useState(processData.bottleneck?.reason || '');
  const [bottleneckDetail, setBottleneckDetail] = useState(processData.bottleneck?.why || '');

  const chatHours = processData.costs?.hoursPerInstance;
  const hoursFromChat = typeof chatHours === 'number' && chatHours > 0;

  const computed = useMemo(() => computeDurationFromSteps(processData?.steps), [processData?.steps]);
  const hoursFromSteps = computed?.hoursPerInstance != null && computed.hoursPerInstance > 0;
  const cycleDaysFromSteps = computed?.cycleDays != null && computed.cycleDays > 0;

  const defaultHours = hoursFromSteps ? computed.hoursPerInstance : (chatHours || 4);
  const [hoursPerInstance, setHoursPerInstance] = useState(defaultHours);
  const [teamSize, setTeamSize] = useState(processData.costs?.teamSize ?? 1);

  const cycleDays = cycleDaysFromSteps ? computed.cycleDays : (processData.lastExample?.elapsedDays || 0);

  useEffect(() => {
    if (hoursFromSteps && computed.hoursPerInstance > 0) {
      setHoursPerInstance(computed.hoursPerInstance);
    }
  }, [computed?.hoursPerInstance, hoursFromSteps]);

  const annual = FREQ_MAP[freq] || 12;

  const savingsPct = useMemo(
    () => estimateSavingsPercent(processData),
    [processData, bottleneckReason]
  );

  /* ═══════ Build fresh processData snapshot for handover ═══════ */
  const buildFreshProcessData = useCallback(() => {
    const pd = {
      ...processData,
      frequency: { type: freq, annual, inFlight },
      bottleneck: { reason: bottleneckReason, why: bottleneckDetail },
      costs: { hoursPerInstance, cycleDays, teamSize, annual },
      savings: { percent: savingsPct },
    };
    updateProcessData({
      frequency: pd.frequency,
      bottleneck: pd.bottleneck,
      costs: pd.costs,
      savings: pd.savings,
    });
    return pd;
  }, [processData, freq, annual, inFlight, bottleneckReason, bottleneckDetail, hoursPerInstance, cycleDays, teamSize, savingsPct, updateProcessData]);

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
      }).catch(() => {});
    }
  }, [handoverState.url]);

  const submitHandover = useCallback(async (sendEmail = true) => {
    const pd = buildFreshProcessData();
    setHandoverState((p) => ({ ...p, status: 'saving', error: '' }));
    try {
      const opts = {
        step: 4,
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
  }, [buildFreshProcessData, saveProgressToCloud, handoverState.email, handoverState.senderName, handoverState.comments]);

  const handleContinue = useCallback(() => {
    updateProcessData({
      frequency: { type: freq, annual, inFlight },
      bottleneck: { reason: bottleneckReason, why: bottleneckDetail },
      costs: { hoursPerInstance, cycleDays, teamSize, annual },
      savings: { percent: savingsPct },
    });
    addAuditEvent({ type: 'navigate', detail: `Completed cost & impact — bottleneck: "${bottleneckReason || 'none'}", frequency: ${freq || 'unset'} (${annual}/yr), ${hoursPerInstance}h/instance, ${teamSize} people` });
    goToScreen(5);
  }, [freq, annual, inFlight, bottleneckReason, bottleneckDetail, hoursPerInstance, cycleDays, teamSize, savingsPct, updateProcessData, goToScreen, addAuditEvent]);

  const diagnosticNav = useDiagnosticNav();
  const registerNav = diagnosticNav?.registerNav;
  useEffect(() => {
    if (!registerNav) return;
    registerNav({
      onBack: () => goToScreen(2),
      onHandover: editingReportId ? undefined : openHandoverModal,
      onContinue: handleContinue,
    });
    return () => registerNav(null);
  }, [registerNav, goToScreen, handleContinue, openHandoverModal, editingReportId]);
  useEffect(() => { diagnosticNav?.notifyUpdate?.(); }, []);

  return (
    <>
    <div className="screen active">
      <div className="screen-card">
        <h2 className="screen-title">Cost &amp; Impact</h2>
        <p className="screen-subtitle">
          Let&apos;s size the cost of &quot;<span className="process-ref">{processData.processName || 'your process'}</span>&quot;
        </p>

        {/* Bottleneck — now asked after mapping */}
        <div className="merged-section">
          <h3 className="merged-section-title">Biggest Bottleneck</h3>
          <p className="screen-subtitle" style={{ marginBottom: '0.75rem', fontSize: '0.9rem' }}>
            Now that you&apos;ve mapped the steps, where does it slow down most?
          </p>
          <div className="form-group">
            <div className="radio-group">
              {BOTTLENECK_REASONS.map(({ id, label }) => (
                <label key={id} className={`radio-option ${bottleneckReason === id ? 'selected' : ''}`}>
                  <input type="radio" name="bottleneckReason" value={id} checked={bottleneckReason === id} onChange={() => { setBottleneckReason(id); addAuditEvent({ type: 'step_edit', detail: `Bottleneck identified as "${label}"` }); }} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          {bottleneckReason && (
            <div className="form-group">
              <label htmlFor="bottleneckDetail">Any extra detail? (optional)</label>
              <input type="text" id="bottleneckDetail" placeholder="e.g. Finance take 3 days to approve..." value={bottleneckDetail} onChange={(e) => setBottleneckDetail(e.target.value)} onBlur={(e) => { const v = e.target.value.trim(); if (v) addAuditEvent({ type: 'step_edit', detail: `Bottleneck detail: "${v}"` }); }} />
            </div>
          )}
        </div>

        {/* Frequency / Volume */}
        <div className="merged-section">
          <h3 className="merged-section-title">Frequency &amp; Volume</h3>
          <div className="form-group">
            <label>How often does this process run?</label>
            <div className="radio-group">
              {Object.keys(FREQ_MAP).map((val) => (
                <label key={val} className={`radio-option ${freq === val ? 'selected' : ''}`}>
                  <input type="radio" name="frequency" value={val} checked={freq === val} onChange={() => { setFreq(val); addAuditEvent({ type: 'step_edit', detail: `Process frequency set to "${val.replace(/-/g, ' ')}" (${FREQ_MAP[val]}/yr)` }); }} />
                  {val.replace(/-/g, ' ')} ({FREQ_MAP[val]}/yr)
                </label>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="inFlight">Instances currently in progress:</label>
            <input type="number" id="inFlight" min={0} value={inFlight} onChange={(e) => setInFlight(parseInt(e.target.value, 10) || 0)} onBlur={(e) => addAuditEvent({ type: 'step_edit', detail: `In-flight instances set to ${e.target.value}` })} />
          </div>
        </div>

        {/* Operational inputs (no £ — manager completes cost analysis separately) */}
        <div className="merged-section">
          <h3 className="merged-section-title">Process Volume &amp; Effort</h3>
          {cycleDays > 0 && (
            <div className="cost-cycle-badge">
              Last example took <strong>{cycleDays} day{cycleDays !== 1 ? 's' : ''}</strong> start to finish
            </div>
          )}
          <div className="form-group">
            <label htmlFor="hoursPerInstance">Person-hours spent per instance:</label>
            <input type="number" id="hoursPerInstance" min={0.5} step={0.5} value={hoursPerInstance} onChange={(e) => setHoursPerInstance(Math.max(0.5, parseFloat(e.target.value) || 1))} onBlur={(e) => addAuditEvent({ type: 'step_edit', detail: `Person-hours per instance set to ${e.target.value}h` })} />
            <span className="form-hint">
              {hoursFromSteps
                ? `Calculated from step durations (${computed.hoursPerInstance.toFixed(1)}h) — adjust if needed`
                : hoursFromChat
                  ? `Afi estimated ${chatHours}h based on your answers — adjust if needed`
                  : 'Actual work time across everyone involved'}
            </span>
          </div>
          <div className="form-group">
            <label htmlFor="teamSize">People involved in this process:</label>
            <input type="number" id="teamSize" min={1} value={teamSize} onChange={(e) => setTeamSize(Math.max(1, parseInt(e.target.value, 10) || 1))} onBlur={(e) => addAuditEvent({ type: 'step_edit', detail: `Team size set to ${e.target.value} people` })} />
          </div>
          <p className="form-hint" style={{ marginTop: 8, fontSize: '0.85rem', color: 'var(--text-mid)' }}>
            A manager will complete the cost analysis (rates, savings) after the audit. You&apos;ll get a link to assign to them.
          </p>
        </div>
      </div>
    </div>

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
