// api/analyze-symptoms.js - UPDATED VERSION
// Vercel Serverless Function for AI-Powered Diagnostic Analysis with Workflow Context

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { evidence, workflows, channels, toolConsent, contact } = req.body;
    
    // Calculate evidence-based metrics
    const metrics = calculateMetrics(evidence, contact.teamSize);
    
    // Detect operating model
    const operatingModel = detectOperatingModel(evidence);

    // Call Claude API for deep analysis
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 16000,
        temperature: 0.7,
        messages: [{
          role: 'user',
          content: `You are an expert workflow optimization consultant analyzing operational evidence to diagnose root causes and create transformation plans.

COMPANY CONTEXT:
- Company: ${contact.company}
- Team Size: ${contact.teamSize}
- Industry: ${contact.industry || 'Not specified'}

QUANTIFIED EVIDENCE (from actual data, not estimates):

WORKFLOW TIMING:
- Actual cycle time: ${evidence.actualTime} days
- Ideal cycle time: ${evidence.idealTime} days
- Delay factor: ${(evidence.actualTime / evidence.idealTime).toFixed(1)}x slower than ideal
- Longest wait time: ${evidence.waitTime} days
- Wait frequency: ${evidence.waitFrequency}

COORDINATION OVERHEAD:
- Status meetings: ${evidence.meetingHours} hours/week
- People in meetings: ${evidence.meetingPeople}
- Weekly cost: £${(evidence.meetingHours * evidence.meetingPeople * 25).toFixed(0)}
- Annual cost: £${(evidence.meetingHours * evidence.meetingPeople * 25 * 50).toFixed(0)}

INFORMATION ACCESS:
- Daily search time: ${evidence.searchTime} minutes/person
- Annual cost: £${Math.round((evidence.searchTime / 60) * 25 * contact.teamSize * 250)}

DATA ISSUES:
- Data inconsistency: ${evidence.dataInconsistent}
- Time to resolve: ${evidence.dataFigureOutTime} minutes per instance

INTEGRATION GAPS:
- Manual data transfers: ${evidence.copyPaste} times/day
- Annual cost: £${Math.round((evidence.copyPaste * 2 / 60) * 25 * contact.teamSize * 250)}
- Shadow spreadsheets: ${evidence.shadowSpreadsheets}
- Hours/week maintaining: ${evidence.spreadsheetHours}

TOOL COMPLEXITY:
- Tools used daily: ${evidence.toolCount}
- Daily switches: ${evidence.toolSwitches}
- Reporting time: ${evidence.reportHours} hours
- Report frequency: ${evidence.reportFrequency}

BUSINESS IMPACT:
- Onboarding time: ${evidence.onboardingWeeks} weeks
- Missed opportunities: ${evidence.missedOpportunities}
- Value per opportunity: £${evidence.opportunityValue}
- Cross-dept work style: ${evidence.crossDeptWork}

CALCULATED COSTS:
${JSON.stringify(metrics.costs, null, 2)}

Total Annual Cost: £${metrics.totalCost.toLocaleString()}

OPERATING MODEL DIAGNOSIS:
- Pattern Detected: ${operatingModel.pattern}
- Confidence: ${operatingModel.confidence}
- Evidence: ${operatingModel.evidence.join(', ')}
- All Scores: ${JSON.stringify(operatingModel.allScores)}

WORKFLOWS TO MAP:
${workflows && workflows.length > 0 ? workflows.map(wf => `
- ${wf.name} (${wf.type})
  Departments involved: ${wf.departments.join(', ')}
`).join('\n') : '- Not specified'}

AVAILABLE DATA SOURCES:
${channels && channels.length > 0 ? channels.join(', ') : 'Manual survey only'}

TOOL CONNECTION STATUS:
${toolConsent ? `
- Gmail: ${toolConsent.gmail ? 'Authorized' : 'Not connected'}
- Slack: ${toolConsent.slack ? 'Authorized' : 'Not connected'}
- CRM: ${toolConsent.crm ? 'Authorized' : 'Not connected'}
- Calendar: ${toolConsent.calendar ? 'Authorized' : 'Not connected'}
- Manual survey preferred: ${toolConsent.preferManual ? 'Yes' : 'No'}
` : 'Not specified'}

TASK:
Provide a comprehensive operational diagnosis and transformation plan in JSON format.

CRITICAL: Use THEIR actual numbers. Show the MATH. Reference THEIR specific workflows.

Return JSON with:
{
  "executiveSummary": "2-3 sentence overview of the core operational problem, using their actual data",
  "healthScore": <0-100 integer based on evidence>,
  "urgencyLevel": "low|medium|high|critical",
  
  "operatingModel": {
    "pattern": "${operatingModel.pattern}",
    "description": "What this means structurally for their organization",
    "whyThisMatters": "Why this specific pattern creates the £${metrics.totalCost.toLocaleString()} cost they're experiencing",
    "manifestation": "How this shows up in their evidence (reference specific numbers)"
  },
  
  "rootCauses": [
    {
      "title": "Primary structural problem",
      "description": "Detailed explanation",
      "manifestation": "How this appears in their ${evidence.actualTime} day cycle time",
      "cascadingEffects": ["Effect 1 with numbers", "Effect 2 with numbers"]
    }
  ],
  
  "workflowInsights": [
    ${workflows && workflows.length > 0 ? workflows.map(wf => `{
      "workflowName": "${wf.name}",
      "type": "${wf.type}",
      "predictedBottlenecks": ["Based on ${wf.type} and their ${evidence.crossDeptWork} cross-dept pattern"],
      "estimatedCycleTime": "Prediction based on their ${evidence.actualTime} day average",
      "dataSourceStrategy": "Which of their ${channels ? channels.length : 0} available sources will reveal most",
      "expectedFindings": "What we'll likely discover from ${wf.departments.join(', ')} departments"
    }`).join(',') : ''}
  ],
  
  "calculatedCosts": {
    "meetingCost": {
      "formula": "${evidence.meetingHours} hrs/wk × ${evidence.meetingPeople} people × £25/hr × 50 weeks",
      "annual": ${evidence.meetingHours * evidence.meetingPeople * 25 * 50}
    },
    "searchCost": {
      "formula": "${evidence.searchTime} min/day × ${contact.teamSize} people × £25/hr × 250 days",
      "annual": ${Math.round((evidence.searchTime / 60) * 25 * contact.teamSize * 250)}
    },
    "transferCost": {
      "formula": "${evidence.copyPaste} copies × 2 min × ${contact.teamSize} people × £25/hr × 250 days",
      "annual": ${Math.round((evidence.copyPaste * 2 / 60) * 25 * contact.teamSize * 250)}
    },
    "totalAnnual": ${metrics.totalCost}
  },
  
  "transformationPlan": {
    "overview": "12-week transformation approach specific to ${operatingModel.pattern}",
    "targetOutcome": "Reduce ${evidence.actualTime} days to ${evidence.idealTime} days (${Math.round((1 - evidence.idealTime/evidence.actualTime) * 100)}% improvement)",
    
    "phases": [
      {
        "phase": 1,
        "title": "Quick Wins (Weeks 1-4)",
        "objective": "Specific to ${operatingModel.pattern} pattern",
        "weeks": [
          {
            "week": 1,
            "objective": "Map ${workflows && workflows.length > 0 ? workflows[0].name : 'current'} workflow",
            "keyTasks": [
              {
                "day": "Monday",
                "time": "9:00 AM",
                "task": "Transformation Kickoff Meeting",
                "attendees": ${workflows && workflows.length > 0 ? JSON.stringify(workflows[0].departments) : '["Leadership", "Operations"]'},
                "agenda": [
                  "Review diagnostic findings (£${metrics.totalCost.toLocaleString()} annual cost)",
                  "Align on ${evidence.actualTime} → ${evidence.idealTime} day target",
                  "Assign workflow owner for ${workflows && workflows.length > 0 ? workflows[0].name : 'Order-to-Cash'}"
                ],
                "deliverable": "Signed transformation charter",
                "template": "kickoff-agenda.md"
              },
              {
                "day": "Tuesday",
                "time": "10:00 AM",
                "task": "Map current ${workflows && workflows.length > 0 ? workflows[0].name : 'workflow'} state",
                "attendees": ${workflows && workflows.length > 0 ? JSON.stringify(workflows[0].departments) : '["Operations", "Sales"]'},
                "duration": "2 hours",
                "deliverable": "As-is process map with ${evidence.actualTime} day cycle time broken down",
                "template": "process-map-template.miro"
              }
            ],
            "expectedOutcome": "Baseline established, quick wins identified"
          },
          {
            "week": 2,
            "objective": "Eliminate first ${evidence.waitTime} day delay",
            "keyTasks": [
              "Specific actions based on where ${evidence.waitTime} day wait occurs",
              "Deploy automation for ${evidence.copyPaste} daily manual transfers",
              "Measure baseline: ${evidence.actualTime} days average"
            ],
            "expectedOutcome": "10-15% cycle time reduction"
          }
        ],
        "expectedImpact": "30-40% reduction in ${evidence.meetingHours} hrs/week meetings, 20% cycle time improvement"
      },
      {
        "phase": 2,
        "title": "Structural Changes (Weeks 5-8)",
        "objective": "Address ${operatingModel.pattern} root cause",
        "expectedImpact": "50-60% total improvement, £${Math.round(metrics.totalCost * 0.5).toLocaleString()} annual savings"
      },
      {
        "phase": 3,
        "title": "Optimization (Weeks 9-12)",
        "objective": "Reach ${evidence.idealTime} day target",
        "expectedImpact": "Sustained ${Math.round((1 - evidence.idealTime/evidence.actualTime) * 100)}% improvement"
      }
    ],
    
    "templates": {
      "kickoff-agenda.md": \`# Transformation Kickoff - ${contact.company}

## Objective
Launch operational transformation to reduce cycle time from ${evidence.actualTime} to ${evidence.idealTime} days

## Agenda (90 minutes)

### 1. Diagnostic Review (20 min)
- Health Score: [will be calculated]
- Annual Cost: £${metrics.totalCost.toLocaleString()}
- Operating Model: ${operatingModel.pattern}
- Key Evidence:
  * ${evidence.actualTime} day cycle time (ideal: ${evidence.idealTime})
  * ${evidence.meetingHours} hrs/week in status meetings
  * ${evidence.copyPaste} manual data transfers daily

### 2. Root Cause Analysis (15 min)
- Why ${operatingModel.pattern} creates delays
- Evidence in our workflows
- Cost breakdown by source

### 3. Transformation Approach (30 min)
- Phase 1: Quick wins (weeks 1-4)
- Phase 2: Structural changes (weeks 5-8)
- Phase 3: Optimization (weeks 9-12)
- Target: ${Math.round((1 - evidence.idealTime/evidence.actualTime) * 100)}% improvement

### 4. Roles & Ownership (15 min)
- Assign process owner
- Working team composition
- Weekly checkpoint schedule

### 5. First Actions (10 min)
- Week 1 deliverables
- Resource allocation
- Communication plan

## Attendees
${workflows && workflows.length > 0 && workflows[0].departments ? workflows[0].departments.map(d => \`- ${d} Lead\`).join('\\n') : '- Leadership\\n- Operations\\n- Key stakeholders'}

## Next Steps
- Tuesday: Process mapping workshop
- Friday: Week 1 checkpoint\`,

      "raci-matrix.xlsx": "RACI matrix template pre-populated with ${workflows && workflows.length > 0 ? workflows[0].name : 'workflow'} steps and ${workflows && workflows.length > 0 && workflows[0].departments ? workflows[0].departments.join(', ') : 'departments'}"
    }
  },
  
  "nextSteps": {
    "immediate": "You'll receive workflow mapping results in 3 days",
    "automated": ${toolConsent && (toolConsent.gmail || toolConsent.slack || toolConsent.crm || toolConsent.calendar) ? 
      `"We're analyzing: ${[
        toolConsent.gmail ? 'Gmail' : null,
        toolConsent.slack ? 'Slack' : null,
        toolConsent.crm ? 'CRM' : null,
        toolConsent.calendar ? 'Calendar' : null
      ].filter(Boolean).join(', ')}"` : 
      '"Not applicable - manual survey preferred"'},
    "manual": ${toolConsent && toolConsent.preferManual ? '"5-minute guided survey sent to your email"' : '"Not applicable - tool analysis enabled"'},
    "timeline": "Complete workflow maps with swimlane diagrams in 3 days",
    "recommendation": "Schedule discovery call to review findings and discuss implementation"
  }
}

Be SPECIFIC. Use THEIR numbers everywhere. Reference THEIR workflows by name. Show the MATH behind every calculation. Make templates actionable with their actual data.`
        }]
      })
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Claude API Error:', error);
      return res.status(500).json({ 
        error: 'AI analysis failed', 
        details: error 
      });
    }

    const data = await response.json();
    const analysis = JSON.parse(data.content[0].text);

    // Return the comprehensive AI analysis
    return res.status(200).json({
      success: true,
      analysis: analysis,
      metrics: metrics,
      operatingModel: operatingModel,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Analysis error:', error);
    return res.status(500).json({ 
      error: 'Failed to analyze symptoms',
      message: error.message 
    });
  }
}

// Calculate evidence-based metrics
function calculateMetrics(evidence, teamSize) {
  const AVG_HOURLY_RATE = 25;
  const WORKDAYS_YEAR = 250;
  const WEEKS_YEAR = 50;
  
  const costs = {};
  let totalCost = 0;
  
  // Meeting cost
  if (evidence.meetingHours && evidence.meetingPeople) {
    const meetingCost = evidence.meetingHours * evidence.meetingPeople * AVG_HOURLY_RATE * WEEKS_YEAR;
    costs.meetingCost = {
      formula: `${evidence.meetingHours} hrs/wk × ${evidence.meetingPeople} people × £${AVG_HOURLY_RATE}/hr × ${WEEKS_YEAR} weeks`,
      annual: meetingCost
    };
    totalCost += meetingCost;
  }
  
  // Search time cost
  if (evidence.searchTime) {
    const searchCost = (evidence.searchTime / 60) * AVG_HOURLY_RATE * teamSize * WORKDAYS_YEAR;
    costs.searchCost = {
      formula: `${evidence.searchTime} min/day × ${teamSize} people × £${AVG_HOURLY_RATE}/hr × ${WORKDAYS_YEAR} days`,
      annual: searchCost
    };
    totalCost += searchCost;
  }
  
  // Manual transfer cost
  if (evidence.copyPaste) {
    const transferCost = (evidence.copyPaste * 2 / 60) * AVG_HOURLY_RATE * teamSize * WORKDAYS_YEAR;
    costs.transferCost = {
      formula: `${evidence.copyPaste} copies × 2 min × ${teamSize} people × £${AVG_HOURLY_RATE}/hr × ${WORKDAYS_YEAR} days`,
      annual: transferCost
    };
    totalCost += transferCost;
  }
  
  // Shadow spreadsheet cost
  if (evidence.spreadsheetHours) {
    const spreadsheetCost = evidence.spreadsheetHours * AVG_HOURLY_RATE * WEEKS_YEAR * (evidence.shadowSpreadsheets || 1);
    costs.spreadsheetCost = {
      formula: `${evidence.spreadsheetHours} hrs/wk × £${AVG_HOURLY_RATE}/hr × ${WEEKS_YEAR} weeks × ${evidence.shadowSpreadsheets} spreadsheets`,
      annual: spreadsheetCost
    };
    totalCost += spreadsheetCost;
  }
  
  // Reporting cost
  if (evidence.reportHours) {
    const frequencyMultiplier = {
      'monthly': 12,
      'weekly': 50,
      'daily': 250,
      'multiple': 500
    };
    const reportCost = evidence.reportHours * AVG_HOURLY_RATE * (frequencyMultiplier[evidence.reportFrequency] || 12);
    costs.reportCost = {
      formula: `${evidence.reportHours} hrs × £${AVG_HOURLY_RATE}/hr × ${frequencyMultiplier[evidence.reportFrequency] || 12} times/year`,
      annual: reportCost
    };
    totalCost += reportCost;
  }
  
  // Opportunity cost
  if (evidence.missedOpportunities && evidence.opportunityValue) {
    const opportunityCost = evidence.missedOpportunities * 4 * evidence.opportunityValue; // Quarterly
    costs.opportunityCost = {
      formula: `${evidence.missedOpportunities} opportunities/quarter × 4 quarters × £${evidence.opportunityValue}`,
      annual: opportunityCost
    };
    totalCost += opportunityCost;
  }
  
  return { costs, totalCost: Math.round(totalCost) };
}

// Detect operating model pattern
function detectOperatingModel(evidence) {
  const scores = {
    functionalSilos: 0,
    fragmentedAccountability: 0,
    hubAndSpokeBottlenecks: 0,
    manualIntegrationLayer: 0,
    reactiveFireFighting: 0,
    scalingCeiling: 0
  };
  
  const evidencePoints = [];
  
  // Functional silos indicators
  if (evidence.crossDeptWork === 'handoff' || evidence.crossDeptWork === 'escalate') {
    scores.functionalSilos += 3;
    evidencePoints.push('Cross-dept work requires handoffs/escalation');
  }
  if (evidence.actualTime > evidence.idealTime * 2) {
    scores.functionalSilos += 2;
    evidencePoints.push(`${(evidence.actualTime / evidence.idealTime).toFixed(1)}x cycle time delay`);
  }
  if (evidence.meetingHours >= 8) {
    scores.functionalSilos += 1;
    evidencePoints.push('High coordination overhead');
  }
  
  // Fragmented accountability indicators
  if (evidence.crossDeptWork === 'escalate') {
    scores.fragmentedAccountability += 3;
    evidencePoints.push('Escalation required for cross-dept work');
  }
  if (evidence.waitTime >= 3) {
    scores.fragmentedAccountability += 2;
    evidencePoints.push('Long approval/decision delays');
  }
  
  // Hub-and-spoke bottlenecks
  if (evidence.onboardingWeeks >= 4) {
    scores.hubAndSpokeBottlenecks += 2;
    evidencePoints.push('Long onboarding suggests tribal knowledge');
  }
  if (evidence.waitFrequency === 'daily' || evidence.waitFrequency === 'multiple') {
    scores.hubAndSpokeBottlenecks += 2;
    evidencePoints.push('Frequent waits suggest centralized bottlenecks');
  }
  
  // Manual integration layer
  if (evidence.copyPaste >= 10) {
    scores.manualIntegrationLayer += 3;
    evidencePoints.push('High manual data transfer volume');
  }
  if (evidence.shadowSpreadsheets >= 2) {
    scores.manualIntegrationLayer += 2;
    evidencePoints.push('Multiple shadow systems');
  }
  if (evidence.toolCount >= 5) {
    scores.manualIntegrationLayer += 1;
    evidencePoints.push('High tool fragmentation');
  }
  
  // Reactive fire-fighting
  if (evidence.missedOpportunities >= 2) {
    scores.reactiveFireFighting += 2;
    evidencePoints.push('Missing opportunities due to speed');
  }
  if (evidence.reportFrequency === 'monthly') {
    scores.reactiveFireFighting += 1;
    evidencePoints.push('Lagging visibility (monthly reporting)');
  }
  
  // Scaling ceiling
  if (evidence.actualTime > evidence.idealTime * 3) {
    scores.scalingCeiling += 2;
    evidencePoints.push('Severe process breakdown');
  }
  
  // Determine primary pattern
  const primary = Object.keys(scores).reduce((a, b) => 
    scores[a] > scores[b] ? a : b
  );
  
  const confidence = scores[primary] >= 5 ? 'HIGH' : scores[primary] >= 3 ? 'MEDIUM' : 'LOW';
  
  return {
    pattern: primary,
    confidence: confidence,
    evidence: evidencePoints.filter((v, i, a) => a.indexOf(v) === i).slice(0, 5), // Unique, top 5
    allScores: scores
  };
}
