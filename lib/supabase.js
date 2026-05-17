import { createClient } from '@supabase/supabase-js';

// Use globalThis to survive Next.js HMR reloads.
// Without this, each HMR update resets the module-level var while the old
// client still holds the Web Lock, causing a 10 s lock-wait timeout.
const GLOBAL_KEY = '__vesno_sb_client__';
let supabaseAdmin = null;

function trimEnv(v) {
  if (v == null) return '';
  return String(v).trim().replace(/^['"]|['"]$/g, '');
}

/**
 * @returns {{ url: string, anonKey: string }}
 */
export function getSupabaseBrowserConfig() {
  const url = trimEnv(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL).replace(/\/$/, '');
  const anonKey = trimEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY);
  if (!url || !anonKey) {
    throw new Error(
      'Supabase client config missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local (restart next dev after changes).',
    );
  }
  try {
    void new URL(url);
  } catch {
    throw new Error(
      `Invalid NEXT_PUBLIC_SUPABASE_URL "${url.slice(0, 48)}${url.length > 48 ? '…' : ''}". It must be a full URL (e.g. https://xxxx.supabase.co).`,
    );
  }
  return { url, anonKey };
}

// In-process auth lock. supabase-js v2 defaults to a cross-tab
// Navigator LockManager lock ("lock:sb-<ref>-auth-token") to serialise
// token refresh across tabs. That lock times out after 10s — and
// surfaces as a runtime error overlay — whenever a previous holder is
// stuck (dev HMR reloads, a crashed/hung tab, or simply another open
// tab). We already keep exactly ONE client per tab (the globalThis
// singleton below), so a simple promise-chain that serialises this
// tab's auth operations is sufficient and removes the LockManager
// dependency entirely. Cross-tab refresh races are rare and self-heal
// (each tab refreshes its own token; getSessionSafe clears bad ones).
let authLockChain = Promise.resolve();
function inProcessAuthLock(_name, _acquireTimeout, fn) {
  const run = authLockChain.then(() => fn());
  authLockChain = run.then(() => {}, () => {}); // keep queue alive on error
  return run;
}

export function getSupabaseClient() {
  if (typeof globalThis !== 'undefined' && globalThis[GLOBAL_KEY]) {
    return globalThis[GLOBAL_KEY];
  }
  const { url, anonKey } = getSupabaseBrowserConfig();
  const client = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      lock: inProcessAuthLock,
    },
  });
  if (typeof globalThis !== 'undefined') globalThis[GLOBAL_KEY] = client;
  return client;
}

/**
 * Wraps auth.getSession(): if the refresh token is missing/invalid, clears the local
 * session so the client stops retrying and AuthApiError spam in dev stops.
 */
export async function getSessionSafe(sb) {
  if (!sb) return { session: null, error: null };
  const { data: { session }, error } = await sb.auth.getSession();
  if (error) {
    try {
      await sb.auth.signOut({ scope: 'local' });
    } catch {
      /* ignore */
    }
    return { session: null, error };
  }
  return { session, error: null };
}

export function getSupabaseAdmin() {
  if (supabaseAdmin) return supabaseAdmin;
  const url = trimEnv(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL).replace(/\/$/, '');
  const serviceKey = trimEnv(process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !serviceKey) throw new Error('Supabase admin config missing');
  supabaseAdmin = createClient(url, serviceKey);
  return supabaseAdmin;
}
