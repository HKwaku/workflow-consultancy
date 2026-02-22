export const SCREEN_LABELS = {
  0: 'Getting Started',
  1: 'Process Selection',
  2: 'Process Name',
  3: 'Define Boundaries',
  4: 'Last Example',
  5: 'Time Investment',
  6: 'Performance',
  7: 'Step Breakdown',
  8: 'Handoff Analysis',
  9: 'Bottlenecks',
  10: 'Systems & Tools',
  11: 'Approvals',
  12: 'Knowledge',
  13: 'New Hire',
  14: 'Frequency',
  15: 'Cost Calculation',
  16: 'Team Cost & Savings',
  17: 'Priority',
  18: 'Your Details',
  19: 'Results',
};

export const SCREEN_PHASES = {
  1: 'Define', 2: 'Define', 3: 'Define',
  4: 'Measure', 5: 'Measure', 6: 'Measure',
  7: 'Map', 8: 'Map', 9: 'Map',
  10: 'Assess', 11: 'Assess', 12: 'Assess', 13: 'Assess',
  14: 'Quantify', 15: 'Quantify', 16: 'Quantify', 17: 'Quantify', 18: 'Quantify',
};

export const PHASES = ['Define', 'Measure', 'Map', 'Assess', 'Quantify'];

export const PROCESS_TEMPLATES = [
  { id: 'customer-onboarding', name: 'Customer Onboarding', icon: '📦' },
  { id: 'sales-to-delivery', name: 'Sales to Delivery', icon: '💰' },
  { id: 'employee-onboarding', name: 'Employee Onboarding', icon: '👤' },
  { id: 'order-fulfillment', name: 'Order Fulfillment', icon: '✅' },
  { id: 'invoice-to-payment', name: 'Invoice to Payment', icon: '💳' },
  { id: 'issue-resolution', name: 'Issue Resolution', icon: '🔧' },
  { id: 'approval-workflow', name: 'Approval Workflow', icon: '📋' },
  { id: 'product-launch', name: 'Product Launch', icon: '🚀' },
  { id: 'reporting-cycle', name: 'Reporting Cycle', icon: '📊' },
];

export const DEFAULT_DEPARTMENTS = [
  'Sales', 'Operations', 'Finance', 'IT', 'Customer Success', 'Product', 'Leadership', 'HR',
];

export const COMPLEXITY_OPTIONS = [
  { value: '1-2', label: '1–2 people (Mostly self-contained)' },
  { value: '3-5', label: '3–5 people (Cross-functional)' },
  { value: '6-10', label: '6–10 people (Multiple teams)' },
  { value: '10+', label: '10+ people (Organisation-wide)' },
];
