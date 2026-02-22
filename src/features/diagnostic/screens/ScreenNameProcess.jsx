import { useState, useEffect } from 'react';
import { useDiagnostic } from '../DiagnosticContext';
import { handOffToLegacy } from '../diagnosticState';

export default function ScreenNameProcess() {
  const {
    processData,
    completedProcesses,
    customDepartments,
    stepCount,
    editingReportId,
    goToScreen,
    setProcessName,
  } = useDiagnostic();
  const [name, setName] = useState(processData.processName || '');

  useEffect(() => {
    if (!name && processData.processName) setName(processData.processName);
  }, [processData.processName]);

  const handleChange = (e) => {
    const v = e.target.value;
    setName(v);
    setProcessName(v);
  };

  const handleContinue = () => {
    if (!name.trim()) return;
    setProcessName(name.trim());
    const state = {
      currentScreen: 3,
      processData: { ...processData, processName: name.trim() },
      completedProcesses: completedProcesses || [],
      customDepartments: customDepartments || [],
      stepCount: stepCount || 0,
      editingReportId: editingReportId || null,
    };
    handOffToLegacy(state);
  };

  return (
    <div className="diag-screen-card">
      <h2 className="diag-screen-title">Name Your Process</h2>
      <p className="diag-screen-subtitle">
        You selected: <span className="process-ref" style={{ fontWeight: 600 }}>{processData.processName || '—'}</span>
      </p>

      <div className="diag-form-group">
        <label htmlFor="processNameInput">What do YOU call this process?</label>
        <input
          id="processNameInput"
          type="text"
          placeholder="e.g., New customer setup"
          value={name}
          onChange={handleChange}
        />
        <p className="diag-helper-text">
          Examples: "New customer setup", "Client onboarding", "Quote-to-cash", "Account activation"
        </p>
      </div>

      <p style={{ color: 'var(--text-mid)', fontSize: '0.95rem' }}>
        This helps us ask questions in your language.
      </p>

      <div className="diag-button-group">
        <button className="diag-btn diag-btn-secondary" onClick={() => goToScreen(1)}>
          ← Back
        </button>
        <button
          className="diag-btn diag-btn-primary"
          onClick={handleContinue}
          disabled={!name.trim()}
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
