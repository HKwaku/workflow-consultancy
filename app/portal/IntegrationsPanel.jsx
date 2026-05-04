'use client';

/**
 * Org-admin Integrations panel — connect / revoke external document
 * sources. The actual document sync happens once an org admin AND a
 * deal editor (often the same person) creates a per-deal binding from
 * the workspace modal.
 *
 * UX mirrors the BYO API-keys panel: vendor cards with active/unset
 * states, connect/disconnect buttons, account-email shown when active.
 * No token data ever reaches the browser.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import './portal-byo.css';

const PROVIDER_DESCRIPTIONS = {
  sharepoint: {
    short: 'SP',
    blurb: 'Sync documents from a SharePoint or OneDrive folder. Vesno reads files via Microsoft Graph using the connecting user\'s permissions; nothing is shared beyond what they already see.',
  },
  google_drive: {
    short: 'GD',
    blurb: 'Sync documents from a Google Drive folder. Vesno reads files via the Drive API using the connecting user\'s permissions.',
  },
  datasite: {
    short: 'DS',
    blurb: 'Datasite VDR — coming soon.',
  },
  box: {
    short: 'B',
    blurb: 'Box for Business — coming soon.',
  },
};

function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return d; }
}

export default function IntegrationsPanel({ orgId, accessToken }) {
  const [data, setData] = useState({ integrations: [], catalogue: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [info, setInfo] = useState(null);

  const load = useCallback(async () => {
    if (!orgId || !accessToken) return;
    setLoading(true); setErr(null);
    try {
      const r = await apiFetch(`/api/integrations?orgId=${encodeURIComponent(orgId)}`, {}, accessToken);
      const j = await r.json();
      if (r.ok) setData({ integrations: j.integrations || [], catalogue: j.catalogue || [] });
      else setErr(j.error || 'Failed to load integrations.');
    } catch { setErr('Network error.'); }
    finally { setLoading(false); }
  }, [orgId, accessToken]);

  useEffect(() => { load(); }, [load]);

  // Surface query-param flash messages from the OAuth redirect.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const sp = new URLSearchParams(window.location.search);
    const ok = sp.get('integration_connected');
    const errParam = sp.get('integration_error');
    if (ok) setInfo(`Connected ${ok}.`);
    if (errParam) setErr(`Connection failed: ${errParam}`);
    if (ok || errParam) {
      sp.delete('integration_connected');
      sp.delete('integration_error');
      const qs = sp.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    }
  }, []);

  const connect = async (providerId) => {
    if (!orgId) return;
    setBusy(true); setErr(null);
    try {
      // Browsers don't send Authorization headers on top-level navigations,
      // so the OAuth start route can't auth us via window.location. Fetch
      // it with the Bearer token instead — it returns the Google /
      // Microsoft authorize URL plus sets the state cookie — and then
      // hand off to the provider via a normal navigation.
      const r = await apiFetch(
        `/api/integrations/${providerId}/oauth/start?orgId=${encodeURIComponent(orgId)}&returnTo=${encodeURIComponent('/portal/org-admin')}`,
        {},
        accessToken,
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.authorizeUrl) {
        setErr(j.error || 'Failed to start OAuth.');
        return;
      }
      window.location.assign(j.authorizeUrl);
    } catch (e) {
      setErr(e?.message || 'Network error.');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (providerId) => {
    if (!confirm(`Disconnect ${providerId}? Existing synced documents stay; future syncs stop.`)) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch(
        `/api/integrations?orgId=${encodeURIComponent(orgId)}&provider=${encodeURIComponent(providerId)}`,
        { method: 'DELETE' },
        accessToken,
      );
      if (r.ok) { setInfo(`${providerId} disconnected.`); await load(); }
      else { const j = await r.json(); setErr(j.error || 'Disconnect failed.'); }
    } finally { setBusy(false); }
  };

  if (loading) return (
    <section className="byo-section">
      <div className="byo-skeleton" style={{ width: 220, marginBottom: 12, height: 18 }} />
      <div className="byo-skeleton" style={{ width: '100%', height: 80 }} />
    </section>
  );

  const activeByProvider = Object.fromEntries(
    (data.integrations || []).filter((i) => i.status === 'active').map((i) => [i.provider, i]),
  );

  return (
    <section className="byo-section">
      <header className="byo-header">
        <div className="byo-header-titleblock">
          <h2>Document source integrations</h2>
          <p className="byo-header-blurb">
            Connect SharePoint, Google Drive, or another VDR to pull documents into a deal automatically. Vesno mirrors files into its data room for AI processing — your source-of-truth stays in your existing tool.
          </p>
        </div>
      </header>

      {err && <div className="byo-banner byo-banner--error">⚠ {err}</div>}
      {info && <div className="byo-banner byo-banner--info">✓ {info}</div>}

      <div className="byo-vendor-grid">
        {data.catalogue.map((p) => {
          const active = activeByProvider[p.id];
          const meta = PROVIDER_DESCRIPTIONS[p.id] || { short: p.id.slice(0, 2).toUpperCase(), blurb: '' };
          if (!active) {
            return (
              <article key={p.id} className="byo-vendor-card byo-vendor-card--unset">
                <div className="byo-vendor-icon">{meta.short}</div>
                <div className="byo-vendor-body">
                  <div className="byo-vendor-toprow">
                    <span className="byo-vendor-name">{p.label}</span>
                    <span className="byo-status-pill byo-status-pill--unset">Not connected</span>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-mid)', margin: 0 }}>{meta.blurb}</p>
                </div>
                <div className="byo-vendor-actions">
                  <button type="button" className="byo-btn byo-btn--primary" onClick={() => connect(p.id)} disabled={busy}>
                    Connect
                  </button>
                </div>
              </article>
            );
          }
          return (
            <article key={p.id} className="byo-vendor-card">
              <div className="byo-vendor-icon">{meta.short}</div>
              <div className="byo-vendor-body">
                <div className="byo-vendor-toprow">
                  <span className="byo-vendor-name">{p.label}</span>
                  <span className="byo-status-pill byo-status-pill--active">Connected</span>
                </div>
                <dl className="byo-vendor-meta">
                  <div><dt>Account</dt><dd>{active.account_email || active.display_name || '—'}</dd></div>
                  <div><dt>Connected</dt><dd>{fmtDate(active.created_at)}</dd></div>
                  <div><dt>Last sync</dt><dd>{active.last_sync_at ? fmtDate(active.last_sync_at) : 'No syncs yet'}</dd></div>
                  {active.last_sync_error && (
                    <div><dt>Last error</dt><dd style={{ color: '#dc2626' }}>{active.last_sync_error}</dd></div>
                  )}
                </dl>
              </div>
              <div className="byo-vendor-actions">
                <button type="button" className="byo-btn byo-btn--danger" onClick={() => disconnect(p.id)} disabled={busy}>
                  Disconnect
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
