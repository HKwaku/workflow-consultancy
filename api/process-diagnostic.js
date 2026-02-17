// api/process-diagnostic.js
// Vercel Serverless Function for Process-First Diagnostic Analysis

module.exports = async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { processes, contact, qualityScore, timestamp } = req.body;

    if (!processes || processes.length === 0) {
      return res.status(400).json({ error: 'No processes provided' });
    }

    // Build analysis for each process
    const processResults = processes.map(p => {
      const quality = calculateProcessQuality(p);
      return {
        name: p.processName,
        type: p.processType,
        elapsedDays: p.lastExample?.elapsedDays || 0,
        annualCost: p.costs?.totalAnnualCost || 0,
        annualInstances: p.frequency?.annual || 0,
        teamSize: p.costs?.teamSize || 1,
        stepsCount: (p.steps || []).length,
        quality,
        bottleneck: p.bottleneck || {},
        priority: p.priority || {}
      };
    });

    const totalCost = processResults.reduce((sum, p) => sum + p.annualCost, 0);

    // Try Claude API for detailed recommendations
    let recommendations;
    let isAIEnhanced = false;
    try {
      recommendations = await getAIRecommendations(processes, contact);
      isAIEnhanced = true;
    } catch (aiError) {
      console.warn('AI analysis unavailable, using rule-based:', aiError.message);
      recommendations = generateRuleBasedRecommendations(processes);
    }

    // Trigger n8n flow diagram generation (async, non-blocking)
    let flowDiagramUrl = null;
    try {
      flowDiagramUrl = await triggerN8nFlowDiagram(processes, contact);
    } catch (n8nError) {
      console.warn('n8n flow diagram trigger failed:', n8nError.message);
    }

    return res.status(200).json({
      success: true,
      processes: processResults,
      totalCost,
      potentialSavings: totalCost * 0.5,
      recommendations,
      flowDiagramUrl,
      qualityScore,
      analysisType: isAIEnhanced ? 'ai-enhanced' : 'rule-based',
      timestamp
    });

  } catch (error) {
    console.error('Process diagnostic error:', error);
    return res.status(500).json({ error: 'Analysis failed. Please try again.' });
  }
}

// ============================================================
// N8N FLOW DIAGRAM INTEGRATION
// ============================================================
async function triggerN8nFlowDiagram(processes, contact) {
  const webhookUrl = process.env.N8N_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log('N8N_WEBHOOK_URL not configured, skipping flow diagram');
    return null;
  }

  // Validate that the value looks like a URL (not a JWT token / API key)
  if (!webhookUrl.startsWith('http://') && !webhookUrl.startsWith('https://')) {
    console.log('N8N_WEBHOOK_URL is not a valid URL (may be an API key). Skipping n8n webhook call. Set a full webhook URL like https://your-n8n.app.n8n.cloud/webhook/xxx');
    return null;
  }

  // Build structured flow data for n8n
  const flowData = processes.map(p => ({
    processName: p.processName,
    processType: p.processType,
    startsWhen: p.definition?.startsWhen || '',
    completesWhen: p.definition?.completesWhen || '',
    steps: (p.steps || []).map(s => ({
      number: s.number,
      name: s.name,
      department: s.department
    })),
    handoffs: (p.handoffs || []).map(h => ({
      from: { name: h.from?.name, department: h.from?.department },
      to: { name: h.to?.name, department: h.to?.department },
      method: h.method,
      clarity: h.clarity
    })),
    approvals: (p.approvals || []).map(a => ({
      name: a.name,
      who: a.who,
      assessment: a.assessment
    })),
    systems: (p.systems || []).map(s => ({
      name: s.name,
      purpose: s.purpose,
      actions: s.actions || []
    })),
    bottleneck: p.bottleneck || {},
    costs: {
      totalAnnualCost: p.costs?.totalAnnualCost || 0,
      instanceCost: p.costs?.instanceCost || 0,
      elapsedDays: p.lastExample?.elapsedDays || 0,
      annualInstances: p.frequency?.annual || 0,
      teamSize: p.costs?.teamSize || 1
    }
  }));

  // Generate Mermaid diagram code for n8n to render
  const mermaidCode = generateMermaidCode(processes);

  const payload = {
    requestType: 'flow-diagram',
    processes: flowData,
    mermaidCode,
    contact: {
      name: contact?.name || '',
      email: contact?.email || '',
      company: contact?.company || ''
    },
    timestamp: new Date().toISOString()
  };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error('n8n webhook returned ' + response.status);
  }

  const result = await response.json();

  // n8n can return: { diagramUrl }, { diagramBase64 }, or { accepted: true } for async processing
  return result.diagramUrl || null;
}

function generateMermaidCode(processes) {
  let m = 'graph TB\n';

  const deptBg = {
    'Sales': '#dbeafe', 'Operations': '#fef3c7', 'Finance': '#dcfce7',
    'IT': '#e0e7ff', 'Customer Success': '#fce7f3', 'Product': '#f3e8ff',
    'Leadership': '#fef9c3', 'HR': '#ffedd5', 'Other': '#f1f5f9'
  };
  const deptStroke = {
    'Sales': '#3b82f6', 'Operations': '#f59e0b', 'Finance': '#22c55e',
    'IT': '#6366f1', 'Customer Success': '#ec4899', 'Product': '#a855f7',
    'Leadership': '#ca8a04', 'HR': '#ea580c', 'Other': '#94a3b8'
  };

  processes.forEach((p, pi) => {
    const prefix = processes.length > 1 ? `P${pi + 1}_` : '';
    const steps = p.steps || [];
    if (steps.length === 0) return;

    const esc = str => (str || '').replace(/"/g, "'").replace(/[[\]{}()#&]/g, ' ').substring(0, 50).trim();

    const deptSteps = {};
    const deptOrder = [];
    steps.forEach((s, i) => {
      const dept = s.department || 'Other';
      if (!deptSteps[dept]) { deptSteps[dept] = []; deptOrder.push(dept); }
      deptSteps[dept].push({ ...s, number: i + 1 });
    });

    // Swimlane subgraphs (stacked vertically, flow LR inside)
    deptOrder.forEach(dept => {
      const safeDept = prefix + dept.replace(/[^a-zA-Z0-9]/g, '_');
      const bg = deptBg[dept] || '#f1f5f9';
      const stroke = deptStroke[dept] || '#94a3b8';
      m += `\n    subgraph ${safeDept}["  ${esc(dept)}  "]\n`;
      m += `        direction LR\n`;

      deptSteps[dept].forEach(s => {
        const nodeId = `${prefix}S${s.number}`;
        const isApproval = s.name && (
          s.name.toLowerCase().includes('approv') || s.name.toLowerCase().includes('review')
        );
        if (isApproval) {
          m += `        ${nodeId}{{"${esc(s.name)}"}}\n`;
        } else {
          m += `        ${nodeId}["${esc(s.name)}"]\n`;
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

    // Flow connections
    m += `\n    ${prefix}START(["${esc(p.definition?.startsWhen || 'Start')}"])\n`;
    m += `    ${prefix}START --> ${prefix}S1\n`;
    m += `    style ${prefix}START fill:#d1fae5,stroke:#059669,stroke-width:2px,color:#064e3b\n`;

    steps.forEach((s, i) => {
      if (i < steps.length - 1) {
        const fromId = `${prefix}S${i + 1}`;
        const toId = `${prefix}S${i + 2}`;
        const handoff = (p.handoffs || [])[i];
        if (handoff) {
          const method = handoff.method ? handoff.method.replace(/-/g, ' ') : '';
          const isBadHandoff = handoff.clarity === 'yes-multiple' || handoff.clarity === 'yes-major';
          if (isBadHandoff) {
            m += `    ${fromId} -.->|"${esc(method)}"| ${toId}\n`;
          } else if (method && s.department !== steps[i + 1]?.department) {
            m += `    ${fromId} -->|"${esc(method)}"| ${toId}\n`;
          } else {
            m += `    ${fromId} --> ${toId}\n`;
          }
        } else {
          m += `    ${fromId} --> ${toId}\n`;
        }
      }
    });

    m += `\n    ${prefix}S${steps.length} --> ${prefix}DONE(["${esc(p.definition?.completesWhen || 'Complete')}"])\n`;
    m += `    style ${prefix}DONE fill:#d1fae5,stroke:#059669,stroke-width:2px,color:#064e3b\n`;

    if (p.bottleneck?.longestStep) {
      const idx = parseInt(String(p.bottleneck.longestStep).replace('step-', ''));
      if (!isNaN(idx) && idx >= 0 && idx < steps.length) {
        m += `    style ${prefix}S${idx + 1} fill:#fee2e2,stroke:#ef4444,stroke-width:3px,color:#991b1b\n`;
      }
    }

    steps.forEach((s, i) => {
      if (s.name && (s.name.toLowerCase().includes('approv') || s.name.toLowerCase().includes('review'))) {
        m += `    style ${prefix}S${i + 1} fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#92400e\n`;
      }
    });
  });

  return m;
}

// ============================================================
// AI RECOMMENDATIONS (Claude API)
// ============================================================
async function getAIRecommendations(processes, contact) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('No API key configured');

  const processDescriptions = processes.map((p, i) => {
    const steps = (p.steps || []).map(s => `${s.number}. ${s.name} [${s.department}]`).join('\n');
    const handoffs = (p.handoffs || []).map((h, j) =>
      `Handoff ${j + 1}: ${h.from?.name} → ${h.to?.name} | Method: ${h.method} | Clarity: ${h.clarity}`
    ).join('\n');
    const systems = (p.systems || []).map(s =>
      `${s.name}: ${s.purpose} [${(s.actions || []).join(', ')}]`
    ).join('\n');
    const approvals = (p.approvals || []).map(a =>
      `${a.name}: Approver: ${a.who}, Rounds: ${a.rounds}, Assessment: ${a.assessment}`
    ).join('\n');

    return `
PROCESS #${i + 1}: ${p.processName} (${p.processType})
- Starts when: ${p.definition?.startsWhen || 'Not specified'}
- Completes when: ${p.definition?.completesWhen || 'Not specified'}
- Complexity: ${p.definition?.complexity || 'Not specified'}
- Departments: ${(p.definition?.departments || []).join(', ')}

LAST EXAMPLE: ${p.lastExample?.name || 'Not specified'}
- Duration: ${p.lastExample?.elapsedDays || '?'} days
- Time breakdown: Meetings ${p.userTime?.meetings || 0}h, Emails ${p.userTime?.emails || 0}h, Execution ${p.userTime?.execution || 0}h, Waiting ${p.userTime?.waiting || 0}h (Total: ${p.userTime?.total || 0}h)
- Performance: ${p.performance || 'Not specified'}
- Issues: ${(p.issues || []).join(', ') || 'None reported'}

STEPS:
${steps || 'Not provided'}

HANDOFFS:
${handoffs || 'Not provided'}

SYSTEMS:
${systems || 'Not provided'}

APPROVALS:
${approvals || 'None'}

KNOWLEDGE:
- First look: ${p.knowledge?.firstLook || '?'}
- Vacation impact: ${p.knowledge?.vacationImpact || '?'}
- Time to answer: ${p.knowledge?.timeToAnswer || '?'}

FREQUENCY: ${p.frequency?.annual || '?'} instances/year, ${p.frequency?.stuck || 0} currently stuck
ANNUAL COST: £${((p.costs?.totalAnnualCost || 0) / 1000).toFixed(0)}K
PRIORITY: ${p.priority?.level || 'Not set'} - ${p.priority?.reason || ''}
BOTTLENECK: ${p.bottleneck?.biggestBottleneck || 'Not identified'} - ${p.bottleneck?.why || ''}
`;
  }).join('\n---\n');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      temperature: 0.6,
      messages: [{
        role: 'user',
        content: `You are a workflow optimisation consultant. Analyse the following process diagnostic data and provide 3-6 specific, actionable recommendations.

CONTACT: ${contact?.name || 'Unknown'}, ${contact?.title || ''} at ${contact?.company || 'Unknown Company'} (${contact?.industry || 'Unknown Industry'}, ${contact?.teamSize || '?'} employees)

${processDescriptions}

For each recommendation, provide:
1. Which process it applies to
2. The specific issue identified
3. A concrete action to take
4. Estimated impact

Return as JSON array:
[{"process": "process name", "type": "handoff|integration|approval|knowledge|automation|general", "text": "Specific recommendation with estimated impact"}]

Return ONLY the JSON array, no markdown or explanation.`
      }]
    })
  });

  if (!response.ok) throw new Error('Claude API error: ' + response.status);

  const data = await response.json();
  const content = data.content?.[0]?.text || '[]';

  try {
    return JSON.parse(content);
  } catch {
    return [{ process: 'Overall', type: 'general', text: content.substring(0, 500) }];
  }
}

// ============================================================
// RULE-BASED RECOMMENDATIONS (fallback)
// ============================================================
function generateRuleBasedRecommendations(processes) {
  const recs = [];

  processes.forEach(p => {
    // Handoff quality
    const poorHandoffs = (p.handoffs || []).filter(h =>
      h.clarity === 'yes-multiple' || h.clarity === 'yes-major' || h.method === 'they-knew'
    );
    if (poorHandoffs.length > 0) {
      recs.push({
        type: 'handoff',
        process: p.processName,
        text: `${poorHandoffs.length} handoff(s) in "${p.processName}" show poor information transfer. Automating notifications and standardising handoff checklists could eliminate delays.`
      });
    }

    // Systems integration
    const copySystems = (p.systems || []).filter(s =>
      (s.actions || []).includes('copy-in') || (s.actions || []).includes('copy-out')
    );
    if (copySystems.length >= 2) {
      recs.push({
        type: 'integration',
        process: p.processName,
        text: `${copySystems.length} systems in "${p.processName}" require manual data copying. Integration could save ~${Math.round(copySystems.length * 15)} minutes per instance.`
      });
    }

    // Approval bottlenecks
    const bureaucratic = (p.approvals || []).filter(a =>
      a.assessment === 'too-tight' || a.assessment === 'bureaucratic'
    );
    if (bureaucratic.length > 0) {
      recs.push({
        type: 'approval',
        process: p.processName,
        text: `${bureaucratic.length} approval point(s) in "${p.processName}" are overly restrictive. Consider pre-approval rules or delegation matrices.`
      });
    }

    // Knowledge risk
    if (p.knowledge?.vacationImpact === 'stops' || p.knowledge?.vacationImpact === 'slows-down') {
      recs.push({
        type: 'knowledge',
        process: p.processName,
        text: `"${p.processName}" has critical knowledge risk. Key person absence would ${p.knowledge.vacationImpact === 'stops' ? 'halt' : 'significantly slow'} operations. Document and cross-train urgently.`
      });
    }

    // High waiting time
    if (p.userTime?.waiting > p.userTime?.execution) {
      recs.push({
        type: 'automation',
        process: p.processName,
        text: `In "${p.processName}", waiting time (${p.userTime.waiting}h) exceeds execution time (${p.userTime.execution}h). Automating notifications and implementing SLAs could cut cycle time significantly.`
      });
    }
  });

  if (recs.length === 0) {
    recs.push({
      type: 'general',
      process: 'Overall',
      text: 'Your processes show room for optimisation. A detailed discovery call will identify the highest-impact improvements.'
    });
  }

  return recs;
}

// ============================================================
// QUALITY SCORING
// ============================================================
function calculateProcessQuality(p) {
  let score = 100;
  const flags = [];

  if (p.lastExample?.startDate) {
    const age = (new Date() - new Date(p.lastExample.startDate)) / (1000 * 60 * 60 * 24);
    if (age > 60) { score -= 10; flags.push('Example over 60 days old'); }
  } else { score -= 15; flags.push('No example dates provided'); }

  if (p.userTime?.total % 5 === 0 && p.userTime?.total > 0) {
    score -= 5; flags.push('Round numbers suggest estimation');
  }

  if ((p.steps || []).length < 5) { score -= 10; flags.push('Limited step detail'); }
  if ((p.steps || []).length >= 8) { score += 5; }

  if (p.lastExample?.startDate && p.lastExample?.endDate) score += 10;
  if (p.costs?.totalAnnualCost > 0) score += 5;
  if ((p.handoffs || []).length > 0) score += 5;
  if ((p.systems || []).length > 0) score += 5;

  score = Math.max(0, Math.min(100, score));

  return {
    score,
    grade: score > 85 ? 'HIGH' : score > 65 ? 'MEDIUM' : 'LOW',
    flags
  };
}
