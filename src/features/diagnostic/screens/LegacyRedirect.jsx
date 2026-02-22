import React, { useEffect } from 'react';
import { useDiagnostic } from '../DiagnosticContext';

/**
 * For screens 4–19, we save state to localStorage and redirect to the legacy
 * diagnostic.html. The legacy will load the saved data and resume from the
 * target screen.
 */
export default function LegacyRedirect({ targetScreen }) {
  const { processData, completedProcesses, customDepartments, stepCount, editingReportId, saveToLocalStorage } = useDiagnostic();

  useEffect(() => {
    saveToLocalStorage();
    // Force the legacy to load at the right screen by writing to localStorage
    const payload = {
      currentScreen: targetScreen,
      processData,
      completedProcesses,
      customDepartments,
      stepCount,
      editingReportId,
      timestamp: new Date().toISOString(),
    };
    try {
      localStorage.setItem('processDiagnosticProgress', JSON.stringify(payload));
    } catch (e) { /* ignore */ }
    window.location.href = '/diagnostic.html';
  }, []);

  return (
    <div className="loading-state" style={{ padding: 60, textAlign: 'center' }}>
      <div className="spinner" />
      <p>Continuing to next step...</p>
    </div>
  );
}
