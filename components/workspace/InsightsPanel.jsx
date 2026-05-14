'use client';

/**
 * Workspace Insights — three cross-process cards rendered side-by-side
 * on the workspace home, below the function tree + processes grid.
 *
 *   1. System inventory — every system the model touches, ranked by
 *      number of processes using it.
 *   2. Capability heatmap — function × (process count, cost, savings,
 *      automation, system mentions). Cells colour-coded by magnitude.
 *   3. Change ROI — predicted vs realised across all changes.
 *
 * One round-trip via /api/operating-models/[id]/insights. Lazy — only
 * fires when the section is expanded (sits in a collapsible to keep
 * the workspace's first paint snappy).
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import SystemDetailDrawer from './SystemDetailDrawer';

function Money(n) {
  if (n == null) return '—';
  if (Math.abs(n) >= 1_000_000) return `£${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000)     return `£${(n / 1_000).toFixed(0)}k`;
  return `£${Math.round(n)}`;
}

function Hours(minutes) {
  if (minutes == null || minutes === 0) return '—';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = minutes / 60;
  if (h < 100) return `${h.toFixed(h < 10 ? 1 : 0)}h`;
  return `${Math.round(h)}h`;
}

function HeatCell({ value, max, format = (v) => v, accent = 'teal', onClick, cellTitle }) {
  if (value == null || value === 0) {
    return <td className="ws-heat-cell ws-heat-cell--empty" title={cellTitle}>{'—'}</td>;
  }
  const intensity = max > 0 ? Math.min(1, Math.abs(value) / max) : 0;
  // Map intensity 0–1 to alpha 0.05–0.55 so even small values get a tint.
  const alpha = 0.05 + intensity * 0.5;
  const colour = accent === 'red' ? `rgba(220,38,38,${alpha})`
              : accent === 'amber' ? `rgba(245,158,11,${alpha})`
              : accent === 'indigo' ? `rgba(99,102,241,${alpha})`
              : `rgba(13,148,136,${alpha})`;
  return (
    <td
      className={`ws-heat-cell${onClick ? ' ws-heat-cell--clickable' : ''}`}
      style={{ background: colour, cursor: onClick ? 'pointer' : undefined, textDecoration: onClick ? 'underline dotted' : undefined }}
      onClick={onClick}
      title={cellTitle}
    >
      {format(value)}
    </td>
  );
}

function SystemInventoryCard({ rows, onSelect, onPromote, isAdmin, busyKey }) {
  if (!rows?.length) return (
    <div className="ws-insight-card ws-insight-card--inventory">
      <h3>System inventory</h3>
      <div className="ws-empty-inline" style={{ margin: 0 }}>
        No systems detected yet. Save a process with steps that reference systems to populate the inventory.
      </div>
    </div>
  );
  const top = rows.slice(0, 12);
  return (
    <div className="ws-insight-card ws-insight-card--inventory">
      <h3>System inventory <span className="ws-insight-sub">{rows.length} system{rows.length === 1 ? '' : 's'}</span></h3>
      <table className="ws-system-table">
        <thead>
          <tr><th>System</th><th>Processes</th><th>Steps</th><th>Functions</th></tr>
        </thead>
        <tbody>
          {top.map((s) => (
            <tr key={s.key} className="ws-system-row">
              <td className="ws-system-name">
                <button
                  type="button"
                  className="ws-system-link"
                  onClick={() => onSelect?.(s)}
                  title="See processes touching this system"
                >{s.system_name}</button>
                {!s.system_id && (
                  <>
                    <span className="ws-system-tag" title="Not in canonical inventory yet">unlinked</span>
                    {isAdmin && (
                      <button
                        type="button"
                        className="ws-system-promote"
                        onClick={(e) => { e.stopPropagation(); onPromote?.(s); }}
                        disabled={busyKey === s.key}
                        title="Add to inventory; auto-links existing process step mentions"
                      >{busyKey === s.key ? '…' : '+ inventory'}</button>
                    )}
                  </>
                )}
              </td>
              <td>{s.processCount}</td>
              <td>{s.stepCount}</td>
              <td>{s.functionCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 12 && (
        <p className="ws-insight-foot">{rows.length - 12} more system{rows.length - 12 === 1 ? '' : 's'} not shown.</p>
      )}
    </div>
  );
}

function CapabilityHeatmapCard({ rows, onCapabilitySelect }) {
  // Drill-through state: { row, metric } when a numeric cell is clicked.
  const [drill, setDrill] = useState(null);

  // Compute per-column maxes for the colour scaling.
  const maxes = useMemo(() => {
    const m = { processCount: 0, stepMinutes: 0, annualCost: 0, potentialSavings: 0, systemMentions: 0 };
    for (const r of rows || []) {
      m.processCount     = Math.max(m.processCount,     r.processCount     || 0);
      m.stepMinutes      = Math.max(m.stepMinutes,      r.stepMinutes      || 0);
      m.annualCost       = Math.max(m.annualCost,       r.annualCost       || 0);
      m.potentialSavings = Math.max(m.potentialSavings, r.potentialSavings || 0);
      m.systemMentions   = Math.max(m.systemMentions,   r.systemMentions   || 0);
    }
    return m;
  }, [rows]);

  if (!rows?.length) {
    return (
      <div className="ws-insight-card ws-insight-card--heatmap">
        <h3>Function heatmap</h3>
        <div className="ws-empty-inline" style={{ margin: 0 }}>
          No data yet. File processes under functions to populate the heatmap.
        </div>
      </div>
    );
  }
  // Helper: open the per-cell drill-through. Stops the row click from
  // also firing (which would filter the processes panel).
  const openDrill = (row, metric) => (e) => {
    e.stopPropagation();
    setDrill({ row, metric });
  };
  return (
    <div className="ws-insight-card ws-insight-card--heatmap">
      <h3>
        Function heatmap{' '}
        <span className="ws-insight-sub">
          {rows.length} row{rows.length === 1 ? '' : 's'} &middot; click any number to drill in
        </span>
      </h3>
      <table className="ws-heat-table">
        <thead>
          <tr>
            <th>Function</th>
            <th>Processes</th>
            <th title="Work minutes attributed to steps that reference this function (step-weighted across spanning processes)">Work</th>
            <th>Annual cost</th>
            <th title="Derived from per-step automation classification: each step's cost share weighted by its automation potential.">Savings</th>
            <th>Auto%</th>
            <th>Systems</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const capKey = r.function_id || '__unfiled__';
            const clickable = !!onCapabilitySelect;
            const onRowClick = clickable
              ? () => onCapabilitySelect(r.function_id || '__unfiled__')
              : undefined;
            const hasProcesses = (r.processes?.length || 0) > 0;
            const drillIf = (metric) => hasProcesses ? openDrill(r, metric) : undefined;
            const drillTitle = (label) => hasProcesses ? `Click to see ${label} by process` : undefined;
            return (
              <tr
                key={capKey}
                className={clickable ? 'ws-heat-row ws-heat-row--clickable' : 'ws-heat-row'}
                onClick={onRowClick}
                title={clickable ? 'Filter the processes panel to this function' : undefined}
              >
                <td className="ws-heat-name">{r.name}</td>
                <HeatCell value={r.processCount}     max={maxes.processCount} accent="indigo"
                  onClick={drillIf('processCount')} cellTitle={drillTitle('the processes')} />
                <HeatCell value={r.stepMinutes}      max={maxes.stepMinutes}  accent="indigo" format={Hours}
                  onClick={drillIf('workMinutes')} cellTitle={drillTitle('work hours')} />
                <HeatCell value={r.annualCost}       max={maxes.annualCost}   accent="red"   format={Money}
                  onClick={drillIf('annualCost')} cellTitle={drillTitle('annual cost')} />
                <HeatCell value={r.potentialSavings} max={maxes.potentialSavings} accent="teal" format={Money}
                  onClick={r.savingsBreakdown?.length ? openDrill(r, 'savings') : undefined}
                  cellTitle={r.savingsBreakdown?.length ? 'Click to see savings by process' : undefined} />
                <HeatCell value={r.avgAutomationPct} max={100} accent="amber" format={(v) => `${v}%`}
                  onClick={drillIf('automationPct')} cellTitle={drillTitle('automation%')} />
                <HeatCell value={r.distinctSystems}  max={maxes.systemMentions || 1} accent="indigo"
                  onClick={drillIf('systems')} cellTitle={drillTitle('the systems')} />
              </tr>
            );
          })}
        </tbody>
      </table>
      {drill && (
        <CellDrillModal row={drill.row} metric={drill.metric} onClose={() => setDrill(null)} />
      )}
    </div>
  );
}

/**
 * Generic per-cell drill-through modal. The user clicked a numeric cell
 * in the heatmap; this lists every process that contributed to that cell
 * (workMinutes / annualCost / savings / automationPct / systems / processCount)
 * with click-throughs to the canvas (?view=<id>).
 */
const METRIC_CONFIG = {
  processCount: {
    title: 'Processes',           summaryFmt: (n) => `${n} process${n === 1 ? '' : 'es'}`,
    column: 'Status',             cellFmt: (p) => p.isOwner ? 'Owner' : 'Touches',
  },
  workMinutes: {
    title: 'Work hours',          summaryFmt: (n) => Hours(n),
    column: 'Work',               cellFmt: (p) => Hours(p.workMinutes),
    sortBy: 'workMinutes',
  },
  annualCost: {
    title: 'Annual cost',         summaryFmt: (n) => Money(n),
    column: 'Cost share',         cellFmt: (p) => Money(p.annualCost),
    sortBy: 'annualCost',
  },
  savings: {
    title: 'Potential savings',   summaryFmt: (n) => Money(n),
    column: 'Savings',            cellFmt: (p) => Money(p.savings),
    sortBy: 'savings',
  },
  automationPct: {
    title: 'Average automation%', summaryFmt: (n) => n != null ? `${n}%` : '—',
    column: 'Auto%',              cellFmt: (p) => p.automationPct != null ? `${p.automationPct}%` : '—',
  },
  systems: {
    title: 'Systems',             summaryFmt: (n) => `${n} distinct system${n === 1 ? '' : 's'}`,
    column: 'Systems used',       cellFmt: (p) => p.systems?.length ? p.systems.join(', ') : '—',
  },
};

function summaryValueFor(row, metric) {
  switch (metric) {
    case 'processCount':  return row.processCount;
    case 'workMinutes':   return row.stepMinutes;
    case 'annualCost':    return row.annualCost;
    case 'savings':       return row.potentialSavings;
    case 'automationPct': return row.avgAutomationPct;
    case 'systems':       return row.distinctSystems;
    default:              return null;
  }
}

function CellDrillModal({ row, metric, onClose }) {
  const cfg = METRIC_CONFIG[metric] || METRIC_CONFIG.workMinutes;
  const all = row.processes || [];
  // For savings we hide rows with 0 contribution; for everything else
  // show every process attached to the function so the user sees what's
  // counted (e.g. a process with workMinutes but no savings still
  // contributes to the Work cell).
  const items = metric === 'savings' ? all.filter((p) => p.savings > 0) : all;
  const sorted = cfg.sortBy
    ? [...items].sort((a, b) => (b[cfg.sortBy] || 0) - (a[cfg.sortBy] || 0))
    : items;
  const total = summaryValueFor(row, metric);
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(15,23,42,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg, #fff)', borderRadius: 8,
          maxWidth: 720, width: '100%', maxHeight: '80vh', overflow: 'auto',
          boxShadow: '0 12px 40px rgba(15,23,42,0.30)',
          padding: '18px 20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-mid, #64748b)' }}>
              {cfg.title}
            </div>
            <h3 style={{ margin: '2px 0 0', fontSize: 16 }}>
              {row.name} &middot; <span style={{ color: '#0f766e' }}>{cfg.summaryFmt(total)}</span>
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ border: 0, background: 'transparent', fontSize: 20, cursor: 'pointer', color: 'var(--text-mid, #64748b)' }}
          >&times;</button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-mid, #64748b)', margin: '0 0 12px' }}>
          Per-process contribution to this cell. Click a process to open it on the canvas.
        </p>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-mid, #64748b)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              <th style={{ padding: '6px 8px' }}>Process</th>
              <th style={{ padding: '6px 8px', textAlign: 'right' }}>{cfg.column}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((it, i) => (
              <tr key={(it.reportId || it.processName) + '_' + i} style={{ borderTop: '1px solid var(--border, #e2e8f0)' }}>
                <td style={{ padding: '8px' }}>
                  {it.reportId ? (
                    <a
                      href={`/workspace/map?view=${encodeURIComponent(it.reportId)}`}
                      style={{ color: 'var(--accent, #0f766e)', textDecoration: 'none', fontWeight: 500 }}
                      title="Open on the canvas (Cmd/Ctrl+click for new tab)"
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
                        e.preventDefault();
                        if (typeof window !== 'undefined') {
                          window.dispatchEvent(new CustomEvent('vesno:open-process', {
                            detail: { reportId: it.reportId, intent: 'view' },
                          }));
                        }
                      }}
                    >{it.processName}</a>
                  ) : (
                    <span>{it.processName}</span>
                  )}
                </td>
                <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600 }}>{cfg.cellFmt(it)}</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={2} style={{ padding: 16, textAlign: 'center', color: 'var(--text-mid, #64748b)' }}>
                Nothing attributable here.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChangeRoiCard({ summary }) {
  if (!summary) return null;
  const t = summary.totals || {};
  const totalLanded = (t.applied || 0) + (t.live || 0) + (t.measured || 0);
  return (
    <div className="ws-insight-card ws-insight-card--roi">
      <h3>Change ROI <span className="ws-insight-sub">{t.changes || 0} change{t.changes === 1 ? '' : 's'}</span></h3>

      <div className="ws-roi-funnel">
        <div className="ws-roi-stage"><span>{t.proposed || 0}</span> proposed</div>
        <div className="ws-roi-stage"><span>{t.applied || 0}</span> applied</div>
        <div className="ws-roi-stage"><span>{t.live || 0}</span> live</div>
        <div className="ws-roi-stage ws-roi-stage--measured"><span>{t.measured || 0}</span> measured</div>
      </div>

      <div className="ws-roi-grid">
        <div>
          <div className="ws-roi-label">Predicted</div>
          <ul className="ws-roi-list">
            {summary.predicted?.time_minutes ? <li>{Math.round(summary.predicted.time_minutes)} minutes saved</li> : null}
            {summary.predicted?.avgCostPct  != null ? <li>{summary.predicted.avgCostPct}% avg cost reduction</li> : null}
            {summary.predicted?.fte ? <li>{summary.predicted.fte} FTE freed</li> : null}
            {!summary.predicted?.time_minutes && summary.predicted?.avgCostPct == null && !summary.predicted?.fte && (
              <li className="ws-roi-empty">No predictions on file.</li>
            )}
          </ul>
        </div>
        <div>
          <div className="ws-roi-label">Realised</div>
          <ul className="ws-roi-list">
            {summary.realised?.length ? summary.realised.slice(0, 4).map((r) => (
              <li key={r.metric}>
                <strong>{r.totalDelta > 0 ? '+' : ''}{r.totalDelta}{r.unit ? ` ${r.unit}` : ''}</strong>
                {' '}{r.metric.replace(/_/g, ' ')} <span className="ws-roi-samples">({r.samples} sample{r.samples === 1 ? '' : 's'})</span>
              </li>
            )) : <li className="ws-roi-empty">No outcomes recorded yet.</li>}
          </ul>
        </div>
      </div>

      {totalLanded > 0 && (
        <p className="ws-roi-coverage">
          {summary.coverage?.withOutcomes || 0} of {totalLanded} landed change{totalLanded === 1 ? '' : 's'} have measured outcomes.
        </p>
      )}
    </div>
  );
}

export default function InsightsPanel({
  modelId, accessToken, isAdmin = false,
  functions = [],
  onCapabilitySelect,
  // When true, the panel renders fully expanded with no collapse toggle.
  // The Workspace renders this in a tab now, so the collapsible would
  // hide the heatmap behind a second click; the tab itself is the
  // expand affordance. Defaults to false to preserve embed callers.
  forceOpen = false,
}) {
  const [internalOpen, setOpen] = useState(false);
  const open = forceOpen || internalOpen;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Drawer state — set by clicking a system row.
  const [drawerSystem, setDrawerSystem] = useState(null);

  // Promote-unlinked busy state — keyed by row key so the loading
  // indicator only shows on the row being promoted.
  const [promotingKey, setPromotingKey] = useState(null);

  const capabilitiesById = useMemo(
    () => new Map((functions || []).map((c) => [c.id, c])),
    [functions],
  );

  const load = useCallback(async () => {
    if (!modelId || !accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch(`/api/operating-models/${modelId}/insights`, {}, accessToken);
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || `insights ${r.status}`);
      }
      setData(await r.json());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [modelId, accessToken]);

  useEffect(() => { if (open && data === null) load(); }, [open, data, load]);

  // Promote an unlinked system mention into the canonical inventory.
  // POST creates the row; the repo's auto-relink walks process_systems and
  // sets system_id on existing same-name rows in one shot.
  const promoteUnlinked = useCallback(async (system) => {
    if (!modelId || !accessToken || !system?.system_name) return;
    setPromotingKey(system.key);
    try {
      const r = await apiFetch(
        `/api/operating-models/${modelId}/systems`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: system.system_name, layer: 'other' }),
        },
        accessToken,
      );
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert(j?.error || `Failed to add to inventory (${r.status})`);
        return;
      }
      // Refresh the insights so the row flips from unlinked → linked.
      await load();
    } finally {
      setPromotingKey(null);
    }
  }, [modelId, accessToken, load]);

  return (
    <section className="ws-pane ws-insights">
      <h2 className="ws-insights-head">
        {forceOpen ? (
          <span className="ws-insights-title">Insights</span>
        ) : (
          <button
            type="button"
            className="ws-tree-action"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >{open ? '−' : '+'} Insights</button>
        )}
        <span className="ws-insight-sub">cross-process system inventory &middot; function heatmap &middot; change ROI</span>
        {open && (
          <button type="button" className="ws-tree-action" onClick={load} disabled={loading}>
            {loading ? '↻ Loading…' : '↻ Refresh'}
          </button>
        )}
      </h2>

      {open && loading && <div className="ws-empty-inline">Loading insights…</div>}
      {open && error && <div className="ws-empty-inline ws-error">Couldn&apos;t load insights: {error}</div>}

      {open && data && !loading && (
        <div className="ws-insights-grid">
          <SystemInventoryCard
            rows={data.systemInventory || []}
            onSelect={setDrawerSystem}
            onPromote={promoteUnlinked}
            isAdmin={isAdmin}
            busyKey={promotingKey}
          />
          <CapabilityHeatmapCard
            rows={data.functionHeatmap || []}
            onCapabilitySelect={onCapabilitySelect}
          />
          <ChangeRoiCard summary={data.changeRoi} />
        </div>
      )}

      {drawerSystem && (
        <SystemDetailDrawer
          modelId={modelId}
          accessToken={accessToken}
          system={drawerSystem}
          capabilitiesById={capabilitiesById}
          onClose={() => setDrawerSystem(null)}
        />
      )}
    </section>
  );
}
