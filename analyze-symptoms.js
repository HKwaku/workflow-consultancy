// api/analyze-symptoms.js
// Vercel Serverless Function for AI-Powered Diagnostic Analysis

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
    const { symptoms, frequencies, contact } = req.body;

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
        max_tokens: 3000,
        temperature: 0.7,
        messages: [{
          role: 'user',
          content: `You are an expert workflow optimization consultant analyzing operational symptoms to diagnose root causes.

COMPANY CONTEXT:
- Company: ${contact.company}
- Size: ${contact.companySize}
- Industry: ${contact.industry || 'Not specified'}

OBSERVED SYMPTOMS:

Time Waste & Delays (Frequency: ${frequencies.time || 'Not specified'}/100):
${symptoms.time && symptoms.time.length > 0 ? symptoms.time.map(s => '- ' + getSymptomDescription(s)).join('\n') : '- None reported'}

Data & Information Issues (Frequency: ${frequencies.data || 'Not specified'}/100):
${symptoms.data && symptoms.data.length > 0 ? symptoms.data.map(s => '- ' + getSymptomDescription(s)).join('\n') : '- None reported'}

Communication Breakdowns (Frequency: ${frequencies.comm || 'Not specified'}/100):
${symptoms.comm && symptoms.comm.length > 0 ? symptoms.comm.map(s => '- ' + getSymptomDescription(s)).join('\n') : '- None reported'}

Technology Frustrations (Frequency: ${frequencies.tech || 'Not specified'}/100):
${symptoms.tech && symptoms.tech.length > 0 ? symptoms.tech.map(s => '- ' + getSymptomDescription(s)).join('\n') : '- None reported'}

Strategic Impact (Frequency: ${frequencies.impact || 'Not specified'}/100):
${symptoms.impact && symptoms.impact.length > 0 ? symptoms.impact.map(s => '- ' + getSymptomDescription(s)).join('\n') : '- None reported'}

TASK:
Provide a comprehensive operational diagnosis in JSON format with the following structure:

{
  "executiveSummary": "2-3 sentence overview of the core operational problem",
  "healthScore": <0-100 integer>,
  "urgencyLevel": "low|medium|high|critical",
  "primaryDiagnosis": "The single biggest structural problem",
  "rootCauses": [
    {
      "title": "Root cause name",
      "description": "Detailed explanation of this root cause",
      "manifestation": "How this shows up in the symptoms",
      "cascadingEffects": ["Effect 1", "Effect 2", "Effect 3"]
    }
  ],
  "hiddenCosts": {
    "timeWaste": "Specific time waste quantification",
    "qualityCost": "Impact on quality/errors",
    "opportunityCost": "What they can't do because of these issues",
    "talentCost": "Impact on employee satisfaction/retention"
  },
  "prioritizedRecommendations": [
    {
      "priority": 1,
      "title": "Recommendation title",
      "rationale": "Why this is the top priority",
      "approach": "Specific approach to fix this",
      "timeframe": "Expected implementation time",
      "expectedImpact": "Quantified expected outcomes",
      "dependencies": "What needs to happen first",
      "quickWins": ["Immediate action 1", "Immediate action 2"]
    }
  ],
  "comparisonToIndustry": "How this compares to typical ${contact.companySize} ${contact.industry || ''} companies",
  "warningSignals": ["Critical warning 1", "Critical warning 2"],
  "discoveryCallFocus": "What to explore in the discovery call based on these symptoms"
}

Be specific, quantitative where possible, and focus on actionable insights. The goal is to show them problems they didn't know they had.`
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

    // Return the AI analysis
    return res.status(200).json({
      success: true,
      analysis: analysis,
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

// Helper function to convert symptom IDs to descriptions
function getSymptomDescription(symptomId) {
  const descriptions = {
    // Time waste
    'time_waiting': 'People waiting on others to respond or complete their part',
    'time_meetings': 'Status update meetings that could be an email',
    'time_searching': 'Hunting for information that should be easy to find',
    'time_rework': 'Redoing work because something was missed or wrong',
    'time_reports': 'Spending hours/days creating reports from scratch',
    
    // Data issues
    'data_inconsistent': 'Different systems showing different numbers',
    'data_spreadsheets': 'Key data living in someone\'s personal spreadsheet',
    'data_manual': 'Copy-pasting data between systems',
    'data_outdated': 'Making decisions on old or incomplete data',
    'data_trust': 'People don\'t trust the data',
    
    // Communication
    'comm_silos': 'Different departments working in isolation',
    'comm_channels': 'Important info scattered across email, Slack, Teams',
    'comm_handoffs': 'Things getting lost when passed between people/teams',
    'comm_tribal': 'Only certain people know how to do certain things',
    'comm_unclear': 'Unclear who\'s responsible for what',
    
    // Technology
    'tech_switching': 'Constantly switching between multiple tools',
    'tech_login': 'Logging into many different systems daily',
    'tech_slow': 'Tools are slow, clunky, or crash regularly',
    'tech_dont_talk': 'Systems don\'t talk to each other',
    'tech_workarounds': 'People finding workarounds because tools don\'t work well',
    
    // Impact
    'impact_slow': 'Can\'t move fast enough to capitalize on opportunities',
    'impact_customers': 'Internal problems creating customer friction',
    'impact_talent': 'Good people frustrated by inefficient processes',
    'impact_decisions': 'Making decisions without good data',
    'impact_growth': 'Current processes won\'t scale as we grow'
  };
  
  return descriptions[symptomId] || symptomId;
}
