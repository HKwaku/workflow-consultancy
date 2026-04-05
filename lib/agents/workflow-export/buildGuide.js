/**
 * Generic build guide generator for workflow platforms.
 * Returns a structured JSON guide: trigger + steps with name, department, handoff.
 */

export function createBuildGuide(acceptedProcesses, { type, triggerSuggested, triggerDesc }) {
  const proc = acceptedProcesses[0];
  const processName = proc.processName || proc.name || 'Process';
  const steps = (proc.steps || []).filter((s) => s.status !== 'removed');
  const handoffs = proc.handoffs || [];

  const stepDefs = steps.map((step, i) => {
    const handoff = handoffs[i];
    return {
      order: i + 1,
      name: step.name || `Step ${i + 1}`,
      department: step.department || '',
      handoff: handoff?.method || '',
      description: `${step.name}. ${step.department ? `Owner: ${step.department}.` : ''} ${handoff?.method ? `Handoff: ${handoff.method}.` : ''}`,
    };
  });

  return {
    name: processName,
    type,
    trigger: { suggested: triggerSuggested, description: triggerDesc },
    steps: stepDefs,
    metadata: { generatedBy: 'Vesno', source: 'accepted-redesign', stepCount: steps.length },
  };
}
