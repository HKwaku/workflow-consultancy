/**
 * Shared module - cross-cutting primitives used by every feature module:
 * auth, supabase client, AI SDK helpers, logger, rate limiting, sanitisation.
 */

export * as auth from '../../auth.js';
export { useAuth } from '../../useAuth.js';
export * as supabase from '../../supabase.js';
export * as aiRetry from '../../ai-retry.js';
export * as aiSchemas from '../../ai-schemas.js';
export * as apiFetch from '../../api-fetch.js';
export * as apiHelpers from '../../api-helpers.js';
export * as chatUtils from '../../chat-utils.js';
export * as logger from '../../logger.js';
export * as rateLimit from '../../rate-limit.js';
export * as sanitize from '../../sanitize.js';
export * as triggerWebhook from '../../triggerWebhook.js';
