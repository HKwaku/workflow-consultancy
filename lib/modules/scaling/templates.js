/**
 * Scaling Mid-cap specific process starters.
 * These appear first in Screen1SelectTemplate for the Scaling module.
 */
export const SCALING_TEMPLATES = [
  {
    id: 'scaling-hire-to-productive',
    label: 'Hire-to-Productive Onboarding',
    icon: '🚀',
    moduleOnly: true,
    steps: [
      { name: 'Offer accepted — trigger onboarding workflow', department: 'HR', systems: ['Email'], workMinutes: 15, waitMinutes: 0 },
      { name: 'IT setup: accounts, hardware, software access', department: 'IT', systems: [], workMinutes: 60, waitMinutes: 1440 },
      { name: 'Day 1 induction and documentation pack', department: 'HR', systems: [], workMinutes: 120, waitMinutes: 0 },
      { name: 'Role-specific training and shadowing (week 1)', department: 'Operations', systems: [], workMinutes: 240, waitMinutes: 0 },
      { name: 'Manager 1:1 check-ins (weeks 2–4)', department: 'Operations', systems: [], workMinutes: 60, waitMinutes: 0 },
      { name: 'First task / client assignment', department: 'Operations', systems: [], workMinutes: 240, waitMinutes: 0 },
      { name: '30-day review: confirm productive and supported', department: 'HR', systems: [], workMinutes: 30, waitMinutes: 0 },
    ],
  },
  {
    id: 'scaling-revenue-ops',
    label: 'Revenue Ops at Scale',
    icon: '📈',
    moduleOnly: true,
    steps: [
      { name: 'Lead enters CRM via inbound or SDR', department: 'Sales', systems: ['HubSpot', 'Salesforce'], workMinutes: 10, waitMinutes: 0 },
      { name: 'Lead qualification and scoring', department: 'Sales', systems: ['HubSpot'], workMinutes: 30, waitMinutes: 0 },
      { name: 'Discovery call booked and held', department: 'Sales', systems: ['Calendly'], workMinutes: 60, waitMinutes: 1440 },
      { name: 'Proposal generated and sent', department: 'Sales', systems: ['Excel', 'Email'], workMinutes: 90, waitMinutes: 0 },
      { name: 'Commercial negotiation', department: 'Sales', systems: [], workMinutes: 60, waitMinutes: 2880 },
      { name: 'Contract signed', department: 'Legal', systems: ['DocuSign'], workMinutes: 30, waitMinutes: 1440 },
      { name: 'Handover to onboarding/delivery team', department: 'Operations', systems: ['Email'], workMinutes: 30, waitMinutes: 0 },
    ],
  },
  {
    id: 'scaling-ops-bottleneck',
    label: 'Ops Bottleneck Audit',
    icon: '⚙️',
    moduleOnly: true,
    steps: [
      { name: 'Identify top 3 process complaints from the team', department: 'Operations', systems: [], workMinutes: 30, waitMinutes: 0 },
      { name: 'Map current flow end-to-end', department: 'Operations', systems: [], workMinutes: 60, waitMinutes: 0 },
      { name: 'Measure current throughput and cycle time', department: 'Operations', systems: [], workMinutes: 30, waitMinutes: 0 },
      { name: 'Identify the one step that limits throughput', department: 'Operations', systems: [], workMinutes: 30, waitMinutes: 0 },
      { name: 'Quantify cost of bottleneck (time × headcount × volume)', department: 'Finance', systems: ['Excel'], workMinutes: 45, waitMinutes: 0 },
      { name: 'Design and test fix for bottleneck step', department: 'Operations', systems: [], workMinutes: 120, waitMinutes: 1440 },
      { name: 'Measure throughput improvement post-fix', department: 'Operations', systems: [], workMinutes: 30, waitMinutes: 0 },
    ],
  },
];
