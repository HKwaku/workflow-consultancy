/**
 * Diagnostic constants - process types, departments, systems, etc.
 */

export const COMMON_SYSTEMS = [
  'Salesforce', 'HubSpot', 'Pipedrive',
  'Gmail', 'Outlook', 'Slack', 'Teams', 'Zoom',
  'Xero', 'QuickBooks', 'Sage',
  'Jira', 'Asana', 'Monday.com', 'Trello', 'Notion',
  'Google Sheets', 'Excel', 'SharePoint',
  'DocuSign', 'HelloSign',
  'Stripe', 'Xero', 'GoCardless',
  'Zendesk', 'Freshdesk', 'Intercom',
  'NetSuite', 'SAP', 'Dynamics 365',
  'Dropbox', 'Google Drive', 'OneDrive',
  'Typeform', 'Calendly', 'Zapier', 'Make',
];

export const SCREEN_LABELS = {
  '-2': 'Team Alignment',
  0: 'Getting Started',
  1: 'Process Definition',
  2: 'Map Steps',
  4: 'Cost & Impact',
  5: 'Your Details',
  6: 'Complete',
};

export const SCREEN_PHASES = {
  0: 'Define',
  2: 'Map',
  4: 'Quantify',
  5: 'Quantify',
  6: 'Complete',
};

export const PROCESS_SCREENS = [0, 2, 5, 6];
export const PROCESS_STEP_LABELS = {
  0: 'Define Process',
  2: 'Map Steps',
  5: 'Your Details',
  6: 'Complete',
};

// Both modes share the same screen sequence — mode only affects whether
// cost analysis is triggered (comprehensive) or skipped (map-only).
export const MAP_ONLY_SCREENS = PROCESS_SCREENS;
export const MAP_ONLY_STEP_LABELS = PROCESS_STEP_LABELS;
export const COMPREHENSIVE_SCREENS = PROCESS_SCREENS;
export const COMPREHENSIVE_STEP_LABELS = PROCESS_STEP_LABELS;

export const TOTAL_SCREENS = 6;

/**
 * Dwell (wait) type — classifies WHY an item sits idle between touches.
 * This is distinct from person idle time: the item ages, not the person.
 *
 *  dependency — item is in another person/team's hands; they must complete
 *               their part before this step can proceed. The wait is external
 *               and uncontrollable from within this step.
 *               Fix: SLAs, handoff triggers, chasing protocols.
 *
 *  blocked    — item is structurally stuck: missing information, unclear input,
 *               or an unresolved system/process issue. Nobody is actively working
 *               on it — it just can't move forward yet.
 *               Fix: upstream clarity, better intake requirements.
 *
 *  capacity   — the right person is identifiable but unavailable (at capacity,
 *               on leave, overloaded). The item sits until they're free.
 *               Fix: resource balancing, cover arrangements.
 *
 *  wip        — person is technically available but context-switched to other
 *               concurrent work. The item is invisible rather than blocked.
 *               Fix: WIP limits, prioritisation signals.
 */
export const WAIT_TYPE_OPTIONS = [
  { value: 'dependency', label: 'Dependency', title: 'Item is with another person/team who must complete their part before this step can proceed' },
  { value: 'blocked',    label: 'Blocked',    title: 'Item cannot proceed — missing information, unclear input, or unresolved process issue' },
  { value: 'capacity',   label: 'Capacity',   title: 'Right person is identifiable but unavailable — at capacity or overloaded' },
  { value: 'wip',        label: 'WIP',        title: 'Person available but context-switched to other concurrent work — item is invisible, not blocked' },
];
