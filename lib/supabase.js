import { createClient } from '@supabase/supabase-js';

// Use globalThis to survive Next.js HMR reloads.
// Without this, each HMR update resets the module-level var while the old
// client still holds the Web Lock, causing a 10 s lock-wait timeout.
const GLOBAL_KEY = '__vesno_sb_client__';
let supabaseAdmin = null;

export function getSupabaseClient() {
  if (typeof globalThis !== 'undefined' && globalThis[GLOBAL_KEY]) {
    return globalThis[GLOBAL_KEY];
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('Supabase client config missing');
  const client = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('Supabase admin config missing');
  supabaseAdmin = createClient(url, serviceKey);
  return supabaseAdmin;
}
