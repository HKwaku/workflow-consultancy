/**
 * Process data shape and helpers for the diagnostic
 */

export const PROCESSES = [
  { id: 'customer-onboarding', name: 'Customer Onboarding', icon: '&#128230;' },
  { id: 'sales-to-delivery', name: 'Sales to Delivery', icon: '&#128176;' },
  { id: 'employee-onboarding', name: 'Employee Onboarding', icon: '&#128100;' },
  { id: 'order-fulfillment', name: 'Order Fulfillment', icon: '&#9989;' },
  { id: 'invoice-to-payment', name: 'Invoice to Payment', icon: '&#128179;' },
  { id: 'issue-resolution', name: 'Issue Resolution', icon: '&#128295;' },
  { id: 'approval-workflow', name: 'Approval Workflow', icon: '&#128203;' },
  { id: 'product-launch', name: 'Product Launch', icon: '&#128640;' },
  { id: 'reporting-cycle', name: 'Reporting Cycle', icon: '&#128200;' },
];

export function createEmptyProcess() {
  return {
    processType: '',
    processName: '',
    teamSize: '',
    industry: '',
    definition: {
      startsWhen: '',
      completesWhen: '',
      complexity: '',
      departments: [],
    },
    lastExample: {
      name: '',
      startDate: '',
      endDate: '',
      elapsedDays: 0,
    },
    userTime: {
      meetings: 0,
      emails: 0,
      execution: 0,
      waiting: 0,
      rework: 0,
      total: 0,
    },
    timeRangeSelections: {
      totalTimeRange: '',
      waitingPortion: '',
      primaryActivity: '',
      meetingCount: '',
      emailCount: '',
      executionLevel: '',
      waitingPortion: '',
      reworkLevel: '',
    },
    timeAccuracy: '',
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
    frequency: {
      type: '',
      annual: 0,
      inFlight: 0,
      progressing: 0,
      stuck: 0,
      waiting: 0,
    },
    costs: {
      hourlyRate: 50,
      instanceCost: 0,
      annualUserCost: 0,
      totalAnnualCost: 0,
      teamSize: 1,
    },
    savings: {},
    priority: {},
    bottleneck: {},
  };
}

export function ensureProcessDataShape(p) {
  const empty = createEmptyProcess();
  if (!p || typeof p !== 'object') return empty;
  const out = {};
  for (const k of Object.keys(empty)) {
    const ev = empty[k];
    const pv = p[k];
    if (ev === null || ev === undefined) {
      out[k] = pv;
    } else if (Array.isArray(ev)) {
      out[k] = Array.isArray(pv) ? pv : ev;
    } else if (typeof ev === 'object' && ev !== null && !Array.isArray(ev)) {
      out[k] = typeof pv === 'object' && pv !== null ? { ...ev, ...pv } : ev;
    } else {
      out[k] = pv !== undefined && pv !== null ? pv : ev;
    }
  }
  return out;
}
