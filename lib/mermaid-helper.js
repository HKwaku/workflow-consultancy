// lib/mermaid-helper.js
// Shared Mermaid swimlane diagram generation for process diagnostics

const DEPT_BG = {
  'Sales': '#dbeafe', 'Operations': '#fef3c7', 'Finance': '#dcfce7',
  'IT': '#e0e7ff', 'Customer Success': '#fce7f3', 'Product': '#f3e8ff',
  'Leadership': '#fef9c3', 'HR': '#ffedd5', 'Other': '#f1f5f9'
};
const DEPT_STROKE = {
  'Sales': '#3b82f6', 'Operations': '#f59e0b', 'Finance': '#22c55e',
  'IT': '#6366f1', 'Customer Success': '#ec4899', 'Product': '#a855f7',
  'Leadership': '#ca8a04', 'HR': '#ea580c', 'Other': '#94a3b8'
};

function escMermaid(str) {
  return (str || '')
    .replace(/"/g, "'")
    .replace(/[[\]{}()#&]/g, ' ')
    .replace(/\n/g, ' ')
    .substring(0, 50)
    .trim();
}

/**
 * Resolve a branch target string like "Step 5" or "5" to a 0-based index.
 */
function resolveBranchTarget(target) {
  if (!target) return -1;
  const match = target.match(/(\d+)/);
  return match ? parseInt(match[1]) - 1 : -1;
}

/**
 * Determine whether a step is a decision node with defined branch paths.
 */
function isDecisionNode(step) {
  return !!(step.isDecision && step.branches && step.branches.length > 0);
}

/**
 * Generate a Mermaid swimlane diagram from an array of process objects.
 * Each process should have: steps[], handoffs[], and optionally
 * definition.startsWhen / definition.completesWhen (or startsWhen / completesWhen at top level)
 * and bottleneck.longestStep.
 *
 * Decision nodes (step.isDecision with step.branches[]) are rendered as diamonds
 * with labeled output arrows to each branch target, matching the homepage pattern.
 */
function generateMermaidCode(processes) {
  let m = 'graph TB\n';

  processes.forEach((p, pi) => {
    const prefix = processes.length > 1 ? `P${pi + 1}_` : '';
    const steps = p.steps || [];
    if (steps.length === 0) return;

    const deptSteps = {};
    const deptOrder = [];
    steps.forEach((s, i) => {
      const dept = s.department || 'Other';
      if (!deptSteps[dept]) { deptSteps[dept] = []; deptOrder.push(dept); }
      deptSteps[dept].push({ ...s, number: i + 1 });
    });

    deptOrder.forEach(dept => {
      const safeDept = prefix + dept.replace(/[^a-zA-Z0-9]/g, '_');
      const bg = DEPT_BG[dept] || '#f1f5f9';
      const stroke = DEPT_STROKE[dept] || '#94a3b8';
      m += `\n    subgraph ${safeDept}["  ${escMermaid(dept)}  "]\n`;
      m += `        direction LR\n`;

      deptSteps[dept].forEach(s => {
        const nodeId = `${prefix}S${s.number}`;
        if (isDecisionNode(s)) {
          m += `        ${nodeId}{"${escMermaid(s.name)}"}\n`;
        } else if (s.name && (s.name.toLowerCase().includes('approv') || s.name.toLowerCase().includes('review'))) {
          m += `        ${nodeId}{{"${escMermaid(s.name)}"}}\n`;
        } else {
          m += `        ${nodeId}["${escMermaid(s.name)}"]\n`;
        }
      });

      const dSteps = deptSteps[dept];
      for (let i = 0; i < dSteps.length - 1; i++) {
        if (dSteps[i + 1].number !== dSteps[i].number + 1) {
          m += `        ${prefix}S${dSteps[i].number} ~~~ ${prefix}S${dSteps[i + 1].number}\n`;
        }
      }

      m += `    end\n`;
      m += `    style ${safeDept} fill:${bg},stroke:${stroke},stroke-width:2px,color:#1e293b\n`;
    });

    const startsWhen = p.definition?.startsWhen || p.startsWhen || 'Start';
    const completesWhen = p.definition?.completesWhen || p.completesWhen || 'Complete';

    m += `\n    ${prefix}START(["${escMermaid(startsWhen)}"])\n`;
    m += `    ${prefix}START --> ${prefix}S1\n`;
    m += `    style ${prefix}START fill:#d1fae5,stroke:#059669,stroke-width:2px,color:#064e3b\n`;

    // Sequential arrows — skip FROM decision steps (branches define their outgoing paths)
    steps.forEach((s, i) => {
      if (i < steps.length - 1 && !isDecisionNode(s)) {
        const fromId = `${prefix}S${i + 1}`;
        const toId = `${prefix}S${i + 2}`;
        const handoff = (p.handoffs || [])[i];
        if (handoff) {
          const method = handoff.method ? handoff.method.replace(/-/g, ' ') : '';
          const isBadHandoff = handoff.clarity === 'yes-multiple' || handoff.clarity === 'yes-major';
          if (isBadHandoff) {
            m += `    ${fromId} -.->|"${escMermaid(method)}"| ${toId}\n`;
          } else if (method && s.department !== steps[i + 1]?.department) {
            m += `    ${fromId} -->|"${escMermaid(method)}"| ${toId}\n`;
          } else {
            m += `    ${fromId} --> ${toId}\n`;
          }
        } else {
          m += `    ${fromId} --> ${toId}\n`;
        }
      }
    });

    // Decision branch arrows — each branch gets a labeled arrow to its target
    steps.forEach((s, i) => {
      if (!isDecisionNode(s)) return;
      const fromId = `${prefix}S${i + 1}`;
      s.branches.forEach(br => {
        const targetIdx = resolveBranchTarget(br.target);
        const label = escMermaid(br.label || '');
        if (targetIdx >= 0 && targetIdx < steps.length) {
          const toId = `${prefix}S${targetIdx + 1}`;
          m += label
            ? `    ${fromId} -->|"${label}"| ${toId}\n`
            : `    ${fromId} --> ${toId}\n`;
        } else {
          m += label
            ? `    ${fromId} -->|"${label}"| ${prefix}DONE\n`
            : `    ${fromId} --> ${prefix}DONE\n`;
        }
      });
    });

    // End node — connect last step to DONE unless it's a decision (branches handle it)
    const lastStep = steps[steps.length - 1];
    if (!isDecisionNode(lastStep)) {
      m += `\n    ${prefix}S${steps.length} --> ${prefix}DONE(["${escMermaid(completesWhen)}"])\n`;
    } else {
      m += `\n    ${prefix}DONE(["${escMermaid(completesWhen)}"])\n`;
    }
    m += `    style ${prefix}DONE fill:#d1fae5,stroke:#059669,stroke-width:2px,color:#064e3b\n`;

    if (p.bottleneck?.longestStep) {
      const idx = parseInt(String(p.bottleneck.longestStep).replace('step-', ''));
      if (!isNaN(idx) && idx >= 0 && idx < steps.length) {
        m += `    style ${prefix}S${idx + 1} fill:#fee2e2,stroke:#ef4444,stroke-width:3px,color:#991b1b\n`;
      }
    }

    // Decision nodes get purple styling; approval/review nodes get amber
    steps.forEach((s, i) => {
      if (isDecisionNode(s)) {
        m += `    style ${prefix}S${i + 1} fill:#ede9fe,stroke:#7c3aed,stroke-width:2px,color:#5b21b6\n`;
      } else if (s.name && (s.name.toLowerCase().includes('approv') || s.name.toLowerCase().includes('review'))) {
        m += `    style ${prefix}S${i + 1} fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#92400e\n`;
      }
    });
  });

  return m;
}

module.exports = { generateMermaidCode, escMermaid };
