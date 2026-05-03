'use client';

/**
 * Rail icon for the diagnostic chat that opens a small settings popover —
 * theme toggle, sign out, GDPR data export, GDPR account deletion. Replaces
 * the legacy /portal/settings page from inside the chat surface.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import { apiFetch, clearApiCache } from '@/lib/api-fetch';

export default function SettingsRailButton({ accessToken, sessionUser, onSignOut }) {
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (searchParams?.get('openSettings') === '1') setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [popPos, setPopPos] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState('');
  const [status, setStatus] = useState(null); // { kind: 'ok'|'err', text }
  const popRef = useRef(null);
  const btnRef = useRef(null);

  // Anchor the popover to the right of the gear icon. Settings sits in the
  // footer — anchoring from the bottom (instead of top) keeps the popover
  // from getting clipped by the viewport edge when its content is taller
  // than the gear's distance from the top.
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPopPos({ left: r.right + 6, bottom: window.innerHeight - r.bottom });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (popRef.current?.contains(e.target)) return;
      if (btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const exportData = async () => {
    setExporting(true);
    setStatus(null);
    try {
      const r = await apiFetch('/api/me/export-data', {}, accessToken);
      if (!r.ok) throw new Error('Export failed');
      const data = await r.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const dl = document.createElement('a');
      dl.href = URL.createObjectURL(blob);
      dl.download = `vesno-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(dl);
      dl.click();
      dl.remove();
      URL.revokeObjectURL(dl.href);
      setStatus({ kind: 'ok', text: 'Export downloaded' });
    } catch (e) {
      setStatus({ kind: 'err', text: e?.message || 'Export failed' });
    } finally {
      setExporting(false);
    }
  };

  const deleteAccount = async () => {
    setDeleting(true);
    setStatus(null);
    try {
      const r = await apiFetch(
        '/api/me/account',
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmation: 'DELETE MY ACCOUNT' }),
        },
        accessToken,
      );
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || 'Deletion failed');
      setStatus({ kind: 'ok', text: 'Account scheduled for deletion. Sign in within 30 days to cancel.' });
      setConfirmDelete('');
    } catch (e) {
      setStatus({ kind: 'err', text: e?.message || 'Deletion failed' });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="s7-split-rail-deals">
      <button
        ref={btnRef}
        type="button"
        className="s7-split-rail-btn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Settings"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
      </button>

      {open && popPos && typeof document !== 'undefined' && createPortal(
        <div
          ref={popRef}
          className="s7-split-rail-deals-pop"
          role="menu"
          style={{ position: 'fixed', left: popPos.left, bottom: popPos.bottom, minWidth: 280, maxHeight: 'calc(100vh - 24px)', overflowY: 'auto' }}
        >
          <div className="s7-split-rail-deals-head"><span>Settings</span></div>

          {sessionUser?.email && (
            <div className="s7-settings-row s7-settings-row--info">
              Signed in as <strong>{sessionUser.email}</strong>
            </div>
          )}

          <div className="s7-settings-row">
            <button type="button" className="s7-settings-btn" onClick={exportData} disabled={exporting}>
              {exporting ? 'Exporting…' : 'Export my data (GDPR)'}
            </button>
          </div>

          <div className="s7-settings-row">
            {confirmDelete === 'open' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
                <span style={{ fontSize: 11, color: 'var(--text-mid)' }}>
                  Type <code>DELETE</code> to confirm. Account is anonymised after 30 days; sign in to cancel.
                </span>
                <input
                  className="s7-settings-input"
                  value={confirmDelete === 'open' ? '' : confirmDelete}
                  onChange={(e) => setConfirmDelete(e.target.value === 'DELETE' ? 'armed' : 'open')}
                  placeholder="Type DELETE"
                />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="s7-settings-btn s7-settings-btn--danger"
                    disabled={deleting || confirmDelete !== 'armed'}
                    onClick={deleteAccount}
                  >{deleting ? 'Scheduling…' : 'Delete account'}</button>
                  <button type="button" className="s7-settings-btn" onClick={() => setConfirmDelete('')}>Cancel</button>
                </div>
              </div>
            ) : (
              <button type="button" className="s7-settings-btn s7-settings-btn--danger-outline" onClick={() => setConfirmDelete('open')}>
                Delete my account…
              </button>
            )}
          </div>

          {status && (
            <div className={`s7-settings-row s7-settings-row--${status.kind}`}>{status.text}</div>
          )}

          {onSignOut && (
            <div className="s7-settings-row">
              <button
                type="button"
                className="s7-settings-btn"
                onClick={() => {
                  setOpen(false);
                  // Wipe ALL Supabase auth storage SYNCHRONOUSLY before
                  // navigating. localStorage + sessionStorage + cookies.
                  // If we let useAuth.signOut do this async, /signin
                  // reads storage on mount, finds the still-not-cleared
                  // session, and redirects right back to /process-audit.
                  // Drop the in-memory apiFetch dedupe/cache so a new
                  // user signing in next doesn't pick up the previous
                  // user's cached responses (in particular /api/deals/…).
                  try { clearApiCache(); } catch { /* ignore */ }
                  try {
                    if (typeof window !== 'undefined') {
                      // Wipe Supabase auth keys (sb-*) AND per-user app
                      // pointers (vesno_chat_session_*, processDiagnosticProgress).
                      // Otherwise the next user to sign in on this browser
                      // inherits the previous user's chat-session pointer
                      // and gets a 404 on hydrate every page load.
                      const STALE_RE = /^(sb-|vesno_chat_session_|processDiagnosticProgress)/;
                      const wipe = (store) => {
                        if (!store) return;
                        const keys = [];
                        for (let i = 0; i < store.length; i++) {
                          const k = store.key(i);
                          if (k && STALE_RE.test(k)) keys.push(k);
                        }
                        for (const k of keys) store.removeItem(k);
                      };
                      wipe(window.localStorage);
                      wipe(window.sessionStorage);
                      // Also expire any sb-* cookies the auth helper might set.
                      if (typeof document !== 'undefined') {
                        document.cookie.split(';').forEach((c) => {
                          const eq = c.indexOf('=');
                          const name = (eq > -1 ? c.slice(0, eq) : c).trim();
                          if (/^sb-/.test(name)) {
                            document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
                          }
                        });
                      }
                    }
                  } catch { /* storage unavailable — fine */ }
                  // Skip onSignOut() here — every Supabase SDK call between
                  // the wipe and the navigation fires extra storage events +
                  // Web-Lock activity that overload page-injected content
                  // scripts (extension "message channel closed" floods).
                  // /signin?signedOut=1 already runs sb.auth.signOut({local})
                  // on mount, so local cleanup is covered.
                  //
                  // Security: still bust the per-instance auth cache so the
                  // just-revoked JWT can't be replayed for the cache TTL.
                  // Plain fetch — no SDK, no storage events. Browsers let
                  // in-flight fetches finish even after window.location
                  // navigation begins.
                  if (accessToken) {
                    try {
                      fetch('/api/auth/cache-bust', {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${accessToken}` },
                        keepalive: true,
                      }).catch(() => {});
                    } catch { /* ignore */ }
                  }
                  if (typeof window !== 'undefined') {
                    // Use replace so back-button doesn't return to chat.
                    // Cache-buster guarantees a fresh fetch even if the
                    // browser cached an older /signin page.
                    window.location.replace(`/signin?mode=login&signedOut=1&t=${Date.now()}`);
                  }
                }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
