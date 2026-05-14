'use client';

/**
 * ModelAllowlistPanel — admin UI for picking which models the org's users
 * can choose from in the chat picker.
 *
 * Shape:
 *   - Lists every catalogue model with checkbox + radio (default).
 *   - Tier badge per model + cost hint per 1M tokens.
 *   - Save → PATCH /api/organizations/[orgId]/models with the picked set.
 *   - Reset → PATCH with allowed=null (use platform default).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import './org-admin-byo.css';

function tierLabel(t) {
  return t === 'deep' ? 'Opus' : t === 'fast' ? 'Haiku' : 'Sonnet';
}

export default function ModelAllowlistPanel({ orgId, accessToken }) {
  const [view, setView] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [info, setInfo] = useState(null);

  // Working copy — diverges from `view` until Save.
  const [draftAllowed, setDraftAllowed] = useState(null);  // Set<string>
  const [draftDefault, setDraftDefault] = useState(null);

  const load = useCallback(async () => {
    if (!orgId || !accessToken) return;
    setLoading(true); setErr(null);
    try {
      const resp = await apiFetch(`/api/organizations/${orgId}/models`, {}, accessToken);
      const json = await resp.json();
      if (!resp.ok) { setErr(json.error || 'Failed to load.'); return; }
      setView(json);
      setDraftAllowed(new Set(json.catalogue.filter((m) => m.allowed).map((m) => m.id)));
      setDraftDefault(json.resolvedDefault || null);
    } catch { setErr('Network error loading models.'); }
    finally { setLoading(false); }
  }, [orgId, accessToken]);

  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(() => {
    if (!view || !draftAllowed) return false;
    const cur = new Set(view.catalogue.filter((m) => m.allowed).map((m) => m.id));
    if (cur.size !== draftAllowed.size) return true;
    for (const id of cur) if (!draftAllowed.has(id)) return true;
    return draftDefault !== view.resolvedDefault;
  }, [view, draftAllowed, draftDefault]);

  const toggle = (id) => {
    if (!draftAllowed) return;
    const next = new Set(draftAllowed);
    if (next.has(id)) {
      next.delete(id);
      // If we just removed the current default, fall back to first remaining.
      if (draftDefault === id) setDraftDefault(next.size > 0 ? Array.from(next)[0] : null);
    } else {
      next.add(id);
      // First time we add a model, make it default.
      if (!draftDefault) setDraftDefault(id);
    }
    setDraftAllowed(next);
  };

  const save = async () => {
    setBusy(true); setErr(null); setInfo(null);
    try {
      const allowed = Array.from(draftAllowed);
      if (allowed.length === 0) { setErr('Select at least one model.'); return; }
      const resp = await apiFetch(
        `/api/organizations/${orgId}/models`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowed, default: draftDefault }) },
        accessToken,
      );
      const json = await resp.json();
      if (!resp.ok) { setErr(json.error || 'Save failed.'); return; }
      setView(json);
      setInfo('Allowed models updated.');
    } catch { setErr('Network error saving.'); }
    finally { setBusy(false); }
  };

  const reset = async () => {
    if (!confirm('Reset to platform default? Users will see the platform allowlist instead of your custom list.')) return;
    setBusy(true); setErr(null); setInfo(null);
    try {
      const resp = await apiFetch(
        `/api/organizations/${orgId}/models`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowed: null, default: null }) },
        accessToken,
      );
      const json = await resp.json();
      if (!resp.ok) { setErr(json.error || 'Reset failed.'); return; }
      setView(json);
      setDraftAllowed(new Set(json.catalogue.filter((m) => m.allowed).map((m) => m.id)));
      setDraftDefault(json.resolvedDefault || null);
      setInfo('Reset to platform default.');
    } finally { setBusy(false); }
  };

  if (loading) {
    return (
      <section className="byo-section">
        <div className="byo-skeleton" style={{ width: 240, height: 18, marginBottom: 12 }} />
        <div className="byo-skeleton" style={{ width: '100%', height: 80 }} />
      </section>
    );
  }
  if (!view) return null;

  return (
    <section className="byo-section">
      <header className="byo-header">
        <div className="byo-header-titleblock">
          <h2>Allowed models</h2>
          <p className="byo-header-blurb">
            Pick which Anthropic models your users can select from in the chat. The default is pre-selected when they open a new conversation; they can switch any time. Other surfaces (deal analysis, recommendations) use the platform tier defaults.
          </p>
        </div>
        <span className={`byo-status-pill ${view.source === 'org' ? 'byo-status-pill--active' : 'byo-status-pill--unset'}`}>
          {view.source === 'org' ? 'Custom list' : view.source === 'byo-default' ? 'BYO default' : 'Platform default'}
        </span>
      </header>

      {err  && <div className="byo-banner byo-banner--error">⚠ {err}</div>}
      {info && <div className="byo-banner byo-banner--info">✓ {info}</div>}

      {/* Group by vendor — Anthropic first, then OpenAI (or whatever else). */}
      {(() => {
        const groups = view.catalogue
          .filter((m) => !m.deprecated)
          .reduce((acc, m) => {
            const v = m.vendor || 'anthropic';
            (acc[v] ||= []).push(m);
            return acc;
          }, {});
        const order = ['anthropic', 'openai'];
        const vendorIds = [...order.filter((v) => groups[v]), ...Object.keys(groups).filter((v) => !order.includes(v))];

        return vendorIds.map((vendor) => (
          <div key={vendor} className="model-allowlist-group">
            <h3 className="model-allowlist-group-title">
              {vendor === 'anthropic' ? 'Anthropic' : vendor === 'openai' ? 'OpenAI' : vendor}
              <span className="model-allowlist-group-count">{groups[vendor].length}</span>
            </h3>
            <ul className="model-allowlist">
              {groups[vendor].map((m) => {
                const checked = draftAllowed?.has(m.id);
                const isDefault = draftDefault === m.id;
                return (
                  <li key={m.id} className={`model-allowlist-row ${checked ? 'is-checked' : ''} ${m.unsupported ? 'is-unsupported' : ''}`}>
                    <label className="model-allowlist-check">
                      <input
                        type="checkbox"
                        checked={!!checked}
                        onChange={() => toggle(m.id)}
                        disabled={busy}
                      />
                      <span className="model-allowlist-checkbox" aria-hidden="true" />
                    </label>
                    <div className="model-allowlist-body">
                      <div className="model-allowlist-toprow">
                        <span className="model-allowlist-name">{m.label}</span>
                        <span className={`model-picker-item-tier model-picker-item-tier--${m.tier}`}>
                          {tierLabel(m.tier)}
                        </span>
                        {m.unsupported && (
                          <span className="model-allowlist-soon">Coming soon</span>
                        )}
                      </div>
                      <p className="model-allowlist-blurb">{m.blurb}</p>
                      <div className="model-allowlist-cost">
                        ${m.inputCostPer1M}/M input · ${m.outputCostPer1M}/M output · {(m.contextWindow / 1000).toFixed(0)}k ctx
                      </div>
                    </div>
                    <label className={`model-allowlist-default ${!checked ? 'is-disabled' : ''}`}>
                      <input
                        type="radio"
                        name="default-model"
                        checked={isDefault}
                        disabled={!checked || busy || m.unsupported}
                        onChange={() => setDraftDefault(m.id)}
                      />
                      <span>Default</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ));
      })()}

      <div className="model-allowlist-actions">
        <button type="button" className="byo-btn" disabled={busy} onClick={reset}>
          Reset to platform default
        </button>
        <button type="button" className="byo-btn byo-btn--primary" disabled={busy || !dirty} onClick={save}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </section>
  );
}
