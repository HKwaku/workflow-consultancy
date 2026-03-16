/**
 * In-memory cache for AI outputs. Keyed by hash of input.
 * For production at scale, use Redis or Vercel KV.
 */
import crypto from 'crypto';

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_MAX_ENTRIES = 500;

const store = new Map();
let order = [];

function hashKey(input) {
  const str = typeof input === 'string' ? input : JSON.stringify(input);
  return crypto.createHash('sha256').update(str).digest('hex');
}

function prune(maxEntries) {
  while (order.length > maxEntries) {
    const oldest = order.shift();
    if (oldest) store.delete(oldest);
  }
}

/**
 * Get cached value. Returns undefined if miss or expired.
 * @param {string|object} input - Input to hash for cache key
 * @returns {*|undefined}
 */
export function get(input) {
  const key = hashKey(input);
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    order = order.filter((k) => k !== key);
    return undefined;
  }
  return entry.value;
}

/**
 * Set cached value.
 * @param {string|object} input - Input to hash for cache key
 * @param {*} value - Value to cache
 * @param {number} ttlMs - TTL in milliseconds
 * @param {number} maxEntries - Max entries before evicting oldest
 */
export function set(input, value, ttlMs = DEFAULT_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES) {
  const key = hashKey(input);
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  order = order.filter((k) => k !== key);
  order.push(key);
  prune(maxEntries);
}
