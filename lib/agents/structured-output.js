/**
 * Shared helper for single-shot LLM calls that return structured JSON.
 * Invokes the model, extracts text, and validates with Zod.
 */
import { stripEmDashes } from '@/lib/api-helpers';
import { parseWithSchema } from '@/lib/ai-schemas';

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

function cleanJsonText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

/**
 * Invoke a model and parse the response as structured JSON validated by a Zod schema.
 * @param {Object} model - LangChain chat model (e.g. getFastModel())
 * @param {Array} messages - Array of SystemMessage, HumanMessage, etc.
 * @param {z.ZodSchema} schema - Zod schema for validation
 * @param {*} fallback - Value to return if parse/validation fails
 * @param {Object} options - { temperature }
 * @returns {Promise<*>} Validated data or fallback
 */
export async function invokeStructured(model, messages, schema, fallback, options = {}) {
  const response = await model.invoke(messages);
  const raw = extractText(response.content);
  const cleaned = cleanJsonText(raw);
  if (!cleaned) return fallback;
  return parseWithSchema(schema, stripEmDashes(cleaned), fallback);
}
