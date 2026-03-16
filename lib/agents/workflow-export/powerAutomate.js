/**
 * Generate Power Automate build guide.
 * Power Automate flows use triggers and actions. This produces a structured
 * guide for building a flow that mirrors the process steps.
 */

export function generatePowerAutomateWorkflow(acceptedProcesses) {
  const proc = acceptedProcesses[0];
  const processName = proc.processName || proc.name || 'Process';
  const steps = (proc.steps || []).filter((s) => s.status !== 'removed');
  const handoffs = proc.handoffs || [];

  const actions = steps.map((step, i) => {
    const handoff = handoffs[i];
    return {
      order: i + 1,
      name: step.name || `Step ${i + 1}`,
      department: step.department || '',
      handoff: handoff?.method || '',
      suggestedAction: mapToPowerAutomateAction(step, handoff),
      description: `${step.name}. ${step.department ? `Owner: ${step.department}.` : ''}`,
    };
  });

  return {
    name: processName,
    type: 'flow',
    trigger: {
      suggested: 'Manually trigger a flow, When a new item is created, or Recurrence',
      description: 'Start the flow  -  manual run, SharePoint list, Dynamics, or schedule.',
    },
    actions: actions,
    metadata: {
      generatedBy: 'Sharpin',
      source: 'accepted-redesign',
      stepCount: steps.length,
    },
  };
}

function mapToPowerAutomateAction(step, handoff) {
  const h = (handoff?.method || '').toLowerCase();
  if (h.includes('email')) return 'Send an email (V2)';
  if (h.includes('slack') || h.includes('teams')) return 'Post message in a chat or channel';
  if (h.includes('spreadsheet') || h.includes('doc')) return 'Create row in Excel or Add row to SharePoint list';
  if (step.department?.toLowerCase().includes('approval')) return 'Start and wait for an approval';
  return 'Compose, Set variable, or HTTP request';
}
