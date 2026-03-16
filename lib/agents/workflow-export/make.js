/**
 * Generate Make (Integromat) scenario build guide.
 * Make uses "Blueprint" JSON for import. This produces a structured
 * guide for building a scenario that mirrors the process steps.
 */

export function generateMakeWorkflow(acceptedProcesses) {
  const proc = acceptedProcesses[0];
  const processName = proc.processName || proc.name || 'Process';
  const steps = (proc.steps || []).filter((s) => s.status !== 'removed');
  const handoffs = proc.handoffs || [];

  const modules = steps.map((step, i) => {
    const handoff = handoffs[i];
    return {
      order: i + 1,
      name: step.name || `Step ${i + 1}`,
      department: step.department || '',
      handoff: handoff?.method || '',
      suggestedModule: mapToMakeModule(step, handoff),
      description: `${step.name}. ${step.department ? `Owner: ${step.department}.` : ''} ${handoff?.method ? `Handoff: ${handoff.method}.` : ''}`,
    };
  });

  return {
    name: processName,
    type: 'scenario',
    trigger: {
      suggested: 'Webhooks, Schedule, or Instant (e.g. Google Sheets, Airtable)',
      description: 'Start the scenario  -  webhook, cron, or app trigger.',
    },
    modules,
    metadata: {
      generatedBy: 'Sharpin',
      source: 'accepted-redesign',
      stepCount: steps.length,
    },
  };
}

function mapToMakeModule(step, handoff) {
  const h = (handoff?.method || '').toLowerCase();
  if (h.includes('email')) return 'Gmail, Outlook, or Email';
  if (h.includes('slack')) return 'Slack';
  if (h.includes('spreadsheet')) return 'Google Sheets or Airtable';
  if (step.department?.toLowerCase().includes('approval')) return 'Slack, Email, or HTTP for approval';
  return 'Set variable, HTTP, or your app connector';
}
