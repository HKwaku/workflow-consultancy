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

function buildN8nNodes(proc, baseX = 240, baseY = 300) {
  const steps = (proc.steps || []).filter((s) => s.status !== 'removed');
  const nodes = [];
  // nodeMap: stepName → { type: 'set'|'if', branches?: [trueName, falseName] }
  const nodeMap = [];

  // Manual Trigger
  nodes.push({
    parameters: {},
    id: uuid(),
    name: 'Start',
    type: 'n8n-nodes-base.manualTrigger',
    typeVersion: 1,
    position: [baseX, baseY],
  });
  nodeMap.push({ name: 'Start', isDecision: false });

  let xOffset = baseX + 220;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepName = step.name || `Step ${i + 1}`;
    const handoff = (proc.handoffs || [])[i];
    const dept = step.department || '';
    const systems = (step.systems || []).join(', ') || '';

    if (step.isDecision) {
      // Determine branch targets from branches array or fallback to next two steps
      const branches = step.branches || [];
      const trueBranchTarget = branches[0]?.target || (steps[i + 1]?.name) || null;
      const falseBranchTarget = branches[1]?.target || (steps[i + 2]?.name) || null;

      nodes.push({
        parameters: {
          conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
            conditions: [
              {
                id: uuid(),
                leftValue: `={{ $json["${stepName.replace(/"/g, '')}"] }}`,
                rightValue: 'approved',
                operator: { type: 'string', operation: 'equals' },
              },
            ],
            combinator: 'and',
          },
          options: {},
        },
        id: uuid(),
        name: stepName,
        type: 'n8n-nodes-base.if',
        typeVersion: 2,
        position: [xOffset, baseY],
      });
      nodeMap.push({ name: stepName, isDecision: true, trueBranch: trueBranchTarget, falseBranch: falseBranchTarget });
    } else {
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
        id: uuid(),
        name: stepName,
        type: 'n8n-nodes-base.set',
        typeVersion: 3.3,
        position: [xOffset, baseY],
      });
      nodeMap.push({ name: stepName, isDecision: false });
    }
    xOffset += 220;
  }

  return { nodes, nodeMap };
}

function buildConnections(nodeMap) {
  const connections = {};
  for (let i = 0; i < nodeMap.length - 1; i++) {
    const current = nodeMap[i];
    const next = nodeMap[i + 1];

    if (current.isDecision) {
      // If node: output 0 = true branch, output 1 = false branch
      const trueTarget = current.trueBranch || next.name;
      const falseTarget = current.falseBranch || next.name;
      connections[current.name] = {
        main: [
          [{ node: trueTarget, type: 'main', index: 0 }],
          [{ node: falseTarget, type: 'main', index: 0 }],
        ],
      };
    } else {
      connections[current.name] = {
        main: [[{ node: next.name, type: 'main', index: 0 }]],
      };
    }
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
  const { nodes, nodeMap } = buildN8nNodes(proc);
  const connections = buildConnections(nodeMap);

  return {
    name: `${processName} (Vesno PoC)`,
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
