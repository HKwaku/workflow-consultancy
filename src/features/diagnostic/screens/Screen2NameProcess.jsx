import React, { useState, useEffect } from 'react';
import { useDiagnostic } from '../DiagnosticContext';

export default function Screen2NameProcess() {
  const { processData, setProcessData, goToScreen } = useDiagnostic();
  const [name, setName] = useState(processData.processName || '');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!name && processData.processName) setName(processData.processName);
  }, [processData.processName]);

  const handleContinue = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Please give your process a name.');
      return;
    }
    setProcessData({ processName: trimmed });
    setError('');
    goToScreen(3);
  };

  return (
    <>
      <h2 className="screen-title">Name Your Process</h2>
      <p className="screen-subtitle">You selected: <span className="process-ref">{processData.processName || processData.processType || 'your process'}</span></p>

      <div className="form-group">
        <label htmlFor="processNameInput">What do YOU call this process?</label>
        <input
          id="processNameInput"
          type="text"
          placeholder="e.g., New customer setup"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(''); }}
        />
        <p className="helper-text">Examples: "New customer setup", "Client onboarding", "Quote-to-cash", "Account activation"</p>
      </div>

      <p style={{ color: 'var(--text-mid)', fontSize: '0.95rem' }}>This helps us ask questions in your language.</p>

      {error && <div className="error-box"><div className="error-text">{error}</div></div>}

      <div className="button-group">
        <button className="button button-secondary" onClick={() => goToScreen(1)}>&larr; Back</button>
        <button className="button button-primary" onClick={handleContinue}>Continue &rarr;</button>
      </div>
    </>
  );
}
