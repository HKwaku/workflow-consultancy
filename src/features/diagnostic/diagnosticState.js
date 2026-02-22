/**
 * Diagnostic state shape — matches legacy createEmptyProcess()
 */
export function createEmptyProcess() {
  return {
    processType: '',
    processName: '',
    definition: { startsWhen: '', completesWhen: '', complexity: '', departments: [] },
    lastExample: { name: '', startDate: '', endDate: '', elapsedDays: 0 },
    userTime: { meetings: 0, emails: 0, execution: 0, waiting: 0, total: 0 },
    timeRangeSelections: { totalTimeRange: '', waitingPortion: '', primaryActivity: '' },
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

const STORAGE_KEY = 'processDiagnosticProgress';

export function saveToLocalStorage(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      currentScreen: state.currentScreen,
      processData: state.processData,
      completedProcesses: state.completedProcesses || [],
      customDepartments: state.customDepartments || [],
      stepCount: state.stepCount || 0,
      editingReportId: state.editingReportId || null,
      timestamp: new Date().toISOString(),
    }));
  } catch (e) {
    console.warn('Failed to save diagnostic progress:', e.message);
  }
}

export function handOffToLegacy(state) {
  saveToLocalStorage(state);
  window.location.href = '/diagnostic.html?from=react';
}
