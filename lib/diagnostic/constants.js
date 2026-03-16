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

// Single process flow — no mode selection, no Cost & Impact screen (4)
export const PROCESS_SCREENS = [0, 2, 5, 6];
export const PROCESS_STEP_LABELS = {
  0: 'Define Process',
  2: 'Map Steps',
  5: 'Your Details',
  6: 'Complete',
};

// Legacy aliases kept for any remaining references
export const MAP_ONLY_SCREENS = PROCESS_SCREENS;
export const MAP_ONLY_STEP_LABELS = PROCESS_STEP_LABELS;
export const COMPREHENSIVE_SCREENS = PROCESS_SCREENS;
export const COMPREHENSIVE_STEP_LABELS = PROCESS_STEP_LABELS;

export const TOTAL_SCREENS = 6;
