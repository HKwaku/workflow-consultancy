// api/n8n-flow-diagram.js
// Vercel Serverless Function - Proxy to n8n webhook for flow diagram generation
// This endpoint acts as a bridge between the frontend and n8n

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
    const { processes, contact, requestType, timestamp } = req.body;

    if (!processes || processes.length === 0) {
      return res.status(400).json({ error: 'No process data provided' });
    }

    const webhookUrl = process.env.N8N_WEBHOOK_URL;

    // Generate Mermaid code regardless (used both by n8n and as fallback)
    const mermaidCode = generateMermaidCode(processes);

    // Validate that the value looks like a URL (not a JWT token / API key)
    const isValidUrl = webhookUrl && (webhookUrl.startsWith('http://') || webhookUrl.startsWith('https://'));

    if (!webhookUrl || !isValidUrl) {
      // No n8n configured - return Mermaid code for client-side rendering
      console.log('N8N_WEBHOOK_URL not configured, returning Mermaid code for client rendering');
      return res.status(200).json({
        success: true,
        mermaidCode,
        message: 'n8n not configured. Mermaid code returned for client-side rendering.'
      });
    }

    // Forward to n8n webhook
    const n8nPayload = {
      requestType: requestType || 'flow-diagram',
      processes,
      mermaidCode,
      contact: contact || {},
      timestamp: timestamp || new Date().toISOString()
    };

    const n8nResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(n8nPayload)
    });

    if (!n8nResponse.ok) {
      console.warn('n8n webhook returned:', n8nResponse.status);
      // Fall back to Mermaid code
      return res.status(200).json({
        success: true,
        mermaidCode,
        message: 'n8n webhook returned an error. Mermaid code provided as fallback.'
      });
    }

    const n8nResult = await n8nResponse.json();

    // n8n can respond with:
    // { diagramUrl: "https://..." } - URL to the rendered diagram image
    // { diagramBase64: "..." } - Base64 encoded PNG image
    // { mermaidCode: "..." } - Enhanced/modified Mermaid code
    // { accepted: true } - Async processing, diagram will be emailed

    return res.status(200).json({
      success: true,
      diagramUrl: n8nResult.diagramUrl || null,
      diagramBase64: n8nResult.diagramBase64 || null,
      mermaidCode: n8nResult.mermaidCode || mermaidCode,
      accepted: n8nResult.accepted || false,
      message: n8nResult.message || 'Flow diagram processed successfully'
    });

  } catch (error) {
    console.error('n8n flow diagram error:', error);

    // Generate fallback Mermaid code even on error
    try {
      const mermaidCode = generateMermaidCode(req.body?.processes || []);
      return res.status(200).json({
        success: true,
        mermaidCode,
        message: 'Error connecting to n8n. Mermaid code provided as fallback.'
      });
    } catch (e) {
      return res.status(500).json({ error: 'Flow diagram generation failed.' });
    }
  }
}

// ============================================================
// MERMAID DIAGRAM GENERATION (VERTICAL SWIMLANE)
// Departments stacked vertically, flow LR within each lane
// ============================================================
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

    const deptSteps = {};
    const deptOrder = [];
    steps.forEach((s, i) => {
      const dept = s.department || 'Other';
      if (!deptSteps[dept]) { deptSteps[dept] = []; deptOrder.push(dept); }
      deptSteps[dept].push({ ...s, number: i + 1 });
    });

    // Build swimlane subgraphs
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

    // Connections
    m += `\n    ${prefix}START(["${esc(p.startsWhen || 'Start')}"])\n`;
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

    m += `\n    ${prefix}S${steps.length} --> ${prefix}DONE(["${esc(p.completesWhen || 'Complete')}"])\n`;
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

function esc(str) {
  return (str || '')
    .replace(/"/g, "'")
    .replace(/[[\]{}()#&]/g, ' ')
    .replace(/\n/g, ' ')
    .substring(0, 50)
    .trim();
}
