'use client';

/**
 * /signin?returnTo=...&mode=login|signup
 *
 * Lightweight sign-in surface used by the diagnostic SignInRequired gate.
 * Hosts the existing SignInForm UI and redirects to `returnTo` once the
 * user is authenticated. If they're already signed in on mount, redirects
 * immediately.
 */

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import { getSupabaseClient, getSessionSafe } from '@/lib/supabase';
import SignInForm from '@/components/auth/SignInForm';
import '@/components/org-admin/org-admin.css';

function SignInContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams?.get('returnTo') || '/workspace/map';
  const mode = searchParams?.get('mode') === 'signup' ? 'signup' : 'login';
  // Set by the Sign-out flow. Skip *all* session-check logic and
  // render the form immediately — never await anything that could
  // stall the page. Defence against the perpetual-spinner bug.
  const justSignedOut = searchParams?.get('signedOut') === '1';

  const [supabase, setSupabase] = useState(null);
  // Skip the loading gate entirely when arriving via Sign out. We
  // already wiped localStorage synchronously in the rail handler;
  // the form should render on first paint.
  const [loading, setLoading] = useState(!justSignedOut);
  const [user, setUser] = useState(null);

  useEffect(() => {
    let mounted = true;

    if (justSignedOut) {
      // Render the form right now. Init the supabase client (so
      // SignInForm can call signInWithPassword), and fire a fully
      // fire-and-forget local signOut to mop up any leftover state.
      // No await — if Supabase JS deadlocks, we don't care.
      try {
        const sb = getSupabaseClient();
        if (mounted) setSupabase(sb);
        sb?.auth?.signOut({ scope: 'local' })?.catch?.(() => {});
      } catch { /* surface only if it ever stops working — see history */ }
      return () => { mounted = false; };
    }

    (async () => {
      try {
        const sb = getSupabaseClient();
        if (!mounted) return;
        setSupabase(sb);
        const { session } = await getSessionSafe(sb);
        if (!mounted) return;
        if (session?.user) {
          setUser(session.user);
          router.replace(returnTo);
          return;
        }
      } catch { /* fall through to setLoading(false) so the form renders */ }
      if (mounted) setLoading(false);
    })();
    return () => { mounted = false; };
  }, [router, returnTo, justSignedOut]);

  // Once SignInForm fires onAuthenticated we redirect.
  const onAuthed = (u) => {
    setUser(u);
    router.replace(returnTo);
  };

  if (loading || user) {
    return (
      <div className="loading-state" style={{ padding: 60 }}>
        <div className="spinner" /><p>Loading…</p>
      </div>
    );
  }

  return (
    <>
      <header className="dashboard-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Link href="/" className="header-logo">
            Vesno<span style={{ color: 'var(--gold)' }}>.</span>
          </Link>
          <div className="header-divider" />
          <span className="header-title">{mode === 'signup' ? 'Create your account' : 'Sign in'}</span>
        </div>
        <ThemeToggle className="header-theme-btn" />
      </header>
      <div className="portal-wrap" style={{ maxWidth: 520, margin: '0 auto', padding: '48px 24px' }}>
        <SignInForm supabase={supabase} onAuthenticated={onAuthed} mode={mode} />
      </div>
    </>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="loading-state" style={{ padding: 60 }}><div className="spinner" /></div>}>
      <SignInContent />
    </Suspense>
  );
}
