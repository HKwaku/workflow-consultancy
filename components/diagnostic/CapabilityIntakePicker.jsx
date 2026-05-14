'use client';

/**
 * CapabilityIntakePicker — shown in the AuditGate when the signed-in
 * user has a default operating model. The picked function lands on
 * the new diagnostic_report row at insert time so the process is filed
 * straight into the workspace, not the Unfiled bucket.
 *
 * Renders nothing for users with no model (no org / no membership) so
 * the gate stays simple for first-time visitors.
 *
 * Props:
 *   accessToken — required; the picker only fires when authenticated
 *   onChange({ operatingModelId, functionId, modelName, functionPath })
 *
 * The function select uses the flat function list with parent
 * prefixes ("Finance / AR / Cash collection") so a one-level select
 * carries hierarchy without a cascading UI.
 */

import { useEffect, useState, useMemo } from 'react';
import { apiFetch } from '@/lib/api-fetch';

export default function CapabilityIntakePicker({ accessToken, onChange }) {
  const [resolution, setResolution] = useState(null); // { modelId } | { reason }
  const [model, setModel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState('');

  /* Step 1: resolve user → default model */
  useEffect(() => {
    if (!accessToken) { setLoading(false); return; }
    let cancelled = false;
    apiFetch('/api/me/operating-model', {}, accessToken)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (!cancelled) setResolution(data); })
      .catch(() => { if (!cancelled) setResolution(null); });
    return () => { cancelled = true; };
  }, [accessToken]);

  /* Step 2: load model + functions once we know the modelId */
  useEffect(() => {
    if (!resolution?.modelId || !accessToken) { setLoading(false); return; }
    let cancelled = false;
    apiFetch(`/api/operating-models/${resolution.modelId}`, {}, accessToken)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (!cancelled) setModel(data); })
      .catch(() => { /* swallow */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [resolution, accessToken]);

  /* Compute path-prefixed labels — Finance / AR / Cash collection */
  const optionRows = useMemo(() => {
    const flat = model?.functionsFlat || [];
    if (!flat.length) return [];
    const byId = new Map(flat.map((c) => [c.id, c]));
    const pathFor = (id, seen = new Set()) => {
      const c = byId.get(id);
      if (!c || seen.has(id)) return [];
      seen.add(id);
      if (!c.parent_function_id) return [c.name];
      return [...pathFor(c.parent_function_id, seen), c.name];
    };
    return flat
      .map((c) => ({ id: c.id, label: pathFor(c.id).join(' / ') }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [model]);

  /* Notify parent when picked changes */
  useEffect(() => {
    if (!resolution?.modelId) return;
    const cap = optionRows.find((o) => o.id === picked);
    onChange?.({
      operatingModelId: resolution.modelId,
      functionId: picked || null,
      modelName: model?.model?.name || null,
      functionPath: cap?.label || null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, resolution, model]);

  /* Render gates — emit nothing for users without a model */
  if (loading) return null;
  if (!resolution?.modelId) return null;
  if (!model) return null;

  return (
    <div className="function-intake-picker">
      <label htmlFor="function-intake-select">
        File this process under
        <span className="function-intake-model"> · {model.model.name}</span>
      </label>
      {optionRows.length > 0 ? (
        <>
          <select
            id="function-intake-select"
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
          >
            <option value="">Don&apos;t file yet (Unfiled)</option>
            {optionRows.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          <p className="function-intake-hint">
            The audit will land in your workspace already filed under the picked function.
            Pick &quot;Don&apos;t file yet&quot; to triage it later.
          </p>
        </>
      ) : (
        <p className="function-intake-hint">
          Your model has no functions yet. The audit will land in the Unfiled bucket — file it from the workspace later.
          {model.isAdmin && <> Or <a href={`/workspace`}>open the workspace</a> to add Finance, Sales, Operations, etc.</>}
        </p>
      )}
    </div>
  );
}
