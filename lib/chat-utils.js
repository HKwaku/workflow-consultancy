/**
 * Parse AI/API errors into user-friendly messages.
 */
export function getFriendlyChatError(rawMessage) {
  if (!rawMessage || typeof rawMessage !== 'string') return 'Something went wrong. Please try again.';
  const lower = rawMessage.toLowerCase();
  if (lower.includes('overload') || lower.includes('overloaded')) {
    return 'The AI service is busy. Please try again in a moment.';
  }
  if (lower.includes('rate limit') || lower.includes('429')) {
    return 'Too many requests. Please wait a moment and try again.';
  }
  if (lower.includes('503') || lower.includes('service unavailable')) {
    return 'The service is temporarily unavailable. Please try again shortly.';
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'The request took too long. Please try again.';
  }
  if (lower.includes('chat failed')) {
    return 'The AI service had trouble responding. Please try again.';
  }
  return 'Something went wrong. Please try again.';
}

/**
 * Check if an error is retryable (worth auto-retrying).
 */
export function isRetryableError(err) {
  const msg = (err?.message || '').toLowerCase();
  return (
    /overload|429|503|timeout|timed out|rate limit|service unavailable|temporarily unavailable/i.test(msg)
  );
}
