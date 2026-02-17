// api/analyze-symptoms.js - UPDATED VERSION
// Vercel Serverless Function for AI-Powered Diagnostic Analysis with Workflow Context


module.exports = async function handler(req, res) {
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

    // Validate API key is present
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' });
    }

    // Call Claude API for deep analysis
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        temperature: 0.7,
        messages: [{
          role: 'user',
          content: `You are an expert workflow optimization consultant. Analyze this operational evidence and return a JSON diagnosis.

COMPANY: ${contact.company} | Team: ${contact.teamSize} | Industry: ${contact.industry || 'Not specified'}

EVIDENCE:
- Cycle time: ${evidence.actualTime} days (ideal: ${evidence.idealTime}, ${(evidence.actualTime / evidence.idealTime).toFixed(1)}x slower)
- Wait time: ${evidence.waitTime} days, frequency: ${evidence.waitFrequency}
- Meetings: ${evidence.meetingHours} hrs/wk with ${evidence.meetingPeople} people
- Search time: ${evidence.searchTime} min/day/person
- Manual transfers: ${evidence.copyPaste}/day, Shadow spreadsheets: ${evidence.shadowSpreadsheets}
- Tools: ${evidence.toolCount} daily, ${evidence.toolSwitches} switches/day
- Onboarding: ${evidence.onboardingWeeks} weeks
- Missed opportunities: ${evidence.missedOpportunities} at £${evidence.opportunityValue} each
- Cross-dept: ${evidence.crossDeptWork}
- Total annual cost: £${metrics.totalCost.toLocaleString()}
- Operating model: ${operatingModel.pattern} (${operatingModel.confidence})

${workflows && workflows.length > 0 ? 'WORKFLOWS: ' + workflows.map(wf => wf.name + ' (' + wf.type + ') - ' + wf.departments.join(', ')).join('; ') : ''}

Return ONLY valid JSON (no markdown, no backticks):
{
  "executiveSummary": "2-3 sentences using their actual numbers",
  "healthScore": 0-100,
  "urgencyLevel": "low|medium|high|critical",
  "operatingModel": {
    "pattern": "${operatingModel.pattern}",
    "description": "brief explanation",
    "whyThisMatters": "why this costs £${metrics.totalCost.toLocaleString()}",
    "manifestation": "how it shows in their data"
  },
  "rootCauses": [
    {"title": "...", "description": "...", "manifestation": "...", "cascadingEffects": ["...", "..."]}
  ],
  "workflowInsights": [],
  "calculatedCosts": {
    "meetingCost": {"formula": "...", "annual": ${evidence.meetingHours * evidence.meetingPeople * 25 * 50}},
    "searchCost": {"formula": "...", "annual": ${Math.round((evidence.searchTime / 60) * 25 * contact.teamSize * 250)}},
    "transferCost": {"formula": "...", "annual": ${Math.round((evidence.copyPaste * 2 / 60) * 25 * contact.teamSize * 250)}},
    "totalAnnual": ${metrics.totalCost}
  },
  "transformationPlan": {
    "overview": "12-week plan for ${operatingModel.pattern}",
    "targetOutcome": "Reduce ${evidence.actualTime} to ${evidence.idealTime} days",
    "phases": [
      {"phase": 1, "title": "Quick Wins (Weeks 1-4)", "objective": "...", "expectedImpact": "..."},
      {"phase": 2, "title": "Structural Changes (Weeks 5-8)", "objective": "...", "expectedImpact": "..."},
      {"phase": 3, "title": "Optimization (Weeks 9-12)", "objective": "...", "expectedImpact": "..."}
    ]
  },
  "nextSteps": {
    "immediate": "...",
    "timeline": "Complete workflow maps in 3 days",
    "recommendation": "..."
  }
}

Use THEIR actual numbers. Show the MATH. Be specific and concise.`
        }]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorJson;
      try { errorJson = JSON.parse(errorText); } catch(e) { errorJson = { raw: errorText }; }
      console.error('Claude API Error:', response.status, errorJson);
      return res.status(500).json({ 
        error: `Claude API returned ${response.status}`, 
        details: errorJson 
      });
    }

    const data = await response.json();
    let analysis;
    try {
      analysis = JSON.parse(data.content[0].text);
    } catch (parseErr) {
      console.error('JSON parse error:', parseErr.message, 'Raw:', data.content[0].text.substring(0, 200));
      return res.status(500).json({
        error: 'Failed to parse AI response as JSON',
        rawPreview: data.content[0].text.substring(0, 500)
      });
    }

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
      message: error.message,
      stack: error.stack ? error.stack.split('\n').slice(0, 3).join('\n') : undefined
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
