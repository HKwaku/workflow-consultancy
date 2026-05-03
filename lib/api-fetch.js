'use client';

const DEFAULT_TIMEOUT_MS = 60000;

// Short-TTL client-side coalesce + cache for safe GETs. Two components
// asking for the same URL within DEDUPE_TTL_MS share one fetch — and a
// near-simultaneous mount (e.g. DealContextChip + DiagnosticWorkspace
// both hitting /api/deals/{id}) shares the in-flight promise, not the
// stale cache window. Bypass with `{ dedupe: false }` on the options.
const DEDUPE_TTL_MS = 2500;
const _inFlight = new Map(); // key → Promise<Response>
const _recent = new Map();   // key → { response, expiresAt }

function dedupKey(url, method, accessToken) {
  return `${method}:${url}:${accessToken ? 'auth' : 'anon'}`;
}

function pruneRecent() {
  const now = Date.now();
  for (const [k, v] of _recent) if (v.expiresAt <= now) _recent.delete(k);
}

/**
 * Fetch wrapper that adds Authorization header when accessToken is provided.
 * - Optional timeout via AbortController.
 * - Coalesces duplicate same-key in-flight GETs and serves recent responses
 *   from a short-TTL cache (default 2.5 s). Mutating verbs (POST/PUT/PATCH/
 *   DELETE) bypass the cache entirely.
 *
 * Opt out per-call with `{ dedupe: false }` in options when you genuinely
 * need a fresh response (long polls, status checks, post-write reads).
 */
export function apiFetch(url, options = {}, accessToken = null) {
  const { timeout, dedupe = true, ...fetchOptions } = options;
  const headers = { ...(fetchOptions.headers || {}) };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const method = (fetchOptions.method || 'GET').toUpperCase();
  const timeoutMs = timeout ?? DEFAULT_TIMEOUT_MS;

  const isCacheable = dedupe && method === 'GET';
  const key = isCacheable ? dedupKey(url, method, accessToken) : null;

  if (isCacheable) {
    const inFlight = _inFlight.get(key);
    if (inFlight) return inFlight.then((r) => r.clone());
    pruneRecent();
    const recent = _recent.get(key);
    if (recent && recent.expiresAt > Date.now()) return Promise.resolve(recent.response.clone());
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const promise = fetch(url, { ...fetchOptions, headers, signal: controller.signal })
    .finally(() => clearTimeout(timer));

  if (isCacheable) {
    _inFlight.set(key, promise);
    promise
      .then((response) => {
        // Only stash 2xx; error responses shouldn't be reused — the next
        // call should retry against the network.
        if (response.ok) _recent.set(key, { response, expiresAt: Date.now() + DEDUPE_TTL_MS });
      })
      .catch(() => { /* swallow; non-cacheable */ })
      .finally(() => _inFlight.delete(key));
    return promise.then((r) => r.clone());
  }

  // Mutating writes never share — every consumer needs the full original
  // response since clone() can't be called after body consumption anyway.
  return promise;
}

/**
 * Drop a specific URL from the cache. Use after a successful write so
 * the next read fetches fresh data instead of the stale cached entry.
 * Pass the full URL string used in the GET, plus the same accessToken
 * (or null) the GET would use.
 */
export function invalidateApiCache(url, accessToken = null) {
  const key = dedupKey(url, 'GET', accessToken);
  _inFlight.delete(key);
  _recent.delete(key);
}

/** Drop every cached entry — e.g. on sign-out. */
export function clearApiCache() {
  _inFlight.clear();
  _recent.clear();
}
