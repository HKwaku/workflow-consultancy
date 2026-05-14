'use client';

/**
 * WorkspaceMap — visual map of the org's operating model.
 *
 * Each top-level function is a card; sub-functions nest inside as smaller
 * cards. Each card shows:
 *   * Process count (owned + spans, when known)
 *   * Step minutes attributed (where the work actually lands)
 *   * Roles assigned to the function
 *   * Top systems used (from the system inventory mention map)
 *
 * Reads the same data WorkspaceClient already loaded — no new API calls.
 * The `processes` list carries `function_ids` per row (computed server-
 * side from step.functionId tags), so we can show "owned vs touched"
 * counts per function without re-walking the JSONB on the client.
 *
 * Click a function → the processes panel filters to it (via onSelect,
 * mirroring CapabilityTree's behaviour).
 */

import { useMemo } from 'react';

function Money(n) {
  if (n == null) return null;
  if (Math.abs(n) >= 1_000_000) return `£${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000)     return `£${(n / 1_000).toFixed(0)}k`;
  return `£${Math.round(n)}`;
}

function Hours(minutes) {
  if (minutes == null || minutes === 0) return null;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = minutes / 60;
  if (h < 100) return `${h.toFixed(h < 10 ? 1 : 0)}h`;
  return `${Math.round(h)}h`;
}

export default function WorkspaceMap({
  functions,        // nested tree from /api/operating-models/[id]
  processes,           // flat list with function_ids[] per row
  roles,               // flat with function_ids[]
  rollup,              // for cost / FTE per function bucket
  onSelect,            // (funcId) => void — filter processes panel
}) {
  // Index everything by function_id once. Spans use BOTH the
  // owner (process.function_id) AND the touch list (function_ids[])
  // — the difference between them is the "shared" count surfaced on
  // each card.
  const stats = useMemo(() => buildStats({ functions, processes, roles, rollup }), [functions, processes, roles, rollup]);

  const tops = functions || [];
  if (tops.length === 0) {
    return (
      <div className="ws-map-empty">
        <p>No functions yet — add one from the function tree to see your map.</p>
      </div>
    );
  }

  return (
    <div className="ws-map">
      {tops.map((cap) => (
        <FunctionCard
          key={cap.id}
          cap={cap}
          stats={stats}
          depth={0}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function FunctionCard({ cap, stats, depth, onSelect }) {
  const s = stats.byId.get(cap.id) || {};
  const owned = s.owned || 0;
  const shared = s.touched ? Math.max(0, s.touched - owned) : 0;
  const work = s.stepMinutes || 0;
  const cost = s.annualCost || 0;
  const roleCount = (s.roles || []).length;

  return (
    <div className={`ws-map-card ws-map-card--depth-${depth}`}>
      <button
        type="button"
        className="ws-map-card-head"
        onClick={() => onSelect?.(cap.id)}
        title="Filter the processes panel to this function"
      >
        <div className="ws-map-card-name">{cap.name}</div>
        <div className="ws-map-card-stats">
          {owned > 0 && (
            <span className="ws-map-stat" title="Processes owned by this function">
              {owned} owned
            </span>
          )}
          {shared > 0 && (
            <span className="ws-map-stat ws-map-stat--shared" title="Processes from other functions whose steps touch this one">
              +{shared} shared
            </span>
          )}
          {work > 0 && (
            <span className="ws-map-stat ws-map-stat--work" title="Step minutes attributed to this function (work-weighted)">
              {Hours(work)} work
            </span>
          )}
          {cost > 0 && (
            <span className="ws-map-stat" title="Annual cost of owned processes">
              {Money(cost)}
            </span>
          )}
          {roleCount > 0 && (
            <span className="ws-map-stat ws-map-stat--people" title="Roles tagged to this function">
              {roleCount} role{roleCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </button>

      {(cap.children || []).length > 0 && (
        <div className="ws-map-card-children">
          {cap.children.map((child) => (
            <FunctionCard
              key={child.id}
              cap={child}
              stats={stats}
              depth={depth + 1}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Pure helper — exported for tests if we add them later. Shape:
 *   {
 *     byId: Map<function_id, {
 *       owned, touched, stepMinutes, annualCost,
 *       roles: [name, ...],
 *       systems: [name, ...],
 *     }>
 *   }
 *
 * Step minutes come from the heatmap (preferred), falling back to nothing.
 * Counts come from the processes list, which already carries function_ids[]
 * (server-derived from step functionId tags).
 */
function buildStats({ functions, processes, roles, rollup }) {
  const byId = new Map();
  const ensure = (id) => {
    if (!byId.has(id)) {
      byId.set(id, {
        owned: 0, touched: 0,
        stepMinutes: 0, annualCost: 0,
        roles: [], systems: [],
      });
    }
    return byId.get(id);
  };

  // Walk the flat function list to seed every bucket — even empty ones
  // get a card on the map.
  const flatFromTree = [];
  const collect = (nodes) => {
    for (const n of nodes || []) {
      flatFromTree.push(n);
      if (n.children?.length) collect(n.children);
    }
  };
  collect(functions || []);
  for (const c of flatFromTree) ensure(c.id);

  // Owned vs touched per function
  for (const p of processes || []) {
    if (p.function_id) ensure(p.function_id).owned += 1;
    const touched = new Set([
      ...(p.function_id ? [p.function_id] : []),
      ...(Array.isArray(p.function_ids) ? p.function_ids : []),
    ]);
    for (const fid of touched) ensure(fid).touched += 1;
  }

  // Roles tagged to functions
  for (const r of roles || []) {
    for (const cid of (r.function_ids || [])) {
      ensure(cid).roles.push(r.name);
    }
  }

  // Step minutes + cost from the rollup (per-function bucket).
  // rollup.byFunction shape: [{ functionId, processCount, ... }]
  for (const b of rollup?.byFunction || []) {
    const id = b.functionId;
    if (!id) continue;
    const s = ensure(id);
    if (b.annualCost != null) s.annualCost = b.annualCost;
    if (b.stepMinutes != null) s.stepMinutes = b.stepMinutes;
  }

  return { byId };
}
