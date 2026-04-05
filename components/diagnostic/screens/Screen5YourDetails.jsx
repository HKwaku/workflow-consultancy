'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useDiagnostic } from '../DiagnosticContext';
import { useDiagnosticNav } from '../DiagnosticNavContext';

export default function Screen5YourDetails() {
  const { processData, completedProcesses, goToScreen, setContact, teamMode, diagnosticMode, authUser, addAuditEvent } = useDiagnostic();
  const [name, setName] = useState(authUser?.name || '');
  const [email, setEmail] = useState(authUser?.email || '');
  const [company, setCompany] = useState('');
  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [costAnalystEmail, setCostAnalystEmail] = useState('');
  const teamSize = processData?.teamSize || '';
  const industry = processData?.industry || '';
  const [error, setError] = useState('');
  const [confirmStep, setConfirmStep] = useState(false);
  const confirmTimeoutRef = useRef(null);

  const processesToSubmit = completedProcesses.length > 0 ? completedProcesses : [{ ...processData }];
  const isTeam = !!teamMode;

  useEffect(() => {
    return () => {
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    };
  }, []);

  const handleSubmit = useCallback(() => {
    if (!name.trim() || !email.trim()) {
      setError('Please provide your name and email.');
      return;
    }
    if (!confirmStep) {
      setConfirmStep(true);
      confirmTimeoutRef.current = setTimeout(() => setConfirmStep(false), 5000);
      return;
    }
    if (confirmTimeoutRef.current) {
      clearTimeout(confirmTimeoutRef.current);
      confirmTimeoutRef.current = null;
    }
    setContact({ name: name.trim(), email: email.trim(), company: company.trim(), title: title.trim(), department: department.trim(), teamSize, industry, costAnalystEmail: costAnalystEmail.trim() || null });
    addAuditEvent({ type: 'submit', detail: `Contact details confirmed — ${name.trim()}${company.trim() ? ` (${company.trim()})` : ''}${title.trim() ? `, ${title.trim()}` : ''}` });
    goToScreen(6);
  }, [name, email, company, title, department, teamSize, industry, confirmStep, setContact, goToScreen]);

  const diagnosticNav = useDiagnosticNav();
  const continueLabel = confirmStep
    ? (isTeam ? 'Confirm and Submit →' : 'Confirm and Generate →')
    : (isTeam ? 'Submit My Perspective →' : 'Get My Report →');

  const registerNav = diagnosticNav?.registerNav;
  useEffect(() => {
    if (!registerNav) return;
    registerNav({
      onBack: () => goToScreen(2),
      onContinue: handleSubmit,
      disabled: false,
      continueLabel,
    });
    return () => registerNav(null);
  }, [registerNav, continueLabel, diagnosticMode, goToScreen, handleSubmit]);

  useEffect(() => {
    diagnosticNav?.notifyUpdate?.();
  }, [confirmStep]);

  return (
    <div className="screen active">
      <div className="screen-card">
        <h2 className="screen-title">Your Details</h2>
        <p className="screen-subtitle">Where should we send your report?</p>
        {(authUser?.name || authUser?.email) && (
          <p style={{ fontSize: 13, color: 'var(--text-mid)', margin: '0 0 16px', padding: '8px 12px', background: 'var(--bg-2, #1e293b)', borderRadius: 6, border: '1px solid var(--border, #334155)' }}>
            Name and email pre-filled from sign-up — update if needed.
          </p>
        )}

        {processesToSubmit.length > 0 && (
          <div className="process-submit-box">
            <strong>Process{processesToSubmit.length > 1 ? 'es' : ''} to analyse:</strong>
            <ul>
              {processesToSubmit.map((p, i) => (
                <li key={i}>{p.processName || `Process ${i + 1}`}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="form-group">
          <label htmlFor="contactName">Your name *</label>
          <input type="text" id="contactName" value={name} onChange={(e) => { setName(e.target.value); setError(''); }} required />
        </div>
        <div className="form-group">
          <label htmlFor="contactEmail">Your email *</label>
          <input type="email" id="contactEmail" value={email} onChange={(e) => { setEmail(e.target.value); setError(''); }} required />
        </div>
        <div className="form-group">
          <label htmlFor="contactCompany">Company (optional)</label>
          <input type="text" id="contactCompany" value={company} onChange={(e) => setCompany(e.target.value)} />
        </div>
        {isTeam && (
          <div className="form-group">
            <label htmlFor="contactDepartment">Team (optional)</label>
            <input type="text" id="contactDepartment" value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g., Sales, Operations" />
          </div>
        )}
        <div className="form-group">
          <label htmlFor="contactTitle">Job title (optional)</label>
          <input type="text" id="contactTitle" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        {diagnosticMode === 'comprehensive' && (
          <div className="form-group">
            <label htmlFor="costAnalystEmail">Cost analyst email (optional)</label>
            <p className="screen-subtitle" style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '0.82rem' }}>
              Who should complete the financial model? They&apos;ll get a link to fill in costs and will be able to view the report.
            </p>
            <input
              type="email"
              id="costAnalystEmail"
              value={costAnalystEmail}
              onChange={(e) => setCostAnalystEmail(e.target.value)}
              placeholder="manager@company.com"
            />
          </div>
        )}

        {error && (
          <div className="error-box">
            <div className="error-text">{error}</div>
          </div>
        )}
      </div>
    </div>
  );
}
