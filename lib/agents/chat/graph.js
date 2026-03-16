import { StateGraph, Annotation } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import { getChatModel } from '../models.js';
import { chatSystemPrompt } from '../../prompts.js';
import { ALL_CHAT_TOOLS } from './tools.js';

/* ── State ───────────────────────────────────────────────────────── */

const replace = (_, v) => v;

const ChatState = Annotation.Root({
  messages: Annotation({
    reducer: (left, right) => {
      const incoming = Array.isArray(right) ? right : [right];
      return [...left, ...incoming];
    },
    default: () => [],
  }),
  systemPrompt: Annotation({ reducer: replace, default: () => '' }),
});

const toolNode = new ToolNode(ALL_CHAT_TOOLS);

/** Extract text from content (string or Anthropic-style content blocks array). */
function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b?.type === 'text' && b?.text)
      .map((b) => b.text)
      .join('');
  }
  return '';
}

/* ── Streaming agent loop (emits content as it arrives) ───────────── */

async function runStreamingLoop({ systemPrompt, messages, onEmit }) {
  const model = getChatModel().bindTools(ALL_CHAT_TOOLS);
  let currentMessages = [...messages];
  const allActions = [];
  const allTextParts = [];
  let recursionCount = 0;
  const maxRecursion = 10;

  const emit = (event, data) => { if (typeof onEmit === 'function') onEmit(event, data); };

  while (recursionCount < maxRecursion) {
    emit('progress', { message: recursionCount === 0 ? 'Sharp is thinking…' : 'Updating your process map…' });
    const input = [new SystemMessage(systemPrompt), ...currentMessages];
    const stream = await model.stream(input);

    let accumulated = null;
    for await (const chunk of stream) {
      if (!accumulated) accumulated = chunk;
      else accumulated = accumulated.concat(chunk);
      const content = extractText(chunk?.content);
      if (content) emit('delta', { text: content });
    }

    const aiMessage = accumulated;
    if (!aiMessage) break;

    const content = extractText(aiMessage.content);
    if (content?.trim()) allTextParts.push(content.trim());

    const toolCalls = aiMessage.tool_calls || [];
    if (toolCalls.length === 0) break;

    for (const tc of toolCalls) {
      allActions.push({ name: tc.name, input: tc.args });
    }
    emit('progress', { message: 'Updating your process map…' });

    const toolResult = await toolNode.invoke({ messages: [...currentMessages, aiMessage] });
    currentMessages = [...currentMessages, aiMessage, ...(toolResult.messages || [])];
    recursionCount++;
  }

  return { textParts: allTextParts, actions: allActions };
}

/* ── Non-streaming agent (original graph) ─────────────────────────── */

async function agentNode(state) {
  const model = getChatModel().bindTools(ALL_CHAT_TOOLS);
  const response = await model.invoke([
    new SystemMessage(state.systemPrompt),
    ...state.messages,
  ]);
  return { messages: [response] };
}

function shouldContinue(state) {
  const last = state.messages[state.messages.length - 1];
  return (last?.tool_calls?.length > 0) ? 'tools' : '__end__';
}

const graph = new StateGraph(ChatState)
  .addNode('agent', agentNode)
  .addNode('tools', toolNode)
  .addEdge('__start__', 'agent')
  .addConditionalEdges('agent', shouldContinue)
  .addEdge('tools', 'agent');

const compiledGraph = graph.compile({ recursionLimit: 10 });

/* ── Public entry point ──────────────────────────────────────────── */

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

export async function runChatAgent({ message, currentSteps, currentHandoffs, processName, history, incompleteInfo, attachments, editingReportId, editingRedesign, onProgress, onEmit }) {
  const emit = (event, data) => {
    if (typeof onEmit === 'function') onEmit(event, data);
    else if (event === 'progress' && typeof onProgress === 'function') onProgress(data?.message ?? data);
  };
  const handoffs = currentHandoffs || [];
  const stepsDesc = (currentSteps || [])
    .filter((s) => s.name?.trim())
    .map((s, i) => {
      let d = `${i + 1}. ${s.name}`;
      if (s.department) d += ` [${s.department}]`;
      if (s.isMerge) d += ' (MERGE)';
      else if (s.isDecision) d += s.parallel ? ' (PARALLEL gateway)' : ' (EXCLUSIVE decision)';
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
  const editingMode = editingReportId
    ? (editingRedesign ? 'redesign' : 'original')
    : null;

  const systemPrompt = chatSystemPrompt({ processName, stepsDesc, incompleteBlock, editingMode });

  const messages = [];
  if (history?.length) {
    for (const h of history.slice(-10)) {
      const Cls = h.role === 'user' ? HumanMessage : AIMessage;
      messages.push(new Cls(h.content));
    }
  }

  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
  const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

  if (hasAttachments && attachments.some((a) => IMAGE_TYPES.includes(a.type))) {
    emit('progress', { message: 'Reading your attachments…' });
    const contentBlocks = [];
    if (message?.trim()) contentBlocks.push({ type: 'text', text: message.trim() });
    for (const a of attachments) {
      if (IMAGE_TYPES.includes(a.type) && a.content) {
        contentBlocks.push({ type: 'image_url', image_url: { url: `data:${a.type};base64,${a.content}` } });
      } else {
        contentBlocks.push({ type: 'text', text: `[Attached: ${a.name}]` });
      }
    }
    messages.push(new HumanMessage({ content: contentBlocks }));
  } else {
    const text = message?.trim() || (hasAttachments ? `Extract process steps from: ${attachments.map((a) => a.name).join(', ')}` : '');
    messages.push(new HumanMessage(text));
  }

  const { textParts, actions } = await runStreamingLoop({ systemPrompt, messages, onEmit });

  let reply = textParts.join('\n').trim();
  if (!reply && actions.length > 0) reply = `Done  -  ${summariseActions(actions)}`;
  if (!reply) reply = 'Done.';

  return { reply, actions: actions.length > 0 ? actions : undefined };
}
