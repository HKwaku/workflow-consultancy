'use client';

/**
 * Per-user settings: GDPR data export + account deletion.
 * Mounted at /portal/settings.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/useAuth';
import { apiFetch } from '@/lib/api-fetch';
import '../portal-byo.css';

const REQUIRED_CONFIRMATION = 'DELETE MY ACCOUNT';

export default function SettingsClient() {
  const { user, accessToken, loading: authLoading } = useAuth();
  const [delStatus, setDelStatus] = useState(null);
  const [confirmationInput, setConfirmationInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [info, setInfo] = useState(null);
  const [exportingNow, setExportingNow] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    (async () => {
      const resp = await apiFetch('/api/me/account', {}, accessToken);
      if (resp.ok) setDelStatus((await resp.json()).deletionRequest);
    })();
  }, [accessToken]);

  if (authLoading) return <div className="portal-viewport"><p>Loading…</p></div>;
  if (!user) return (
    <div className="portal-viewport">
      <p>You need to sign in to see your settings. <Link href="/portal">Sign in</Link></p>
    </div>
  );

  const downloadExport = async () => {
    setErr(null); setInfo(null); setExportingNow(true);
    try {
      const resp = await fetch('/api/me/export-data', { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        setErr(j.error || `Export failed (${resp.status}).`);
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vesno-data-export-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setInfo('Your data export has been downloaded.');
    } catch (e) { setErr('Network error.'); }
    finally { setExportingNow(false); }
  };

  const requestDeletion = async () => {
    if (confirmationInput !== REQUIRED_CONFIRMATION) {
      setErr(`Type ${REQUIRED_CONFIRMATION} exactly to proceed.`);
      return;
    }
    setBusy(true); setErr(null); setInfo(null);
    try {
      const resp = await apiFetch(
        '/api/me/account',
        { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation: REQUIRED_CONFIRMATION }) },
        accessToken,
      );
      const json = await resp.json();
      if (!resp.ok) { setErr(json.error || 'Failed to schedule deletion.'); return; }
      setDelStatus(json.deletionRequest);
      setInfo(json.message);
      setConfirmationInput('');
    } finally { setBusy(false); }
  };

  const cancelDeletion = async () => {
    setBusy(true); setErr(null); setInfo(null);
    try {
      const resp = await apiFetch(
        '/api/me/account',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }) },
        accessToken,
      );
      if (!resp.ok) { setErr('Failed to cancel.'); return; }
      const fresh = await apiFetch('/api/me/account', {}, accessToken);
      setDelStatus(fresh.ok ? (await fresh.json()).deletionRequest : null);
      setInfo('Deletion cancelled. Your account is active again.');
    } finally { setBusy(false); }
  };

  return (
    <div className="portal-viewport">
      <div style={{ maxWidth: 800, margin: '40px auto', padding: '0 24px' }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: 8 }}>Settings</h1>
        <p style={{ color: 'var(--text-mid)', marginBottom: 32 }}>
          Signed in as <strong>{user.email}</strong>.
          {' '}<Link href="/portal" style={{ color: 'var(--accent-light)' }}>Back to dashboard</Link>
        </p>

        {err  && <div className="byo-banner byo-banner--error">⚠ {err}</div>}
        {info && <div className="byo-banner byo-banner--info">✓ {info}</div>}

        {/* ── Data export (GDPR Art. 20) ───────────────────────────── */}
        <section className="byo-section">
          <header className="byo-header">
            <div className="byo-header-titleblock">
              <h2>Download your data</h2>
              <p className="byo-header-blurb">
                Get a JSON copy of every diagnostic, chat session, deal you own, and document you uploaded.
                Document bytes are not included — download them individually from the deal page.
              </p>
            </div>
          </header>
          <button type="button" className="byo-btn byo-btn--primary" disabled={exportingNow} onClick={downloadExport}>
            {exportingNow ? 'Preparing…' : 'Download my data (JSON)'}
          </button>
        </section>

        {/* ── Delete account (GDPR Art. 17) ────────────────────────── */}
        <section className="byo-section">
          <header className="byo-header">
            <div className="byo-header-titleblock">
              <h2>Delete account</h2>
              <p className="byo-header-blurb">
                Schedule your account for permanent deletion. You'll have <strong>30 days</strong> to cancel by signing back in.
                After that, your personal data is anonymised. Deals you own are transferred to the platform admin so collaborators retain access.
                Chat messages stay (they may include other users' content) but your email is redacted everywhere.
              </p>
            </div>
          </header>

          {delStatus?.status === 'pending' ? (
            <div>
              <div className="byo-banner byo-banner--info" style={{ marginBottom: 16 }}>
                Your account is scheduled for deletion on <strong>{new Date(delStatus.expunge_after).toLocaleString()}</strong>.
              </div>
              <button type="button" className="byo-btn byo-btn--primary" disabled={busy} onClick={cancelDeletion}>
                Cancel deletion
              </button>
            </div>
          ) : delStatus?.status === 'completed' ? (
            <p style={{ color: 'var(--text-mid)' }}>Your account was deleted on {new Date(delStatus.completed_at).toLocaleString()}.</p>
          ) : (
            <div>
              <p style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 12 }}>
                Type <code style={{ background: 'var(--surface-alt)', padding: '2px 6px', borderRadius: 4 }}>{REQUIRED_CONFIRMATION}</code> below to confirm.
              </p>
              <input
                type="text"
                className="byo-form-input"
                style={{ width: '100%', maxWidth: 360, marginBottom: 12 }}
                value={confirmationInput}
                onChange={(e) => setConfirmationInput(e.target.value)}
                placeholder={REQUIRED_CONFIRMATION}
                disabled={busy}
              />
              <div>
                <button
                  type="button"
                  className="byo-btn byo-btn--danger"
                  disabled={busy || confirmationInput !== REQUIRED_CONFIRMATION}
                  onClick={requestDeletion}
                >
                  {busy ? 'Scheduling…' : 'Schedule account deletion'}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
