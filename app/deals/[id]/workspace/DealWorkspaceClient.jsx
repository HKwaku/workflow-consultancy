'use client';

/**
 * DealWorkspaceClient - the workspace tabs (List / Map / Graph / FTE /
 * Canonical inventory / Insights) over a DEAL rather than an
 * operating model.
 *
 * Synthesis:
 *   - functions   = deal participants (acquirer + target for M&A;
 *                   platform + portfolios for PE roll-ups). Each
 *                   participant becomes a top-level "function".
 *   - processes   = deal flows; each flow points to a diagnostic
 *                   report and inherits its function via the
 *                   participant. Step minutes / cost / savings come
 *                   from the report's diagnostic_data, same shape
 *                   the workspace uses.
 *   - rollup      = computed in-memory by aggregating per-process cost
 *                   / savings / minutes. No model_roles in deal scope,
 *                   so the FTE column stays 0 unless we infer from the
 *                   participant's report.
 *   - insights    = computeFunctionHeatmap + computeChangeRoiSummary
 *                   work as-is once the data is in heatmap shape.
 *
 * Reuses WorkspaceMap / WorkspaceGraph / InsightsPanel etc. so the
 * UI is identical to /workspace.
 */

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/useAuth';
import { apiFetch } from '@/lib/api-fetch';
import WorkspaceMap from '@/components/workspace/WorkspaceMap';
import WorkspaceGraph from '@/components/workspace/WorkspaceGraph';
import InsightsPanel from '@/components/workspace/InsightsPanel';
import ProcessesPanel from '@/components/workspace/ProcessesPanel';
import CapabilityTree from '@/components/workspace/CapabilityTree';
import WorkspaceScopeNav from '@/components/workspace/WorkspaceScopeNav';
import { deriveCostByFunction } from '@/lib/processMetrics';

function Money(n) {
  if (n == null) return '—';
  if (Math.abs(n) >= 1_000_000) return `£${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000)     return `£${(n / 1_000).toFixed(0)}k`;
  return `£${Math.round(n)}`;
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

const PE_LABELS = {
  platform_company:  'Platform',
  portfolio_company: 'Portfolio company',
  acquirer:          'Acquirer',
  target:            'Target',
};

export default function DealWorkspaceClient({ dealId, embedded = false, onScopeSelect, initialDeal = null } = {}) {
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();
  // Seed deal state with the picker row so the shell renders
  // immediately with name + type + status, no full-shell loading flash
  // while the /api/deals/[id] fetch resolves. The fetch overwrites
  // `deal` with the full payload (participants + flows) when ready.
  const [deal, setDeal]         = useState(initialDeal);
  const [loading, setLoading]   = useState(!initialDeal);
  const [error, setError]       = useState(null);
  const [view, setView]         = useState('list');
  const [selectedFuncId, setSelectedFuncId] = useState(null);
  // Which participant the tabs are scoped to. `null` = "Combined" view
  // (aggregated across every participant on the deal). When the user
  // picks a participant pill, the synth is re-run with that filter.
  const [scopeParticipantId, setScopeParticipantId] = useState(null);

  // Single round-trip: /api/deals/[id] returns participants + flows
  // with their reports already enriched. Refetch on auth.
  const load = useCallback(async () => {
    if (!accessToken || !dealId) return;
    setLoading(true);
    try {
      const r = await apiFetch(`/api/deals/${encodeURIComponent(dealId)}`, {}, accessToken);
      if (!r.ok) throw new Error(`/api/deals/${dealId} -> ${r.status}`);
      setDeal(await r.json());
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [accessToken, dealId]);
  useEffect(() => { if (!authLoading) load(); }, [authLoading, load]);

  // Chat-driven navigation: Deal agent's open_deal_view + focus_participant
  // tools fire these events. We react inline so the chat can drive the
  // canvas without the user clicking tabs.
  useEffect(() => {
    const onSetView = (e) => {
      const v = e?.detail?.view;
      if (v && ['list', 'map', 'graph', 'fte', 'inventory', 'insights', 'analysis'].includes(v)) {
        setView(v);
      }
    };
    const onFocusParticipant = (e) => {
      setScopeParticipantId(e?.detail?.participantId ?? null);
      setSelectedFuncId(null);
    };
    window.addEventListener('vesno:set-workspace-view', onSetView);
    window.addEventListener('vesno:focus-participant', onFocusParticipant);
    return () => {
      window.removeEventListener('vesno:set-workspace-view', onSetView);
      window.removeEventListener('vesno:focus-participant', onFocusParticipant);
    };
  }, []);

  // Synthesise the workspace shape from the deal payload, scoped to
  // either every participant ("Combined") or just one when the user
  // picks a participant pill.
  const synth = useMemo(
    () => synthesiseFromDeal(deal, scopeParticipantId),
    [deal, scopeParticipantId],
  );
  // The participant pill row reads from the unscoped deal payload so
  // the user can always switch between any participant.
  const allParticipants = deal?.participants || [];
  const hasAnalysis = Array.isArray(deal?.summary?.analyses) && deal.summary.analyses.length > 0;
  const filteredProcesses = useMemo(() => {
    if (!synth) return [];
    if (selectedFuncId == null) return synth.processes;
    if (selectedFuncId === '__unfiled__') return synth.processes.filter((p) => !p.function_id);
    return synth.processes.filter((p) => p.function_id === selectedFuncId);
  }, [synth, selectedFuncId]);

  /* ── Render gates ────────────────────────────────────────────── */
  if (authLoading || (loading && !deal)) {
    return <div className="ws-shell ws-empty">Loading deal workspace…</div>;
  }
  if (!user) {
    return (
      <div className="ws-shell ws-empty">
        <h1>Deal workspace</h1>
        <p>Sign in to access this deal.</p>
        <Link href="/signin" className="ws-cta">Sign in</Link>
      </div>
    );
  }
  if (error) {
    return (
      <div className="ws-shell ws-empty">
        <h1>Deal workspace</h1>
        <p className="ws-error">Couldn&apos;t load this deal: {error}</p>
        <button type="button" className="ws-cta" onClick={load}>Retry</button>
      </div>
    );
  }
  if (!deal) return null;

  const dealMeta = deal.deal || {};
  const dealKindLabel = dealMeta.type === 'pe_rollup' ? 'PE roll-up'
                      : dealMeta.type === 'ma'        ? 'M&A deal'
                      : dealMeta.type === 'scaling'   ? 'Scaling deal'
                      : 'Deal';
  return (
    <div className="ws-shell">
      {!embedded && <WorkspaceScopeNav active="deals" onSelect={onScopeSelect} />}
      <header className="ws-header">
        <div className="ws-header-row">
          <div>
            <p className="ws-eyebrow">
              {dealKindLabel}{dealMeta.dealCode ? <> &middot; <code>{dealMeta.dealCode}</code></> : null}
            </p>
            <h1 className="ws-title">{dealMeta.name || 'Untitled deal'}</h1>
          </div>
        </div>
        {dealMeta.processName && (
          <p className="ws-description">Canonical process: <strong>{dealMeta.processName}</strong></p>
        )}

        {/* Participant scope selector. "Combined" aggregates every
            participant's flows + reports into one workspace; the per-
            participant pills isolate the view to that company. The
            Combined pill stays available even before an analysis has
            run — running an analysis just enriches it with synthesised
            findings + redesigns. */}
        {allParticipants.length > 0 && (
          <div className="ws-tabs ws-tabs--scope" role="tablist" aria-label="Participant scope" style={{ marginBottom: 8 }}>
            <button
              type="button"
              role="tab"
              aria-selected={scopeParticipantId === null}
              className={`ws-tab${scopeParticipantId === null ? ' ws-tab--active' : ''}`}
              onClick={() => setScopeParticipantId(null)}
              title={hasAnalysis
                ? 'Combined view, enriched by the latest deal analysis'
                : 'Combined view across every participant. Run a deal analysis to add cross-participant findings.'}
            >Combined{hasAnalysis ? '' : ' (raw)'}</button>
            {allParticipants.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={scopeParticipantId === p.id}
                className={`ws-tab${scopeParticipantId === p.id ? ' ws-tab--active' : ''}`}
                onClick={() => { setScopeParticipantId(p.id); setSelectedFuncId(null); }}
                title={`${p.role} - ${p.companyName || ''}`}
              >
                {p.companyName || p.participantName || p.role}
              </button>
            ))}
          </div>
        )}

        <div className="ws-tabs" role="tablist" aria-label="Deal workspace view">
          {[
            { id: 'list',       label: 'List' },
            { id: 'map',        label: 'Map' },
            { id: 'graph',      label: 'Graph' },
            { id: 'fte',        label: 'FTE' },
            { id: 'inventory',  label: 'Canonical inventory' },
            { id: 'insights',   label: 'Insights' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={view === t.id}
              className={`ws-tab${view === t.id ? ' ws-tab--active' : ''}`}
              onClick={() => setView(t.id)}
            >{t.label}</button>
          ))}
        </div>
      </header>

      <section className="ws-stats">
        <StatTile
          label={scopeParticipantId ? 'In scope' : 'Functions'}
          value={scopeParticipantId
            ? (allParticipants.find((p) => p.id === scopeParticipantId)?.companyName || 'Participant')
            : (synth?.functions?.length ?? '—')}
          sub={scopeParticipantId
            ? `1 of ${allParticipants.length} participants`
            : `${allParticipants.length} participant${allParticipants.length === 1 ? '' : 's'} · ${dealKindLabel}`}
        />
        <StatTile
          label="Process flows"
          value={synth?.processes?.length ?? 0}
          sub={dealMeta.status ? dealMeta.status : null}
        />
        <StatTile label="Annual cost"        value={Money(synth?.totals?.annualCost)} />
        <StatTile label="Potential savings"  value={Money(synth?.totals?.potentialSavings)} />
        <StatTile
          label="Avg automation"
          value={synth?.totals?.avgAutomationPct != null ? `${synth.totals.avgAutomationPct}%` : '—'}
        />
      </section>

      {view === 'fte' ? (
        <DealFteBreakdown synth={synth} />
      ) : view === 'inventory' ? (
        <DealInventory synth={synth} />
      ) : view === 'insights' ? (
        // Reuse the InsightsPanel by passing it the deal's modelId-shaped
        // id. The panel calls /api/operating-models/<id>/insights, which
        // returns 404 for a deal id. We work around this by computing the
        // insights in-memory from the synthesised heatmap and rendering
        // a focused card here. Same drill-through grammar.
        <DealInsights synth={synth} dealId={dealId} />
      ) : view === 'graph' ? (
        <WorkspaceGraph
          functions={synth.functions}
          processes={synth.processes}
          onSelect={(fid) => { setSelectedFuncId(fid); setView('list'); }}
          onProcessOpen={(processId) => {
            // Silent canvas swap, same path as /workspace (DiagnosticWorkspace
            // listens for vesno:open-process). No route change → chat thread
            // and deal scope stay intact.
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('vesno:open-process', {
                detail: { reportId: processId, intent: 'view' },
              }));
            }
          }}
        />
      ) : view === 'map' ? (
        <WorkspaceMap
          functions={synth.functions}
          processes={synth.processes}
          roles={[]}
          rollup={synth.rollup}
          onSelect={(fid) => { setSelectedFuncId(fid); setView('list'); }}
        />
      ) : (
        <div className="ws-grid">
          <aside className="ws-pane ws-pane--functions">
            <CapabilityTree
              modelId={null}
              functions={synth.functions}
              rollup={synth.rollup}
              isAdmin={false}
              accessToken={accessToken}
              selectedFuncId={selectedFuncId}
              onSelect={setSelectedFuncId}
              onChanged={() => load()}
            />
          </aside>
          <main className="ws-pane ws-pane--processes">
            <ProcessesPanel
              modelId={null}
              processes={filteredProcesses}
              allCapabilities={synth.functionsFlat}
              selectedFuncId={selectedFuncId}
              accessToken={accessToken}
              onChanged={() => load()}
              // Carry the deal context across navigation so the chat
              // surface stays scoped (DealsRailButton hydrates from
              // ?deal=<id>); used as the underlying href for
              // modifier-click-new-tab. Plain clicks are intercepted by
              // onProcessClick below for in-place canvas swap.
              processUrlFor={(p) => `/workspace/map?view=${encodeURIComponent(p.id)}&deal=${encodeURIComponent(dealId)}`}
              onProcessClick={(p) => {
                if (typeof window === 'undefined') return;
                window.dispatchEvent(new CustomEvent('vesno:open-process', {
                  detail: { reportId: p.id, intent: 'view' },
                }));
              }}
              // Deal flows are anchored to participants; refiling under
              // a different operating-model function doesn't apply here.
              hideRefile
            />
          </main>
        </div>
      )}
    </div>
  );
}

/* ── Synthesis ─────────────────────────────────────────────────────
 * Convert the deal payload from /api/deals/[id] into the shape the
 * workspace components expect. Each participant becomes a function;
 * each flow becomes a process, anchored to its participant's function.
 */
function synthesiseFromDeal(deal, scopeParticipantId = null) {
  if (!deal) return null;
  const allParticipants = deal.participants || [];
  const allFlows        = deal.flows || [];
  // Scope: either every participant ("Combined") or just one. The
  // "Combined" view falls back to all participants when no analysis
  // has produced a deal-level synthesis yet — the per-participant
  // numbers still aggregate sensibly.
  const participants = scopeParticipantId
    ? allParticipants.filter((p) => p.id === scopeParticipantId)
    : allParticipants;
  const flows = scopeParticipantId
    ? allFlows.filter((f) => f.participantId === scopeParticipantId)
    : allFlows;

  // Build the function tree from the SAME shape the regular workspace
  // uses: top-level functions are real business functions (the step
  // departments), not participants. The participant filter sits in the
  // pill row above and just narrows which flows feed the synth — once
  // that's done, the workspace looks identical to /workspace.
  //
  // Stable, deterministic ids keyed on the lower-cased name so the
  // same department across two participants collapses into one row in
  // the Combined view (e.g. Apex's "Compliance" + Lumen's "Compliance"
  // become one Compliance function with both companies' processes).
  const participantById = new Map(participants.map((p) => [p.id, p]));
  const fnByKey = new Map(); // key -> { id, name, parent_function_id, ... }
  const ensureFn = (dept) => {
    if (!dept) return null;
    const key = dept.toLowerCase().trim();
    if (!key) return null;
    if (!fnByKey.has(key)) {
      fnByKey.set(key, {
        id: `fn::${key}`,
        name: dept,
        parent_function_id: null,
        layer: 'value_chain',
        status: 'live',
        children: [],
        description: '',
      });
    }
    return fnByKey.get(key).id;
  };

  const processes = [];
  for (const f of flows) {
    const r = f.report || {};
    const participant = f.participantId ? participantById.get(f.participantId) : null;

    const stepsRaw = Array.isArray(r.rawSteps) ? r.rawSteps : [];
    const stampedSteps = stepsRaw.map((s) => {
      const dept = (s.department || '').trim();
      const fnId = ensureFn(dept);
      return { ...s, functionId: fnId || null };
    });

    // Distinct functions touched - drives the graph view's "spans"
    // edges so a process that crosses Compliance + Cards renders both
    // links from those columns.
    const touchedFnIds = [...new Set(stampedSteps.map((s) => s.functionId).filter(Boolean))];
    const ownerFnId = touchedFnIds[0] || null;

    // Cost attribution lives in lib/processMetrics so the deal-side
    // graph's heatmap + owner-mismatch flag use exactly the same logic
    // as the operating-models API.
    const cost_by_function = deriveCostByFunction({
      rawProcesses: [{ steps: stampedSteps }],
      declaredFunctionId: ownerFnId,
      annualCost: r.totalAnnualCost,
    });

    processes.push({
      id: r.id || f.id,
      function_id: ownerFnId,
      function_ids: touchedFnIds,
      // Company stays as a column on the process row so the user can
      // tell whose flow it is even in the Combined view.
      company: participant?.companyName || null,
      contact_name: participant?.participantName || null,
      participant_id: participant?.id || null,
      participant_role: participant?.role || null,
      process_name: f.label || r?.processes?.[0]?.name || 'Untitled flow',
      total_annual_cost: r.totalAnnualCost ?? null,
      potential_savings: r.potentialSavings ?? null,
      automation_percentage: r.automationPercentage ?? null,
      state_kind: f.flowKind || 'current',
      created_at: f.createdAt,
      updated_at: f.updatedAt,
      diagnostic_data: {
        rawProcesses: [{
          name: f.label || r?.processes?.[0]?.name || 'Untitled flow',
          steps: stampedSteps,
        }],
      },
      cost_by_function,
    });
  }

  // Functions: a flat list of departments. No sub-functions for now -
  // the deal data shape is one level deep. The list goes in alphabetical
  // order for predictable rendering.
  const functionsFlat = [...fnByKey.values()].sort((a, b) =>
    (a.name || '').localeCompare(b.name || ''),
  );
  const functions = functionsFlat;

  // Compute a rollup that mirrors lib/operatingModel/repo.js
  // computeModelRollup: per-function processCount + cost + savings.
  // Step-driven attribution isn't possible here (steps are stripped),
  // so cost/savings sit on the owner function.
  const buckets = new Map();
  const ensure = (fid, name) => {
    if (!buckets.has(fid)) {
      buckets.set(fid, {
        functionId: fid,
        name: name || (fid ? '(orphaned)' : '(unfiled)'),
        processCount: 0,
        fte: 0,
        annualCost: 0,
        potentialSavings: 0,
        automationPctSum: 0, automationPctCount: 0,
        stepMinutes: 0, stepCount: 0,
      });
    }
    return buckets.get(fid);
  };
  // Friendly name for a function id (department).
  const fnNameFor = (id) => {
    const fn = functionsFlat.find((f) => f.id === id);
    return fn ? fn.name : null;
  };

  let totalAnnualCost = 0;
  let totalSavings    = 0;
  let autoSum = 0, autoCount = 0;
  for (const p of processes) {
    // Owner bucket = the function this process is filed under (its
    // first touched department). Counts the report once for the
    // process-count rollup; per-function cost / savings / minutes
    // come from the step walk below so spanning processes apportion
    // correctly.
    const ownerId = p.function_id || null;
    const ownerBucket = ensure(ownerId, fnNameFor(ownerId));
    ownerBucket.processCount += 1;
    if (p.total_annual_cost != null)     totalAnnualCost += Number(p.total_annual_cost) || 0;
    if (p.potential_savings != null)     totalSavings    += Number(p.potential_savings) || 0;
    if (p.automation_percentage != null) {
      autoSum += Number(p.automation_percentage) || 0;
      autoCount += 1;
    }

    // Step-walk: credit step minutes (and proportional cost / savings)
    // to the function the step is tagged to. A spanning process splits
    // its £ across every function its steps touch.
    const steps = p.diagnostic_data?.rawProcesses?.[0]?.steps || [];
    const totalWm = steps.reduce((s, st) => s + (Number(st?.workMinutes) > 0 ? Number(st.workMinutes) : 0), 0);
    for (const s of steps) {
      const wm = Number(s.workMinutes) > 0 ? Number(s.workMinutes) : 0;
      const fid = s.functionId || ownerId;
      const sb = ensure(fid, fnNameFor(fid));
      sb.stepCount += 1;
      sb.stepMinutes += wm;
      if (wm > 0 && totalWm > 0) {
        const share = wm / totalWm;
        if (p.total_annual_cost)     sb.annualCost       += (Number(p.total_annual_cost)     || 0) * share;
        if (p.potential_savings)     sb.potentialSavings += (Number(p.potential_savings)     || 0) * share;
        if (p.automation_percentage != null) {
          sb.automationPctSum   += (Number(p.automation_percentage) || 0) * share;
          sb.automationPctCount += share;
        }
      }
    }
  }
  const byFunction = [...buckets.values()].map((b) => ({
    functionId: b.functionId,
    name: b.name,
    processCount: b.processCount,
    stepCount: b.stepCount,
    stepMinutes: round2(b.stepMinutes),
    fte: 0,
    annualCost: round2(b.annualCost),
    potentialSavings: round2(b.potentialSavings),
    avgAutomationPct: b.automationPctCount ? round2(b.automationPctSum / b.automationPctCount) : null,
  }));
  const totals = {
    processes: processes.length,
    fte: 0,
    annualCost:       round2(totalAnnualCost),
    potentialSavings: round2(totalSavings),
    avgAutomationPct: autoCount ? round2(autoSum / autoCount) : null,
  };

  // Pre-compute a simple per-function heatmap for the Insights tab.
  // We can't reuse lib/operatingModel/crossProcess.computeFunctionHeatmap
  // here because that module pulls in node-only deps (crypto via
  // api-helpers); the deal endpoint also strips raw steps so the
  // step-driven savings calc would land on 0 anyway. Aggregate
  // report-level fields instead — accurate for the deal context.
  const heatmap = byFunction
    .filter((b) => b.functionId)
    .map((b) => ({
      function_id: b.functionId,
      name: b.name,
      processCount: b.processCount,
      annualCost: b.annualCost,
      potentialSavings: b.potentialSavings,
      avgAutomationPct: b.avgAutomationPct,
    }))
    .sort((a, b) => (b.annualCost || 0) - (a.annualCost || 0));

  return {
    deal,
    functions,
    functionsFlat,
    participantById,
    processes,
    rollup: { totals, byFunction, unfiledProcesses: buckets.get(null)?.processCount || 0 },
    totals,
    heatmap,
  };
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

/* ── Tab views: FTE / Inventory / Insights ─────────────────────── */

function DealFteBreakdown({ synth }) {
  const participants = synth?.deal?.participants || [];
  return (
    <section className="ws-pane">
      <div className="ws-insight-card">
        <h3>Participants <span className="ws-insight-sub">{participants.length} total</span></h3>
        {participants.length === 0 ? (
          <div className="ws-empty-inline" style={{ margin: 0 }}>
            No participants on this deal yet. Invite one from the deal&apos;s chat surface.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-mid, #64748b)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <th style={{ padding: '6px 8px' }}>Company</th>
                <th style={{ padding: '6px 8px' }}>Role</th>
                <th style={{ padding: '6px 8px' }}>Status</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Annual cost</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Savings</th>
              </tr>
            </thead>
            <tbody>
              {participants.map((p) => (
                <tr key={p.id} style={{ borderTop: '1px solid var(--border, #e2e8f0)' }}>
                  <td style={{ padding: '8px', fontWeight: 500 }}>{p.companyName || '(unnamed)'}</td>
                  <td style={{ padding: '8px', color: 'var(--text-mid, #64748b)' }}>{PE_LABELS[p.role] || p.role || '—'}</td>
                  <td style={{ padding: '8px', color: 'var(--text-mid, #64748b)' }}>{p.status || '—'}</td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>{Money(p.report?.totalAnnualCost)}</td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>{Money(p.report?.potentialSavings)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="ws-insight-foot" style={{ marginTop: 10 }}>
          Deals don&apos;t carry headcount inventory like an operating model. To track FTE per
          function, anchor each participant&apos;s flow to an operating model.
        </p>
      </div>
    </section>
  );
}

function DealInventory({ synth }) {
  // Distinct systems mentioned across the deal's flows. Walks each
  // process's rawProcesses[].steps[].systems[] when available; the
  // /api/deals/[id] endpoint usually omits raw steps so this is a
  // best-effort view.
  const systems = useMemo(() => {
    const m = new Map();
    for (const p of synth?.processes || []) {
      const dd = p.diagnostic_data || {};
      const procs = Array.isArray(dd.rawProcesses) ? dd.rawProcesses : [];
      for (const proc of procs) {
        const steps = Array.isArray(proc?.steps) ? proc.steps : [];
        for (const step of steps) {
          for (const s of (step.systems || [])) {
            const name = typeof s === 'string' ? s.trim() : '';
            if (!name) continue;
            const key = name.toLowerCase();
            if (!m.has(key)) m.set(key, { name, processIds: new Set(), mentions: 0 });
            const e = m.get(key);
            e.mentions += 1;
            e.processIds.add(p.id);
          }
        }
      }
    }
    return [...m.values()]
      .map((e) => ({ name: e.name, processCount: e.processIds.size, mentions: e.mentions }))
      .sort((a, b) => b.processCount - a.processCount);
  }, [synth]);
  return (
    <section className="ws-pane">
      <div className="ws-insight-card">
        <h3>Systems mentioned <span className="ws-insight-sub">{systems.length} distinct</span></h3>
        {systems.length === 0 ? (
          <div className="ws-empty-inline" style={{ margin: 0 }}>
            No systems detected in the deal&apos;s flows yet. Map a process with steps that reference
            systems to populate this list.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-mid, #64748b)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <th style={{ padding: '6px 8px' }}>System</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Processes</th>
                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Mentions</th>
              </tr>
            </thead>
            <tbody>
              {systems.map((s) => (
                <tr key={s.name} style={{ borderTop: '1px solid var(--border, #e2e8f0)' }}>
                  <td style={{ padding: '8px', fontWeight: 500 }}>{s.name}</td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>{s.processCount}</td>
                  <td style={{ padding: '8px', textAlign: 'right', color: 'var(--text-mid, #64748b)' }}>{s.mentions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function DealInsights({ synth }) {
  // Render the heatmap directly using the synthesised data (the API
  // endpoint at /api/operating-models/[id]/insights doesn't accept a
  // deal id, so we compute in-memory and render a focused card).
  const rows = synth?.heatmap || [];
  if (rows.length === 0) {
    return (
      <section className="ws-pane">
        <div className="ws-insight-card">
          <h3>Insights</h3>
          <div className="ws-empty-inline" style={{ margin: 0 }}>
            No process data yet. Once participants map flows the heatmap will populate.
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="ws-pane">
      <div className="ws-insight-card">
        <h3>Function heatmap <span className="ws-insight-sub">{rows.length} row{rows.length === 1 ? '' : 's'}</span></h3>
        <table className="ws-heat-table">
          <thead>
            <tr>
              <th>Function</th>
              <th>Processes</th>
              <th>Annual cost</th>
              <th>Savings</th>
              <th>Auto%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.function_id || '__unfiled__'} className="ws-heat-row">
                <td className="ws-heat-name">{r.name}</td>
                <td className="ws-heat-cell">{r.processCount}</td>
                <td className="ws-heat-cell">{Money(r.annualCost)}</td>
                <td className="ws-heat-cell">{Money(r.potentialSavings)}</td>
                <td className="ws-heat-cell">{r.avgAutomationPct != null ? `${r.avgAutomationPct}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="ws-insight-foot" style={{ marginTop: 10 }}>
          Savings are derived from each report&apos;s automation classification. Anchor a flow to a
          full operating model for richer drill-throughs and Change ROI tracking.
        </p>
      </div>
    </section>
  );
}
