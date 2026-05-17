'use client';

/**
 * Process list for the workspace home. Shown alongside the capability tree.
 *
 * Each row: company / process / cost / state, with a "File under…" picker
 * that anchors the process to a capability. Click the row title to open
 * the existing report editor (separate session — design-surface refactor
 * is the next phase).
 */

import { useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api-fetch';

function Money(n) {
  if (n == null) return '—';
  if (Math.abs(n) >= 1_000_000) return `£${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000)     return `£${(n / 1_000).toFixed(0)}k`;
  return `£${Math.round(n)}`;
}

/**
 * Owner-mismatch detection — identical rule to the Graph view
 * (WorkspaceGraph): a process is flagged when its biggest cost-driver
 * function (by attributed cost_by_function) is not its declared owner,
 * and there's more than one driver (so the single-function fallback
 * doesn't false-positive). Keeps List and Graph telling the same story.
 */
function ownerMismatch(p) {
  const cbf = p.cost_by_function || {};
  const annualCost = Number(p.total_annual_cost) || 0;
  let topId = null;
  let topCost = 0;
  let distinct = 0;
  for (const [fid, cost] of Object.entries(cbf)) {
    const c = Number(cost) || 0;
    if (c <= 0) continue;
    distinct += 1;
    if (c > topCost) { topCost = c; topId = fid; }
  }
  const declared = p.function_id || null;
  const mismatch = !!(declared && topId && topId !== declared && distinct > 1);
  return {
    mismatch,
    topId,
    topShare: annualCost > 0 ? topCost / annualCost : 0,
  };
}

export default function ProcessesPanel({
  modelId, processes, allCapabilities,
  selectedFuncId, accessToken, onChanged,
  // Optional URL builder so callers (e.g. the deal workspace) can
  // append context like ?deal=<id> to view links. Default mirrors the
  // standard workspace's view-on-canvas pattern.
  processUrlFor = (p) => `/workspace/map?view=${encodeURIComponent(p.id)}`,
  // Optional click handler — when provided, the row title invokes this
  // instead of navigating, so the host can load the process inline on
  // the canvas without a route change. Receives the process row.
  onProcessClick = null,
  // When true (deal workspace), hide the file-under-capability picker
  // since deal flows are anchored to participants, not org capabilities.
  hideRefile = false,
}) {
  const [busyById, setBusyById] = useState({});

  const funcsById = useMemo(() => {
    const m = {};
    for (const c of allCapabilities || []) m[c.id] = c;
    return m;
  }, [allCapabilities]);

  // Capability picker options — leading "Unfile" sentinel.
  const capOptions = useMemo(() => {
    return [{ value: '', label: 'Unfile (none)' }]
      .concat((allCapabilities || []).map((c) => ({ value: c.id, label: c.name })));
  }, [allCapabilities]);

  const fileUnder = useCallback(async (processId, funcId) => {
    setBusyById((s) => ({ ...s, [processId]: true }));
    try {
      await apiFetch(
        `/api/operating-models/${modelId}/processes/${encodeURIComponent(processId)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ function_id: funcId || null }),
        },
        accessToken,
      );
      onChanged?.();
    } finally {
      setBusyById((s) => { const n = { ...s }; delete n[processId]; return n; });
    }
  }, [modelId, accessToken, onChanged]);

  // Group by capability when no filter is active. Otherwise show flat.
  const grouped = useMemo(() => {
    if (selectedFuncId != null) return null;
    const groups = new Map();
    for (const p of processes || []) {
      const key = p.function_id || '__unfiled__';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    return groups;
  }, [processes, selectedFuncId]);

  const headerLabel = selectedFuncId == null
    ? `All processes (${processes?.length || 0})`
    : selectedFuncId === '__unfiled__'
      ? `Unfiled processes (${processes?.length || 0})`
      : `${funcsById[selectedFuncId]?.name || 'Function'} (${processes?.length || 0})`;

  return (
    <div className="ws-procs">
      <div className="ws-procs-head">
        <h2>{headerLabel}</h2>
      </div>

      {(processes?.length || 0) === 0 && (
        <p className="ws-empty-inline">
          {selectedFuncId == null
            ? 'No processes yet. Run an audit from the chat to add one.'
            : 'No processes filed under this function yet.'}
        </p>
      )}

      {grouped ? (
        // Grouped-by-capability view (no filter)
        [...grouped.entries()].map(([funcId, rows]) => {
          const cap = funcId === '__unfiled__' ? { id: '__unfiled__', name: 'Unfiled' } : funcsById[funcId];
          const label = cap?.name || '(orphaned function)';
          return (
            <div key={funcId} className="ws-procs-group">
              <h3 className="ws-procs-group-title">{label} <span className="ws-procs-group-count">{rows.length}</span></h3>
              <ul className="ws-procs-list">
                {rows.map((p) => (
                  <ProcessRow
                    key={p.id}
                    p={p}
                    capOptions={capOptions}
                    funcsById={funcsById}
                    busy={!!busyById[p.id]}
                    onFile={fileUnder}
                    processUrlFor={processUrlFor}
                    onProcessClick={onProcessClick}
                    hideRefile={hideRefile}
                  />
                ))}
              </ul>
            </div>
          );
        })
      ) : (
        // Flat view (filter active)
        <ul className="ws-procs-list">
          {(processes || []).map((p) => (
            <ProcessRow
              key={p.id}
              p={p}
              capOptions={capOptions}
              funcsById={funcsById}
              busy={!!busyById[p.id]}
              onFile={fileUnder}
              processUrlFor={processUrlFor}
              onProcessClick={onProcessClick}
              hideRefile={hideRefile}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ProcessRow({ p, capOptions, busy, onFile, funcsById, processUrlFor, onProcessClick, hideRefile = false }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const spansNames = (p.function_ids || [])
    .filter((fid) => fid && fid !== p.function_id)
    .map((fid) => funcsById?.[fid]?.name)
    .filter(Boolean);
  const mm = ownerMismatch(p);
  const declaredName = p.function_id ? (funcsById?.[p.function_id]?.name || null) : null;
  const topDriverName = mm.topId ? (funcsById?.[mm.topId]?.name || null) : null;
  const mismatchTitle = mm.mismatch && topDriverName
    ? `Declared owner: ${declaredName || 'Unfiled'} · Top cost driver: ${topDriverName} (${Math.round(mm.topShare * 100)}%)`
    : '';
  const handleTitleClick = (e) => {
    if (!onProcessClick) return;
    // Let Cmd/Ctrl/Shift/middle-click open in a new tab via the href.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    onProcessClick(p);
  };
  return (
    <li className="ws-proc-row">
      <div className="ws-proc-main">
        <Link
          href={processUrlFor(p)}
          className="ws-proc-title"
          onClick={handleTitleClick}
        >
          {p.process_name || p.processName || 'Untitled process'}
        </Link>
        {mm.mismatch && (
          <span className="ws-proc-mismatch" title={mismatchTitle} aria-label="Owner mismatch">
            ⚠ {topDriverName}
          </span>
        )}
        {(p.company || p.contact_name) && (
          <span className="ws-proc-company" title="Company / contact">
            {p.company || p.contact_name}
          </span>
        )}
        {spansNames.length > 0 && (
          <span
            className="ws-proc-spans"
            title={`Steps in this process touch: ${spansNames.join(', ')}`}
          >
            spans {spansNames.join(' · ')}
          </span>
        )}
      </div>
      <div className="ws-proc-meta">
        <span className="ws-proc-cost" title="Annual cost">{Money(p.total_annual_cost)}</span>
        {Number(p.potential_savings) > 0 && (
          <span title="Decided savings" className="ws-proc-savings">↓ {Money(p.potential_savings)}</span>
        )}
        {Number(p.automation_percentage) > 0 && (
          <span title="Automation %" className="ws-proc-auto">{Math.round(p.automation_percentage)}% auto</span>
        )}
      </div>
      {!hideRefile && (
        <div className="ws-proc-actions">
          {pickerOpen ? (
            <select
              autoFocus
              disabled={busy}
              defaultValue={p.function_id || ''}
              onChange={(e) => { onFile(p.id, e.target.value); setPickerOpen(false); }}
              onBlur={() => setPickerOpen(false)}
            >
              {capOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <button
              type="button"
              className="ws-proc-file"
              onClick={() => setPickerOpen(true)}
              disabled={busy}
            >
              File under...
            </button>
          )}
        </div>
      )}
    </li>
  );
}
