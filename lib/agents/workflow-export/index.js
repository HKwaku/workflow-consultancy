/**
 * Workflow export agent  -  generates platform-specific workflow definitions
 * from accepted operating model redesigns.
 */

import { generateN8nWorkflow } from './n8n.js';
import { generateUnqorkWorkflow } from './unqork.js';
import { generateMakeWorkflow } from './make.js';
import { generateZapierWorkflow } from './zapier.js';
import { generatePowerAutomateWorkflow } from './powerAutomate.js';
import { generatePipedreamWorkflow } from './pipedream.js';
import { generateCamundaWorkflow } from './camunda.js';
import { generateTemporalWorkflow } from './temporal.js';
import { generateRetoolWorkflow } from './retool.js';
import { generateAirtableWorkflow } from './airtable.js';
import { generateMondayWorkflow } from './monday.js';
import { generateProcessStreetWorkflow } from './processStreet.js';
import { generateSmartSuiteWorkflow } from './smartsuite.js';
import { generateWorkatoWorkflow } from './workato.js';
import { generateTrayIoWorkflow } from './trayIo.js';
import { generateInstructions } from './instructions.js';
import { getSupportedPlatformIds } from './platforms.js';

const GENERATORS = {
  n8n: generateN8nWorkflow,
  unqork: generateUnqorkWorkflow,
  make: generateMakeWorkflow,
  zapier: generateZapierWorkflow,
  'power-automate': generatePowerAutomateWorkflow,
  pipedream: generatePipedreamWorkflow,
  camunda: generateCamundaWorkflow,
  temporal: generateTemporalWorkflow,
  retool: generateRetoolWorkflow,
  airtable: generateAirtableWorkflow,
  monday: generateMondayWorkflow,
  'process-street': generateProcessStreetWorkflow,
  smartsuite: generateSmartSuiteWorkflow,
  workato: generateWorkatoWorkflow,
  'tray-io': generateTrayIoWorkflow,
};

/**
 * Generate workflow export for a given platform.
 * @param {Object} params
 * @param {Array<{processName: string, steps: Array, handoffs: Array}>} params.acceptedProcesses
 * @param {string} params.platform - Platform id (n8n, unqork, make, zapier, power-automate, pipedream)
 * @returns {{ workflowJson: object, instructions: string, platform: string }}
 */
export async function generateWorkflowExport({ acceptedProcesses, platform }) {
  if (!acceptedProcesses?.length) {
    throw new Error('No accepted processes to export. Accept the redesign first.');
  }

  const generator = GENERATORS[platform];
  if (!generator) {
    throw new Error(`Unsupported platform: ${platform}. Use one of: ${getSupportedPlatformIds().join(', ')}.`);
  }

  const workflowJson = generator(acceptedProcesses);
  const instructions = generateInstructions({ platform, acceptedProcesses });

  return {
    workflowJson,
    instructions,
    platform,
  };
}
