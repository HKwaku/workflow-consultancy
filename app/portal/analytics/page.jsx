'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import { getSupabaseClient, getSessionSafe } from '@/lib/supabase';
import PortalAuth from '../PortalAuth';
import PortalDashboard from '../PortalDashboard';
import '../../../public/styles/diagnostic.css';
import '../../../public/styles/flow-canvas.css';
import '../portal.css';
import '../../../lib/modules/report/report.css';
import '../../../lib/modules/cost/cost.css';

function PortalAnalyticsContent() {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [supabase, setSupabase] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const sb = getSupabaseClient();
        if (!mounted) return;
        setSupabase(sb);
        const { session: s } = await getSessionSafe(sb);
        if (mounted) { setSession(s); setUser(s?.user ?? null); }
        sb.auth.onAuthStateChange((_event, s2) => {
          if (mounted) { setSession(s2 ?? null); setUser(s2?.user ?? null); }
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

  if (loading) {
    return (
      <div className="loading-state" style={{ padding: 60 }}>
        <div className="spinner" /><p>Loading...</p>
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
            <span className="header-title">Dashboard analytics</span>
          </div>
          <ThemeToggle className="header-theme-btn" />
        </header>
        <div className="portal-wrap" style={{ maxWidth: 960, margin: '0 auto', padding: '48px 24px' }}>
          <PortalAuth supabase={supabase} onAuthenticated={setUser} />
        </div>
      </>
    );
  }

  return (
    <PortalDashboard
      user={user}
      accessToken={session?.access_token}
      onSignOut={handleSignOut}
      initialSection="analytics"
    />
  );
}

export default function PortalAnalyticsPage() {
  return (
    <Suspense fallback={<div className="loading-state" style={{ padding: 60 }}><div className="spinner" /><p>Loading...</p></div>}>
      <PortalAnalyticsContent />
    </Suspense>
  );
}
