import { createBuildGuide } from './buildGuide.js';

export function generateTrayIoWorkflow(acceptedProcesses) {
  return createBuildGuide(acceptedProcesses, {
    type: 'workflow',
    triggerSuggested: 'Webhook, schedule, or connector trigger',
    triggerDesc: 'Tray.io workflow  -  trigger on webhook, schedule, or connector event.',
  });
}
