// api/survey-submit.js - Vercel Serverless Function
// Processes comprehensive workflow survey submissions

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
    const { workflows, diagnostic } = req.body;

    if (!workflows || !Array.isArray(workflows) || workflows.length === 0) {
      return res.status(400).json({ error: 'No workflow data provided' });
    }

    // Calculate aggregate metrics from survey data
    const surveyMetrics = calculateSurveyMetrics(workflows);

    // Generate swimlane data structure for each workflow
    const swimlaneData = workflows.map(wf => generateSwimlaneData(wf));

    // Call Claude API for analysis if API key is available
    let aiAnalysis = null;
    if (process.env.ANTHROPIC_API_KEY) {
      aiAnalysis = await generateAIAnalysis(workflows, surveyMetrics, diagnostic);
    }

    return res.status(200).json({
      success: true,
      message: 'Survey submitted successfully',
      summary: {
        workflowCount: workflows.length,
        totalSteps: workflows.reduce((sum, wf) => sum + (wf.steps ? wf.steps.length : 0), 0),
        totalHandoffs: workflows.reduce((sum, wf) => sum + (wf.handoffs ? wf.handoffs.length : 0), 0),
        surveyMetrics,
        swimlaneData,
        aiAnalysis,
        confidence: 'MEDIUM',
        dataSource: 'manual-survey'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Survey submission error:', error);
    return res.status(500).json({
      error: 'Failed to process survey',
      message: error.message
    });
  }
}

function calculateSurveyMetrics(workflows) {
  const metrics = {
    workflows: [],
    aggregate: {
      totalWorkTime: 0,
      totalWaitTime: 0,
      totalElapsedTime: 0,
      workPercentage: 0,
      waitPercentage: 0,
      crossDeptHandoffs: 0,
      totalHandoffs: 0,
      avgClarificationRate: 0
    }
  };

  workflows.forEach(wf => {
    const steps = wf.steps || [];
    const handoffs = wf.handoffs || [];

    let workTime = 0;
    let waitTime = 0;

    steps.forEach(step => {
      if (step.workTime) workTime += parseFloat(step.workTime.typical) || 0;
      if (step.waitTime) waitTime += parseFloat(step.waitTime.typical) || 0;
    });

    let handoffDelay = 0;
    let crossDept = 0;
    handoffs.forEach(ho => {
      if (ho.delay) handoffDelay += parseFloat(ho.delay.typical) || 0;
      if (ho.crossDepartment) crossDept++;
    });

    const totalElapsed = workTime + waitTime + handoffDelay;

    metrics.workflows.push({
      name: wf.workflowName || wf.name || 'Unnamed',
      workTime,
      waitTime,
      handoffDelay,
      totalElapsed,
      workPercentage: totalElapsed > 0 ? Math.round((workTime / totalElapsed) * 100) : 0,
      waitPercentage: totalElapsed > 0 ? Math.round(((waitTime + handoffDelay) / totalElapsed) * 100) : 0,
      stepCount: steps.length,
      handoffCount: handoffs.length,
      crossDeptHandoffs: crossDept
    });

    metrics.aggregate.totalWorkTime += workTime;
    metrics.aggregate.totalWaitTime += waitTime + handoffDelay;
    metrics.aggregate.totalElapsedTime += totalElapsed;
    metrics.aggregate.crossDeptHandoffs += crossDept;
    metrics.aggregate.totalHandoffs += handoffs.length;
  });

  const total = metrics.aggregate.totalElapsedTime;
  metrics.aggregate.workPercentage = total > 0 ? Math.round((metrics.aggregate.totalWorkTime / total) * 100) : 0;
  metrics.aggregate.waitPercentage = total > 0 ? Math.round((metrics.aggregate.totalWaitTime / total) * 100) : 0;

  return metrics;
}

function generateSwimlaneData(workflow) {
  const steps = workflow.steps || [];
  const handoffs = workflow.handoffs || [];

  // Group steps by department for swimlanes
  const departments = new Map();
  steps.forEach((step, idx) => {
    const dept = step.department || 'Unknown';
    if (!departments.has(dept)) {
      departments.set(dept, []);
    }
    departments.get(dept).push({
      stepNumber: idx + 1,
      name: step.name,
      role: step.role,
      workTime: step.workTime ? step.workTime.typical : 0,
      waitTime: step.waitTime ? step.waitTime.typical : 0,
      variability: step.variability,
      trigger: step.trigger
    });
  });

  // Build handoff connections
  const connections = handoffs.map((ho, idx) => ({
    from: { step: idx + 1, department: steps[idx] ? steps[idx].department : '' },
    to: { step: idx + 2, department: steps[idx + 1] ? steps[idx + 1].department : '' },
    method: ho.method,
    delay: ho.delay ? ho.delay.typical : 0,
    clarificationRate: ho.clarificationFrequency,
    crossDepartment: ho.crossDepartment || false
  }));

  return {
    workflowName: workflow.workflowName || workflow.name,
    trigger: workflow.trigger,
    completion: workflow.completion,
    frequency: workflow.frequency,
    lanes: Object.fromEntries(departments),
    connections,
    totalSteps: steps.length,
    totalDepartments: departments.size
  };
}

async function generateAIAnalysis(workflows, metrics, diagnostic) {
  try {
    const workflowSummaries = workflows.map(wf => {
      const m = metrics.workflows.find(w => w.name === (wf.workflowName || wf.name));
      return `
Workflow: ${wf.workflowName || wf.name}
- Steps: ${(wf.steps || []).length}
- Total elapsed: ${m ? m.totalElapsed : 'N/A'} hours
- Work: ${m ? m.workPercentage : 'N/A'}% | Wait: ${m ? m.waitPercentage : 'N/A'}%
- Cross-dept handoffs: ${m ? m.crossDeptHandoffs : 0}
- Steps: ${(wf.steps || []).map(s => `${s.name} (${s.department}, ${s.workTime ? s.workTime.typical : '?'}h work + ${s.waitTime ? s.waitTime.typical : '?'}h wait)`).join(' → ')}
- Bottlenecks: ${wf.recentExample ? wf.recentExample.bottleneckReason : 'Not specified'}
- Biggest pain: ${wf.suggestions ? wf.suggestions.biggestPain : 'Not specified'}`;
    }).join('\n');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8000,
        temperature: 0.7,
        messages: [{
          role: 'user',
          content: `You are an expert workflow optimization consultant. Analyse the following manually-surveyed workflow data and provide actionable insights.

SURVEY DATA:
${workflowSummaries}

AGGREGATE METRICS:
- Total work time: ${metrics.aggregate.totalWorkTime} hours
- Total wait time: ${metrics.aggregate.totalWaitTime} hours
- Work/Wait ratio: ${metrics.aggregate.workPercentage}% work / ${metrics.aggregate.waitPercentage}% wait
- Cross-department handoffs: ${metrics.aggregate.crossDeptHandoffs}
- Total handoffs: ${metrics.aggregate.totalHandoffs}

${diagnostic ? `DIAGNOSTIC CONTEXT:
- Health Score: ${diagnostic.healthScore || 'N/A'}
- Total Cost: £${diagnostic.totalCost || 'N/A'}
- Workflow Count: ${diagnostic.workflowCount || 'N/A'}` : ''}

CONFIDENCE: MEDIUM (survey-based estimates)

Return JSON with:
{
  "summary": "2-3 sentence overview of findings",
  "keyFindings": [
    {"title": "Finding title", "description": "Detail", "impact": "high|medium|low"}
  ],
  "bottlenecks": [
    {"workflow": "name", "step": "step name", "issue": "description", "recommendation": "fix"}
  ],
  "recommendations": [
    {"priority": 1, "title": "Recommendation", "description": "Detail", "expectedImprovement": "X% faster"}
  ],
  "estimatedSavings": "Annual savings estimate if recommendations implemented"
}`
        }]
      })
    });

    if (!response.ok) return null;

    const data = await response.json();
    return JSON.parse(data.content[0].text);
  } catch (error) {
    console.error('AI analysis error:', error);
    return null;
  }
}
