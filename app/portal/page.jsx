'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getSupabaseClient } from '@/lib/supabase';
import PortalAuth from './PortalAuth';
import PortalDashboard from './PortalDashboard';
import './portal.css';

export default function PortalPage() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [supabase, setSupabase] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const sb = getSupabaseClient();
        if (!mounted) return;
        setSupabase(sb);

        const { data: { session } } = await sb.auth.getSession();
        if (mounted && session?.user) setUser(session.user);

        sb.auth.onAuthStateChange((event, session) => {
          if (event === 'PASSWORD_RECOVERY') {
            setUser({ ...session?.user, needsPasswordUpdate: true });
          } else if (session?.user) {
            setUser(session.user);
          } else {
            setUser(null);
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
    setUser(null);
  };

  if (loading) {
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
            <Link href="/" className="header-logo">Workflow<span style={{ color: 'var(--gold)' }}>.</span></Link>
            <div className="header-divider" />
            <span className="header-title">Dashboard</span>
          </div>
        </header>
        <div className="portal-wrap" style={{ maxWidth: 960, margin: '0 auto', padding: '48px 24px' }}>
          <PortalAuth supabase={supabase} onAuthenticated={setUser} />
        </div>
      </>
    );
  }

  if (user.needsPasswordUpdate) {
    return (
      <>
        <header className="dashboard-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Link href="/" className="header-logo">Workflow<span style={{ color: 'var(--gold)' }}>.</span></Link>
          </div>
        </header>
        <div className="portal-wrap" style={{ maxWidth: 400, margin: '48px auto', padding: 24 }}>
          <PortalAuth supabase={supabase} onAuthenticated={setUser} mode="updatePassword" />
        </div>
      </>
    );
  }

  return <PortalDashboard user={user} onSignOut={handleSignOut} />;
}
