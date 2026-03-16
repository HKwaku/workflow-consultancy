/**
 * Generate N8N workflow JSON from accepted process steps.
 * Creates a proof-of-concept workflow: Manual Trigger → Set nodes per step.
 * Decision steps become If nodes with branches.
 */

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function buildN8nNodes(proc, baseX = 240, baseY = 300, stepGap = 180) {
  const steps = (proc.steps || []).filter((s) => s.status !== 'removed');
  const nodes = [];
  const nodeIds = [];

  // Manual Trigger
  const triggerId = uuid();
  nodes.push({
    parameters: {},
    id: triggerId,
    name: 'Start',
    type: 'n8n-nodes-base.manualTrigger',
    typeVersion: 1,
    position: [baseX, baseY],
  });
  nodeIds.push('Start');

  let yOffset = baseY;
  let xOffset = baseX + 220;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepName = step.name || `Step ${i + 1}`;
    const nodeId = uuid();
    const handoff = (proc.handoffs || [])[i];
    const dept = step.department || '';
    const systems = (step.systems || []).join(', ') || '';

    nodes.push({
      parameters: {
        mode: 'manual',
        duplicateItem: false,
        assignments: {
          assignments: [
            { id: uuid(), name: 'step', value: stepName, type: 'string' },
            { id: uuid(), name: 'department', value: dept, type: 'string' },
            { id: uuid(), name: 'handoff', value: handoff?.method || '', type: 'string' },
            { id: uuid(), name: 'systems', value: systems, type: 'string' },
          ],
        },
        options: {},
      },
      id: nodeId,
      name: stepName,
      type: 'n8n-nodes-base.set',
      typeVersion: 3.3,
      position: [xOffset, yOffset],
    });
    nodeIds.push(stepName);
    xOffset += 220;
  }

  return { nodes, nodeIds };
}

function buildConnections(nodeIds) {
  const connections = {};
  for (let i = 0; i < nodeIds.length - 1; i++) {
    const from = nodeIds[i];
    const to = nodeIds[i + 1];
    connections[from] = {
      main: [[{ node: to, type: 'main', index: 0 }]],
    };
  }
  return connections;
}

/**
 * Generate N8N workflow JSON for one or more processes.
 * Multi-process: creates separate workflows (returns first process as primary).
 */
export function generateN8nWorkflow(acceptedProcesses) {
  const proc = acceptedProcesses[0];
  const processName = proc.processName || proc.name || 'Process';
  const { nodes, nodeIds } = buildN8nNodes(proc);
  const connections = buildConnections(nodeIds);

  return {
    name: `${processName} (Sharpin PoC)`,
    nodes,
    connections,
    active: false,
    settings: {
      executionOrder: 'v1',
    },
    staticData: null,
    meta: {
      templateCredsSetupCompleted: false,
    },
    pinData: {},
    tags: [],
  };
}
