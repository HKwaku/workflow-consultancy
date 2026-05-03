import { ChatAnthropic } from '@langchain/anthropic';

const isDev = process.env.NODE_ENV === 'development';

// Canonical Anthropic model IDs. Routes that use the raw @anthropic-ai/sdk
// (streaming) import these strings instead of hard-coding them.
export const FAST_MODEL_ID = 'claude-haiku-4-5-20251001';
export const CHAT_MODEL_ID = 'claude-sonnet-4-6';
export const DEEP_MODEL_ID = 'claude-opus-4-7';

/**
 * All factories accept an `apiKey` override (BYO customer key). When set, it
 * supersedes ANTHROPIC_API_KEY for that single model instance — the call goes
 * to the customer's Anthropic workspace, not ours.
 *
 * Callers SHOULD resolve the key via lib/customerKey.js -> resolveActiveKey()
 * and pass `key` here. Falling back to the env var is fine for legacy paths
 * (anonymous flows, marketing surfaces) but new code should be explicit.
 */

function pickApiKey(overrides) {
  // overrides.apiKey wins. Otherwise fall back to env. Empty strings count as
  // "not set" so a misconfigured override doesn't silently auth as platform.
  if (overrides.apiKey && typeof overrides.apiKey === 'string' && overrides.apiKey.length > 0) {
    return overrides.apiKey;
  }
  return process.env.ANTHROPIC_API_KEY;
}

// Fast, cheap: quick extractions, summaries, fallback inference
export function getFastModel(overrides = {}) {
  const { apiKey: _, ...rest } = overrides;
  return new ChatAnthropic({
    model: FAST_MODEL_ID,
    maxTokens: 4096,
    temperature: 0.3,
    verbose: isDev,
    anthropicApiKey: pickApiKey(overrides),
    ...rest,
  });
}

// Primary: diagnostic chat, step mapping, tool use
export function getChatModel(overrides = {}) {
  const { apiKey: _, ...rest } = overrides;
  return new ChatAnthropic({
    model: CHAT_MODEL_ID,
    maxTokens: 16384,
    temperature: 0.3,
    verbose: isDev,
    anthropicApiKey: pickApiKey(overrides),
    ...rest,
  });
}

// Deep reasoning: redesign synthesis, multi-step analysis, structured output
export function getDeepModel(overrides = {}) {
  const { apiKey: _, ...rest } = overrides;
  return new ChatAnthropic({
    model: DEEP_MODEL_ID,
    maxTokens: 16000,
    temperature: 0,
    verbose: isDev,
    anthropicApiKey: pickApiKey(overrides),
    ...rest,
  });
}
