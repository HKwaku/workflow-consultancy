import { createBuildGuide } from './buildGuide.js';

export function generateAirtableWorkflow(acceptedProcesses) {
  return createBuildGuide(acceptedProcesses, {
    type: 'automation',
    triggerSuggested: 'Record created, record updated, or scheduled',
    triggerDesc: 'Airtable automation  -  trigger on record change, or run on schedule.',
  });
}
