import { ChatAnthropic } from '@langchain/anthropic';

const isDev = process.env.NODE_ENV === 'development';

// Canonical Anthropic model IDs. Routes that use the raw @anthropic-ai/sdk
// (streaming) import these strings instead of hard-coding them.
export const FAST_MODEL_ID = 'claude-haiku-4-5-20251001';
export const CHAT_MODEL_ID = 'claude-sonnet-4-6';
export const DEEP_MODEL_ID = 'claude-opus-4-7';

// Fast, cheap: quick extractions, summaries, fallback inference
export function getFastModel(overrides = {}) {
  return new ChatAnthropic({
    model: FAST_MODEL_ID,
    maxTokens: 4096,
    temperature: 0.3,
    verbose: isDev,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    ...overrides,
  });
}

// Primary: diagnostic chat, step mapping, tool use
export function getChatModel(overrides = {}) {
  return new ChatAnthropic({
    model: CHAT_MODEL_ID,
    maxTokens: 16384,
    temperature: 0.3,
    verbose: isDev,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    ...overrides,
  });
}

// Deep reasoning: redesign synthesis, multi-step analysis, structured output
export function getDeepModel(overrides = {}) {
  return new ChatAnthropic({
    model: DEEP_MODEL_ID,
    maxTokens: 16000,
    temperature: 0,
    verbose: isDev,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    ...overrides,
  });
}
