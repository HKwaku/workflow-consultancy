'use client';

import { useState, useEffect } from 'react';
import { getSupabaseClient } from '@/lib/supabase';

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
        const { data: { session: s } } = await sb.auth.getSession();
        if (mounted) {
          setSession(s);
          setUser(s?.user ?? null);
        }
        sb.auth.onAuthStateChange((_event, s) => {
          if (mounted) {
            setSession(s);
            setUser(s?.user ?? null);
          }
        });
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
