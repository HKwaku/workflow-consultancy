'use client';

/**
 * WorkspaceContextStrip — banner pinned at the top of the chat surface
 * for signed-in users with an operating model. Tells the user "you're
 * inside a workspace, this isn't a one-off audit" with one glance, and
 * is the model switcher: because Home lands here, this is where a user
 * sees the active model and can switch / create another (one org per
 * user by design — these are models within that org).
 *
 * Renders nothing for:
 *   - anonymous / not-signed-in users
 *   - signed-in users with no org / no default model
 *   - chats already scoped to a deal (the deal context chip covers it)
 *   - edit-mode chats (the existing target-mode/redesign-mode bars cover it)
 */

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import { useDiagnostic } from '@/components/diagnostic/DiagnosticContext';

export default function WorkspaceContextStrip({ accessToken, hide }) {
  const [model, setModel]   = useState(null);
  const [counts, setCounts] = useState(null);
  const [open, setOpen]     = useState(false);
  const [models, setModels] = useState(null); // lazy: loaded when the menu opens
  const [busy, setBusy]     = useState(false);
  const wrapRef = useRef(null);
  const { selectedOperatingModelId, selectedOperatingModelName } = useDiagnostic();

  useEffect(() => {
    if (!accessToken || hide) return;
    let cancelled = false;
    (async () => {
      try {
        let modelId = selectedOperatingModelId;
        let modelName = selectedOperatingModelName;
        if (!modelId) {
          const meResp = await apiFetch('/api/me/operating-model', {}, accessToken);
          const me = meResp.ok ? await meResp.json() : null;
          if (cancelled || !me?.modelId) return;
          modelId = me.modelId;
        }
        const [rollupResp, modelResp] = await Promise.all([
          apiFetch(`/api/operating-models/${modelId}/rollup`, {}, accessToken),
          apiFetch(`/api/operating-models/${modelId}`,         {}, accessToken),
        ]);
        if (cancelled) return;
        const rollup = rollupResp.ok ? await rollupResp.json() : null;
        const m      = modelResp.ok  ? await modelResp.json()  : null;
        setModel({ id: modelId, name: modelName || m?.model?.name || 'Operating model' });
        setCounts({
          processes: rollup?.totals?.processes ?? 0,
          unfiled:   rollup?.unfiledProcesses ?? 0,
        });
      } catch { /* swallow — strip just doesn't render */ }
    })();
    return () => { cancelled = true; };
  }, [accessToken, hide, selectedOperatingModelId, selectedOperatingModelName]);

  // Close the menu on outside click / Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && models === null && accessToken) {
      try {
        const r = await apiFetch('/api/me/operating-models', {}, accessToken);
        const d = r.ok ? await r.json() : null;
        setModels(Array.isArray(d?.models) ? d.models : []);
      } catch { setModels([]); }
    }
  };

  // Switch / create then hard-navigate to /workspace/map so the whole
  // shell re-resolves against the new active model (same as Home).
  const go = () => { if (typeof window !== 'undefined') window.location.assign('/workspace/map'); };

  const switchTo = async (id) => {
    if (busy || id === model?.id) { setOpen(false); return; }
    setBusy(true);
    try {
      await apiFetch('/api/me/operating-models', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: id }),
      }, accessToken);
      go();
    } catch { setBusy(false); }
  };

  const createModel = async () => {
    if (busy) return;
    const name = (typeof window !== 'undefined' && window.prompt('Name the new operating model:'))?.trim();
    if (!name) return;
    setBusy(true);
    try {
      const r = await apiFetch('/api/me/operating-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }, accessToken);
      const d = await r.json();
      if (!r.ok || d?.error) throw new Error(d?.error || 'create failed');
      go(); // POST already activated it
    } catch { setBusy(false); }
  };

  if (hide || !model || !counts) return null;

  const menu = {
    position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 50,
    minWidth: 220, maxWidth: 320, maxHeight: 280, overflow: 'auto',
    background: 'var(--bg, #fff)', border: '1px solid var(--border, #e2e8f0)',
    borderRadius: 8, boxShadow: '0 8px 24px rgba(15,23,42,0.16)', padding: 4,
  };
  const itemBase = {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
    padding: '7px 9px', fontSize: 13, border: 'none', background: 'transparent',
    cursor: 'pointer', textAlign: 'left', borderRadius: 6, fontFamily: 'inherit',
    color: 'var(--text, #1e293b)',
  };

  return (
    <div className="s7-workspace-context-bar" role="status">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="6" cy="6" r="2"/>
        <circle cx="18" cy="6" r="2"/>
        <circle cx="12" cy="18" r="2"/>
        <line x1="8" y1="7" x2="11" y2="16"/>
        <line x1="16" y1="7" x2="13" y2="16"/>
      </svg>
      <span>
        Working in{' '}
        <span ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
          <button
            type="button"
            onClick={toggle}
            disabled={busy}
            title="Switch or create an operating model"
            style={{
              border: 'none', background: 'transparent', cursor: 'pointer',
              font: 'inherit', fontWeight: 700, color: 'inherit', padding: 0,
              textDecoration: 'underline dotted', textUnderlineOffset: 3,
            }}
          >
            {busy ? 'Switching…' : model.name} <span aria-hidden style={{ fontSize: '0.7em' }}>{'▾'}</span>
          </button>
          {open && (
            <div style={menu} role="menu">
              {models === null && <div style={{ padding: '7px 9px', fontSize: 12, color: 'var(--text-mid,#64748b)' }}>Loading…</div>}
              {models && models.length === 0 && <div style={{ padding: '7px 9px', fontSize: 12, color: 'var(--text-mid,#64748b)' }}>No models.</div>}
              {models && models.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="menuitem"
                  onClick={() => switchTo(m.id)}
                  style={{ ...itemBase, ...(m.id === model.id ? { background: 'var(--accent-muted, rgba(13,148,136,0.10))', fontWeight: 600 } : null) }}
                >
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name || '(unnamed)'}</span>
                  {m.id === model.id && <span style={{ fontSize: 10, color: '#0d9488', fontWeight: 700 }}>ACTIVE</span>}
                  {m.isDefault && m.id !== model.id && <span style={{ fontSize: 10, color: 'var(--text-mid,#94a3b8)' }}>default</span>}
                </button>
              ))}
              <div style={{ borderTop: '1px solid var(--border,#e2e8f0)', margin: '4px 0' }} />
              <button type="button" role="menuitem" onClick={createModel} style={{ ...itemBase, color: '#0d9488', fontWeight: 600 }}>
                + New model
              </button>
            </div>
          )}
        </span>
        {counts.processes > 0 && (
          <> · {counts.processes} process{counts.processes === 1 ? '' : 'es'}</>
        )}
        {counts.processes === 0 && (
          <> · <span className="s7-workspace-context-warn" title="Nothing is analysed until a process exists. Describe one in the chat and Reina maps it into this model.">no processes yet — describe one to map it</span></>
        )}
        {counts.unfiled > 0 && (
          <> · <span className="s7-workspace-context-warn" title="Unfiled = mapped but not yet placed under a function. File them from the workspace process list so cost / bottleneck / automation roll-ups include them.">{counts.unfiled} unfiled</span></>
        )}
      </span>
      <button
        type="button"
        className="s7-workspace-context-link s7-workspace-context-link--btn"
        onClick={() => {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('vesno:open-workspace'));
          }
        }}
      >
        Open workspace
      </button>
    </div>
  );
}
