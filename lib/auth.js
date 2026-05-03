/**
 * Server-side auth: verify Supabase JWT and return user email.
 *
 * Heavy perf path: this runs on every protected API request. The naive
 * implementation calls supabase.auth.getUser(token) → network round-trip
 * to Supabase Auth on every call (~100-300ms). With a typical workspace
 * surface firing 4-8 parallel API requests, that's 4-8 simultaneous auth
 * round-trips, all of which are completely redundant for the same JWT
 * within a few seconds.
 *
 * Two layers of caching:
 *
 *   1. **JWT exp pre-check** — Supabase JWTs are HS256 with a payload
 *      that includes `exp`, `email`, `sub`. We base64-decode the payload
 *      locally to (a) reject expired tokens without a network call and
 *      (b) confirm the token shape before involving Supabase. We don't
 *      verify the signature here — that's what the cached network call
 *      does — so this is just a fast "should I bother" check.
 *
 *   2. **Cache successful verifications** — keep the result keyed by a
 *      hash of the token for AUTH_CACHE_TTL_MS. The next ~50 calls with
 *      the same JWT skip the network entirely. TTL is short (60s) so a
 *      revoked or rotated token can't extend its life by much.
 *
 * Cache is in-memory per serverless instance — no shared state required,
 * no cross-instance staleness risk worse than the TTL.
 */
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

// Module-level singleton for server-side JWT verification only.
// Created with persistSession:false and autoRefreshToken:false so it never
// acquires a Web Lock - avoids the Navigator LockManager timeout error that
// occurs when multiple full clients are created.
let _verifyClient = null;

function getVerifyClient() {
  if (_verifyClient) return _verifyClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  _verifyClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return _verifyClient;
}

const AUTH_CACHE_TTL_MS = 60_000;
const AUTH_CACHE_MAX = 1024;
// Map<tokenHash, { session, expiresAt }>. expiresAt is min(JWT exp, now+TTL).
const _authCache = new Map();
// Map<tokenHash, Promise<session|null>>. Coalesces concurrent verifications
// of the same token so 8 parallel API calls trigger ONE network round-trip
// instead of 8.
const _inFlight = new Map();

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('base64');
}

function cacheGet(tokenHash) {
  const hit = _authCache.get(tokenHash);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    _authCache.delete(tokenHash);
    return null;
  }
  return hit.session;
}

function cacheSet(tokenHash, session, jwtExpSec) {
  // expiresAt = min(JWT exp, now + TTL). Don't cache past the JWT's own
  // expiry or a revoked token would still appear valid for our full TTL.
  const ttlExpiry = Date.now() + AUTH_CACHE_TTL_MS;
  const jwtExpiry = jwtExpSec ? jwtExpSec * 1000 : ttlExpiry;
  const expiresAt = Math.min(ttlExpiry, jwtExpiry);
  if (expiresAt <= Date.now()) return;
  if (_authCache.size >= AUTH_CACHE_MAX) {
    const oldest = _authCache.keys().next().value;
    if (oldest) _authCache.delete(oldest);
  }
  _authCache.set(tokenHash, { session, expiresAt });
}

/**
 * Decode a Supabase JWT payload (without verifying the signature). Returns
 * null if the token is malformed or expired. Used to short-circuit before
 * the network call.
 */
function peekJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json);
    if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Verify a Supabase JWT signature LOCALLY against SUPABASE_JWT_SECRET
 * (HS256). Returns the decoded payload on success, null on
 * malformed / expired / wrong-signature / missing-secret.
 *
 * Why this matters: Supabase issues HS256 JWTs signed with the
 * project's JWT secret (Project Settings → API → JWT Settings). If we
 * have that secret on the server we can verify the token entirely
 * locally — no network call to /auth/v1/user, no ~200 ms round-trip.
 * Cache + in-flight coalescing in verifySupabaseSession still apply
 * but the underlying verify itself becomes ~ms.
 *
 * Falls back to the network path when the secret isn't configured so
 * deployments can adopt this incrementally without env churn.
 */
function verifyJwtLocal(token) {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;
  try {
    const headerJson = Buffer.from(headerB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const header = JSON.parse(headerJson);
    if (header.alg !== 'HS256') return null;
    // Constant-time compare to dodge timing attacks even though the
    // attack surface here is narrow (server-side, post-rate-limit).
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest();
    const provided = Buffer.from(signatureB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (expected.length !== provided.length) return null;
    if (!crypto.timingSafeEqual(expected, provided)) return null;
    const payloadJson = Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(payloadJson);
    if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) return null;
    if (typeof payload.nbf === 'number' && payload.nbf * 1000 > Date.now()) return null;
    if (!payload.sub || !payload.email) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function verifySupabaseSession(request) {
  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) return null;

  // Fast-path: malformed or expired token, refuse without involving Supabase.
  const payload = peekJwtPayload(token);
  if (!payload) return null;

  const tokenHash = hashToken(token);
  const cached = cacheGet(tokenHash);
  if (cached) return cached;

  // FAST PATH: verify the JWT locally with SUPABASE_JWT_SECRET. When
  // the secret is configured, every authenticated request avoids the
  // ~200 ms /auth/v1/user round-trip on cache miss. Falls through to
  // the network path when no secret is set — that lets deployments
  // adopt this incrementally without env churn.
  const localPayload = verifyJwtLocal(token);
  if (localPayload) {
    const session = {
      user: { id: localPayload.sub, email: localPayload.email },
      email: localPayload.email.toLowerCase().trim(),
      userId: localPayload.sub,
    };
    cacheSet(tokenHash, session, localPayload.exp);
    return session;
  }

  // Coalesce: if another request is already verifying this same token, await
  // its result instead of firing a duplicate round-trip.
  const inFlight = _inFlight.get(tokenHash);
  if (inFlight) return inFlight;

  const promise = (async () => {
    try {
      const supabase = getVerifyClient();
      if (!supabase) return null;
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error || !user?.email) return null;
      const session = { user, email: user.email.toLowerCase().trim(), userId: user.id };
      cacheSet(tokenHash, session, payload.exp);
      return session;
    } catch {
      return null;
    } finally {
      _inFlight.delete(tokenHash);
    }
  })();
  _inFlight.set(tokenHash, promise);
  return promise;
}

/**
 * Require auth: returns 401 response if no valid session.
 * Use: const auth = await requireAuth(request); if (auth.error) return auth.error;
 */
export async function requireAuth(request) {
  const session = await verifySupabaseSession(request);
  if (!session) {
    return { error: { status: 401, body: { error: 'Authentication required. Please sign in.' } } };
  }
  return { email: session.email, userId: session.userId, user: session.user };
}

/**
 * Test-only: clear the in-memory auth cache. Useful in tests that mint
 * synthetic JWTs and want a clean slate between cases.
 */
export function _clearAuthCacheForTesting() {
  _authCache.clear();
  _inFlight.clear();
}

/**
 * Evict a specific token from the cache. Called by the /api/auth/cache-bust
 * endpoint when a client signs out, so the just-revoked JWT can't be
 * replayed for up to TTL_MS afterwards. In-memory cache is per serverless
 * instance — a multi-instance deploy may still have stale entries on
 * other Lambdas; SECURITY.md documents the residual exposure.
 */
export function bustAuthCacheForToken(token) {
  if (!token) return false;
  const key = hashToken(token);
  const had = _authCache.delete(key);
  _inFlight.delete(key);
  return had;
}
