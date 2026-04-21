import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { checkOrigin, getRequestId } from '@/lib/api-helpers';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export const maxDuration = 30;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildSystemPrompt(context) {
  const { steps = [], costs = {}, savings = {}, bottleneck = {} } = context;

  const stepSummary = steps.length > 0
    ? steps.map((s, i) => `${i + 1}. ${s.name || 'Step'} (${s.department || 'unknown team'}${s.workMinutes ? `, ${s.workMinutes}m work` : ''}${s.waitMinutes ? `, ${s.waitMinutes}m wait` : ''})`).join('\n')
    : 'No step detail available.';

  const totalWork = steps.reduce((n, s) => n + (s.workMinutes || 0), 0);
  const totalWait = steps.reduce((n, s) => n + (s.waitMinutes || 0), 0);
  const hoursPerRun = (totalWork / 60).toFixed(1);
  const teamSize = costs.teamSize || 1;
  const annual = costs.annual || 12;
  const hourlyRate = costs.hourlyRate || 50;
  const annualCost = teamSize * annual * (totalWork / 60) * hourlyRate;

  return `You are a process cost analyst helping a client understand the cost figures in their process audit report. Be concise, specific, and helpful. Use plain language. Avoid jargon.

PROCESS DATA:
Steps:
${stepSummary}

METRICS:
- Total work time per run: ${hoursPerRun}h
- Total wait time per run: ${(totalWait / 60).toFixed(1)}h
- Team size involved: ${teamSize}
- Runs per year: ${annual}
- Estimated hourly cost rate: £${hourlyRate}/hr
- Estimated annual cost: £${Math.round(annualCost).toLocaleString()}
- Estimated savings opportunity: ${savings.estimatedSavingsPercent || savings.percent || 0}%
- Main bottleneck: ${bottleneck.reason || 'not identified'}${bottleneck.why ? ` — ${bottleneck.why}` : ''}

Answer the user's question about the cost figures. If you don't have enough data to answer precisely, give a best estimate and say what additional info would help.`;
}

export async function POST(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  const { question, context = {}, reportId, mode } = body;
  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    return NextResponse.json({ error: 'Question required.' }, { status: 400 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'AI not configured.' }, { status: 500 });
  }

  const requestId = getRequestId(request);
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: buildSystemPrompt(context),
      messages: [{ role: 'user', content: question.trim().slice(0, 1000) }],
    });

    const answer = response.content?.[0]?.text || 'I could not generate an answer.';
    return NextResponse.json({ answer });
  } catch (err) {
    logger.error('Cost copilot error', { requestId, error: err.message });
    return NextResponse.json({ error: 'Analysis failed. Please try again.' }, { status: 500 });
  }
}
