import { createBuildGuide } from './buildGuide.js';

export function generateCamundaWorkflow(acceptedProcesses) {
  return createBuildGuide(acceptedProcesses, {
    type: 'bpmn',
    triggerSuggested: 'Message, Timer, or Signal Start Event',
    triggerDesc: 'BPMN start event  -  message, timer, or signal. Deploy to Camunda Engine.',
  });
}
