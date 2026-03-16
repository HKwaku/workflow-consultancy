/**
 * Generate Zapier build guide.
 * Zapier Zaps are trigger → action(s). This produces a structured guide
 * for building a Zap that mirrors the process steps.
 */

export function generateZapierWorkflow(acceptedProcesses) {
  const proc = acceptedProcesses[0];
  const processName = proc.processName || proc.name || 'Process';
  const steps = (proc.steps || []).filter((s) => s.status !== 'removed');
  const handoffs = proc.handoffs || [];

  const actions = steps.map((step, i) => {
    const handoff = handoffs[i];
    return {
      step: i + 1,
      name: step.name || `Step ${i + 1}`,
      department: step.department || '',
      handoff: handoff?.method || '',
      suggestedApp: mapToZapierApp(step, handoff),
      description: `Action ${i + 1}: ${step.name}. ${step.department ? `Owner: ${step.department}.` : ''} ${handoff?.method ? `Handoff: ${handoff.method}.` : ''}`,
    };
  });

  return {
    name: processName,
    type: 'zap',
    trigger: {
      suggested: 'Manual Trigger or Schedule',
      description: 'Start the process  -  e.g. new form submission, new row in spreadsheet, or scheduled run.',
    },
    steps: actions,
    metadata: {
      generatedBy: 'Sharpin',
      source: 'accepted-redesign',
      stepCount: steps.length,
    },
  };
}

function mapToZapierApp(step, handoff) {
  const h = (handoff?.method || '').toLowerCase();
  if (h.includes('email')) return 'Gmail, Outlook, or Email by Zapier';
  if (h.includes('slack')) return 'Slack';
  if (h.includes('spreadsheet')) return 'Google Sheets or Excel';
  if (step.department?.toLowerCase().includes('sales')) return 'HubSpot, Salesforce, or Pipedrive';
  if (step.department?.toLowerCase().includes('hr')) return 'BambooHR, Workday, or Personio';
  return 'Filter, Formatter, or your CRM';
}
