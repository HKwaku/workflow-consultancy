import { createBuildGuide } from './buildGuide.js';

export function generateTemporalWorkflow(acceptedProcesses) {
  return createBuildGuide(acceptedProcesses, {
    type: 'workflow',
    triggerSuggested: 'Workflow start (signal, schedule, or child workflow)',
    triggerDesc: 'Temporal workflow  -  start via signal, schedule, or as child of another workflow.',
  });
}
