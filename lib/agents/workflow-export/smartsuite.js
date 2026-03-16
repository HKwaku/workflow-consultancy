import { createBuildGuide } from './buildGuide.js';

export function generateSmartSuiteWorkflow(acceptedProcesses) {
  return createBuildGuide(acceptedProcesses, {
    type: 'workflow',
    triggerSuggested: 'Record created, record updated, or scheduled',
    triggerDesc: 'SmartSuite workflow  -  trigger on record change or schedule.',
  });
}
