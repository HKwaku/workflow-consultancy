'use client';

/**
 * ModelPicker — pill above the chat input. Lets the user pick which model
 * Reina uses for this session.
 *
 * Behaviour:
 *   - Hydrates instantly from sessionStorage if a recent payload exists; then
 *     re-fetches /api/me/models in the background and reconciles. Picker
 *     never blocks first paint.
 *   - Auto-default by phase: if the user hasn't manually picked, the picker
 *     tracks the suggested model for the current chat phase
 *     (see modelCatalogue.suggestedModelIdForPhase).
 *   - Sticks for the session: any user pick disables auto-default for the
 *     rest of the session. Reload resets.
 *   - Hides itself when the allowlist has 0 or 1 entries (no choice to make).
 *   - Filters out `unsupported` models server-side (see /api/me/models).
 *
 * Props:
 *   accessToken      string
 *   selected         current selected model id (parent state)
 *   onChange         (id) => void
 *   phase            current chat phase ('intake'|'map'|'details'|'cost'|'complete')
 *   hasAttachments   boolean — if true, suggest fast tier
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import '@/components/org-admin/org-admin-byo.css';

// Bump this version when the payload shape changes OR when the platform
// allowlist expands — keeps stale browser caches from poisoning the first
// paint with a one-model payload that the user can't change.
const SS_KEY = 'vesno_models_v4';
const SS_TTL_MS = 5 * 60_000; // 5 min — second visits feel instant. Admin changes propagate within 5 min OR on next sessionStorage clear.

// Optimistic placeholder shown WHILE /api/me/models is in flight. Picked to
// match the platform default so the rendered label is correct in the most
// common case. The user can't open the popover until real data arrives —
// that part stays loader-gated to avoid showing a misleading allowlist.
const OPTIMISTIC_PLACEHOLDER = {
  id: 'claude-sonnet-4-6',
  label: 'Claude Sonnet 4.6',
  tier: 'chat',
  blurb: 'Default for chat and deal analysis.',
};

function loadFromSession() {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.expiresAt || parsed.expiresAt < Date.now()) return null;
    return parsed.payload;
  } catch { return null; }
}

function saveToSession(payload) {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(SS_KEY, JSON.stringify({ payload, expiresAt: Date.now() + SS_TTL_MS }));
  } catch { /* quota or disabled */ }
}

// Replicates modelCatalogue.suggestedModelIdForPhase but client-side, so we
// don't pull the whole catalogue module down to the browser. The picker only
// has the per-allowlist subset returned by /api/me/models, which already
// carries `tier` per item.
function suggestForPhase({ allowed, phase, hasAttachments }) {
  if (!Array.isArray(allowed) || allowed.length === 0) return null;
  const tier = hasAttachments  ? 'fast'
             : phase === 'intake' ? 'fast'
             : 'chat';
  return allowed.find((m) => m.tier === tier && !m.deprecated)?.id
      || allowed.find((m) => m.tier === tier)?.id
      || allowed.find((m) => !m.deprecated)?.id
      || allowed[0].id;
}

export default function ModelPicker({
  accessToken, selected, onChange,
  phase, hasAttachments,
}) {
  const [data, setData] = useState(() => loadFromSession());
  const [open, setOpen] = useState(false);
  const popRef = useRef(null);
  // True once the user explicitly picks; suppresses phase-driven auto-default.
  const userOverrideRef = useRef(false);

  // Background fetch + reconcile. Always runs once on mount; cache makes the
  // first render fast even when the network is slow.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const resp = await apiFetch('/api/me/models', {}, accessToken);
        if (!resp.ok) return;
        const json = await resp.json();
        if (cancelled) return;
        setData(json);
        saveToSession(json);
      } catch { /* swallow — picker just doesn't render */ }
    };
    load();
    return () => { cancelled = true; };
  }, [accessToken]);

  // Auto-default by phase. Re-runs when phase changes (only if the user
  // hasn't manually overridden). The first run also handles the
  // initial-load case (picker has data but selected is null).
  useEffect(() => {
    if (userOverrideRef.current) return;
    if (!data?.allowed?.length || typeof onChange !== 'function') return;
    const suggested = suggestForPhase({
      allowed: data.allowed,
      phase, hasAttachments,
    });
    if (suggested && suggested !== selected) onChange(suggested);
    // We deliberately omit `selected` from deps — auto-defaulting on every
    // selection change would loop. The override flag is the gate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, phase, hasAttachments]);

  // Close popover on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (popRef.current && !popRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const activeModel = useMemo(() => {
    const id = selected || data?.default;
    return data?.allowed?.find((m) => m.id === id) || null;
  }, [selected, data]);

  // The `suggested` id for the current phase — used to mark "(suggested)" in
  // the popover so the user can see what auto-default would have chosen.
  const suggestedId = useMemo(() => suggestForPhase({
    allowed: data?.allowed || [],
    phase, hasAttachments,
  }), [data, phase, hasAttachments]);

  // OPTIMISTIC PLACEHOLDER: while we're waiting for /api/me/models on first
  // load, render a pill immediately so the chat input doesn't shift around
  // when the data arrives. The popover is disabled (no real data yet).
  if (!data) {
    return (
      <div className="model-picker">
        <button
          type="button"
          className="model-picker-pill"
          disabled
          title="Loading models…"
          aria-busy="true"
        >
          <span className="model-picker-pill-dot" style={{ animation: 'model-picker-pop 1.2s ease-in-out infinite alternate' }} />
          <span className="model-picker-pill-label">{OPTIMISTIC_PLACEHOLDER.label}</span>
        </button>
      </div>
    );
  }

  if (!data.allowed || data.allowed.length === 0) return null;
  // Special case: only one model available — show it as a static pill so the
  // user can SEE which model they're on, but skip the popover (no choice).
  if (data.allowed.length === 1) {
    const only = data.allowed[0];
    return (
      <div className="model-picker">
        <button type="button" className="model-picker-pill" disabled title={only.blurb || only.label}>
          <span className="model-picker-pill-dot" />
          <span className="model-picker-pill-label">{only.label}</span>
        </button>
      </div>
    );
  }

  const handlePick = (id) => {
    userOverrideRef.current = true;
    onChange?.(id);
    setOpen(false);
  };

  return (
    <div className="model-picker" ref={popRef}>
      <button
        type="button"
        className="model-picker-pill"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="Select the model for this conversation"
      >
        <span className="model-picker-pill-dot" />
        <span className="model-picker-pill-label">
          {activeModel?.label || 'Select model'}
        </span>
        <span className="model-picker-pill-chev" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="model-picker-pop" role="listbox" aria-label="Choose a model">
          <div className="model-picker-pop-head">
            <span>Model for this chat</span>
            {data.source === 'platform' && <span className="model-picker-pop-headhint">Platform default</span>}
            {data.source === 'org'      && <span className="model-picker-pop-headhint">Your org's allowlist</span>}
            {data.source === 'byo-default' && <span className="model-picker-pop-headhint">Your BYO key</span>}
          </div>
          <ul className="model-picker-list">
            {data.allowed.map((m) => {
              const isActive = (selected || data.default) === m.id;
              const isSuggested = !userOverrideRef.current && m.id === suggestedId;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    className={`model-picker-item ${isActive ? 'is-active' : ''}`}
                    onClick={() => handlePick(m.id)}
                  >
                    <div className="model-picker-item-row">
                      <span className="model-picker-item-name">
                        {m.label}
                        {isSuggested && !isActive && (
                          <span className="model-picker-suggest-tag"> · suggested</span>
                        )}
                      </span>
                      <span className={`model-picker-item-tier model-picker-item-tier--${m.tier}`}>
                        {m.tier === 'deep' ? 'Opus' : m.tier === 'fast' ? 'Haiku' : 'Sonnet'}
                      </span>
                    </div>
                    {m.blurb && <p className="model-picker-item-blurb">{m.blurb}</p>}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="model-picker-pop-foot">
            {data.hasCustomerKey
              ? "Calls bill to your org's Anthropic key."
              : "Calls bill to the platform key & count toward your org budget."}
          </div>
        </div>
      )}
    </div>
  );
}
