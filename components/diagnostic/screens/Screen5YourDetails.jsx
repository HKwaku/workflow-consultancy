'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useDiagnostic } from '../DiagnosticContext';
import { useDiagnosticNav } from '../DiagnosticNavContext';

export default function Screen5YourDetails() {
  const { processData, completedProcesses, goToScreen, setContact, teamMode, diagnosticMode, authUser, addAuditEvent } = useDiagnostic();
  const [department, setDepartment] = useState('');
  const [costAnalystEmail, setCostAnalystEmail] = useState('');
  const teamSize = processData?.teamSize || '';
  const industry = processData?.industry || '';
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
    if (!confirmStep) {
      setConfirmStep(true);
      confirmTimeoutRef.current = setTimeout(() => setConfirmStep(false), 5000);
      return;
    }
    if (confirmTimeoutRef.current) {
      clearTimeout(confirmTimeoutRef.current);
      confirmTimeoutRef.current = null;
    }
    const contactName = authUser?.name || '';
    const contactEmail = authUser?.email || '';
    const contactCompany = authUser?.company || '';
    const contactTitle = authUser?.title || '';
    setContact({ name: contactName, email: contactEmail, company: contactCompany, title: contactTitle, department: department.trim(), teamSize, industry, costAnalystEmail: costAnalystEmail.trim() || null });
    addAuditEvent({ type: 'submit', detail: `Contact details confirmed - ${contactName}${contactCompany ? ` (${contactCompany})` : ''}${contactTitle ? `, ${contactTitle}` : ''}` });
    goToScreen(6);
  }, [authUser, department, teamSize, industry, costAnalystEmail, confirmStep, setContact, goToScreen, addAuditEvent]);

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

        {isTeam && (
          <div className="form-group">
            <label htmlFor="contactDepartment">Team (optional)</label>
            <input type="text" id="contactDepartment" value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g., Sales, Operations" />
          </div>
        )}
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
      </div>
    </div>
  );
}
