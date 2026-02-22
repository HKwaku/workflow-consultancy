import React, { useState } from 'react';
import { useDiagnostic } from '../DiagnosticContext';
import { PROCESS_TEMPLATES } from '../constants';

export default function Screen1ProcessSelection() {
  const { processData, setProcessData, goToScreen } = useDiagnostic();
  const [customProcess, setCustomProcess] = useState('');
  const [error, setError] = useState('');

  const selected = processData.processType || (customProcess ? 'custom' : '');
  const canContinue = selected && (customProcess ? customProcess.trim() : processData.processType);

  const selectTemplate = (id, name) => {
    setProcessData({ processType: id, processName: name });
    setCustomProcess('');
    setError('');
  };

  const handleCustomChange = (e) => {
    const v = e.target.value;
    setCustomProcess(v);
    if (v.trim()) {
      setProcessData({ processType: 'custom', processName: v.trim() });
    } else {
      setProcessData({ processType: '', processName: '' });
    }
    setError('');
  };

  const handleContinue = () => {
    if (!canContinue) {
      setError('Please select a process or describe your own.');
      return;
    }
    setError('');
    goToScreen(2);
  };

  return (
    <>
      <h2 className="screen-title">Select Your Process</h2>
      <p className="screen-subtitle">Which process causes you the most pain?</p>

      <div className="process-grid">
        {PROCESS_TEMPLATES.map((t) => (
          <div
            key={t.id}
            className={`process-card ${selected === t.id ? 'selected' : ''}`}
            onClick={() => selectTemplate(t.id, t.name)}
          >
            <div className="process-icon">{t.icon}</div>
            <div className="process-name">{t.name}</div>
          </div>
        ))}
      </div>

      <div className="form-group" style={{ marginTop: '2rem' }}>
        <label>Or describe your own:</label>
        <input
          type="text"
          placeholder="e.g., Quote to Contract"
          value={customProcess}
          onChange={handleCustomChange}
        />
      </div>

      {error && <div className="error-box"><div className="error-text">{error}</div></div>}

      <div className="button-group">
        <button className="button button-secondary" onClick={() => goToScreen(0)}>&larr; Back</button>
        <button className="button button-primary" onClick={handleContinue} disabled={!canContinue}>
          Continue &rarr;
        </button>
      </div>
    </>
  );
}
