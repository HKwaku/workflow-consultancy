'use client';

import { useState, useEffect } from 'react';
import { getSupabaseClient } from '@/lib/supabase';
import PortalAuth from '@/app/portal/PortalAuth';

export default function TeamAuthGate({ onAuthenticated, onBack, subtitle }) {
  const [supabase, setSupabase] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const sb = getSupabaseClient();
        if (!mounted) return;
        setSupabase(sb);

        const { data: { session } } = await sb.auth.getSession();
        if (mounted && session?.user) {
          onAuthenticated(extractUser(session.user));
          return;
        }
      } catch {
        // Supabase not configured — fall through to auth form
      }
      if (mounted) setChecking(false);
    })();
    return () => { mounted = false; };
  }, [onAuthenticated]);

  if (checking) {
    return (
      <div className="screen active">
        <div className="screen-card" style={{ textAlign: 'center', padding: '3rem' }}>
          <div className="loading-spinner" />
          <p style={{ marginTop: '1rem', color: 'var(--text-mid)' }}>Checking account...</p>
        </div>
      </div>
    );
  }

  const handleAuth = (user) => {
    onAuthenticated(extractUser(user));
  };

  return (
    <div className="screen active">
      <div className="team-auth-wrap">
        {onBack && (
          <button type="button" className="mode-back-btn" onClick={onBack}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width={16} height={16}>
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back
          </button>
        )}
        <p className="team-auth-heading">{subtitle || 'Sign in to start or join a team alignment session'}</p>
        {supabase ? (
          <PortalAuth supabase={supabase} onAuthenticated={handleAuth} mode="login" />
        ) : (
          <div className="auth-card">
            <p className="auth-subtitle">Authentication service is not available. Please try again later.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function extractUser(user) {
  const email = user?.email || '';
  const name = user?.user_metadata?.full_name
    || user?.user_metadata?.name
    || email.split('@')[0]
    || '';
  return { name, email };
}
