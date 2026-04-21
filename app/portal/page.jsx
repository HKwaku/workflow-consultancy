'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import { useSearchParams } from 'next/navigation';
import { getSupabaseClient, getSessionSafe } from '@/lib/supabase';
import PortalAuth from './PortalAuth';
import PortalDashboard from './PortalDashboard';
import '../../public/styles/diagnostic.css';
import '../../public/styles/flow-canvas.css';
import './portal.css';
import '../../lib/modules/report/report.css';
import '../../lib/modules/cost/cost.css';

function PortalContent() {
  const searchParams = useSearchParams();
  const editFromUrl = searchParams.get('edit');
  const returnTo = searchParams.get('returnTo');
  const forceDashboard = searchParams.get('dashboard') === '1';
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [supabase, setSupabase] = useState(null);

  // After sign-in, redirect back to where the user came from, or to the chat
  const handleAuthenticated = (authenticatedUser) => {
    if (returnTo) {
      window.location.href = returnTo;
    } else if (editFromUrl || forceDashboard) {
      setUser(authenticatedUser);
    } else {
      window.location.href = '/process-audit';
    }
  };

  useEffect(() => {
    if (editFromUrl && user?.email && typeof window !== 'undefined') {
      window.location.href = `/process-audit?edit=${encodeURIComponent(editFromUrl)}&email=${encodeURIComponent(user.email)}`;
    }
  }, [editFromUrl, user]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const sb = getSupabaseClient();
        if (!mounted) return;
        setSupabase(sb);

        const { session: s } = await getSessionSafe(sb);
        if (mounted) {
          setSession(s);
          setUser(s?.user ?? null);
        }

        sb.auth.onAuthStateChange((event, s) => {
          if (event === 'PASSWORD_RECOVERY' && s?.user) {
            setUser({ ...s.user, needsPasswordUpdate: true });
            setSession(s);
          } else if (mounted) {
            setSession(s ?? null);
            setUser(s?.user ?? null);
          }
        });
      } catch (e) {
        console.warn('Supabase init failed:', e.message);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const handleSignOut = async () => {
    if (supabase) await supabase.auth.signOut();
    setSession(null);
    setUser(null);
  };

  if (loading || (editFromUrl && user?.email)) {
    return (
      <div className="loading-state" style={{ padding: 60 }}>
        <div className="spinner" />
        <p>Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <header className="dashboard-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Link href="/" className="header-logo">Vesno<span style={{ color: 'var(--gold)' }}>.</span></Link>
            <div className="header-divider" />
            <span className="header-title">Sign in</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <ThemeToggle className="header-theme-btn" />
          </div>
        </header>
        <div className="portal-wrap" style={{ maxWidth: 960, margin: '0 auto', padding: '48px 24px' }}>
          <PortalAuth supabase={supabase} onAuthenticated={handleAuthenticated} />
        </div>
      </>
    );
  }

  if (user.needsPasswordUpdate) {
    return (
      <>
        <header className="dashboard-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Link href="/" className="header-logo">Vesno<span style={{ color: 'var(--gold)' }}>.</span></Link>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <ThemeToggle className="header-theme-btn" />
          </div>
        </header>
        <div className="portal-wrap" style={{ maxWidth: 400, margin: '48px auto', padding: 24 }}>
          <PortalAuth supabase={supabase} onAuthenticated={setUser} mode="updatePassword" />
        </div>
      </>
    );
  }

  // Signed-in users without a specific edit/returnTo/dashboard action land in the chat
  if (!editFromUrl && !returnTo && !forceDashboard && typeof window !== 'undefined') {
    window.location.replace('/process-audit');
    return <div className="loading-state" style={{ padding: 60 }}><div className="spinner" /></div>;
  }

  return <PortalDashboard user={user} accessToken={session?.access_token} onSignOut={handleSignOut} />;
}

export default function PortalPage() {
  return (
    <Suspense fallback={<div className="loading-state" style={{ padding: 60 }}><div className="spinner" /><p>Loading...</p></div>}>
      <PortalContent />
    </Suspense>
  );
}
