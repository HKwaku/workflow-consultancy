import { NextResponse } from 'next/server';
import { fetchWithTimeout } from '@/lib/api-helpers';

export async function POST(request) {
  try {
    const { workflows, diagnostic } = await request.json();
    if (!workflows || !Array.isArray(workflows) || workflows.length === 0) return NextResponse.json({ error: 'No workflow data provided' }, { status: 400 });

    const surveyMetrics = calculateSurveyMetrics(workflows);
    const swimlaneData = workflows.map(wf => generateSwimlaneData(wf));

    let aiAnalysis = null;
    if (process.env.ANTHROPIC_API_KEY) {
      try { aiAnalysis = await generateAIAnalysis(workflows, surveyMetrics, diagnostic); } catch (e) { console.warn('AI analysis failed:', e.message); }
    }

    return NextResponse.json({
      success: true, message: 'Survey submitted successfully',
      summary: { workflowCount: workflows.length, totalSteps: workflows.reduce((sum, wf) => sum + (wf.steps ? wf.steps.length : 0), 0), totalHandoffs: workflows.reduce((sum, wf) => sum + (wf.handoffs ? wf.handoffs.length : 0), 0), surveyMetrics, swimlaneData, aiAnalysis, confidence: 'MEDIUM', dataSource: 'manual-survey' },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Survey submission error:', error);
    return NextResponse.json({ error: 'Failed to process survey.' }, { status: 500 });
  }
}

function calculateSurveyMetrics(workflows) {
  const metrics = { workflows: [], aggregate: { totalWorkTime: 0, totalWaitTime: 0, totalElapsedTime: 0, workPercentage: 0, waitPercentage: 0, crossDeptHandoffs: 0, totalHandoffs: 0 } };
  workflows.forEach(wf => {
    const steps = wf.steps || [], handoffs = wf.handoffs || [];
    let workTime = 0, waitTime = 0;
    steps.forEach(step => { if (step.workTime) workTime += parseFloat(step.workTime.typical) || 0; if (step.waitTime) waitTime += parseFloat(step.waitTime.typical) || 0; });
    let handoffDelay = 0, crossDept = 0;
    handoffs.forEach(ho => { if (ho.delay) handoffDelay += parseFloat(ho.delay.typical) || 0; if (ho.crossDepartment) crossDept++; });
    const totalElapsed = workTime + waitTime + handoffDelay;
    metrics.workflows.push({ name: wf.workflowName || wf.name || 'Unnamed', workTime, waitTime, handoffDelay, totalElapsed, workPercentage: totalElapsed > 0 ? Math.round((workTime / totalElapsed) * 100) : 0, waitPercentage: totalElapsed > 0 ? Math.round(((waitTime + handoffDelay) / totalElapsed) * 100) : 0, stepCount: steps.length, handoffCount: handoffs.length, crossDeptHandoffs: crossDept });
    metrics.aggregate.totalWorkTime += workTime; metrics.aggregate.totalWaitTime += waitTime + handoffDelay; metrics.aggregate.totalElapsedTime += totalElapsed; metrics.aggregate.crossDeptHandoffs += crossDept; metrics.aggregate.totalHandoffs += handoffs.length;
  });
  const total = metrics.aggregate.totalElapsedTime;
  metrics.aggregate.workPercentage = total > 0 ? Math.round((metrics.aggregate.totalWorkTime / total) * 100) : 0;
  metrics.aggregate.waitPercentage = total > 0 ? Math.round((metrics.aggregate.totalWaitTime / total) * 100) : 0;
  return metrics;
}

function generateSwimlaneData(workflow) {
  const steps = workflow.steps || [], handoffs = workflow.handoffs || [];
  const departments = new Map();
  steps.forEach((step, idx) => { const dept = step.department || 'Unknown'; if (!departments.has(dept)) departments.set(dept, []); departments.get(dept).push({ stepNumber: idx + 1, name: step.name, role: step.role, workTime: step.workTime ? step.workTime.typical : 0, waitTime: step.waitTime ? step.waitTime.typical : 0 }); });
  const connections = handoffs.map((ho, idx) => ({ from: { step: idx + 1, department: steps[idx] ? steps[idx].department : '' }, to: { step: idx + 2, department: steps[idx + 1] ? steps[idx + 1].department : '' }, method: ho.method, delay: ho.delay ? ho.delay.typical : 0, crossDepartment: ho.crossDepartment || false }));
  return { workflowName: workflow.workflowName || workflow.name, trigger: workflow.trigger, completion: workflow.completion, frequency: workflow.frequency, lanes: Object.fromEntries(departments), connections, totalSteps: steps.length, totalDepartments: departments.size };
}

async function generateAIAnalysis(workflows, metrics, diagnostic) {
  const workflowSummaries = workflows.map(wf => { const m = metrics.workflows.find(w => w.name === (wf.workflowName || wf.name)); return `Workflow: ${wf.workflowName || wf.name}\n- Steps: ${(wf.steps || []).length}\n- Total elapsed: ${m ? m.totalElapsed : 'N/A'} hours\n- Work: ${m ? m.workPercentage : 'N/A'}% | Wait: ${m ? m.waitPercentage : 'N/A'}%`; }).join('\n');
  const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 8000, temperature: 0.7, messages: [{ role: 'user', content: `Analyse these workflow surveys and return JSON insights:\n\n${workflowSummaries}\n\nReturn JSON: { "summary": "...", "keyFindings": [...], "bottlenecks": [...], "recommendations": [...], "estimatedSavings": "..." }` }] }) });
  if (!response.ok) return null;
  const data = await response.json();
  let text = data.content[0].text;
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(text);
}
