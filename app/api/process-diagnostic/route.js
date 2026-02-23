import { NextResponse } from 'next/server';
import { fetchWithTimeout, stripEmDashes } from '@/lib/api-helpers';
import { generateMermaidCode } from '@/lib/mermaid-helper';

export async function POST(request) {
  try {
    const { processes, contact, qualityScore, timestamp } = await request.json();
    if (!processes || processes.length === 0) return NextResponse.json({ error: 'No processes provided' }, { status: 400 });

    const processResults = processes.map(p => {
      const quality = calculateProcessQuality(p);
      return { name: p.processName, type: p.processType, elapsedDays: p.lastExample?.elapsedDays || 0, annualCost: p.costs?.totalAnnualCost || 0, annualInstances: p.frequency?.annual || 0, teamSize: p.costs?.teamSize || 1, stepsCount: (p.steps || []).length, quality, bottleneck: p.bottleneck || {}, priority: p.priority || {} };
    });
    const totalCost = processResults.reduce((sum, p) => sum + p.annualCost, 0);

    let recommendations;
    let isAIEnhanced = false;
    try { recommendations = await getAIRecommendations(processes, contact); isAIEnhanced = true; }
    catch (aiError) { recommendations = generateRuleBasedRecommendations(processes); }

    let flowDiagramUrl = null;
    try { flowDiagramUrl = await triggerN8nFlowDiagram(processes, contact); } catch (e) { /* skip */ }

    return NextResponse.json({ success: true, processes: processResults, totalCost, potentialSavings: totalCost * 0.5, recommendations, flowDiagramUrl, qualityScore, analysisType: isAIEnhanced ? 'ai-enhanced' : 'rule-based', timestamp });
  } catch (error) {
    console.error('Process diagnostic error:', error);
    return NextResponse.json({ error: 'Analysis failed.' }, { status: 500 });
  }
}

async function triggerN8nFlowDiagram(processes, contact) {
  const webhookUrl = process.env.N8N_DIAGNOSTIC_WEBHOOK_URL || process.env.N8N_WEBHOOK_URL;
  if (!webhookUrl || (!webhookUrl.startsWith('http://') && !webhookUrl.startsWith('https://'))) return null;
  const mermaidCode = generateMermaidCode(processes);
  const flowData = processes.map(p => ({ processName: p.processName, processType: p.processType, startsWhen: p.definition?.startsWhen || '', completesWhen: p.definition?.completesWhen || '', steps: (p.steps || []).map(s => { const step = { number: s.number, name: s.name, department: s.department }; if (s.isDecision && s.branches?.length > 0) { step.isDecision = true; step.branches = s.branches; } if (s.isExternal) step.isExternal = true; return step; }), handoffs: (p.handoffs || []).map(h => ({ from: { name: h.from?.name, department: h.from?.department }, to: { name: h.to?.name, department: h.to?.department }, method: h.method, clarity: h.clarity })), approvals: (p.approvals || []).map(a => ({ name: a.name, who: a.who, assessment: a.assessment })), systems: (p.systems || []).map(s => ({ name: s.name, purpose: s.purpose, actions: s.actions || [] })), bottleneck: p.bottleneck || {}, costs: { totalAnnualCost: p.costs?.totalAnnualCost || 0, instanceCost: p.costs?.instanceCost || 0, elapsedDays: p.lastExample?.elapsedDays || 0, annualInstances: p.frequency?.annual || 0, teamSize: p.costs?.teamSize || 1 } }));
  const response = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestType: 'flow-diagram', processes: flowData, mermaidCode, contact: { name: contact?.name || '', email: contact?.email || '', company: contact?.company || '' }, timestamp: new Date().toISOString() }) });
  if (!response.ok) throw new Error('n8n webhook returned ' + response.status);
  const result = await response.json();
  return result.diagramUrl || null;
}

async function getAIRecommendations(processes, contact) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('No API key configured');
  const processDescriptions = processes.map((p, i) => {
    const steps = (p.steps || []).map(s => `${s.number}. ${s.name} [${s.department}]`).join('\n');
    return `PROCESS #${i + 1}: ${p.processName} (${p.processType})\n- Duration: ${p.lastExample?.elapsedDays || '?'} days\n- Steps:\n${steps}\n- Frequency: ${p.frequency?.annual || '?'}/year\n- Annual Cost: £${((p.costs?.totalAnnualCost || 0) / 1000).toFixed(0)}K`;
  }).join('\n---\n');
  const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 4000, temperature: 0.6, messages: [{ role: 'user', content: `Analyse these processes and return 3-6 JSON recommendations:\n\n${processDescriptions}\n\nReturn as JSON array: [{"process": "name", "type": "handoff|integration|approval|knowledge|automation|general", "text": "recommendation"}]\nReturn ONLY the JSON array.` }] }) });
  if (!response.ok) throw new Error('Claude API error: ' + response.status);
  const data = await response.json();
  const content = data.content?.[0]?.text || '[]';
  try { return stripEmDashes(JSON.parse(content)); } catch { return [{ process: 'Overall', type: 'general', text: content.substring(0, 500).replace(/\u2014/g, '-') }]; }
}

function generateRuleBasedRecommendations(processes) {
  const recs = [];
  processes.forEach(p => {
    const poorHandoffs = (p.handoffs || []).filter(h => h.clarity === 'yes-multiple' || h.clarity === 'yes-major' || h.method === 'they-knew');
    if (poorHandoffs.length > 0) recs.push({ type: 'handoff', process: p.processName, text: `${poorHandoffs.length} handoff(s) in "${p.processName}" show poor information transfer.` });
    const copySystems = (p.systems || []).filter(s => (s.actions || []).includes('copy-in') || (s.actions || []).includes('copy-out'));
    if (copySystems.length >= 2) recs.push({ type: 'integration', process: p.processName, text: `${copySystems.length} systems in "${p.processName}" require manual data copying.` });
    if (p.knowledge?.vacationImpact === 'stops' || p.knowledge?.vacationImpact === 'slows-down') recs.push({ type: 'knowledge', process: p.processName, text: `"${p.processName}" has critical knowledge risk.` });
    if (p.userTime?.waiting > p.userTime?.execution) recs.push({ type: 'automation', process: p.processName, text: `In "${p.processName}", waiting time exceeds execution time.` });
  });
  if (recs.length === 0) recs.push({ type: 'general', process: 'Overall', text: 'Your processes show room for optimisation.' });
  return recs;
}

function calculateProcessQuality(p) {
  let score = 100;
  const flags = [];
  if (p.lastExample?.startDate) { const age = (new Date() - new Date(p.lastExample.startDate)) / (1000 * 60 * 60 * 24); if (age > 60) { score -= 10; flags.push('Example over 60 days old'); } } else { score -= 15; flags.push('No example dates provided'); }
  if (p.userTime?.total % 5 === 0 && p.userTime?.total > 0) { score -= 5; flags.push('Round numbers suggest estimation'); }
  if ((p.steps || []).length < 5) { score -= 10; flags.push('Limited step detail'); }
  if ((p.steps || []).length >= 8) score += 5;
  if (p.lastExample?.startDate && p.lastExample?.endDate) score += 10;
  if (p.costs?.totalAnnualCost > 0) score += 5;
  if ((p.handoffs || []).length > 0) score += 5;
  if ((p.systems || []).length > 0) score += 5;
  score = Math.max(0, Math.min(100, score));
  return { score, grade: score > 85 ? 'HIGH' : score > 65 ? 'MEDIUM' : 'LOW', flags };
}
