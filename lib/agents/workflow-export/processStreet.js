import { createBuildGuide } from './buildGuide.js';

export function generateProcessStreetWorkflow(acceptedProcesses) {
  return createBuildGuide(acceptedProcesses, {
    type: 'checklist',
    triggerSuggested: 'Workflow run started, schedule, or trigger',
    triggerDesc: 'Process Street workflow  -  start run manually, on schedule, or via trigger.',
  });
}
