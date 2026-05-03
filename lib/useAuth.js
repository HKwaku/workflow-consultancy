'use client';

import { useState, useEffect } from 'react';
import { getSupabaseClient, getSessionSafe } from '@/lib/supabase';

function getSb() {
  try {
    return getSupabaseClient();
  } catch { return null; }
}

export function useAuth() {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const sb = getSb();
        if (!sb) { if (mounted) setLoading(false); return; }
        const { session: s } = await getSessionSafe(sb);

        if (mounted) {
          setSession(s ?? null);
          setUser(s?.user ?? null);
        }

        const { data: { subscription } } = sb.auth.onAuthStateChange((event, s) => {
          if (!mounted) return;
          // NOTE: do NOT call sb.auth.signOut() from this listener.
          // Supabase's signOut unconditionally re-emits SIGNED_OUT, which
          // would fire this listener again → infinite recursion → tab crash.
          // The user-initiated sign-out path in SettingsRailButton already
          // wipes storage synchronously before navigating, so there's no
          // stale state to clean up here.
          setSession(s ?? null);
          setUser(s?.user ?? null);
        });

        return () => subscription?.unsubscribe();
      } catch {
        /* supabase unavailable */
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const signOut = async () => {
    // Goal: return as fast as possible so the caller can navigate away.
    // Anything network-bound (Supabase /logout, cache-bust) runs
    // fire-and-forget so a stalled request never freezes the UI.
    const tokenAtSignout = session?.access_token || null;
    const sb = getSb();

    // 1. CLEAR LOCAL STATE FIRST — cheap, no network. After this the user
    //    is signed out from this tab's perspective even if the network
    //    calls below never complete.
    try {
      if (sb) await sb.auth.signOut({ scope: 'local' });
    } catch { /* ignore */ }
    setSession(null);
    setUser(null);

    // 2. Best-effort server cleanup — evict the JWT from the per-instance
    //    auth cache and revoke at Supabase Auth globally. Both fire-and-
    //    forget so a 30s hang on either doesn't keep us pinned.
    if (tokenAtSignout) {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 3000);
      fetch('/api/auth/cache-bust', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenAtSignout}` },
        signal: ctrl.signal,
      }).catch(() => { /* ignore — server cache will TTL-expire anyway */ });
    }
    if (sb) {
      // Global revoke at Supabase Auth so the token can't be replayed
      // from another device. Fire-and-forget for the same reason.
      sb.auth.signOut({ scope: 'global' }).catch(() => { /* ignore */ });
    }
  };

  return { user, session, accessToken: session?.access_token ?? null, loading, signOut };
}
