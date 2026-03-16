/**
 * Rate limiter. Uses in-memory store only.
 * Note: In serverless (e.g. Vercel), each instance has its own store; limits reset on cold start.
 * Shared rate limiting (e.g. Upstash Redis) is not implemented yet; add KV_REST_API_* if needed.
 * Limits: 100 requests per 60s per key (IP).
 */
const store = new Map();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 100;

function prune() {
  const now = Date.now();
  for (const [k, v] of store.entries()) {
    if (v.resetAt < now) store.delete(k);
  }
}

export function checkRateLimit(key) {
  prune();
  const now = Date.now();
  let entry = store.get(key);
  if (!entry) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    store.set(key, entry);
  }
  if (now >= entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + WINDOW_MS;
  }
  entry.count++;
  if (entry.count > MAX_REQUESTS) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { allowed: true };
}

export function getRateLimitKey(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : request.headers.get('x-real-ip') || 'unknown';
  return ip;
}
