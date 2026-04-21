/**
 * M&A Integration specific process starters.
 * These appear first in Screen1SelectTemplate for the M&A module.
 */
export const MA_TEMPLATES = [
  {
    id: 'ma-day1-integration',
    label: 'Day 1 Integration Checklist',
    icon: '🤝',
    moduleOnly: true,
    steps: [
      { name: 'Confirm process owner on combined org chart', department: 'Operations', systems: [], workMinutes: 20, waitMinutes: 0 },
      { name: 'Document current state process (as-is)', department: 'Operations', systems: [], workMinutes: 120, waitMinutes: 0 },
      { name: 'Identify systems used and access requirements', department: 'IT', systems: [], workMinutes: 30, waitMinutes: 0 },
      { name: 'Flag dependencies on departing or at-risk staff', department: 'HR', systems: [], workMinutes: 30, waitMinutes: 0 },
      { name: 'Map cross-entity handoffs and communication paths', department: 'Operations', systems: [], workMinutes: 60, waitMinutes: 0 },
      { name: 'Confirm process continues safely on Day 1', department: 'Operations', systems: [], workMinutes: 45, waitMinutes: 0 },
      { name: 'Assign integration workstream owner', department: 'PMO', systems: [], workMinutes: 20, waitMinutes: 0 },
    ],
  },
  {
    id: 'ma-synergy-capture',
    label: 'Synergy Capture Mapping',
    icon: '🔗',
    moduleOnly: true,
    steps: [
      { name: 'List all parallel processes running in both entities', department: 'Operations', systems: [], workMinutes: 60, waitMinutes: 0 },
      { name: 'Calculate cost of running duplicate processes', department: 'Finance', systems: ['Excel'], workMinutes: 90, waitMinutes: 0 },
      { name: 'Identify best-in-class version to retain', department: 'Operations', systems: [], workMinutes: 45, waitMinutes: 0 },
      { name: 'Map migration path from dropped process to retained', department: 'Operations', systems: [], workMinutes: 60, waitMinutes: 0 },
      { name: 'Agree timeline and sign-off with both process owners', department: 'PMO', systems: [], workMinutes: 30, waitMinutes: 1440 },
      { name: 'Execute migration and decommission duplicate', department: 'Operations', systems: [], workMinutes: 120, waitMinutes: 0 },
      { name: 'Confirm synergy realised and update integration tracker', department: 'PMO', systems: ['Excel'], workMinutes: 30, waitMinutes: 0 },
    ],
  },
  {
    id: 'ma-carve-out-baseline',
    label: 'Carve-out Process Baseline',
    icon: '✂️',
    moduleOnly: true,
    steps: [
      { name: 'Identify processes currently shared with parent entity', department: 'Operations', systems: [], workMinutes: 60, waitMinutes: 0 },
      { name: 'Classify each as: transfer, rebuild, or outsource', department: 'Operations', systems: [], workMinutes: 45, waitMinutes: 0 },
      { name: 'Document shared system dependencies to be severed', department: 'IT', systems: [], workMinutes: 60, waitMinutes: 0 },
      { name: 'Identify staff performing shared service roles', department: 'HR', systems: [], workMinutes: 30, waitMinutes: 0 },
      { name: 'Map standalone process once carved out', department: 'Operations', systems: [], workMinutes: 90, waitMinutes: 0 },
      { name: 'Calculate standalone operating cost', department: 'Finance', systems: ['Excel'], workMinutes: 60, waitMinutes: 0 },
      { name: 'Confirm readiness for standalone operations by separation date', department: 'PMO', systems: [], workMinutes: 30, waitMinutes: 0 },
    ],
  },
];
