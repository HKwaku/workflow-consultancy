'use client';

/**
 * Workspace home — function tree + process list + rollup stats. Becomes
 * the user's primary surface for "what does our operating model look like."
 *
 * On mount:
 *   1. resolve user → default operating model via /api/me/operating-model
 *   2. parallel-load: model (full), rollup, processes
 *   3. render the four panes (header / rollup / functions / processes)
 *
 * Falls back to a "create-an-org" CTA when the user has no org or no
 * default model — the workspace is org-scoped by design.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/useAuth';
import { apiFetch } from '@/lib/api-fetch';
import CapabilityTree from '@/components/workspace/CapabilityTree';
import {
  augmentFunctionsWithOther, scopeForFunction, processInScope, countsByFunction,
} from '@/lib/operatingModel/functionTree';
import ProcessesPanel from '@/components/workspace/ProcessesPanel';
import InsightsPanel from '@/components/workspace/InsightsPanel';
import AnalysisPanel from '@/components/workspace/AnalysisPanel';
import WorkspaceInventory from '@/components/workspace/WorkspaceInventory';
import WorkspaceMap from '@/components/workspace/WorkspaceMap';
import WorkspaceGraph from '@/components/workspace/WorkspaceGraph';
import WorkspaceDealsTab from '@/components/workspace/WorkspaceDealsTab';
import WorkspaceOutputsTab from '@/components/workspace/WorkspaceOutputsTab';
import WorkspaceScopeNav from '@/components/workspace/WorkspaceScopeNav';
import { useSearchParams } from 'next/navigation';

function Money(n) {
  if (n == null) return '—';
  if (Math.abs(n) >= 1_000_000) return `£${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000)     return `£${(n / 1_000).toFixed(0)}k`;
  return `£${Math.round(n)}`;
}

// Suppress the auto-generated description from migration 37's backfill
// ("Default model created by migration 37. Edit name + add capabilities…").
// Real org-authored descriptions still render.
function isMigrationBoilerplate(text) {
  if (!text) return false;
  return /Default model created by migration|add capabilities to start designing/i.test(text);
}

function StatTile({ label, value, sub }) {
  return (
    <div className="ws-stat">
      <div className="ws-stat-value">{value}</div>
      <div className="ws-stat-label">{label}</div>
      {sub && <div className="ws-stat-sub">{sub}</div>}
    </div>
  );
}

export default function WorkspaceClient({ embedded = false, modelId: modelIdOverride = null } = {}) {
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();
  const [resolution, setResolution]     = useState(null); // { modelId, ... } | { reason }
  const [model, setModel]               = useState(null);
  const [rollup, setRollup]             = useState(null);
  const [processes, setProcesses]       = useState(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [selectedFuncId, setSelectedFuncId] = useState(null);
  // ?view=deals / ?view=outputs promote the top-level scopes; analytics
  // is no longer a scope (consolidated into the 'analysis' tab).
  // Otherwise this is the per-context tab id (list/map/graph/...).
  const searchParams = useSearchParams();
  const initialView = (() => {
    const v = searchParams.get('view');
    if (v === 'deals' || v === 'outputs') return v;
    if (v === 'analytics') return 'analysis'; // legacy links → Analysis tab
    if (['list', 'map', 'graph', 'fte', 'inventory', 'insights', 'analysis'].includes(v)) return v;
    return 'graph';
  })();
  const [view, setView] = useState(initialView);
  const isScopeView = view === 'deals' || view === 'outputs';

  // Step 1: resolve user → default model. When `modelId` is passed
  // explicitly (canvas overlay drilling into a non-default model), use
  // it directly and skip the /api/me/operating-model lookup. This
  // makes switching models from the in-canvas picker actually load
  // the picked model instead of the user's default.
  useEffect(() => {
    if (modelIdOverride) {
      setResolution({ modelId: modelIdOverride });
      setLoading(false);
      return;
    }
    if (authLoading) return;
    if (!accessToken) { setLoading(false); return; }
    let cancelled = false;
    apiFetch('/api/me/operating-model', {}, accessToken)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`me/operating-model ${r.status}`)))
      .then((data) => { if (!cancelled) setResolution(data); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [authLoading, accessToken, modelIdOverride]);

  // Step 2: parallel-load model + rollup + processes once resolved
  const loadAll = useCallback(async () => {
    if (!resolution?.modelId || !accessToken) return;
    setLoading(true);
    try {
      const [m, r, p] = await Promise.all([
        apiFetch(`/api/operating-models/${resolution.modelId}`, {}, accessToken).then((x) => x.ok ? x.json() : null),
        apiFetch(`/api/operating-models/${resolution.modelId}/rollup`, {}, accessToken).then((x) => x.ok ? x.json() : null),
        apiFetch(`/api/operating-models/${resolution.modelId}/processes`, {}, accessToken).then((x) => x.ok ? x.json() : null),
      ]);
      setModel(m);
      setRollup(r);
      setProcesses(p?.processes || []);
    } finally {
      setLoading(false);
    }
  }, [resolution, accessToken]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Chat-driven mutations (propose_add_function / role / system) dispatch
  // `vesno:workspace-changed` after a successful Confirm. Listen for it and
  // re-fetch so the canvas shows the new row immediately.
  useEffect(() => {
    if (!resolution?.modelId || !accessToken) return undefined;
    const onChange = () => { loadAll(); };
    window.addEventListener('vesno:workspace-changed', onChange);
    return () => window.removeEventListener('vesno:workspace-changed', onChange);
  }, [resolution, accessToken, loadAll]);

  // Chat-driven navigation: the Model agent's open_workspace_view +
  // focus_function tools fire these events; we react inline so the chat
  // can drive the canvas without the user clicking tabs.
  useEffect(() => {
    const onSetView = (e) => {
      const v = e?.detail?.view;
      if (v && ['list', 'map', 'graph', 'fte', 'inventory', 'insights', 'analysis'].includes(v)) {
        setView(v);
      }
    };
    const onFocusFunction = (e) => {
      // null clears the filter; '__unfiled__' sentinel maps to the unfiled bucket.
      setSelectedFuncId(e?.detail?.functionId ?? null);
    };
    window.addEventListener('vesno:set-workspace-view', onSetView);
    window.addEventListener('vesno:focus-function', onFocusFunction);
    return () => {
      window.removeEventListener('vesno:set-workspace-view', onSetView);
      window.removeEventListener('vesno:focus-function', onFocusFunction);
    };
  }, []);

  // Refresh handlers — passed into child components so a CRUD action can
  // refresh exactly what changed without a full reload.
  const refreshModel    = useCallback(async () => {
    if (!resolution?.modelId || !accessToken) return;
    const m = await apiFetch(`/api/operating-models/${resolution.modelId}`, {}, accessToken).then((x) => x.ok ? x.json() : null);
    if (m) setModel(m);
  }, [resolution, accessToken]);
  const refreshRollup   = useCallback(async () => {
    if (!resolution?.modelId || !accessToken) return;
    const r = await apiFetch(`/api/operating-models/${resolution.modelId}/rollup`, {}, accessToken).then((x) => x.ok ? x.json() : null);
    if (r) setRollup(r);
  }, [resolution, accessToken]);
  const refreshProcesses = useCallback(async () => {
    if (!resolution?.modelId || !accessToken) return;
    const p = await apiFetch(`/api/operating-models/${resolution.modelId}/processes`, {}, accessToken).then((x) => x.ok ? x.json() : null);
    if (p) setProcesses(p.processes || []);
  }, [resolution, accessToken]);

  // Augmented function tree (+ "Other" sub-functions) shared by the
  // sidebar, the List filter, and (via the same helper) the Graph — so
  // all three show the identical hierarchy and counts.
  const aug = useMemo(
    () => augmentFunctionsWithOther(model?.functions || [], processes || []),
    [model, processes],
  );
  const funcCounts = useMemo(
    () => countsByFunction(aug.flat, processes || [], aug.parentsWithDirect),
    [aug, processes],
  );

  const filteredProcesses = useMemo(() => {
    if (!processes) return [];
    if (selectedFuncId == null) return processes;
    if (selectedFuncId === '__unfiled__') return processes.filter((p) => !p.function_id);
    // Subtree (incl. "Other") + touches scope, so picking a parent
    // collects every process beneath it and spanning processes surface
    // under each function they touch.
    const scope = scopeForFunction(aug.flat, selectedFuncId);
    return processes.filter((p) => processInScope(p, scope, aug.parentsWithDirect));
  }, [processes, selectedFuncId, aug]);

  /* ── Render gates ─────────────────────────────────────────── */

  if (authLoading || (loading && !resolution)) {
    return <div className="ws-shell ws-empty">Loading workspace…</div>;
  }

  if (!user) {
    return (
      <div className="ws-shell ws-empty">
        <h1>Workspace</h1>
        <p>Sign in to access your operating-model workspace.</p>
        <Link href="/signin?returnTo=/workspace" className="ws-cta">Sign in</Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ws-shell ws-empty">
        <h1>Workspace</h1>
        <p className="ws-error">Couldn&apos;t load your workspace: {error}</p>
        <button type="button" className="ws-cta" onClick={loadAll}>Retry</button>
      </div>
    );
  }

  if (resolution && !resolution.modelId) {
    // No org or no default model — the workspace is org-scoped.
    return (
      <div className="ws-shell ws-empty">
        <h1>Workspace</h1>
        <p>
          {resolution.reason === 'no_org'
            ? 'You’re not yet a member of an organisation. The workspace is the org’s shared design surface; create one to get started.'
            : 'Your organisation doesn’t have a default operating model yet. An org admin can create one from org admin.'}
        </p>
        <Link href="/org-admin" className="ws-cta">Open org admin</Link>
        <p className="ws-empty-sub">Or just map a process directly: <Link href="/workspace/map">/workspace/map</Link></p>
      </div>
    );
  }

  if (!model) {
    return <div className="ws-shell ws-empty">Loading model…</div>;
  }

  const isAdmin = !!model.isAdmin;

  // Plain-click handler for the scope nav: switches view in-place
  // (no route change). New-tab clicks fall through to the Link href.
  const onScopeSelect = (scope) => setView(scope === 'standard' ? 'graph' : scope);

  // Scope-views (Deals / Analytics) take over the full surface and
  // hide the per-context header + tabs + stats. The scope nav stays
  // visible at the top so the user can switch back to Standard.
  if (isScopeView) {
    return (
      <div className="ws-shell">
        {!embedded && <WorkspaceScopeNav active={view} onSelect={onScopeSelect} />}
        {view === 'deals' && <WorkspaceDealsTab accessToken={accessToken} />}
        {view === 'outputs' && (
          <WorkspaceOutputsTab modelId={resolution?.modelId || null} accessToken={accessToken} />
        )}
      </div>
    );
  }

  return (
    <div className="ws-shell">
      {!embedded && <WorkspaceScopeNav active="standard" onSelect={onScopeSelect} />}
      <header className="ws-header">
        {/* Top row: title block on the left, primary action + admin link on the right */}
        <div className="ws-header-top">
          <div className="ws-header-titles">
            <h1>{model.model.name}</h1>
            <span className={`ws-kind ws-kind--${model.model.kind}`}>{model.model.kind.replace('_', ' ')}</span>
            <span className={`ws-status ws-status--${model.model.status}`}>{model.model.status}</span>
            {isAdmin
              ? <span className="ws-badge ws-badge--admin">Admin</span>
              : <span className="ws-badge">Member</span>}
          </div>
        </div>

        {/* Description — suppress the migration boilerplate so the header stays clean */}
        {model.model.description && !isMigrationBoilerplate(model.model.description) && (
          <p className="ws-description">{model.model.description}</p>
        )}

        {/* View tabs — own row, prominent */}
        <div className="ws-tabs" role="tablist" aria-label="Workspace view">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'graph'}
            className={`ws-tab${view === 'graph' ? ' ws-tab--active' : ''}`}
            onClick={() => setView('graph')}
          >Graph</button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'list'}
            className={`ws-tab${view === 'list' ? ' ws-tab--active' : ''}`}
            onClick={() => setView('list')}
          >List</button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'map'}
            className={`ws-tab${view === 'map' ? ' ws-tab--active' : ''}`}
            onClick={() => setView('map')}
          >Map</button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'fte'}
            className={`ws-tab${view === 'fte' ? ' ws-tab--active' : ''}`}
            onClick={() => setView('fte')}
          >FTE</button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'inventory'}
            className={`ws-tab${view === 'inventory' ? ' ws-tab--active' : ''}`}
            onClick={() => setView('inventory')}
          >Canonical inventory</button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'insights'}
            className={`ws-tab${view === 'insights' ? ' ws-tab--active' : ''}`}
            onClick={() => setView('insights')}
          >Insights</button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'analysis'}
            className={`ws-tab${view === 'analysis' ? ' ws-tab--active' : ''}`}
            onClick={() => setView('analysis')}
          >Analysis</button>
        </div>
      </header>

      <section className="ws-stats">
        <StatTile
          label="Processes"
          value={rollup?.totals?.processes ?? '—'}
          sub={rollup?.unfiledProcesses ? `${rollup.unfiledProcesses} unfiled` : null}
        />
        <StatTile label="FTE (modelled)" value={rollup?.totals?.fte ?? '—'} />
        <StatTile label="Annual cost"     value={Money(rollup?.totals?.annualCost)} />
        <StatTile label="Potential savings" value={Money(rollup?.totals?.potentialSavings)} />
        <StatTile
          label="Avg automation"
          value={rollup?.totals?.avgAutomationPct != null ? `${rollup.totals.avgAutomationPct}%` : '—'}
        />
      </section>

      {view === 'fte' ? (
        <FteBreakdown
          rollup={rollup}
          roles={model.roles || []}
          functions={model.functionsFlat || []}
        />
      ) : view === 'inventory' ? (
        <WorkspaceInventory
          modelId={resolution.modelId}
          roles={model.roles || []}
          systems={model.systems || []}
          functions={model.functionsFlat || []}
          isAdmin={isAdmin}
          accessToken={accessToken}
          onChanged={() => { refreshModel(); refreshRollup(); }}
        />
      ) : view === 'insights' ? (
        <InsightsPanel
          modelId={resolution.modelId}
          accessToken={accessToken}
          isAdmin={isAdmin}
          functions={model.functionsFlat || []}
          // Tab context: skip the internal "+ Insights" collapsible.
          // The tab itself is the expand affordance; an extra click would
          // hide the heatmap and the user wouldn't know it was there.
          forceOpen
          onCapabilitySelect={(funcId) => {
            // Heatmap row click → scope the processes panel to that function
            // (or the unfiled bucket sentinel) and switch back to the List
            // view so the user sees the filtered list immediately.
            setSelectedFuncId(funcId);
            setView('list');
          }}
        />
      ) : view === 'analysis' ? (
        <AnalysisPanel
          modelId={resolution.modelId}
          accessToken={accessToken}
          functions={model.functionsFlat || []}
        />
      ) : view === 'graph' ? (
        <WorkspaceGraph
          functions={model.functions}
          processes={processes || []}
          onSelect={(funcId) => {
            // Double-click a function in the graph → drill back to list
            // filtered to that function (same UX as the Map's click).
            setSelectedFuncId(funcId);
            setView('list');
          }}
          onProcessOpen={(processId) => {
            // Double-click a process bar → silently swap the canvas to
            // that process. The DiagnosticWorkspace host listens for
            // vesno:open-process and routes through its open_process
            // action (no route change, no remount, chat thread intact).
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('vesno:open-process', {
                detail: { reportId: processId, intent: 'view' },
              }));
            }
          }}
        />
      ) : view === 'map' ? (
        <WorkspaceMap
          functions={model.functions}
          processes={processes || []}
          roles={model.roles || []}
          rollup={rollup}
          onSelect={(funcId) => {
            setSelectedFuncId(funcId);
            setView('list');
          }}
        />
      ) : (
        <div className="ws-grid">
          <aside className="ws-pane ws-pane--functions">
            <CapabilityTree
              modelId={resolution.modelId}
              functions={aug.tree}
              countsById={funcCounts}
              rollup={rollup}
              isAdmin={isAdmin}
              accessToken={accessToken}
              selectedFuncId={selectedFuncId}
              onSelect={setSelectedFuncId}
              onChanged={() => { refreshModel(); refreshRollup(); }}
            />
          </aside>

          <main className="ws-pane ws-pane--processes">
            <ProcessesPanel
              modelId={resolution.modelId}
              processes={filteredProcesses}
              allCapabilities={model.functionsFlat}
              selectedFuncId={selectedFuncId}
              accessToken={accessToken}
              onChanged={() => { refreshProcesses(); refreshRollup(); }}
              onProcessClick={(p) => {
                // Embedded inside DiagnosticClient via /workspace or
                // opened as the workspace overlay on /workspace/map:
                // dispatch the silent-canvas-swap event handled by
                // DiagnosticWorkspace. If no host is listening (e.g.
                // future standalone surface), the Link's default
                // navigation still fires via the natural href.
                if (typeof window === 'undefined') return;
                window.dispatchEvent(new CustomEvent('vesno:open-process', {
                  detail: { reportId: p.id, intent: 'view' },
                }));
              }}
            />
          </main>
        </div>
      )}

    </div>
  );
}

/* ── FTE breakdown tab ──────────────────────────────────────────────
 * A focused view of how FTE / headcount is distributed:
 *   - Per-function rows from the rollup (already step-driven if any
 *     roles are cited on steps; otherwise an equal split across the
 *     role's function_ids — see lib/operatingModel/repo.js).
 *   - Per-role rows showing headcount and the function tags.
 *
 * No new data fetches — both inputs come from the parent's existing
 * `rollup.byFunction` and `model.roles` payloads.
 */
function FteBreakdown({ rollup, roles, functions }) {
  const totalFte = rollup?.totals?.fte ?? 0;
  const byFunction = (rollup?.byFunction || [])
    .filter((b) => (b.fte || 0) > 0)
    .sort((a, b) => (b.fte || 0) - (a.fte || 0));
  const funcsById = new Map((functions || []).map((f) => [f.id, f]));
  const roleRows = (roles || [])
    .map((r) => ({
      ...r,
      function_names: (r.function_ids || []).map((id) => funcsById.get(id)?.name).filter(Boolean),
    }))
    .sort((a, b) => (b.headcount || 0) - (a.headcount || 0));
  return (
    <section className="ws-pane ws-fte-tab" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14 }}>
      <div className="ws-insight-card">
        <h3>FTE by function <span className="ws-insight-sub">{byFunction.length} row{byFunction.length === 1 ? '' : 's'} &middot; {totalFte} FTE total</span></h3>
        {byFunction.length === 0 ? (
          <div className="ws-empty-inline" style={{ margin: 0 }}>
            No FTE attribution yet. Add roles with headcount and tag them to functions.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-mid, #64748b)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <th style={{ padding: '6px 8px' }}>Function</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>FTE</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Share</th>
              </tr>
            </thead>
            <tbody>
              {byFunction.map((b) => (
                <tr key={b.functionId || '__unfiled__'} style={{ borderTop: '1px solid var(--border, #e2e8f0)' }}>
                  <td style={{ padding: '8px' }}>{b.name}</td>
                  <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600 }}>{b.fte}</td>
                  <td style={{ padding: '8px', textAlign: 'right', color: 'var(--text-mid, #64748b)' }}>
                    {totalFte > 0 ? `${Math.round((b.fte / totalFte) * 100)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="ws-insight-card">
        <h3>FTE by role <span className="ws-insight-sub">{roleRows.length} role{roleRows.length === 1 ? '' : 's'}</span></h3>
        {roleRows.length === 0 ? (
          <div className="ws-empty-inline" style={{ margin: 0 }}>
            No roles in the operating model yet.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-mid, #64748b)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <th style={{ padding: '6px 8px' }}>Role</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>FTE</th>
                <th style={{ padding: '6px 8px' }}>Functions</th>
              </tr>
            </thead>
            <tbody>
              {roleRows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--border, #e2e8f0)' }}>
                  <td style={{ padding: '8px' }}>
                    <div style={{ fontWeight: 500 }}>{r.name}</div>
                    {r.owner_email && (
                      <div style={{ fontSize: 11, color: 'var(--text-mid, #64748b)' }}>{r.owner_email}</div>
                    )}
                  </td>
                  <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600 }}>{r.headcount || 0}</td>
                  <td style={{ padding: '8px', color: 'var(--text-mid, #64748b)', fontSize: 12 }}>
                    {r.function_names.length ? r.function_names.join(', ') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
