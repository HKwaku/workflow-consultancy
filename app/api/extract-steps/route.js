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
      ? `Extract the process steps from this document or text:\n\n${textContent.slice(0, 20000)}`
      : 'Extract the process steps from this image.';

    contentParts.push({
      type: 'text',
      text: `${textPrompt}

Extract every process step and return a JSON array. Each step object must have:
- name: string — concise step name (e.g. "Submit purchase request")
- department: string — the team, role, or department responsible. Use the exact name from the source (e.g. "Finance", "Customer Success", "Account Manager", "IT Support"). Leave blank only if genuinely unknown.
- owner: string — specific role or person if mentioned (e.g. "Finance Manager"), otherwise blank
- systems: string[] — software tools or systems used in this step (e.g. ["SAP", "Slack", "Email"])
- isDecision: boolean — true if this is a decision/branch point (e.g. "Approve or Reject?", "If X then Y")
- isMerge: boolean — true if this step is a convergence point where two or more branches rejoin the main flow. In diagrams, this is any shape that has multiple incoming arrows, or a BPMN gateway labelled "join/merge". In text, phrases like "after [either/both/all] paths, do X" indicate that X is the merge.
- branches: array — if isDecision is true, list the branch outcomes as [{label: "Yes"}, {label: "No"}] or use the actual branch labels from the source. Empty array otherwise.

Rules:
- If the source is a table (e.g. spreadsheet or Teams export), treat each row as a step. Map column headers like "Owner", "Team", "Responsible", "Assigned to" → department/owner.
- Preserve the original sequence order.
- Include ALL steps — do not summarise or skip.
- For decision steps, set isDecision: true and populate branches.
- For rejoin / convergence steps, set isMerge: true. When two branches visibly reconnect onto the same step in a diagram, that step is a merge. Prefer over-flagging merges when branches rejoin — the diagram needs it to draw the reconnection arrows.

Return ONLY the JSON array, no other text. Example:
[{"name":"Submit request","department":"Procurement","owner":"Procurement Analyst","systems":["SAP"],"isDecision":false,"isMerge":false,"branches":[]},{"name":"Approve or reject?","department":"Finance Manager","owner":"","systems":[],"isDecision":true,"isMerge":false,"branches":[{"label":"Approved"},{"label":"Rejected"}]},{"name":"Archive decision","department":"Finance","owner":"","systems":[],"isDecision":false,"isMerge":true,"branches":[]}]`,
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

    const normalised = steps.slice(0, 50).map((s, i) => ({
      number: i + 1,
      name: String(s.name || '').trim().slice(0, 200),
      department: String(s.department || '').trim().slice(0, 100),
      owner: String(s.owner || '').trim().slice(0, 100),
      systems: Array.isArray(s.systems) ? s.systems.map(String).slice(0, 10) : [],
      isDecision: !!s.isDecision,
      isMerge: !!s.isMerge,
      isExternal: false,
      branches: (s.isDecision && Array.isArray(s.branches))
        ? s.branches.slice(0, 6).map((b) => ({ label: String(b?.label || '').trim(), target: null }))
        : [],
      contributor: '',
      checklist: [],
    })).filter((s) => s.name);

    return NextResponse.json({ success: true, steps: normalised, count: normalised.length });
  } catch (err) {
    logger.error('Extract steps error', { requestId: getRequestId(request), error: err.message });
    return NextResponse.json({ error: 'Failed to extract steps.' }, { status: 500 });
  }
}
