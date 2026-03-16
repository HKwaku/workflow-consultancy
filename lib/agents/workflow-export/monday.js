import { createBuildGuide } from './buildGuide.js';

export function generateMondayWorkflow(acceptedProcesses) {
  return createBuildGuide(acceptedProcesses, {
    type: 'automation',
    triggerSuggested: 'Item created, status changed, or column updated',
    triggerDesc: 'Monday.com automation  -  trigger on board change, item update, or status.',
  });
}
