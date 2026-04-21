/**
 * High Risk Ops specific process starters.
 * These appear first in Screen1SelectTemplate for the High Risk Ops module.
 */
export const HIGH_RISK_OPS_TEMPLATES = [
  {
    id: 'hro-business-continuity',
    label: 'Business Continuity Mapping',
    icon: '🛡️',
    moduleOnly: true,
    steps: [
      { name: 'Identify process owner and named backup', department: 'Operations', systems: [], workMinutes: 20, waitMinutes: 0 },
      { name: 'Document all steps reliant on a single person', department: 'Operations', systems: [], workMinutes: 60, waitMinutes: 0 },
      { name: 'Map system dependencies and access requirements', department: 'IT', systems: [], workMinutes: 30, waitMinutes: 0 },
      { name: 'Define RTO (recovery time objective) for process failure', department: 'Operations', systems: [], workMinutes: 30, waitMinutes: 0 },
      { name: 'Write documented fallback / contingency procedure', department: 'Operations', systems: [], workMinutes: 90, waitMinutes: 0 },
      { name: 'Rehearse fallback with backup owner', department: 'Operations', systems: [], workMinutes: 60, waitMinutes: 0 },
      { name: 'Store in accessible knowledge base and review quarterly', department: 'Operations', systems: ['Notion', 'SharePoint'], workMinutes: 20, waitMinutes: 0 },
    ],
  },
  {
    id: 'hro-key-person-dependency',
    label: 'Key-Person Dependency Audit',
    icon: '⚠️',
    moduleOnly: true,
    steps: [
      { name: 'List all critical processes across the business', department: 'Operations', systems: [], workMinutes: 30, waitMinutes: 0 },
      { name: 'For each process: identify who performs it and backup', department: 'Operations', systems: [], workMinutes: 60, waitMinutes: 0 },
      { name: 'Rate impact of each process if owner is unavailable for 1 week', department: 'Operations', systems: [], workMinutes: 45, waitMinutes: 0 },
      { name: 'Flag high-impact single-owner processes as red risks', department: 'Operations', systems: [], workMinutes: 20, waitMinutes: 0 },
      { name: 'Prioritise documentation for top 3 red risk processes', department: 'Operations', systems: [], workMinutes: 60, waitMinutes: 0 },
      { name: 'Cross-train named backup on each red risk process', department: 'HR', systems: [], workMinutes: 180, waitMinutes: 2880 },
      { name: 'Confirm risk rating reduced and update risk register', department: 'Operations', systems: [], workMinutes: 20, waitMinutes: 0 },
    ],
  },
  {
    id: 'hro-compliance-control',
    label: 'Compliance Control Mapping',
    icon: '📜',
    moduleOnly: true,
    steps: [
      { name: 'Identify applicable regulations and standards for this process', department: 'Legal', systems: [], workMinutes: 30, waitMinutes: 0 },
      { name: 'Map which steps involve regulated data or financial controls', department: 'Operations', systems: [], workMinutes: 45, waitMinutes: 0 },
      { name: 'Confirm evidence of control exists for each regulated step', department: 'Operations', systems: [], workMinutes: 60, waitMinutes: 0 },
      { name: 'Identify gaps: steps with no audit trail or documented owner', department: 'Operations', systems: [], workMinutes: 30, waitMinutes: 0 },
      { name: 'Assign responsible owner and evidence requirement for each gap', department: 'Legal', systems: [], workMinutes: 30, waitMinutes: 0 },
      { name: 'Implement control improvements and evidence capture', department: 'Operations', systems: [], workMinutes: 120, waitMinutes: 2880 },
      { name: 'Conduct compliance walk-through and sign off', department: 'Legal', systems: [], workMinutes: 60, waitMinutes: 0 },
    ],
  },
];
