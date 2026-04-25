'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { getSessionSafe } from '@/lib/supabase';

/** Map Supabase network / TLS failures to actionable copy (browser often shows "Failed to fetch"). */
function formatAuthError(err) {
  const name = err?.name || '';
  const msg = String(err?.message || err || '');
  if (
    name === 'AuthRetryableFetchError' ||
    /failed to fetch|networkerror|load failed|network request failed/i.test(msg)
  ) {
    return (
      'Cannot reach Supabase from this browser. Check: (1) NEXT_PUBLIC_SUPABASE_URL and ' +
      'NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local — then restart `next dev`; (2) the Supabase project is not paused; ' +
      '(3) VPN or ad-blocker is not blocking *.supabase.co; (4) Supabase → Authentication → URL configuration includes ' +
      `this origin (e.g. ${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'}).`
    );
  }
  return msg || 'Something went wrong.';
}

function PasswordField({ value, onChange, placeholder }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="auth-password-wrap">
      <input
        type={visible ? 'text' : 'password'}
        className="auth-input"
        placeholder={placeholder}
        value={value}
        onChange={onChange}
      />
      <button
        type="button"
        className="auth-password-toggle"
        onClick={() => setVisible(v => !v)}
        tabIndex={-1}
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
            <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        )}
      </button>
    </div>
  );
}

export default function PortalAuth({ supabase, onAuthenticated, mode: initialMode }) {
  const searchParams = useSearchParams();

  const urlMode = searchParams?.get('mode');
  const resolvedInitialMode = initialMode || (urlMode === 'signup' ? 'signup' : urlMode === 'forgot' ? 'forgot' : 'login');

  const [mode, setMode] = useState(resolvedInitialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  // Pre-fill email from ?email= URL param (passed from diagnostic gate)
  useEffect(() => {
    const urlEmail = searchParams?.get('email');
    if (urlEmail) setEmail(decodeURIComponent(urlEmail));
  }, [searchParams]);

  const showError = (msg) => { setError(msg); setSuccess(''); };

  const handleSignIn = async (e) => {
    e?.preventDefault();
    if (!email || !password) { showError('Please enter email and password.'); return; }
    if (!supabase) {
      showError('Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local, then restart the dev server.');
      return;
    }
    setLoading(true); setError('');
    try {
      const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) throw err;
      onAuthenticated(data.user);
    } catch (err) {
      showError(formatAuthError(err) || 'Sign in failed.');
    }
    finally { setLoading(false); }
  };

  const handleSignUp = async (e) => {
    e?.preventDefault();
    if (!email || !password) { showError('Please enter email and password.'); return; }
    if (password.length < 6) { showError('Password must be at least 6 characters.'); return; }
    if (!supabase) {
      showError('Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local, then restart the dev server.');
      return;
    }
    setLoading(true); setError('');
    try {
      const { data, error: err } = await supabase.auth.signUp({ email, password });
      if (err) throw err;
      if (data.user) onAuthenticated(data.user);
      else setSuccess('Check your email for a confirmation link.');
    } catch (err) {
      showError(formatAuthError(err) || 'Sign up failed.');
    }
    finally { setLoading(false); }
  };

  const handleForgotPassword = async (e) => {
    e?.preventDefault();
    if (!email) { showError('Please enter your email address.'); return; }
    if (!supabase) { showError('Authentication service not available. Check NEXT_PUBLIC_SUPABASE_* in .env.local and restart the dev server.'); return; }
    setLoading(true); setError(''); setSuccess('');
    try {
      const redirectUrl = window.location.origin + '/portal';
      const { error: err } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl });
      if (err) throw err;
      setSuccess('Password reset link sent! Check your email (including spam folder).');
    } catch (err) {
      showError(formatAuthError(err) || 'Failed to send reset email.');
    }
    finally { setLoading(false); }
  };

  const handleUpdatePassword = async (e) => {
    e?.preventDefault();
    if (!password || !confirmPassword) { showError('Please fill in both fields.'); return; }
    if (password.length < 6) { showError('Password must be at least 6 characters.'); return; }
    if (password !== confirmPassword) { showError('Passwords do not match.'); return; }
    if (!supabase) { showError('Authentication service not available.'); return; }
    setLoading(true); setError(''); setSuccess('');
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) throw err;
      setSuccess('Password updated successfully! Redirecting...');
      setTimeout(async () => {
        const { session } = await getSessionSafe(supabase);
        if (session?.user) onAuthenticated(session.user);
      }, 1500);
    } catch (err) {
      showError(formatAuthError(err) || 'Failed to update password. The link may have expired.');
    }
    finally { setLoading(false); }
  };

  if (mode === 'updatePassword') {
    return (
      <div className="auth-card">
        <h2>Set New Password</h2>
        <p className="auth-subtitle">Choose a new password for your account.</p>
        {error && <div className="auth-error show">{error}</div>}
        {success && <div className="auth-success show">{success}</div>}
        <form onSubmit={handleUpdatePassword}>
          <PasswordField placeholder="New password (min 6 characters)" value={password} onChange={(e) => setPassword(e.target.value)} />
          <PasswordField placeholder="Confirm new password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          <button type="submit" className="auth-btn" disabled={loading}>{loading ? 'Updating...' : 'Update Password'}</button>
        </form>
      </div>
    );
  }

  if (mode === 'forgot') {
    return (
      <div className="auth-card">
        <h2>Reset Password</h2>
        <p className="auth-subtitle">Enter your email and we&apos;ll send you a link to reset your password.</p>
        {error && <div className="auth-error show">{error}</div>}
        {success && <div className="auth-success show">{success}</div>}
        {!supabase && (
          <div className="auth-error show" role="alert">
            Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local, then restart <code style={{ fontSize: '0.85em' }}>next dev</code>.
          </div>
        )}
        <form onSubmit={handleForgotPassword}>
          <input type="email" className="auth-input" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="submit" className="auth-btn" disabled={loading || !supabase}>{loading ? 'Sending...' : 'Send Reset Link'}</button>
        </form>
        <div className="auth-toggle">
          <a onClick={() => setMode('login')} style={{ cursor: 'pointer' }}>Back to sign in</a>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-card">
      <h2>{mode === 'signup' ? 'Create Account' : 'Sign In'}</h2>
      <p className={mode === 'login' ? 'auth-subtitle auth-subtitle--signin' : 'auth-subtitle'}>
        {mode === 'signup'
          ? 'Sign up to access your dashboard. Use the same email from your process audit.'
          : 'Access your audit reports and track implementation progress.'}
      </p>
      {error && <div className="auth-error show">{error}</div>}
      {success && <div className="auth-success show">{success}</div>}
      {!supabase && (
        <div className="auth-error show" role="alert">
          Supabase is not configured in the browser. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to
          .env.local, then restart <code style={{ fontSize: '0.85em' }}>next dev</code>.
        </div>
      )}
      <form onSubmit={mode === 'signup' ? handleSignUp : handleSignIn}>
        <input type="email" className="auth-input" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
        <PasswordField placeholder={mode === 'signup' ? 'Password (min 6 characters)' : 'Password'} value={password} onChange={(e) => setPassword(e.target.value)} />
        {mode === 'login' && (
          <div style={{ textAlign: 'center', marginBottom: 12 }}>
            <a onClick={() => setMode('forgot')} style={{ fontSize: '0.82rem', color: 'var(--accent)', cursor: 'pointer' }}>Forgot password?</a>
          </div>
        )}
        <button type="submit" className="auth-btn" disabled={loading || !supabase}>
          {loading ? 'Please wait...' : mode === 'signup' ? 'Create Account' : 'Sign In'}
        </button>
      </form>
      <div className="auth-toggle">
        {mode === 'signup' ? (
          <>Already have an account? <a onClick={() => setMode('login')} style={{ cursor: 'pointer' }}>Sign in</a></>
        ) : (
          <>Don&apos;t have an account? <a onClick={() => setMode('signup')} style={{ cursor: 'pointer' }}>Sign up</a></>
        )}
      </div>
    </div>
  );
}
