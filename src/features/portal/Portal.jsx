import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import './portal.css';
import { getSupabase } from '../../lib/supabase';
import PortalAuth from './PortalAuth';
import PortalDashboard from './PortalDashboard';

export default function Portal() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [supabase, setSupabase] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const sb = await getSupabase();
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
        <div className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 28px', background: 'linear-gradient(135deg, var(--primary), #243f5c)', color: 'white' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <a href="/" style={{ color: 'white', textDecoration: 'none', fontFamily: "'Cormorant Garamond', serif", fontSize: '1.3rem', fontWeight: 700 }}>Workflow<span style={{ color: 'var(--gold)' }}>.</span></a>
            <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.15)' }} />
            <span style={{ fontSize: '0.85rem', opacity: 0.7 }}>Client Portal</span>
          </div>
        </div>
        <div className="portal-wrap" style={{ maxWidth: 960, margin: '0 auto', padding: '48px 24px' }}>
          <PortalAuth supabase={supabase} onAuthenticated={setUser} />
        </div>
      </>
    );
  }

  if (user.needsPasswordUpdate) {
    return (
      <>
        <div className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 28px', background: 'linear-gradient(135deg, var(--primary), #243f5c)', color: 'white' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <a href="/" style={{ color: 'white', textDecoration: 'none', fontFamily: "'Cormorant Garamond', serif", fontSize: '1.3rem', fontWeight: 700 }}>Workflow<span style={{ color: 'var(--gold)' }}>.</span></a>
          </div>
        </div>
        <div className="portal-wrap" style={{ maxWidth: 400, margin: '48px auto', padding: 24 }}>
          <PortalAuth supabase={supabase} onAuthenticated={setUser} mode="updatePassword" />
        </div>
      </>
    );
  }

  return (
    <div className="portal-wrap">
      <PortalDashboard user={user} onSignOut={handleSignOut} />
    </div>
  );
}
