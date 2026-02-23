import { NextResponse } from 'next/server';
import { fetchWithTimeout } from '@/lib/api-helpers';

export async function POST(request) {
  try {
    const body = await request.json();

    if (body.mode === 'extract-steps') {
      return handleExtractSteps(body);
    }

    const { evidence, workflows, channels, toolConsent, contact } = body;
    if (!contact || !evidence) return NextResponse.json({ error: 'Evidence and contact data are required.' }, { status: 400 });

    const teamSize = contact.teamSize || 1;
    const metrics = calculateMetrics(evidence, teamSize);
    const operatingModel = detectOperatingModel(evidence);

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured on server' }, { status: 500 });
    }

    const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', max_tokens: 4096, temperature: 0.7,
        messages: [{ role: 'user', content: `You are an expert workflow optimization consultant. Analyze this operational evidence and return a JSON diagnosis.

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
  "operatingModel": { "pattern": "${operatingModel.pattern}", "description": "brief explanation", "whyThisMatters": "why this costs £${metrics.totalCost.toLocaleString()}", "manifestation": "how it shows in their data" },
  "rootCauses": [{"title": "...", "description": "...", "manifestation": "...", "cascadingEffects": ["...", "..."]}],
  "workflowInsights": [],
  "calculatedCosts": { "meetingCost": {"formula": "...", "annual": ${evidence.meetingHours * evidence.meetingPeople * 25 * 50}}, "searchCost": {"formula": "...", "annual": ${Math.round((evidence.searchTime / 60) * 25 * contact.teamSize * 250)}}, "transferCost": {"formula": "...", "annual": ${Math.round((evidence.copyPaste * 2 / 60) * 25 * contact.teamSize * 250)}}, "totalAnnual": ${metrics.totalCost} },
  "transformationPlan": { "overview": "12-week plan", "targetOutcome": "Reduce ${evidence.actualTime} to ${evidence.idealTime} days", "phases": [{"phase": 1, "title": "Quick Wins (Weeks 1-4)", "objective": "...", "expectedImpact": "..."}, {"phase": 2, "title": "Structural Changes (Weeks 5-8)", "objective": "...", "expectedImpact": "..."}, {"phase": 3, "title": "Optimization (Weeks 9-12)", "objective": "...", "expectedImpact": "..."}] },
  "nextSteps": { "immediate": "...", "timeline": "Complete workflow maps in 3 days", "recommendation": "..." }
}
Use THEIR actual numbers. Show the MATH. Be specific and concise.` }]
      })
    });

    if (!response.ok) return NextResponse.json({ error: 'AI analysis service returned an error.' }, { status: 502 });
    const data = await response.json();
    let rawText = data.content[0].text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    let analysis;
    try { analysis = JSON.parse(rawText); } catch (parseErr) {
      console.error('JSON parse error:', parseErr.message);
      return NextResponse.json({ error: 'AI returned an unparseable response.' }, { status: 502 });
    }

    return NextResponse.json({ success: true, analysis, metrics, operatingModel, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Analysis error:', error);
    return NextResponse.json({ error: 'Failed to analyze symptoms.' }, { status: 500 });
  }
}

function calculateMetrics(evidence, teamSize) {
  const AVG_HOURLY_RATE = 25, WORKDAYS_YEAR = 250, WEEKS_YEAR = 50;
  const costs = {};
  let totalCost = 0;
  if (evidence.meetingHours && evidence.meetingPeople) { const c = evidence.meetingHours * evidence.meetingPeople * AVG_HOURLY_RATE * WEEKS_YEAR; costs.meetingCost = { formula: `${evidence.meetingHours} hrs/wk × ${evidence.meetingPeople} people × £${AVG_HOURLY_RATE}/hr × ${WEEKS_YEAR} weeks`, annual: c }; totalCost += c; }
  if (evidence.searchTime) { const c = (evidence.searchTime / 60) * AVG_HOURLY_RATE * teamSize * WORKDAYS_YEAR; costs.searchCost = { formula: `${evidence.searchTime} min/day × ${teamSize} people × £${AVG_HOURLY_RATE}/hr × ${WORKDAYS_YEAR} days`, annual: c }; totalCost += c; }
  if (evidence.copyPaste) { const c = (evidence.copyPaste * 2 / 60) * AVG_HOURLY_RATE * teamSize * WORKDAYS_YEAR; costs.transferCost = { formula: `${evidence.copyPaste} copies × 2 min × ${teamSize} people × £${AVG_HOURLY_RATE}/hr × ${WORKDAYS_YEAR} days`, annual: c }; totalCost += c; }
  if (evidence.spreadsheetHours) { const c = evidence.spreadsheetHours * AVG_HOURLY_RATE * WEEKS_YEAR * (evidence.shadowSpreadsheets || 1); costs.spreadsheetCost = { annual: c }; totalCost += c; }
  if (evidence.reportHours) { const freq = { 'monthly': 12, 'weekly': 50, 'daily': 250, 'multiple': 500 }; const c = evidence.reportHours * AVG_HOURLY_RATE * (freq[evidence.reportFrequency] || 12); costs.reportCost = { annual: c }; totalCost += c; }
  if (evidence.missedOpportunities && evidence.opportunityValue) { const c = evidence.missedOpportunities * 4 * evidence.opportunityValue; costs.opportunityCost = { annual: c }; totalCost += c; }
  return { costs, totalCost: Math.round(totalCost) };
}

function detectOperatingModel(evidence) {
  const scores = { functionalSilos: 0, fragmentedAccountability: 0, hubAndSpokeBottlenecks: 0, manualIntegrationLayer: 0, reactiveFireFighting: 0, scalingCeiling: 0 };
  if (evidence.crossDeptWork === 'handoff' || evidence.crossDeptWork === 'escalate') scores.functionalSilos += 3;
  if (evidence.actualTime > evidence.idealTime * 2) scores.functionalSilos += 2;
  if (evidence.meetingHours >= 8) scores.functionalSilos += 1;
  if (evidence.crossDeptWork === 'escalate') scores.fragmentedAccountability += 3;
  if (evidence.waitTime >= 3) scores.fragmentedAccountability += 2;
  if (evidence.onboardingWeeks >= 4) scores.hubAndSpokeBottlenecks += 2;
  if (evidence.waitFrequency === 'daily' || evidence.waitFrequency === 'multiple') scores.hubAndSpokeBottlenecks += 2;
  if (evidence.copyPaste >= 10) scores.manualIntegrationLayer += 3;
  if (evidence.shadowSpreadsheets >= 2) scores.manualIntegrationLayer += 2;
  if (evidence.toolCount >= 5) scores.manualIntegrationLayer += 1;
  if (evidence.missedOpportunities >= 2) scores.reactiveFireFighting += 2;
  if (evidence.actualTime > evidence.idealTime * 3) scores.scalingCeiling += 2;
  const primary = Object.keys(scores).reduce((a, b) => scores[a] > scores[b] ? a : b);
  return { pattern: primary, confidence: scores[primary] >= 5 ? 'HIGH' : scores[primary] >= 3 ? 'MEDIUM' : 'LOW', allScores: scores };
}

async function handleExtractSteps(body) {
  const { imageBase64, imageMediaType, text } = body;
  if (!imageBase64 && !text) return NextResponse.json({ error: 'Provide either imageBase64 or text.' }, { status: 400 });
  if (imageBase64 && imageBase64.length > 7 * 1024 * 1024) return NextResponse.json({ error: 'Image too large.' }, { status: 413 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured.' }, { status: 500 });

  const systemPrompt = `You are an expert process analyst. Extract a structured list of process steps from the input provided. Return ONLY valid JSON with: { "processName": "...", "steps": [{ "number": 1, "name": "...", "department": "...", "isExternal": false, "isDecision": false, "branches": [] }] }`;
  const messages = [{ role: 'user', content: [] }];
  if (imageBase64) {
    messages[0].content.push({ type: 'image', source: { type: 'base64', media_type: imageMediaType || 'image/png', data: imageBase64 } });
    messages[0].content.push({ type: 'text', text: 'Extract all process steps from this process map / flowchart image. Return structured JSON.' });
  } else {
    messages[0].content.push({ type: 'text', text: 'Extract structured process steps from this description:\n\n' + text });
  }

  try {
    const resp = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 4096, temperature: 0, system: systemPrompt, messages })
    }, 45000);

    if (!resp.ok) return NextResponse.json({ error: 'AI extraction failed (' + resp.status + ')' }, { status: 502 });
    const data = await resp.json();
    let rawText = (data.content?.[0]?.text || '').replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    let parsed;
    try { parsed = JSON.parse(rawText); } catch (e) {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) try { parsed = JSON.parse(jsonMatch[0]); } catch (e2) { /* fallthrough */ }
      if (!parsed) return NextResponse.json({ error: 'Failed to parse AI response.' }, { status: 502 });
    }
    return NextResponse.json({ success: true, processName: parsed.processName || '', steps: (parsed.steps || []).slice(0, 50) });
  } catch (err) {
    console.error('Extract steps error:', err);
    return NextResponse.json({ error: 'Step extraction failed: ' + err.message }, { status: 500 });
  }
}
