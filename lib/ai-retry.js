/**
 * Retry wrapper for AI API calls.
 * Retries on transient errors (rate limit, overload, network) with exponential backoff.
 */

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 529]);

function isRetryableError(err) {
  if (!err) return false;
  // LangChain / Anthropic SDK errors expose a status code
  const status = err.status ?? err.statusCode ?? err.response?.status;
  if (status && RETRYABLE_STATUS.has(status)) return true;
  // Network-level errors
  const msg = (err.message || '').toLowerCase();
  return msg.includes('econnreset') || msg.includes('timeout') || msg.includes('network') || msg.includes('overloaded');
}

/**
 * Retries `fn` up to `maxAttempts` times with exponential backoff.
 * @param {() => Promise<any>} fn - Async function to retry
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts=3]
 * @param {number} [opts.baseDelayMs=1000]
 * @param {string} [opts.label='AI call'] - For logging
 * @param {import('./logger').Logger} [opts.logger]
 * @returns {Promise<any>}
 */
export async function withRetry(fn, { maxAttempts = 3, baseDelayMs = 1000, label = 'AI call', logger } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryableError(err) || attempt === maxAttempts) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 200;
      logger?.warn(`${label} failed (attempt ${attempt}/${maxAttempts}), retrying in ${Math.round(delay)}ms`, {
        error: err.message,
        status: err.status ?? err.statusCode,
      });
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
