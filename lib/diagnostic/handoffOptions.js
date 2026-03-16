/**
 * Handoff method and clarity options for step transitions
 * Matches original diagnostic.html emoji-based button labels
 */

export const HANDOFF_METHODS = [
  { value: 'email', label: 'Email' },
  { value: 'slack', label: 'Slack / Teams' },
  { value: 'verbal', label: 'Verbal' },
  { value: 'meeting', label: 'Meeting / call' },
  { value: 'spreadsheet', label: 'Shared doc' },
  { value: 'they-knew', label: 'They just knew' },
];

export const CLARITY_OPTIONS = [
  { value: 'no', label: '\u2705 No issues' },
  { value: 'yes-once', label: '\u{1F7E1} Once' },
  { value: 'yes-multiple', label: '\u{1F7E0} 2-3x' },
  { value: 'yes-major', label: '\u{1F534} 4+x' },
];
