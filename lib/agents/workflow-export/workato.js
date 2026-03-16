import { createBuildGuide } from './buildGuide.js';

export function generateWorkatoWorkflow(acceptedProcesses) {
  return createBuildGuide(acceptedProcesses, {
    type: 'recipe',
    triggerSuggested: 'Event, schedule, or webhook',
    triggerDesc: 'Workato recipe  -  trigger on app event, schedule, or webhook.',
  });
}
