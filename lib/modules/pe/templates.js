/**
 * PE Roll-up specific process starters.
 * These appear first in Screen1SelectTemplate for the PE module.
 */
export const PE_TEMPLATES = [
  {
    id: 'pe-ebitda-impact',
    label: 'EBITDA Impact Mapping',
    icon: '📊',
    moduleOnly: true,
    steps: [
      { name: 'Identify cost centre and owner', department: 'Finance', systems: [], workMinutes: 30, waitMinutes: 0 },
      { name: 'Gather process cost inputs (headcount, time, frequency)', department: 'Finance', systems: ['Excel'], workMinutes: 60, waitMinutes: 120 },
      { name: 'Map approval and sign-off chain', department: 'Finance', systems: [], workMinutes: 20, waitMinutes: 0 },
      { name: 'Identify manual vs automated steps', department: 'Operations', systems: [], workMinutes: 30, waitMinutes: 0 },
      { name: 'Calculate fully-loaded annual cost', department: 'Finance', systems: ['Excel'], workMinutes: 45, waitMinutes: 0 },
      { name: 'Benchmark against APQC peer data', department: 'Finance', systems: [], workMinutes: 30, waitMinutes: 0 },
      { name: 'Document improvement opportunities and EBITDA impact', department: 'Finance', systems: [], workMinutes: 60, waitMinutes: 0 },
    ],
  },
  {
    id: 'pe-management-reporting',
    label: 'Management Reporting Baseline',
    icon: '📋',
    moduleOnly: true,
    steps: [
      { name: 'Request data from business units', department: 'Finance', systems: ['Email'], workMinutes: 20, waitMinutes: 1440 },
      { name: 'Consolidate data into master spreadsheet', department: 'Finance', systems: ['Excel'], workMinutes: 90, waitMinutes: 0 },
      { name: 'Validate figures against source systems', department: 'Finance', systems: ['Excel', 'Xero'], workMinutes: 60, waitMinutes: 60 },
      { name: 'Identify and investigate variances', department: 'Finance', systems: ['Excel'], workMinutes: 45, waitMinutes: 120 },
      { name: 'Prepare commentary and narrative', department: 'Finance', systems: ['Excel'], workMinutes: 60, waitMinutes: 0 },
      { name: 'CFO review and sign-off', department: 'Finance', systems: [], workMinutes: 30, waitMinutes: 480 },
      { name: 'Distribute to board / PE investor', department: 'Finance', systems: ['Email'], workMinutes: 10, waitMinutes: 0 },
    ],
  },
  {
    id: 'pe-cost-centre-review',
    label: 'Cost Centre Review',
    icon: '💷',
    moduleOnly: true,
    steps: [
      { name: 'Pull cost centre P&L from finance system', department: 'Finance', systems: ['Xero', 'NetSuite'], workMinutes: 20, waitMinutes: 0 },
      { name: 'Identify top 5 cost lines', department: 'Finance', systems: ['Excel'], workMinutes: 30, waitMinutes: 0 },
      { name: 'Allocate costs to process activities', department: 'Finance', systems: ['Excel'], workMinutes: 60, waitMinutes: 0 },
      { name: 'Benchmark against prior period and budget', department: 'Finance', systems: ['Excel'], workMinutes: 30, waitMinutes: 0 },
      { name: 'Review with cost centre owner', department: 'Operations', systems: [], workMinutes: 45, waitMinutes: 1440 },
      { name: 'Agree on reduction actions and owners', department: 'Operations', systems: [], workMinutes: 30, waitMinutes: 0 },
      { name: 'Log in action tracker and follow up', department: 'Finance', systems: ['Excel', 'Asana'], workMinutes: 15, waitMinutes: 0 },
    ],
  },
];
