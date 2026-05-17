/**
 * Artefact sub-agent.
 *
 * A focused, one-shot generator the chat tool delegates to. It is NOT
 * conversational: the main agent decides *what* to make and hands over
 * a skill + spec + grounding context; this produces the artefact body,
 * structurally validates it, and self-repairs once before giving up.
 *
 * Kept separate from the chat loop so it can run on a stronger model
 * with a larger output budget without bloating every chat turn.
 */

import Anthropic from '@anthropic-ai/sdk';
import { DEEP_MODEL_ID, CHAT_MODEL_ID, FAST_MODEL_ID } from '../models.js';
import { logger } from '../../logger.js';

/**
 * Per-skill speed/quality tier. Artefacts ran on Opus 4.7 (the slowest
 * tier) for everything, plus a second Opus call on any validation slip
 * — the dominant reason emission felt slow. Most deliverables are short
 * and well-structured; Haiku 4.5 produces them well and ~3-5x faster.
 * Opus is reserved for genuinely synthesis-heavy or schema-critical
 * work where reasoning depth changes the output quality.
 */
const DEEP_SKILLS = new Set([
  'business_case', 'board_pack', 'qofe_summary', 'decision_memo',
  'target_operating_model', 'project_charter', 'scenario_model',
  // structured Gantts: CPM-grade plans + JSON-schema constrained
  'gantt', 'hundred_day_plan', 'automation_roadmap',
]);
function modelTierForSkill(skill) {
  if (!skill) return FAST_MODEL_ID;
  // Office files are mechanical codegen (python-pptx/docx/openpyxl in
  // the sandbox), not deep reasoning. Opus 4.7 + adaptive thinking made
  // a .pptx take "ages"; Sonnet 4.6 is materially faster and just as
  // reliable at writing the library code, with the PK-zip validation +
  // honest failure path catching any slip.
  if (skill.office) return CHAT_MODEL_ID;
  if (DEEP_SKILLS.has(skill.id)) return DEEP_MODEL_ID;
  return FAST_MODEL_ID;                            // the common, fast path
}

const _platformClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function clientFor(apiKey) {
  if (apiKey && typeof apiKey === 'string' && apiKey.length > 0 && apiKey !== process.env.ANTHROPIC_API_KEY) {
    return new Anthropic({ apiKey });
  }
  return _platformClient;
}

const MAX_OUTPUT_TOKENS = 8000;

function systemPrompt(skill) {
  return [
    'You are the Artefact generator for a workflow-consultancy workspace.',
    'You produce ONE concrete deliverable, then stop. You are not a chat assistant.',
    '',
    'Hard rules:',
    '- Output ONLY the artefact body. No preamble ("Here is…"), no sign-off, no explanation.',
    '- Do not wrap the whole artefact in Markdown code fences unless the artefact itself is source code.',
    '- Ground every number/claim in the provided CONTEXT. If something needed is missing, make a reasonable assumption and state it inside the artefact (e.g. an "Assumptions" line) — never invent precise figures silently.',
    '- Be decision-grade: specific, quantified, and immediately usable.',
    '',
    `Artefact type: ${skill.label} (${skill.id}).`,
    'Format contract for this artefact:',
    skill.instructions,
  ].join('\n');
}

function extractText(msg) {
  if (!msg || !Array.isArray(msg.content)) return '';
  return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

/**
 * @param {object}  args
 * @param {object}  args.skill   a registry entry from ARTEFACT_SKILLS
 * @param {string}  args.title   human title (for context only; not echoed)
 * @param {string}  args.spec    what to make + parameters, from the main agent
 * @param {string} [args.context] grounding data the main agent already has
 * @param {string} [args.apiKey] customer key passthrough (else platform)
 * @param {string} [args.model]  model override (else DEEP_MODEL_ID)
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<{content:string,type:string,language:string|null,usage:object}|{error:string}>}
 */
export async function generateArtefact({ skill, title, spec, context, apiKey, model, signal }) {
  if (!skill || typeof skill.validate !== 'function') return { error: 'unknown skill' };
  const client = clientFor(apiKey);
  const activeModel = model || modelTierForSkill(skill);

  const userBlock = [
    title ? `TITLE: ${title}` : null,
    '',
    'SPEC (what to produce):',
    String(spec || '').trim() || '(no spec provided — infer from the title)',
    context ? `\nCONTEXT (ground the artefact in this — do not contradict it):\n${String(context).slice(0, 24000)}` : '',
  ].filter((x) => x !== null).join('\n');

  const baseMessages = [{ role: 'user', content: userBlock }];

  // The system prompt is fully static per skill (constant preamble +
  // the skill's frozen instructions); the per-request spec/context
  // live in `messages`, which render AFTER system. So a cache
  // breakpoint on the system block is reused across the validate→
  // repair round-trip within a call and across calls for the same
  // skill (5-min TTL). Below the model's minimum cacheable prefix it
  // silently no-ops — no error. Cache hits: resp.usage.cache_read_input_tokens.
  const systemBlocks = [
    { type: 'text', text: systemPrompt(skill), cache_control: { type: 'ephemeral' } },
  ];

  // JSON-shaped skills that ship a schema get structured outputs:
  // the response is constrained to valid, correctly-shaped JSON, so
  // the repair pass almost never fires. Skills whose contract is
  // intentionally freeform (table/json), not JSON at all (csv), or
  // not cleanly schema-expressible (scenario_model's arbitrary
  // assumptions map) stay on the validate→repair path.
  const outputConfig = skill.jsonSchema
    ? { format: { type: 'json_schema', schema: skill.jsonSchema } }
    : undefined;

  async function call(messages, maxTokens) {
    const resp = await client.messages.create(
      {
        // No `temperature`: claude-opus-4-7 (the default deep model)
        // rejects it ("deprecated for this model"). The default
        // sampling is fine for structured artefact output.
        model: activeModel,
        max_tokens: maxTokens,
        system: systemBlocks,
        ...(outputConfig ? { output_config: outputConfig } : {}),
        messages,
      },
      signal ? { signal } : undefined,
    );
    return {
      text: extractText(resp),
      usage: resp?.usage || {},
      refusal: resp?.stop_reason === 'refusal',
    };
  }

  try {
    let totalIn = 0; let totalOut = 0; let cacheRead = 0; let cacheWrite = 0;
    const meter = (u) => {
      totalIn += u.input_tokens || 0;
      totalOut += u.output_tokens || 0;
      cacheRead += u.cache_read_input_tokens || 0;
      cacheWrite += u.cache_creation_input_tokens || 0;
    };
    const first = await call(baseMessages, MAX_OUTPUT_TOKENS);
    let { text } = first;
    meter(first.usage);

    // Structured-output refusals don't conform to the schema — fail
    // fast with a clear message rather than a confusing parse error.
    if (first.refusal) {
      logger.warn('Artefact generation refused', { skill: skill.id });
      return { error: `the model declined to produce this ${skill.label}` };
    }

    let check = skill.validate(text);
    if (!check.ok) {
      // One structural-repair pass: hand back the bad output + the
      // exact validator complaint and ask for a corrected body only.
      const repair = await call(
        [
          ...baseMessages,
          { role: 'assistant', content: text || '(empty)' },
          {
            role: 'user',
            content:
              `That output failed validation: ${check.error}. ` +
              'Return the corrected artefact body ONLY, obeying the format contract exactly. No explanation.',
          },
        ],
        MAX_OUTPUT_TOKENS,
      );
      meter(repair.usage);
      check = skill.validate(repair.text);
      if (!check.ok) {
        logger.warn('Artefact generation failed validation after repair', {
          skill: skill.id, error: check.error,
        });
        return { error: `could not produce a valid ${skill.label} (${check.error})` };
      }
    }

    return {
      content: check.content,
      type: skill.type,
      language: skill.language || null,
      usage: {
        input_tokens: totalIn,
        output_tokens: totalOut,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheWrite,
      },
    };
  } catch (e) {
    logger.error('Artefact generation call failed', { skill: skill?.id, error: e.message });
    return { error: `generation failed: ${e.message}` };
  }
}

/* ── Office-file path (code execution → Files API) ─────────────────
 *
 * For binary deliverables (.pptx/.docx/.xlsx) the text path doesn't
 * apply: the sub-agent writes the file in Anthropic's code-execution
 * sandbox (python-pptx / python-docx / openpyxl are pre-installed).
 * The sandbox does NOT auto-surface created files as Files-API ids
 * (the bash result's file list comes back empty), but stdout IS
 * reliably captured — so the final sandbox cell base64-encodes the
 * file between sentinels, and we decode that here. The caller
 * (graph.js emit_artefact) persists the bytes to Supabase Storage.
 */

const OFFICE_MIME = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const OFFICE_LIB = { pptx: 'python-pptx', docx: 'python-docx', xlsx: 'openpyxl' };
const B64_START = '__ARTEFACT_B64_START__';
const B64_END = '__ARTEFACT_B64_END__';

function safeBase(s) {
  return String(s || 'artefact').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'artefact';
}

// Concatenate stdout from every code-execution result block in a
// response (the channel the sandbox base64 comes back on).
function collectStdout(resp) {
  let out = '';
  if (!Array.isArray(resp?.content)) return out;
  for (const b of resp.content) {
    if (b?.type !== 'bash_code_execution_tool_result') continue;
    const r = b.content;
    if (r && typeof r.stdout === 'string') out += r.stdout;
  }
  return out;
}

// Pull the base64 payload from between the sentinels and decode it to
// a Buffer. Returns null if absent or not a valid OOXML zip.
function decodeB64Artefact(stdout) {
  const i = stdout.indexOf(B64_START);
  const j = stdout.indexOf(B64_END);
  if (i === -1 || j === -1 || j <= i) return null;
  const b64 = stdout.slice(i + B64_START.length, j).replace(/[^A-Za-z0-9+/=]/g, '');
  if (!b64) return null;
  let buf;
  try { buf = Buffer.from(b64, 'base64'); } catch { return null; }
  // All .pptx/.docx/.xlsx are ZIP archives → magic bytes "PK".
  if (!buf || buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) return null;
  return buf;
}

/**
 * Generate an Office file (.pptx/.docx/.xlsx) in the code-execution
 * sandbox and return its bytes for the caller to store.
 *
 * @returns {Promise<{file:Buffer,filename:string,mime:string,type:string,language:null,usage:object}|{error:string}>}
 */
export async function generateOfficeArtefact({ skill, title, spec, context, apiKey, model, signal }) {
  const fmt = skill?.format;
  if (!OFFICE_MIME[fmt]) return { error: 'unknown office skill' };
  const client = clientFor(apiKey);
  const activeModel = model || modelTierForSkill(skill); // office → deep
  const outName = `${safeBase(title || skill.label)}.${fmt}`;
  const outPath = `/tmp/${outName}`;

  // Static per-skill system prompt → cacheable. The spec/context vary
  // and live in `messages` after the breakpoint.
  const systemBlocks = [{
    type: 'text',
    cache_control: { type: 'ephemeral' },
    text: [
      `You build exactly ONE ${fmt.toUpperCase()} file in the code-execution sandbox, then stop. You are not a chat assistant.`,
      `Use the ${OFFICE_LIB[fmt]} library (pre-installed). Write the finished file to "${outPath}" — that exact path and name.`,
      '',
      'Hard rules:',
      '- Build the deliverable from the SPEC and CONTEXT. Ground every number/claim in CONTEXT; if something needed is missing, make a reasonable assumption and state it inside the document.',
      '- Make it polished and decision-grade: clear structure, titled sections/slides/sheets, consistent formatting, no placeholder lorem text.',
      '- Keep it appropriately compact (a few pages / slides / sheets) so it transfers cleanly — do not pad.',
      '- After writing the file, run ONE final Python cell that emits the file as base64 and NOTHING else:',
      `    import base64; data=open("${outPath}","rb").read(); print("${B64_START}"); print(base64.b64encode(data).decode()); print("${B64_END}")`,
      '- Do NOT print the document text, file listings, or any commentary. The base64 block is the only required output.',
      '',
      `Format contract for this ${skill.label}:`,
      skill.instructions || '(produce a well-structured document appropriate to the spec)',
    ].join('\n'),
  }];

  const userBlock = [
    title ? `TITLE: ${title}` : null,
    '',
    'SPEC (what to produce):',
    String(spec || '').trim() || '(no spec provided — infer from the title)',
    context ? `\nCONTEXT (ground the document in this — do not contradict it):\n${String(context).slice(0, 24000)}` : '',
  ].filter((x) => x !== null).join('\n');

  let messages = [{ role: 'user', content: userBlock }];
  let totalIn = 0; let totalOut = 0; let cacheRead = 0; let cacheWrite = 0;
  let stdoutAll = '';

  try {
    // The code-execution server loop can pause (`pause_turn`) before
    // the base64 cell runs; re-send with the assistant turn appended,
    // bounded so a stuck build can't loop forever. A healthy build is
    // 1-2 hops; cap at 3 so a stuck one fails in ~2 min (then the
    // honest-failure path tells the user to retry) instead of dragging
    // to 4+ hops and failing anyway. Accumulate stdout across hops.
    for (let hop = 0; hop < 3; hop += 1) {
      const resp = await client.messages.create(
        {
          model: activeModel,
          max_tokens: 8000,
          // No adaptive thinking: writing python-pptx/docx/openpyxl from
          // a clear spec is mechanical, not a reasoning problem, and
          // thinking was the single biggest latency cost on this path.
          system: systemBlocks,
          tools: [{ type: 'code_execution_20260120', name: 'code_execution' }],
          messages,
        },
        signal ? { signal } : undefined,
      );
      const u = resp?.usage || {};
      totalIn += u.input_tokens || 0; totalOut += u.output_tokens || 0;
      cacheRead += u.cache_read_input_tokens || 0; cacheWrite += u.cache_creation_input_tokens || 0;

      if (resp.stop_reason === 'refusal') {
        return { error: `the model declined to produce this ${skill.label}` };
      }
      stdoutAll += collectStdout(resp);
      if (stdoutAll.includes(B64_END)) break;
      if (resp.stop_reason === 'pause_turn') {
        messages = [...messages, { role: 'assistant', content: resp.content }];
        continue;
      }
      break; // end_turn without the payload
    }

    const bytes = decodeB64Artefact(stdoutAll);
    if (!bytes) {
      // Capture the real failure shape — without this the office path
      // fails silently and looks like "it just made JSON" downstream.
      logger.warn('Office artefact: no decodable file from sandbox', {
        skill: skill?.id,
        fmt,
        sawStart: stdoutAll.includes(B64_START),
        sawEnd: stdoutAll.includes(B64_END),
        stdoutLen: stdoutAll.length,
      });
      return stdoutAll.includes(B64_START)
        ? { error: `the ${skill.label} was too large to transfer in one pass — ask for a more compact document` }
        : { error: `the ${skill.label} build did not return a ${fmt} file (the sandbox produced no file payload)` };
    }

    return {
      file: bytes,
      filename: outName,
      mime: OFFICE_MIME[fmt],
      type: fmt,
      language: null,
      usage: {
        input_tokens: totalIn,
        output_tokens: totalOut,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheWrite,
      },
    };
  } catch (e) {
    logger.error('Office artefact generation failed', { skill: skill?.id, error: e.message });
    return { error: `generation failed: ${e.message}` };
  }
}

export { CHAT_MODEL_ID };
