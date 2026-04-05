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
          // On failed token refresh Supabase fires SIGNED_OUT with no session —
          // clear storage to prevent the error from recurring on next page load
          if (event === 'SIGNED_OUT' && !s) {
            try { sb.auth.signOut({ scope: 'local' }); } catch { /* ignore */ }
          }
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
    try {
      const sb = getSb();
      if (sb) await sb.auth.signOut();
    } catch { /* ignore */ }
    setSession(null);
    setUser(null);
  };

  return { user, session, accessToken: session?.access_token ?? null, loading, signOut };
}
