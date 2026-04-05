import { NextResponse } from 'next/server';
import { checkOrigin, getRequestId } from '@/lib/api-helpers';
import { checkRateLimit, getRateLimitKey } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { getFastModel } from '@/lib/agents/models';
import { HumanMessage } from '@langchain/core/messages';

export const maxDuration = 30;

export async function POST(request) {
  const originErr = checkOrigin(request);
  if (originErr) return NextResponse.json({ error: originErr.error }, { status: originErr.status });

  const rl = await checkRateLimit(getRateLimitKey(request));
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'AI service not configured.' }, { status: 503 });
  }

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  const { imageBase64, mediaType, textContent } = body || {};

  if (!imageBase64 && !textContent) {
    return NextResponse.json({ error: 'imageBase64 or textContent required.' }, { status: 400 });
  }

  try {
    const model = getFastModel();

    const contentParts = [];

    if (imageBase64) {
      contentParts.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType || 'image/png',
          data: imageBase64,
        },
      });
    }

    const textPrompt = textContent
      ? `Extract the process steps from this document or text:\n\n${textContent.slice(0, 8000)}`
      : 'Extract the process steps from this image.';

    contentParts.push({
      type: 'text',
      text: `${textPrompt}

Return a JSON array of steps. Each step should have:
- name: string (the step name, keep concise)
- department: string (e.g. "Finance", "HR", "IT", "Operations", "Management", "Sales", or leave blank if unclear)
- systems: string[] (any software tools mentioned, e.g. ["SAP", "Email"])

Return ONLY the JSON array, no other text. Example:
[{"name":"Submit request","department":"Employee","systems":["Email"]},{"name":"Review","department":"Manager","systems":[]}]`,
    });

    const response = await model.invoke([new HumanMessage({ content: contentParts })]);
    const text = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

    // Extract JSON array from response
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return NextResponse.json({ error: 'Could not extract steps from content.' }, { status: 422 });

    let steps;
    try { steps = JSON.parse(match[0]); } catch { return NextResponse.json({ error: 'Could not parse extracted steps.' }, { status: 422 }); }

    if (!Array.isArray(steps) || steps.length === 0) {
      return NextResponse.json({ error: 'No steps found in content.' }, { status: 422 });
    }

    const normalised = steps.slice(0, 30).map((s, i) => ({
      number: i + 1,
      name: String(s.name || '').trim().slice(0, 200),
      department: String(s.department || '').trim().slice(0, 100),
      systems: Array.isArray(s.systems) ? s.systems.map(String).slice(0, 10) : [],
      isDecision: false,
      isMerge: false,
      isExternal: false,
      branches: [],
      contributor: '',
      checklist: [],
    })).filter((s) => s.name);

    return NextResponse.json({ success: true, steps: normalised, count: normalised.length });
  } catch (err) {
    logger.error('Extract steps error', { requestId: getRequestId(request), error: err.message });
    return NextResponse.json({ error: 'Failed to extract steps.' }, { status: 500 });
  }
}
