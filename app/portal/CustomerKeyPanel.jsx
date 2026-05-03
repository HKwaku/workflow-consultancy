'use client';

/**
 * Customer-managed AI key panel for org admins.
 *
 * Visual design: per-vendor cards (active/unset states), modern paste form
 * with validation, audit timeline. Styles in app/portal/portal-byo.css.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import './portal-byo.css';

const SUPPORTED_VENDORS = [
  { id: 'anthropic', label: 'Anthropic',           short: 'A', placeholder: 'sk-ant-api03-...' },
  { id: 'openai',    label: 'OpenAI',              short: 'O', placeholder: 'sk-proj-... or sk-...',
    blurb: 'Bills your OpenAI account directly when an OpenAI model is used. Models still need to be added to your allowlist via the Allowed models tab; the user-facing chat picker only lists models the runtime can call today.' },
  { id: 'mistral',   label: 'Mistral (OCR)',       short: 'M', placeholder: 'mistral-...',
    blurb: 'Used for the data room OCR fallback (scanned PDFs, image uploads). Without this key, those files are stored but not text-indexed.' },
  // Voyage surfaced via the API but not yet wired in the UI.
];

function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return d; }
}
function fmtDateOnly(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString(undefined, { dateStyle: 'medium' }); } catch { return d; }
}
function daysUntil(d) {
  if (!d) return null;
  return Math.round((new Date(d).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

const ACTION_LABEL = {
  set: 'Key set',
  rotated: 'Key rotated',
  revoked: 'Key revoked',
  validated: 'Validated',
  used_first_time: 'First use',
  rotation_reminder_sent: 'Rotation reminder',
};

export default function CustomerKeyPanel({ orgId, accessToken }) {
  const [keys, setKeys] = useState([]);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [info, setInfo] = useState(null);

  const [vendor, setVendor] = useState('anthropic');
  const [draftKey, setDraftKey] = useState('');
  const [showAudit, setShowAudit] = useState(false);

  const load = useCallback(async () => {
    if (!orgId || !accessToken) return;
    setLoading(true); setErr(null);
    try {
      const [kResp, aResp] = await Promise.all([
        apiFetch(`/api/organizations/${orgId}/api-keys`, {}, accessToken),
        apiFetch(`/api/organizations/${orgId}/api-keys/audit?limit=50`, {}, accessToken),
      ]);
      const k = await kResp.json();
      const a = await aResp.json();
      if (kResp.ok) setKeys(k.keys || []); else setErr(k.error || 'Failed to load keys.');
      if (aResp.ok) setAudit(a.audit || []);
    } catch { setErr('Network error loading keys.'); }
    finally { setLoading(false); }
  }, [orgId, accessToken]);

  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null); setInfo(null); setBusy(true);
    try {
      const resp = await apiFetch(
        `/api/organizations/${orgId}/api-keys`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vendor, key: draftKey }) },
        accessToken,
      );
      const data = await resp.json();
      if (!resp.ok) setErr(data.error || 'Save failed.');
      else { setDraftKey(''); setInfo(`Saved ${data.fingerprint}.`); await load(); }
    } catch { setErr('Network error saving key.'); }
    finally { setBusy(false); }
  };

  const revoke = async (v) => {
    if (!confirm(`Revoke ${v} key for this organisation? Future calls will fall back to the platform key (and the org token budget will start applying again).`)) return;
    setBusy(true); setErr(null);
    try {
      const resp = await apiFetch(`/api/organizations/${orgId}/api-keys?vendor=${v}`, { method: 'DELETE' }, accessToken);
      if (resp.ok) { setInfo(`${v} key revoked.`); await load(); }
      else { const d = await resp.json(); setErr(d.error || 'Revoke failed.'); }
    } finally { setBusy(false); }
  };

  if (loading) return (
    <section className="byo-section">
      <div className="byo-skeleton" style={{ width: 220, marginBottom: 12, height: 18 }} />
      <div className="byo-skeleton" style={{ width: '100%', height: 80 }} />
    </section>
  );

  const activeByVendor = Object.fromEntries(
    (keys || []).filter((k) => k.status === 'active').map((k) => [k.vendor, k]),
  );

  return (
    <section className="byo-section">
      <header className="byo-header">
        <div className="byo-header-titleblock">
          <h2>AI provider API keys</h2>
          <p className="byo-header-blurb">
            Set your organisation's own key to bill LLM usage directly to your account. When set, our monthly token budget no longer applies — only your provider's billing.
          </p>
        </div>
      </header>

      {err && <div className="byo-banner byo-banner--error">⚠ {err}</div>}
      {info && <div className="byo-banner byo-banner--info">✓ {info}</div>}

      {/* Vendor cards */}
      <div className="byo-vendor-grid">
        {SUPPORTED_VENDORS.map((v) => {
          const k = activeByVendor[v.id];
          if (!k) {
            return (
              <article key={v.id} className="byo-vendor-card byo-vendor-card--unset">
                <div className="byo-vendor-icon">{v.short}</div>
                <div className="byo-vendor-body">
                  <div className="byo-vendor-toprow">
                    <span className="byo-vendor-name">{v.label}</span>
                    <span className="byo-status-pill byo-status-pill--unset">Using platform key</span>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-mid)', margin: 0 }}>
                    {v.blurb || 'No customer key set. LLM calls bill against our platform key and count toward your monthly token budget.'}
                  </p>
                </div>
                <div className="byo-vendor-actions" />
              </article>
            );
          }
          const days = daysUntil(k.rotation_due_at);
          const overdue = days != null && days <= 0;
          const soon    = days != null && days > 0 && days <= 14;
          const statusCls = overdue ? 'byo-status-pill--overdue'
                          : soon    ? 'byo-status-pill--rotate'
                          : 'byo-status-pill--active';
          const statusLabel = overdue ? `Rotation overdue ${-days}d`
                            : soon    ? `Rotate in ${days}d`
                            : 'Active';
          return (
            <article key={v.id} className="byo-vendor-card">
              <div className="byo-vendor-icon">{v.short}</div>
              <div className="byo-vendor-body">
                <div className="byo-vendor-toprow">
                  <span className="byo-vendor-name">{v.label}</span>
                  <span className={`byo-status-pill ${statusCls}`}>{statusLabel}</span>
                  <span className="byo-vendor-key">{k.key_fingerprint}</span>
                </div>
                <dl className="byo-vendor-meta">
                  <div><dt>Set by</dt><dd>{k.set_by_email}</dd></div>
                  <div><dt>Set</dt><dd>{fmtDateOnly(k.set_at)}</dd></div>
                  <div><dt>Last used</dt><dd>{k.last_used_at ? fmtDate(k.last_used_at) : 'Never'}</dd></div>
                  <div><dt>Rotation due</dt><dd>{fmtDateOnly(k.rotation_due_at)}</dd></div>
                </dl>
              </div>
              <div className="byo-vendor-actions">
                <button type="button" className="byo-btn byo-btn--danger" onClick={() => revoke(v.id)} disabled={busy}>
                  Revoke
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {/* Set / rotate form */}
      <form onSubmit={submit} className="byo-form">
        <div className="byo-form-field">
          <label className="byo-form-label" htmlFor="byo-vendor">Vendor</label>
          <select id="byo-vendor" className="byo-form-select" value={vendor} onChange={(e) => setVendor(e.target.value)} disabled={busy}>
            {SUPPORTED_VENDORS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </div>
        <div className="byo-form-field">
          <label className="byo-form-label" htmlFor="byo-key">
            {activeByVendor[vendor] ? 'Rotate to new key' : 'Paste new API key'}
          </label>
          <input
            id="byo-key"
            className="byo-form-input"
            type="password"
            value={draftKey}
            onChange={(e) => setDraftKey(e.target.value)}
            placeholder={SUPPORTED_VENDORS.find((v) => v.id === vendor)?.placeholder}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
        </div>
        <button type="submit" className="byo-btn byo-btn--primary" disabled={busy || !draftKey}>
          {busy ? 'Validating…' : (activeByVendor[vendor] ? 'Rotate key' : 'Save key')}
        </button>
      </form>

      <p className="byo-form-hint">
        <span className="byo-form-hint-icon">i</span>
        We validate the key with a single test call (~$0.000003) before storing. Stored encrypted via pgcrypto with a key in Supabase Vault. Never logged.
      </p>

      {/* Audit timeline */}
      <div className="byo-audit-toggle">
        <button type="button" className="byo-btn byo-btn--ghost" onClick={() => setShowAudit(!showAudit)}>
          {showAudit ? 'Hide audit log' : `Show audit log (${audit.length})`}
        </button>
      </div>

      {showAudit && (
        audit.length === 0 ? (
          <div className="byo-empty" style={{ marginTop: 16 }}>No audit events yet.</div>
        ) : (
          <ol className="byo-audit">
            {audit.map((row) => (
              <li key={row.id} className="byo-audit-row" data-action={row.action}>
                <div className="byo-audit-row-head">
                  <span className="byo-audit-action">{ACTION_LABEL[row.action] || row.action}</span>
                  <span className="byo-audit-when">{fmtDate(row.created_at)}</span>
                </div>
                <div className="byo-audit-meta">
                  <span>{row.vendor}</span>
                  {row.key_fingerprint && <span><code>{row.key_fingerprint}</code></span>}
                  <span>by {row.actor_email || 'system'}</span>
                </div>
              </li>
            ))}
          </ol>
        )
      )}
    </section>
  );
}
