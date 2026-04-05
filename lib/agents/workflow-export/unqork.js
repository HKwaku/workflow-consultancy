/**
 * Generate Unqork workflow definition from accepted process steps.
 * Produces a JSON structure describing nodes, swimlanes, and flow
 * for use with Unqork Workflow Builder (Copy/Paste Workflow Definition).
 *
 * Unqork uses BPMN-like concepts: Start, Task, End, Exclusive Gateway, etc.
 * This generates a portable definition that can guide manual setup or
 * be adapted for Unqork's import format.
 */

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Generate Unqork-style workflow definition.
 * Structure: pool → swimlanes → nodes → connections.
 */
export function generateUnqorkWorkflow(acceptedProcesses) {
  const proc = acceptedProcesses[0];
  const processName = proc.processName || proc.name || 'Process';
  const steps = (proc.steps || []).filter((s) => s.status !== 'removed');
  const handoffs = proc.handoffs || [];

  const nodes = [];
  const connections = [];
  let x = 100;
  const y = 200;

  // Start node
  const startId = uuid();
  nodes.push({
    id: startId,
    type: 'Start',
    name: 'Start',
    lane: 'Authenticated',
    position: { x, y },
  });
  x += 250;

  let prevId = startId;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepName = step.name || `Step ${i + 1}`;
    const nodeId = uuid();
    const handoff = handoffs[i];
    const lane = step.department ? step.department : 'Authenticated';

    if (step.isDecision && (step.branches || []).length >= 2) {
      // Exclusive Gateway (decision)
      nodes.push({
        id: nodeId,
        type: 'ExclusiveGateway',
        name: stepName,
        lane,
        position: { x, y },
        branches: step.branches.map((b) => ({ label: b.label, target: b.target })),
      });
    } else {
      // Task node
      nodes.push({
        id: nodeId,
        type: 'Task',
        name: stepName,
        lane,
        position: { x, y },
        department: step.department || '',
        handoffMethod: handoff?.method || '',
        systems: step.systems || [],
      });
    }

    connections.push({ from: prevId, to: nodeId });
    prevId = nodeId;
    x += 250;
  }

  // End node
  const endId = uuid();
  nodes.push({
    id: endId,
    type: 'End',
    name: 'End',
    lane: 'Authenticated',
    position: { x, y },
  });
  connections.push({ from: prevId, to: endId });

  return {
    name: processName,
    description: `Workflow generated from Vesno operating model redesign. Import into Unqork Workflow Builder.`,
    version: '1.0',
    processName,
    swimlanes: [
      { id: 'authenticated', name: 'Authenticated', type: 'user' },
      { id: 'automated', name: 'Automated', type: 'automated' },
    ],
    nodes,
    connections,
    metadata: {
      generatedBy: 'Vesno',
      source: 'accepted-redesign',
      stepCount: steps.length,
    },
  };
}
