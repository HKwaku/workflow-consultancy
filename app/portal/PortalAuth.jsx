'use client';

import { useState } from 'react';

export default function PortalAuth({ supabase, onAuthenticated, mode: initialMode }) {
  const [mode, setMode] = useState(initialMode || 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const showError = (msg) => { setError(msg); setSuccess(''); };

  const handleSignIn = async (e) => {
    e?.preventDefault();
    if (!email || !password) { showError('Please enter email and password.'); return; }
    setLoading(true); setError('');
    try {
      if (supabase) {
        const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        onAuthenticated(data.user);
      } else {
        onAuthenticated({ email });
      }
    } catch (err) { showError(err.message || 'Sign in failed.'); }
    finally { setLoading(false); }
  };

  const handleSignUp = async (e) => {
    e?.preventDefault();
    if (!email || !password) { showError('Please enter email and password.'); return; }
    if (password.length < 6) { showError('Password must be at least 6 characters.'); return; }
    setLoading(true); setError('');
    try {
      if (supabase) {
        const { data, error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
        if (data.user) onAuthenticated(data.user);
        else showError('Check your email for a confirmation link.');
      } else { onAuthenticated({ email }); }
    } catch (err) { showError(err.message || 'Sign up failed.'); }
    finally { setLoading(false); }
  };

  const handleForgotPassword = async (e) => {
    e?.preventDefault();
    if (!email) { showError('Please enter your email address.'); return; }
    setLoading(true); setError(''); setSuccess('');
    try {
      const redirectUrl = window.location.origin + '/portal';
      const { error: err } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl });
      if (err) throw err;
      setSuccess('Password reset link sent! Check your email (including spam folder).');
    } catch (err) { showError(err.message || 'Failed to send reset email.'); }
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
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) onAuthenticated(session.user);
      }, 1500);
    } catch (err) { showError(err.message || 'Failed to update password. The link may have expired.'); }
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
          <input type="password" className="auth-input" placeholder="New password (min 6 characters)" value={password} onChange={(e) => setPassword(e.target.value)} />
          <input type="password" className="auth-input" placeholder="Confirm new password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
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
        <form onSubmit={handleForgotPassword}>
          <input type="email" className="auth-input" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="submit" className="auth-btn" disabled={loading}>{loading ? 'Sending...' : 'Send Reset Link'}</button>
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
      <p className="auth-subtitle">
        {mode === 'signup'
          ? 'Sign up to access your portal. Use the same email from your diagnostic.'
          : 'Access your diagnostic reports and track implementation progress.'}
      </p>
      {error && <div className="auth-error show">{error}</div>}
      <form onSubmit={mode === 'signup' ? handleSignUp : handleSignIn}>
        <input type="email" className="auth-input" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" className="auth-input" placeholder={mode === 'signup' ? 'Password (min 6 characters)' : 'Password'} value={password} onChange={(e) => setPassword(e.target.value)} />
        {mode === 'login' && (
          <div style={{ textAlign: 'center', marginBottom: 12 }}>
            <a onClick={() => setMode('forgot')} style={{ fontSize: '0.82rem', color: 'var(--accent)', cursor: 'pointer' }}>Forgot password?</a>
          </div>
        )}
        <button type="submit" className="auth-btn" disabled={loading}>
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
