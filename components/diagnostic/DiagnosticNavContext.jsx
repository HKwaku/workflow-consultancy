'use client';

import { createContext, useContext, useRef, useState, useCallback, useMemo } from 'react';

const DiagnosticNavContext = createContext(null);

const SCREENS_WITH_NAV = new Set([-2, 0, 1, 2, 4, 5, 6]);

export function DiagnosticNavProvider({ children }) {
  const navConfigRef = useRef(null);
  const [navVersion, setNavVersion] = useState(0);

  const registerNav = useCallback((config) => {
    const hadConfig = !!navConfigRef.current;
    navConfigRef.current = config;
    if (config && !hadConfig) setNavVersion((v) => v + 1);
    if (!config && hadConfig) setNavVersion((v) => v + 1);
  }, []);

  const notifyUpdate = useCallback(() => {
    setNavVersion((v) => v + 1);
  }, []);

  const value = useMemo(
    () => ({ navConfigRef, navVersion, registerNav, notifyShareUrlChange: notifyUpdate, notifyUpdate }),
    [navVersion, registerNav, notifyUpdate]
  );
  return (
    <DiagnosticNavContext.Provider value={value}>
      {children}
    </DiagnosticNavContext.Provider>
  );
}

export function useDiagnosticNav() {
  return useContext(DiagnosticNavContext);
}

export function DiagnosticNavBar({ currentScreen }) {
  const ctx = useDiagnosticNav();
  if (!ctx || !SCREENS_WITH_NAV.has(currentScreen)) return null;

  const { navConfigRef, navVersion } = ctx;
  void navVersion;

  const config = navConfigRef?.current;
  if (!config) return null;

  const { onBack, onHandover, onContinue, onSaveToReport, savingToReport, disabled, continueLabel } = config;

  return (
    <div className="diagnostic-screen-nav">
      <button type="button" className="button button-secondary" onClick={onBack}>&larr; Back</button>
      <div className="diagnostic-screen-nav-right">
        {onHandover && (
          <button type="button" className="s7-share-btn" onClick={onHandover} title="Handover to a colleague">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            Handover
          </button>
        )}
        {onSaveToReport && (
          <button type="button" className="button button-save-report" onClick={onSaveToReport} disabled={savingToReport}>
            {savingToReport ? 'Saving...' : 'Save to Report'}
          </button>
        )}
        {onContinue && (
          <button type="button" className="button button-primary" onClick={onContinue} disabled={disabled}>{continueLabel || 'Continue \u2192'}</button>
        )}
      </div>
    </div>
  );
}
