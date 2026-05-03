/**
 * GET /api/me/models
 *
 * Returns the model allowlist + default for the calling user's org. The chat
 * model picker hits this on mount.
 *
 * Anonymous callers get the platform allowlist (Sonnet only). This makes
 * the picker degrade gracefully on the public diagnostic flow rather than
 * 401-ing.
 *
 * Performance:
 *   - Once we have orgId, the customer-key + allowed-models lookups run in
 *     parallel (they don't depend on each other).
 *   - Per-orgId in-memory response cache for 60s. Matches the customer-key
 *     cache TTL so an admin rotation/key-change is reflected within a minute.
 *   - Sets a `Cache-Control: private, max-age=60` header so the browser
 *     caches it for the same TTL — the chat-page reload cost goes to ~0ms.
 */

import { NextResponse } from 'next/server';
import { verifySupabaseSession } from '@/lib/auth';
import { getOrgIdForUser } from '@/lib/costGuard';
import { resolveActiveKey } from '@/lib/customerKey';
import { resolveAllowedModels } from '@/lib/orgModels';
import { publicCatalogue } from '@/lib/agents/modelCatalogue';

const CACHE_TTL_MS = 60_000;
const _cache = new Map(); // key: `${orgId || 'anon'}` → { payload, expiresAt }

function buildPayload(resolved, hasCustomerKey) {
  const cat = publicCatalogue();
  // Drop unsupported (e.g. OpenAI before the client wires up). An admin can
  // still toggle them in the allowlist UI; users just don't see them until
  // the runtime actually routes calls there.
  const items = resolved.allowed
    .map((id) => cat.find((m) => m.id === id))
    .filter((m) => m && !m.unsupported);
  // If the resolved default is unsupported / filtered out, fall back to the
  // first surviving item.
  const defaultId = items.find((m) => m.id === resolved.default)?.id
                 || items[0]?.id
                 || null;
  return {
    allowed: items,
    default: defaultId,
    source: resolved.source,
    hasCustomerKey,
  };
}

export async function GET(request) {
  // Fast-path: anonymous request (no auth header / cookie). All anonymous
  // callers share one cached payload; no DB round-trip needed.
  const hasAuthHeader = request.headers.get('authorization')?.startsWith('Bearer ');
  const hasAuthCookie = request.headers.get('cookie')?.includes('sb-');
  if (!hasAuthHeader && !hasAuthCookie) {
    const cached = _cache.get('anon');
    if (cached && cached.expiresAt > Date.now()) return jsonWithCache(cached.payload);
    const resolved = await resolveAllowedModels({ orgId: null, hasCustomerKey: false });
    const payload = buildPayload(resolved, false);
    _cache.set('anon', { payload, expiresAt: Date.now() + CACHE_TTL_MS });
    return jsonWithCache(payload);
  }

  const session = await verifySupabaseSession(request).catch(() => null);

  // Cache key — anonymous callers all share one entry, since they always get
  // the same platform-only allowlist.
  const cacheKey = session
    ? `s:${session.userId || session.email}`
    : 'anon';

  const cached = _cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return jsonWithCache(cached.payload);
  }

  let orgId = null;
  let hasCustomerKey = false;

  if (session) {
    orgId = await getOrgIdForUser({ email: session.email, userId: session.userId });
  }

  if (orgId) {
    // The two remaining lookups are independent — fan out instead of awaiting
    // serially. On a cold Supabase this halves the wait.
    const [keyResult, modelsResult] = await Promise.all([
      resolveActiveKey({ orgId, vendor: 'anthropic' }),
      // Optimistic: assume hasCustomerKey=false, then re-resolve only if the
      // truth differs. In practice this is fine because the allowed list
      // doesn't include hasCustomerKey-derived defaults until we read row 1.
      resolveAllowedModels({ orgId, hasCustomerKey: false }),
    ]);
    hasCustomerKey = keyResult.source === 'customer';

    // If the org has a customer key AND no explicit allowlist, the
    // optimistic resolution above returned the platform allowlist (wrong).
    // Re-resolve with the correct flag. Cheap — orgModels caches the org row
    // in process via Supabase keep-alive on most hosts.
    let resolved = modelsResult;
    if (hasCustomerKey && resolved.source === 'platform') {
      resolved = await resolveAllowedModels({ orgId, hasCustomerKey: true });
    }
    const payload = buildPayload(resolved, hasCustomerKey);
    _cache.set(cacheKey, { payload, expiresAt: Date.now() + CACHE_TTL_MS });
    return jsonWithCache(payload);
  }

  // No org → straight platform fallback, no fan-out needed.
  const resolved = await resolveAllowedModels({ orgId: null, hasCustomerKey: false });
  const payload = buildPayload(resolved, false);
  _cache.set(cacheKey, { payload, expiresAt: Date.now() + CACHE_TTL_MS });
  return jsonWithCache(payload);
}

function jsonWithCache(payload) {
  const resp = NextResponse.json(payload);
  resp.headers.set('Cache-Control', 'private, max-age=60');
  return resp;
}
