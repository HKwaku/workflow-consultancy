'use client';

import { useState } from 'react';
import { useDiagnostic } from './DiagnosticContext';

export default function SaveProgressModal({ isOpen, onClose }) {
  const { currentScreen, processData, completedProcesses, customDepartments, diagnosticMode, saveProgressToCloud } = useDiagnostic();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('form'); // form | saving | success | error
  const [resumeUrl, setResumeUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSave = async (withEmail) => {
    if (withEmail && !email.trim()) {
      setErrorMsg('Please enter your email.');
      return;
    }
    setStatus('saving');
    setErrorMsg('');
    try {
      const result = await saveProgressToCloud(withEmail ? email.trim() : null);
      setResumeUrl(result.resumeUrl || '');
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err.message || 'Save failed');
    }
  };

  const handleCopy = () => {
    if (resumeUrl) {
      navigator.clipboard.writeText(resumeUrl);
    }
  };

  const handleClose = () => {
    setStatus('form');
    setResumeUrl('');
    setErrorMsg('');
    onClose();
  };

  return (
    <div className={`save-modal-overlay ${isOpen ? 'show' : ''}`} onClick={handleClose}>
      <div className="save-modal save-modal-box" onClick={(e) => e.stopPropagation()}>
        <h3 className="save-modal-title">Save & get link</h3>

        {status === 'form' && (
          <>
            <p className="save-modal-desc">
              Save your progress and get a link to continue on any device.
            </p>
            <div className="form-group">
              <label htmlFor="saveModalEmail">Email (optional, we&apos;ll send you the link)</label>
              <input
                type="email"
                id="saveModalEmail"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setErrorMsg(''); }}
                onKeyDown={(e) => e.key === 'Enter' && handleSave(true)}
              />
            </div>
            {errorMsg && <p className="save-modal-inline-error">{errorMsg}</p>}
            <div className="save-modal-btn-row">
              <button type="button" className="button button-primary" onClick={() => handleSave(true)}>Save & Email Link</button>
              <button type="button" className="button button-secondary" onClick={() => handleSave(false)}>Just get link</button>
            </div>
          </>
        )}

        {status === 'saving' && (
          <p className="save-modal-status">Saving...</p>
        )}

        {status === 'success' && (
          <>
            <p className="save-modal-success">Progress saved!</p>
            <div className="form-group">
              <label>Your resume link:</label>
              <div className="save-modal-link-row">
                <input type="text" className="save-modal-link-input" readOnly value={resumeUrl} onClick={(e) => e.target.select()} />
                <button type="button" className="button button-secondary" onClick={handleCopy}>Copy</button>
              </div>
            </div>
            <button type="button" className="button button-primary" onClick={handleClose}>Done</button>
          </>
        )}

        {status === 'error' && (
          <>
            <p className="save-modal-error">{errorMsg}</p>
            <button type="button" className="button button-primary" onClick={() => setStatus('form')}>Try again</button>
          </>
        )}
      </div>
    </div>
  );
}
