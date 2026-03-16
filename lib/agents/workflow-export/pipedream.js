/**
 * Generate Pipedream workflow build guide.
 * Pipedream uses steps with triggers and actions. This produces a structured
 * guide for building a workflow that mirrors the process steps.
 */

export function generatePipedreamWorkflow(acceptedProcesses) {
  const proc = acceptedProcesses[0];
  const processName = proc.processName || proc.name || 'Process';
  const steps = (proc.steps || []).filter((s) => s.status !== 'removed');
  const handoffs = proc.handoffs || [];

  const stepDefs = steps.map((step, i) => {
    const handoff = handoffs[i];
    return {
      step: i + 1,
      name: step.name || `Step ${i + 1}`,
      department: step.department || '',
      handoff: handoff?.method || '',
      suggestedComponent: mapToPipedreamComponent(step, handoff),
      config: {
        step: step.name,
        department: step.department || '',
        handoff: handoff?.method || '',
      },
    };
  });

  return {
    name: processName,
    type: 'workflow',
    trigger: {
      suggested: 'Schedule, Webhook, or Event Source',
      description: 'Start the workflow  -  cron, HTTP trigger, or app event (e.g. new row in Airtable).',
    },
    steps: stepDefs,
    metadata: {
      generatedBy: 'Sharpin',
      source: 'accepted-redesign',
      stepCount: steps.length,
    },
  };
}

function mapToPipedreamComponent(step, handoff) {
  const h = (handoff?.method || '').toLowerCase();
  if (h.includes('email')) return 'Gmail, SendGrid, or Resend';
  if (h.includes('slack')) return 'Slack';
  if (h.includes('spreadsheet')) return 'Google Sheets or Airtable';
  if (step.department?.toLowerCase().includes('sales')) return 'Salesforce, HubSpot, or Pipedrive';
  return 'Code (Node.js), HTTP Request, or Data Store';
}
