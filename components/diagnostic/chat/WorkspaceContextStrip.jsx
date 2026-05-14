'use client';

/**
 * WorkspaceContextStrip — banner pinned at the top of the chat surface
 * for signed-in users with an operating model. Tells the user "you're
 * inside a workspace, this isn't a one-off audit" with one glance.
 *
 * Renders nothing for:
 *   - anonymous / not-signed-in users
 *   - signed-in users with no org / no default model
 *   - chats already scoped to a deal (the deal context chip covers it)
 *   - edit-mode chats (the existing target-mode/redesign-mode bars cover it)
 *
 * Layout matches s7-target-mode-bar / s7-redesign-mode-bar so it sits
 * cleanly in the same banner stack at the top of s7-workspace.
 */

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import { useDiagnostic } from '@/components/diagnostic/DiagnosticContext';

export default function WorkspaceContextStrip({ accessToken, hide }) {
  const [model, setModel]       = useState(null);
  const [counts, setCounts]     = useState(null);
  // Read context anchors so picking a non-default model in the canvas
  // overlay's Standard picker reflects in the chat banner immediately.
  // Falls back to /api/me/operating-model when no context anchor is set.
  const { selectedOperatingModelId, selectedOperatingModelName } = useDiagnostic();

  useEffect(() => {
    if (!accessToken || hide) return;
    let cancelled = false;
    (async () => {
      try {
        // Resolve the active model id: context anchor wins (user picked
        // a non-default model), default falls back via /api/me.
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

  if (hide || !model || !counts) return null;

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
        Working in <strong>{model.name}</strong>
        {counts.processes > 0 && (
          <> · {counts.processes} process{counts.processes === 1 ? '' : 'es'}</>
        )}
        {counts.unfiled > 0 && (
          <> · <span className="s7-workspace-context-warn">{counts.unfiled} unfiled</span></>
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
