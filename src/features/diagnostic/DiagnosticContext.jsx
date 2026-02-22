import React, { createContext, useContext, useReducer, useCallback } from 'react';

const TOTAL_SCREENS = 19;

export function createEmptyProcess() {
  return {
    processType: '',
    processName: '',
    definition: { startsWhen: '', completesWhen: '', complexity: '', departments: [] },
    lastExample: { name: '', startDate: '', endDate: '', elapsedDays: 0 },
    userTime: { meetings: 0, emails: 0, execution: 0, waiting: 0, total: 0 },
    timeRangeSelections: {},
    performance: '',
    issues: [],
    biggestDelay: '',
    delayDetails: '',
    steps: [],
    handoffs: [],
    systems: [],
    approvals: [],
    knowledge: {},
    newHire: {},
    frequency: { type: '', annual: 0, inFlight: 0, progressing: 0, stuck: 0, waiting: 0 },
    costs: { hourlyRate: 50, instanceCost: 0, annualUserCost: 0, totalAnnualCost: 0, teamSize: 1 },
    savings: {},
    priority: {},
    bottleneck: {},
  };
}

const initialState = {
  currentScreen: 0,
  processData: createEmptyProcess(),
  completedProcesses: [],
  customDepartments: [],
  stepCount: 0,
  systemCount: 0,
  editingReportId: null,
};

const DiagnosticContext = createContext(null);

export function useDiagnostic() {
  const ctx = useContext(DiagnosticContext);
  if (!ctx) throw new Error('useDiagnostic must be used within DiagnosticProvider');
  return ctx;
}

function reducer(state, action) {
  switch (action.type) {
    case 'SET_SCREEN':
      return { ...state, currentScreen: action.payload };
    case 'SET_PROCESS_DATA':
      return { ...state, processData: { ...createEmptyProcess(), ...state.processData, ...action.payload } };
    case 'SET_COMPLETED_PROCESSES':
      return { ...state, completedProcesses: action.payload };
    case 'SET_CUSTOM_DEPARTMENTS':
      return { ...state, customDepartments: action.payload };
    case 'SET_EDITING_REPORT':
      return { ...state, editingReportId: action.payload };
    case 'RESET_PROCESS':
      return { ...state, processData: createEmptyProcess() };
    case 'RESTORE_STATE':
      return { ...action.payload };
    default:
      return state;
  }
}

export function DiagnosticProvider({ children, initial }) {
  const [state, dispatch] = useReducer(reducer, initial || initialState);

  const goToScreen = useCallback((screenNum) => {
    dispatch({ type: 'SET_SCREEN', payload: screenNum });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const setProcessData = useCallback((updates) => {
    dispatch({ type: 'SET_PROCESS_DATA', payload: updates });
  }, []);

  const saveToLocalStorage = useCallback(() => {
    try {
      localStorage.setItem('processDiagnosticProgress', JSON.stringify({
        currentScreen: state.currentScreen,
        processData: state.processData,
        completedProcesses: state.completedProcesses,
        customDepartments: state.customDepartments,
        stepCount: state.stepCount,
        editingReportId: state.editingReportId,
        timestamp: new Date().toISOString(),
      }));
    } catch (e) { /* ignore */ }
  }, [state]);

  const value = {
    ...state,
    TOTAL_SCREENS,
    goToScreen,
    setProcessData,
    saveToLocalStorage,
    dispatch,
  };

  return (
    <DiagnosticContext.Provider value={value}>
      {children}
    </DiagnosticContext.Provider>
  );
}
