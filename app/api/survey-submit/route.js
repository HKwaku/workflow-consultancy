import { NextResponse } from 'next/server';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { checkOrigin, getRequestId } from '@/lib/api-helpers';
import { logger } from '@/lib/logger';
import { SurveyAnalysisSchema, SurveySubmitInputSchema } from '@/lib/ai-schemas';

const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024; // 2MB
import { invokeStructured } from '@/lib/agents/structured-output';
import { get, set } from '@/lib/agents/ai-cache';
import { surveyAnalysisSystemPrompt, surveyAnalysisUserPrompt } from '@/lib/prompts';
import { getFastModel } from '@/lib/agents/models';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';

export async function POST(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  try {
    const rl = checkRateLimit(getRateLimitKey(request));
    if (!rl.allowed) return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } });

    const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_PAYLOAD_BYTES) return NextResponse.json({ error: 'Request body too large.' }, { status: 413 });

    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
    const parsed = SurveySubmitInputSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request. workflows (1-50) required.', details: parsed.error.flatten() }, { status: 400 });
    const { workflows, diagnostic } = parsed.data;

    const surveyMetrics = calculateSurveyMetrics(workflows);
    const swimlaneData = workflows.map(wf => generateSwimlaneData(wf));

    let aiAnalysis = null;
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        aiAnalysis = await generateAIAnalysis(workflows, surveyMetrics, diagnostic);
      } catch (e) {
        logger.warn('AI analysis failed', { requestId: getRequestId(request), message: e.message });
      }
    }

    return NextResponse.json({
      success: true, message: 'Survey submitted successfully',
      summary: { workflowCount: workflows.length, totalSteps: workflows.reduce((sum, wf) => sum + (wf.steps ? wf.steps.length : 0), 0), totalHandoffs: workflows.reduce((sum, wf) => sum + (wf.handoffs ? wf.handoffs.length : 0), 0), surveyMetrics, swimlaneData, aiAnalysis, confidence: 'MEDIUM', dataSource: 'manual-survey' },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Survey submission error', { requestId: getRequestId(request), error: error.message, stack: error.stack });
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

  const cacheKey = { workflowSummaries };
  const cached = get(cacheKey);
  if (cached && typeof cached === 'object') return cached;

  const fallback = { summary: '', keyFindings: [], bottlenecks: [], recommendations: [], estimatedSavings: null };
  const analysis = await invokeStructured(
    getFastModel({ temperature: 0.5 }),
    [
      new SystemMessage(surveyAnalysisSystemPrompt()),
      new HumanMessage(surveyAnalysisUserPrompt(workflowSummaries)),
    ],
    SurveyAnalysisSchema,
    fallback
  );

  set(cacheKey, analysis);
  return analysis;
}
