import { ChatAnthropic } from '@langchain/anthropic';

export function getFastModel(overrides = {}) {
  return new ChatAnthropic({
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 4096,
    temperature: 0.3,
    verbose: true,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    ...overrides,
  });
}

export function getChatModel(overrides = {}) {
  return new ChatAnthropic({
    model: 'claude-sonnet-4-6',
    maxTokens: 8192,
    temperature: 0.3,
    verbose: true,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    ...overrides,
  });
}

export function getDeepModel(overrides = {}) {
  return new ChatAnthropic({
    model: 'claude-sonnet-4-6',
    maxTokens: 16000,
    temperature: 0,
    verbose: true,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    ...overrides,
  });
}
