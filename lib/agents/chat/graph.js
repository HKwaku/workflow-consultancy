import Anthropic from '@anthropic-ai/sdk';
import { chatSystemPrompt } from '../../prompts.js';
import { ALL_CHAT_TOOLS } from './tools.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/* ── Tool execution (returns result string for the model) ─────────── */

function executeTool(name, input) {
  switch (name) {
    case 'add_step':
      return `Added step "${input.name}"${input.afterStep != null ? ` after step ${input.afterStep}` : ' at end'}.`;
    case 'update_step': {
      const fields = Object.keys(input).filter(k => k !== 'stepNumber');
      return `Updated step ${input.stepNumber}: ${fields.join(', ')}.`;
    }
    case 'remove_step':
      return `Removed step ${input.stepNumber}.`;
    case 'set_handoff':
      return `Set handoff from step ${input.fromStep}: ${input.method}.`;
    case 'add_custom_department':
      return `Added custom department "${input.name}".`;
    case 'replace_all_steps':
      return `Replaced entire flow with ${input.steps?.length || 0} steps.`;
    default:
      return 'Done.';
  }
}

/* ── Streaming agent loop ─────────────────────────────────────────── */

async function runStreamingLoop({ system, messages, onEmit, maxIterations = 10 }) {
  let currentMessages = [...messages];
  const allActions = [];
  const allTextParts = [];
  let iterations = 0;

  const emit = (event, data) => { if (typeof onEmit === 'function') onEmit(event, data); };

  while (iterations < maxIterations) {
    emit('progress', { message: iterations === 0 ? 'Reina is thinking…' : 'Updating your process map…' });

    let streamText = '';
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 16384,
      temperature: 0.3,
      system,
      messages: currentMessages,
      tools: ALL_CHAT_TOOLS,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        streamText += event.delta.text;
        emit('delta', { text: event.delta.text });
      }
    }

    const finalMessage = await stream.finalMessage();
    if (streamText.trim()) allTextParts.push(streamText.trim());

    if (finalMessage.stop_reason !== 'tool_use') break;

    const toolUses = finalMessage.content.filter(b => b.type === 'tool_use');
    if (toolUses.length === 0) break;

    emit('progress', { message: 'Updating your process map…' });

    const toolResults = toolUses.map(tu => {
      allActions.push({ name: tu.name, input: tu.input });
      return { type: 'tool_result', tool_use_id: tu.id, content: executeTool(tu.name, tu.input) };
    });

    currentMessages = [
      ...currentMessages,
      { role: 'assistant', content: finalMessage.content },
      { role: 'user', content: toolResults },
    ];
    iterations++;
  }

  return { textParts: allTextParts, actions: allActions };
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function summariseActions(actions) {
  const parts = [];
  let added = 0, updated = 0, removed = 0, handoffs = 0, depts = 0, replaced = false;
  for (const a of actions) {
    if (a.name === 'add_step') added++;
    else if (a.name === 'update_step') updated++;
    else if (a.name === 'remove_step') removed++;
    else if (a.name === 'set_handoff') handoffs++;
    else if (a.name === 'add_custom_department') depts++;
    else if (a.name === 'replace_all_steps') replaced = true;
  }
  if (replaced) parts.push(`Set up ${actions.find(a => a.name === 'replace_all_steps')?.input?.steps?.length || 0} steps`);
  if (added) parts.push(`added ${added} step${added > 1 ? 's' : ''}`);
  if (updated) parts.push(`updated ${updated} step${updated > 1 ? 's' : ''}`);
  if (removed) parts.push(`removed ${removed} step${removed > 1 ? 's' : ''}`);
  if (handoffs) parts.push(`set ${handoffs} handoff${handoffs > 1 ? 's' : ''}`);
  if (depts) parts.push(`added ${depts} custom department${depts > 1 ? 's' : ''}`);
  return parts.length > 0 ? parts.join(', ') + '.' : '';
}

function describeAttachmentFile(a) {
  const t = (a.type || '').toLowerCase();
  const name = a.name || 'file';
  if (t.startsWith('image/')) return `image "${name}"`;
  if (t.includes('spreadsheet') || /application\/vnd\.ms-excel|spreadsheetml/.test(t) || /\.(xlsx?|csv)$/i.test(name)) return `spreadsheet "${name}"`;
  if (t === 'application/pdf' || /\.pdf$/i.test(name)) return `PDF "${name}"`;
  if (a.textContent) return `text file "${name}"`;
  if (t.includes('word') || t.includes('document') || /\.docx?$/i.test(name)) return `document "${name}"`;
  return `file "${name}"`;
}

/* ── Public entry point ───────────────────────────────────────────── */

export async function runChatAgent({
  message, currentSteps, currentHandoffs, processName, history,
  incompleteInfo, attachments, editingReportId, editingRedesign, redesignContext,
  sessionContext,
  onProgress, onEmit,
}) {
  const emit = (event, data) => {
    if (typeof onEmit === 'function') onEmit(event, data);
    else if (event === 'progress' && typeof onProgress === 'function') onProgress(data?.message ?? data);
  };

  const handoffs = currentHandoffs || [];
  const stepsDesc = (currentSteps || [])
    .filter(s => s.name?.trim())
    .map((s, i) => {
      let d = `${i + 1}. ${s.name}`;
      if (s.department) d += ` [${s.department}]`;
      if (s.isMerge) d += ' (MERGE)';
      else if (s.isDecision) d += s.parallel ? ' (PARALLEL/AND gateway)' : s.inclusive ? ' (INCLUSIVE/OR gateway)' : ' (EXCLUSIVE/XOR decision)';
      if ((s.branches || []).length) {
        const bl = s.branches.map((b, bi) => `  ${bi === 0 ? 'Yes' : bi === 1 ? 'No' : `Branch ${bi + 1}`}${b.label ? ' "' + b.label + '"' : ''} → ${b.target || 'unlinked'}`).join('\n');
        d += `\n${bl}`;
      }
      if (s.workMinutes != null) d += ` (${s.workMinutes}m work${s.waitMinutes != null ? `, ${s.waitMinutes}m wait` : ''})`;
      if (s.owner) d += ` [owner: ${s.owner}]`;
      if ((s.systems || []).length) d += ` {${s.systems.join(', ')}}`;
      if (handoffs[i]?.method) d += ` → handoff: ${handoffs[i].method}`;
      return d;
    })
    .join('\n') || '(no steps yet)';

  const incompleteBlock = incompleteInfo
    ? `\n\nINCOMPLETE STEPS  -  proactively remind the user to fill these in:\n${incompleteInfo}`
    : '';
  const editingMode = editingReportId ? (editingRedesign ? 'redesign' : 'original') : null;
  const system = chatSystemPrompt({ processName, stepsDesc, incompleteBlock, editingMode, redesignContext, sessionContext });

  /* Build message history */
  const messages = [];
  if (history?.length) {
    for (const h of history.slice(-10)) {
      messages.push({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content });
    }
  }

  /* Handle attachments */
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
  const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  const hasRichContent = hasAttachments && attachments.some(a => IMAGE_TYPES.includes(a.type) || a.textContent);

  if (hasAttachments) {
    const list = attachments.map(a => a.name).filter(Boolean).join(', ') || `${attachments.length} file(s)`;
    emit('progress', { message: `Received ${attachments.length} file${attachments.length > 1 ? 's' : ''}: ${list}. Preparing for analysis…` });
  }

  let preAck = '';
  if (hasRichContent) {
    emit('progress', { message: 'Reading your attachments…' });
    const contentBlocks = [];
    if (message?.trim()) contentBlocks.push({ type: 'text', text: message.trim() });
    for (const a of attachments) {
      emit('progress', { message: `Loading ${describeAttachmentFile(a)}…` });
      if (IMAGE_TYPES.includes(a.type) && a.content) {
        contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: a.type, data: a.content } });
      } else if (a.textContent) {
        const text = a.textContent.length > 80000 ? a.textContent.slice(0, 80000) + '\n[truncated]' : a.textContent;
        contentBlocks.push({ type: 'text', text: `File: ${a.name}\n\n${text}` });
      } else {
        emit('progress', { message: `Referencing "${a.name}" in your request…` });
        contentBlocks.push({ type: 'text', text: `[Attached: ${a.name}]` });
      }
    }
    messages.push({ role: 'user', content: contentBlocks });
  } else {
    if (hasAttachments) emit('progress', { message: 'Packaging your files for the assistant…' });
    const text = message?.trim() || (hasAttachments ? `Extract process steps from: ${attachments.map(a => a.name).join(', ')}` : '');
    messages.push({ role: 'user', content: text });
  }

  if (hasAttachments) {
    const fileDesc = attachments.length === 1 ? describeAttachmentFile(attachments[0]) : `${attachments.length} files`;
    preAck = `Got it — I can see you've shared ${fileDesc}. I'll read through it and extract your process steps now…\n\n`;
    emit('delta', { text: preAck });
  }

  const { textParts, actions } = await runStreamingLoop({ system, messages, onEmit: emit });

  let reply = textParts.join('\n').trim();
  if (!reply && actions.length > 0) reply = `Done  -  ${summariseActions(actions)}`;
  if (!reply) reply = 'Done.';
  if (preAck) reply = `${preAck}${reply}`;

  return { reply, actions: actions.length > 0 ? actions : undefined };
}
