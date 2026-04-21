import { ChatAnthropic } from '@langchain/anthropic';

const isDev = process.env.NODE_ENV === 'development';

// Fast, cheap: quick extractions, summaries, fallback inference
export function getFastModel(overrides = {}) {
  return new ChatAnthropic({
    model: 'claude-haiku-4-5-20251001',
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
    model: 'claude-sonnet-4-6',
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
    model: 'claude-opus-4-7',
    maxTokens: 16000,
    temperature: 0,
    verbose: isDev,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    ...overrides,
  });
}
