import { createBuildGuide } from './buildGuide.js';

export function generateRetoolWorkflow(acceptedProcesses) {
  return createBuildGuide(acceptedProcesses, {
    type: 'workflow',
    triggerSuggested: 'Button click, Schedule, or Event',
    triggerDesc: 'Retool workflow  -  trigger on button click, schedule, or app event.',
  });
}
