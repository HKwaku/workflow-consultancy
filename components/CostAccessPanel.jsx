'use client';

/**
 * CostAccessPanel — report owner UI to manage who can see cost data.
 *
 * Reads/writes the `costAuthorizedEmails` list for a report via
 * `/api/cost-authorized-emails`. The owner is always authorised and
 * rendered read-only. Accepts `accessToken` so it can be embedded on
 * pages that hold the Supabase session.
 */

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import { getSupabaseClient, getSessionSafe } from '@/lib/supabase';

function normalize(email) {
  return String(email || '').trim().toLowerCase();
}

export default function CostAccessPanel({ reportId, accessToken: accessTokenProp, onChange }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [hidden, setHidden] = useState(false); // 403 → not the owner, hide entirely
  const [ownerEmail, setOwnerEmail] = useState('');
  const [emails, setEmails] = useState([]);
  const [draft, setDraft] = useState('');
  const [accessToken, setAccessToken] = useState(accessTokenProp || null);

  useEffect(() => {
    if (accessTokenProp) { setAccessToken(accessTokenProp); return; }
    let cancelled = false;
    (async () => {
      try {
        const sb = getSupabaseClient();
        const { session } = await getSessionSafe(sb);
        if (!cancelled) setAccessToken(session?.access_token || null);
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [accessTokenProp]);

  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};

  useEffect(() => {
    let cancelled = false;
    if (!reportId) { setLoading(false); return; }

    (async () => {
      try {
        setLoading(true);
        setError('');
        const resp = await apiFetch(`/api/cost-authorized-emails?id=${encodeURIComponent(reportId)}`, { headers });
        const data = await resp.json();
        if (cancelled) return;
        if (resp.status === 403) { setHidden(true); return; }
        if (!resp.ok) {
          setError(data.error || 'Failed to load cost access.');
          return;
        }
        setOwnerEmail(data.ownerEmail || '');
        setEmails(data.authorizedEmails || []);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load cost access.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId, accessToken]);

  const persist = useCallback(async (next) => {
    setSaving(true);
    setError('');
    try {
      const resp = await apiFetch('/api/cost-authorized-emails', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ reportId, authorizedEmails: next }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error || 'Failed to update cost access.');
        return false;
      }
      setEmails(data.authorizedEmails || []);
      onChange?.(data.authorizedEmails || []);
      return true;
    } catch (err) {
      setError(err.message || 'Failed to update cost access.');
      return false;
    } finally {
      setSaving(false);
    }
  }, [reportId, accessToken, onChange]);

  const handleAdd = async (e) => {
    e.preventDefault();
    const value = normalize(draft);
    if (!value) return;
    if (value === ownerEmail) { setError('Owner is already authorised.'); return; }
    if (emails.includes(value)) { setDraft(''); return; }
    const ok = await persist([...emails, value]);
    if (ok) setDraft('');
  };

  const handleRemove = async (email) => {
    await persist(emails.filter((e) => e !== email));
  };

  if (hidden) return null;

  if (loading) {
    return (
      <section className="cap-root">
        <header className="cap-header"><h3 className="cap-title">Cost access</h3></header>
        <p className="cap-loading">Loading…</p>
      </section>
    );
  }

  return (
    <section className="cap-root">
      <header className="cap-header">
        <h3 className="cap-title">Cost access</h3>
        <p className="cap-subtitle">
          Who can view cost data for this report. The owner always has access.
        </p>
      </header>

      <ul className="cap-list">
        {ownerEmail && (
          <li className="cap-item cap-item--owner">
            <span className="cap-item-email">{ownerEmail}</span>
            <span className="cap-item-role">Owner</span>
          </li>
        )}
        {emails.map((email) => (
          <li key={email} className="cap-item">
            <span className="cap-item-email">{email}</span>
            <button
              type="button"
              className="cap-item-remove"
              onClick={() => handleRemove(email)}
              disabled={saving}
              aria-label={`Remove ${email}`}
            >
              Remove
            </button>
          </li>
        ))}
        {emails.length === 0 && (
          <li className="cap-item cap-item--empty">No additional analysts yet.</li>
        )}
      </ul>

      <form className="cap-add-form" onSubmit={handleAdd}>
        <input
          type="email"
          className="cap-add-input"
          placeholder="analyst@company.com"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={saving}
          required
        />
        <button type="submit" className="button button-primary cap-add-btn" disabled={saving || !draft}>
          Add
        </button>
      </form>

      {error && <p className="cap-error" role="alert">{error}</p>}
    </section>
  );
}
