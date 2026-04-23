/**
 * Distributed rate limiter using Upstash Redis when configured,
 * falling back to in-memory store for local dev / unconfigured envs.
 *
 * Upstash setup: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
 * in your environment (Vercel project settings or .env.local).
 *
 * Limits: 100 requests per 60s per key (IP).
 */

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 100;

// ---------------------------------------------------------------------------
// Upstash sliding-window rate limiter (shared across all instances)
// ---------------------------------------------------------------------------

let _upstashLimiter = null;

function getUpstashLimiter() {
  if (_upstashLimiter !== null) return _upstashLimiter;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    _upstashLimiter = false; // mark as unavailable
    return false;
  }
  try {
    const { Redis } = require('@upstash/redis');
    const { Ratelimit } = require('@upstash/ratelimit');
    const redis = new Redis({ url, token });
    _upstashLimiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(MAX_REQUESTS, '60 s'),
      analytics: false,
      prefix: 'rl',
    });
    return _upstashLimiter;
  } catch {
    _upstashLimiter = false;
    return false;
  }
}

// ---------------------------------------------------------------------------
// In-memory fallback (single instance, resets on cold start)
// ---------------------------------------------------------------------------

const store = new Map();

function prune() {
  const now = Date.now();
  for (const [k, v] of store.entries()) {
    if (v.resetAt < now) store.delete(k);
  }
}

function checkInMemory(key) {
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function checkRateLimit(key) {
  const limiter = getUpstashLimiter();
  if (limiter) {
    try {
      const { success, reset } = await limiter.limit(key);
      if (!success) {
        const retryAfter = reset ? Math.ceil((reset - Date.now()) / 1000) : 60;
        return { allowed: false, retryAfter };
      }
      return { allowed: true };
    } catch {
      // Upstash unreachable - degrade gracefully to in-memory
      return checkInMemory(key);
    }
  }
  return checkInMemory(key);
}

export function getRateLimitKey(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded
    ? forwarded.split(',')[0].trim()
    : request.headers.get('x-real-ip') || 'unknown';
  return ip;
}
