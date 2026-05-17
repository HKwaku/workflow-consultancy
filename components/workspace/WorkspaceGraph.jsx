'use client';

/**
 * WorkspaceGraph — operating-model org chart with S-curve connectors.
 *
 * Header: top-level function rectangles, with sub-functions nested inside.
 * Body:   each process is a fixed-width bar sitting in its OWNER's column
 *         (no more spanning rectangles).
 * Linkages: SVG overlay draws cubic-bezier S-curves from each function /
 *         sub-function down to every process associated with it —
 *           - solid line  = owner relationship (process.function_id)
 *           - dashed line = touches relationship (a step in the process is
 *                           tagged to this function via step.functionId)
 *
 * The connector layer makes cross-functional flows visually obvious without
 * widening the rectangles. A process touched by 3 functions has 3 curves
 * arriving at the top of its bar.
 *
 * Click any rectangle → drills back to the list view filtered.
 */

import { useMemo, useState, useCallback } from 'react';
import { formatCurrency } from '@/lib/diagnostic/utils';
import { augmentFunctionsWithOther, otherIdFor } from '@/lib/operatingModel/functionTree';

const COL_WIDTH      = 200; // pixels per leaf column
const FUNC_HEADER_H  = 60;  // top-level function header height
const SUB_HEADER_H   = 38;  // sub-function strip height
const PROC_ROW_H     = 32;  // process bar height
const PROC_ROW_GAP   = 10;
const PROC_TOP_PAD   = 140; // gap below header (sub-function strip) where the first process row starts
const PROC_BAR_W_PAD = 16;  // horizontal padding inside the process column
const SIDE_PAD       = 12;

export default function WorkspaceGraph({ functions, processes, onSelect, onProcessOpen }) {
  const layout = useMemo(() => buildLayout({ functions, processes }), [functions, processes]);

  // Interactive state: which node the user is hovering / has clicked.
  // Hover gives instant feedback; click pins the highlight so the user
  // can move their cursor without losing it.
  const [hovered, setHovered] = useState(null);  // { kind, id }
  const [pinned, setPinned]   = useState(null);  // { kind, id }
  const focus = pinned || hovered;

  // Build adjacency map once: id → Set of connected ids
  // (functions ↔ their owned + touched processes; processes ↔ their owner + touched functions)
  const adjacency = useMemo(() => buildAdjacency(layout.edges), [layout.edges]);

  const onNodeEnter  = useCallback((kind, id) => setHovered({ kind, id }), []);
  const onNodeLeave  = useCallback(() => setHovered(null), []);
  const onNodeClick  = useCallback((kind, id) => {
    setPinned((prev) => (prev?.id === id ? null : { kind, id }));
  }, []);

  if (!functions || functions.length === 0) {
    return (
      <div className="ws-map-empty">
        <p>No functions yet — add one from the function tree to populate the chart.</p>
      </div>
    );
  }

  const { topFuncs, totalCols, processNodes, edges, headerHeight, totalHeight, hasCostData, funcCostRolled } = layout;
  const funcCostTitle = (id) => {
    const c = funcCostRolled?.get(id) || 0;
    return c > 0 ? `${formatCurrency(c)}/yr · ` : '';
  };
  const totalWidth = totalCols * COL_WIDTH + SIDE_PAD * 2;

  // Compute which ids are "in focus" (the focused node + its neighbours).
  // When nothing is focused, everything renders at full opacity.
  const inFocus = focus ? new Set([focus.id, ...(adjacency.get(focus.id) || [])]) : null;
  const isDimmed = (id) => inFocus != null && !inFocus.has(id);
  const isHighlightedEdge = (e) => {
    if (!focus) return false;
    return e.fromId === focus.id || e.toId === focus.id;
  };

  return (
    <div className="ws-orgchart-wrap">
      <div className="ws-orgchart-legend">
        <span><i className="ws-orgchart-swatch ws-orgchart-swatch--func" /> Function</span>
        <span><i className="ws-orgchart-swatch ws-orgchart-swatch--sub" /> Sub-function</span>
        <span><i className="ws-orgchart-swatch ws-orgchart-swatch--proc" /> Process</span>
        <span><i className="ws-orgchart-line ws-orgchart-line--owns" /> owns</span>
        <span><i className="ws-orgchart-line ws-orgchart-line--touches" /> touches</span>
        {hasCostData && (
          <>
            <span title="Process bars and function headers are tinted red in proportion to their annual cost share."><i className="ws-orgchart-swatch ws-orgchart-swatch--heat" /> Cost intensity</span>
            <span title="The process's declared owner is not its largest cost driver."><i className="ws-orgchart-swatch ws-orgchart-swatch--mismatch" /> Owner mismatch</span>
          </>
        )}
      </div>

      <div className="ws-orgchart-scroller">
        <div
          className="ws-orgchart"
          style={{ width: totalWidth, height: totalHeight }}
          onClick={(e) => {
            // Click on empty canvas → clear pinned selection
            if (e.target === e.currentTarget) setPinned(null);
          }}
        >
          {/* SVG overlay: connectors live behind nodes */}
          <svg
            className="ws-orgchart-svg"
            width={totalWidth}
            height={totalHeight}
            aria-hidden
          >
            {edges.map((e) => {
              const dim = focus && !isHighlightedEdge(e);
              const hl  = isHighlightedEdge(e);
              return (
                <path
                  key={e.id}
                  d={sCurve(e.from, e.to)}
                  className={`ws-orgchart-edge ws-orgchart-edge--${e.kind}${dim ? ' ws-orgchart-edge--dim' : ''}${hl ? ' ws-orgchart-edge--hl' : ''}`}
                  fill="none"
                />
              );
            })}
          </svg>

          {/* Header row: top-level function rectangles + sub-functions */}
          <div className="ws-orgchart-header" style={{ height: headerHeight, left: SIDE_PAD }}>
            {topFuncs.map((f) => {
              const w = (f.cols || 1) * COL_WIDTH;
              const fDim = isDimmed(f.id);
              const fHl  = focus?.id === f.id;
              return (
                <div
                  key={f.id}
                  className={`ws-orgchart-func${fDim ? ' ws-orgchart-func--dim' : ''}${fHl ? ' ws-orgchart-func--hl' : ''}`}
                  style={{ left: f.leftCol * COL_WIDTH, width: w, height: headerHeight }}
                  onMouseEnter={() => onNodeEnter('function', f.id)}
                  onMouseLeave={onNodeLeave}
                >
                  <button
                    type="button"
                    className="ws-orgchart-func-label"
                    onClick={(e) => { e.stopPropagation(); onNodeClick('function', f.id); }}
                    onDoubleClick={(e) => { e.stopPropagation(); onSelect?.(f.id); }}
                    title={`${f.name} · ${funcCostTitle(f.id)}Click to highlight · double-click to filter list view`}
                  >
                    {f.name}
                  </button>
                  {(f.children || []).length > 0 && (
                    <div className="ws-orgchart-subrow" style={{ height: SUB_HEADER_H }}>
                      {f.children.map((sub) => {
                        const sDim = isDimmed(sub.id);
                        const sHl  = focus?.id === sub.id;
                        return (
                          <button
                            key={sub.id}
                            type="button"
                            className={`ws-orgchart-subfunc${sDim ? ' ws-orgchart-subfunc--dim' : ''}${sHl ? ' ws-orgchart-subfunc--hl' : ''}`}
                            style={{ width: (sub.cols || 1) * COL_WIDTH - 4 }}
                            onMouseEnter={(ev) => { ev.stopPropagation(); onNodeEnter('function', sub.id); }}
                            onMouseLeave={(ev) => { ev.stopPropagation(); onNodeLeave(); }}
                            onClick={(ev) => { ev.stopPropagation(); onNodeClick('function', sub.id); }}
                            onDoubleClick={(ev) => { ev.stopPropagation(); onSelect?.(sub.id); }}
                            title={`${sub.name} · ${funcCostTitle(sub.id)}Click to highlight · double-click to filter list view`}
                          >
                            {sub.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Process bars — fixed width, positioned in owner column */}
          {processNodes.map((p) => {
            const dim = isDimmed(p.id);
            const hl  = focus?.id === p.id;
            const procHeat = heatColor(p.heatIntensity);
            const cls = [
              'ws-orgchart-proc',
              dim ? 'ws-orgchart-proc--dim' : '',
              hl ? 'ws-orgchart-proc--hl' : '',
              p.mismatch && !hl ? 'ws-orgchart-proc--mismatch' : '',
            ].filter(Boolean).join(' ');
            return (
              <div
                key={p.id}
                className={cls}
                style={{
                  left: p.x,
                  top: p.y,
                  width: p.width,
                  height: PROC_ROW_H,
                  ...(procHeat ? { backgroundColor: procHeat.bg, color: procHeat.fg } : {}),
                }}
                title={`${p.tooltip} · double-click to open the flow artefact`}
                onMouseEnter={() => onNodeEnter('process', p.id)}
                onMouseLeave={onNodeLeave}
                onClick={(e) => { e.stopPropagation(); onNodeClick('process', p.id); }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  // Strip the `p_` prefix off the node id to recover the
                  // process id, then ask the parent to open the flow artefact
                  // on the chat canvas.
                  const processId = p.id.startsWith('p_') ? p.id.slice(2) : p.id;
                  onProcessOpen?.(processId);
                }}
              >
                {p.mismatch && (
                  <span className="ws-orgchart-proc-mismatch-badge" aria-label="Owner mismatch">⚠</span>
                )}
                <span className="ws-orgchart-proc-name">{p.name}</span>
                {p.touchesNames.length > 0 && (
                  <span className="ws-orgchart-proc-spans">
                    spans {p.touchesNames.join(' · ')}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Layout ────────────────────────────────────────────────────── */

function buildLayout({ functions, processes }) {
  // "Other" sub-function injection — shared with the List filter +
  // sidebar so all three surfaces show the identical augmented tree.
  const { tree: fnTree, parentsWithDirect } = augmentFunctionsWithOther(functions, processes);

  // Pass 1: column-span per function (parents = sum of children).
  const flat = [];
  let cursor = 0;
  const annotate = (node, depth) => {
    const kids = node.children || [];
    if (kids.length === 0) {
      const out = { ...node, depth, leftCol: cursor, cols: 1 };
      flat.push(out);
      cursor += 1;
      return out;
    }
    const start = cursor;
    const annotatedKids = kids.map((c) => annotate(c, depth + 1));
    const span = cursor - start;
    const out = { ...node, depth, leftCol: start, cols: span, children: annotatedKids };
    flat.push(out);
    return out;
  };
  const topFuncs = fnTree.map((f) => annotate(f, 0));
  const totalCols = cursor;
  const byId = new Map(flat.map((f) => [f.id, f]));

  // Group processes by owner (column) so we can stack them vertically.
  const procsByOwner = new Map();
  for (const p of processes || []) {
    const owner = p.function_id || '__unfiled__';
    if (!procsByOwner.has(owner)) procsByOwner.set(owner, []);
    procsByOwner.get(owner).push(p);
  }

  // If there are unfiled processes, give them their own column at the right.
  let unfiledCol = null;
  if (procsByOwner.has('__unfiled__')) {
    unfiledCol = cursor; cursor += 1;
  }
  const adjustedTotalCols = cursor;

  // Has any sub-functions? Determines header height.
  const hasSubs = (functions || []).some((f) => (f.children || []).length > 0);
  const headerHeight = FUNC_HEADER_H + (hasSubs ? SUB_HEADER_H : 0);

  // Process node positions — stack within owner column.
  const procColX = (ownerId) => {
    if (ownerId === '__unfiled__') return unfiledCol * COL_WIDTH;
    const f = byId.get(ownerId);
    return (f?.leftCol ?? 0) * COL_WIDTH;
  };
  const procColW = (ownerId) => {
    if (ownerId === '__unfiled__') return COL_WIDTH;
    const f = byId.get(ownerId);
    return (f?.cols ?? 1) * COL_WIDTH;
  };

  // ── Cost attribution + owner-mismatch detection ─────────────────────
  // Each process row carries:
  //   total_annual_cost   (number)
  //   cost_by_function    ({ [funcId]: numericCost })  ← computed in the
  //                       API from step workMinutes
  // For each process: find the top cost-driver function and flag the
  // bar when that driver is not the declared owner.
  const procCost = new Map();   // p.id -> { annualCost, topId, topShare, mismatch }
  const funcCost = new Map();   // fid -> attributed cost (direct; rolled up below)
  for (const p of processes || []) {
    const cbf = p.cost_by_function || {};
    const annualCost = Number(p.total_annual_cost) || 0;
    let topId = null;
    let topCost = 0;
    let distinct = 0;
    for (const [fid, cost] of Object.entries(cbf)) {
      const c = Number(cost) || 0;
      if (c <= 0) continue;
      distinct += 1;
      // Cost tagged directly to a parent lands on its "Other" leaf so
      // the parent stays a pure rollup. topId / mismatch still reason
      // about the function the user actually tagged (the parent), not
      // the synthetic bucket.
      const costId = parentsWithDirect.has(fid) ? otherIdFor(fid) : fid;
      funcCost.set(costId, (funcCost.get(costId) || 0) + c);
      if (c > topCost) { topCost = c; topId = fid; }
    }
    const declared = p.function_id || null;
    // Mismatch only when: process has a declared owner, there's enough
    // attribution to identify a clear top driver, and that driver is a
    // different function. distinct>1 ensures we're not flagging the
    // single-function fallback case where everything sits on the owner.
    const mismatch = !!(declared && topId && topId !== declared && distinct > 1);
    procCost.set(p.id, {
      annualCost,
      topId,
      topShare: annualCost > 0 ? topCost / annualCost : 0,
      mismatch,
    });
  }
  // Rank-based intensity (0..1) so the amber → red gradient reads as a
  // clear "sliding scale" across processes rather than bunching in red.
  // Tied costs share the same intensity; lowest distinct cost = 0 (amber),
  // highest = 1 (red). Function headers stay neutral — the heatmap is
  // a per-process signal.
  //
  // A heatmap of "cost distribution" only means something when costs
  // actually vary. With sparse seed/test data every process can resolve
  // to the SAME default annual cost (deriveProcessMetrics falls back to
  // 4h × £62.5 × 12 × 1 ≈ £3,000 when a process has no cost inputs), so
  // a single distinct value would otherwise paint every bar the same
  // colour and imply a distribution that isn't there. Require ≥2 distinct
  // costs before tinting anything; otherwise stay neutral and hide the
  // legend chip.
  const procCostsSorted = [...new Set([...procCost.values()].map((d) => d.annualCost).filter((c) => c > 0))].sort((a, b) => a - b);
  const hasCostData = procCostsSorted.length >= 2;
  const procIntensityByCost = new Map();
  if (hasCostData) {
    procCostsSorted.forEach((cost, i) => procIntensityByCost.set(cost, i / (procCostsSorted.length - 1)));
  }

  // Parent-direct cost was already remapped onto each parent's injected
  // "Other" leaf during attribution, so no non-leaf carries direct cost.
  // Roll up: a parent's cost = the sum of its (leaf-only) subtree.
  // Tooltip-only — does not feed the per-process heatmap.
  const funcCostRolled = new Map(funcCost);
  for (const f of topFuncs) {
    let total = funcCostRolled.get(f.id) || 0;
    const stack = [...(f.children || [])];
    while (stack.length) {
      const c = stack.pop();
      total += funcCost.get(c.id) || 0;
      if (c.children?.length) stack.push(...c.children);
    }
    funcCostRolled.set(f.id, total);
  }

  // Conservation invariant: Σ process cost == Σ sub-function (leaf)
  // cost == Σ top-level function (rolled) cost. deriveCostByFunction
  // already normalises each process's split to its total, so the only
  // way these diverge is an attributed function id that isn't anywhere
  // in the tree (orphan tag). Warn in dev so that regresses loudly
  // instead of silently dropping cost from the rollup.
  if (typeof window !== 'undefined') {
    const sumProc = [...procCost.values()].reduce((s, d) => s + (d.annualCost || 0), 0);
    const sumLeaf = [...funcCost.values()].reduce((s, c) => s + (c || 0), 0);
    const topIds = new Set(topFuncs.map((f) => f.id));
    const sumTop = [...funcCostRolled.entries()]
      .filter(([id]) => topIds.has(id))
      .reduce((s, [, c]) => s + (c || 0), 0);
    const eps = Math.max(1, sumProc * 1e-6);
    if (Math.abs(sumProc - sumLeaf) > eps || Math.abs(sumLeaf - sumTop) > eps) {
      // eslint-disable-next-line no-console
      console.warn('[rollup] cost conservation broken — some attributed function id is not in the tree:',
        { sumProc, sumSubFunction: sumLeaf, sumFunction: sumTop });
    }
  }
  const heatProcIntensity = (cost) => (hasCostData && cost > 0 ? (procIntensityByCost.get(cost) ?? null) : null);

  const processNodes = [];
  // Sort owners so wider (parent) bars place after narrower (child) bars in
  // the same leftmost column. Without this, a parent with leftCol=0 and one
  // of its sub-functions also at leftCol=0 both grab row 0 and visually
  // overlap (the wider parent bar paints on top of the narrower child).
  // Tie-break: leftCol asc, then cols asc (narrower first).
  const ownerEntries = [...procsByOwner.entries()].sort(([a], [b]) => {
    const A = a === '__unfiled__' ? { left: unfiledCol, cols: 1 } : { left: byId.get(a)?.leftCol ?? Infinity, cols: byId.get(a)?.cols ?? 1 };
    const B = b === '__unfiled__' ? { left: unfiledCol, cols: 1 } : { left: byId.get(b)?.leftCol ?? Infinity, cols: byId.get(b)?.cols ?? 1 };
    if (A.left !== B.left) return A.left - B.left;
    return A.cols - B.cols;
  });

  // Per-column row cursor. Each process bar claims every column it spans
  // for one row, so a parent bar (spans 3 cols) sits BELOW the deepest
  // child bar that has used any of those 3 cols.
  const colNextRow = new Map();
  const claimRowForRange = (startCol, span) => {
    let row = 0;
    for (let c = startCol; c < startCol + span; c++) row = Math.max(row, colNextRow.get(c) || 0);
    for (let c = startCol; c < startCol + span; c++) colNextRow.set(c, row + 1);
    return row;
  };

  for (const [ownerId, procs] of ownerEntries) {
    const colX = procColX(ownerId);
    const colW = procColW(ownerId);
    const ownerFunc = ownerId === '__unfiled__' ? null : byId.get(ownerId);
    const startCol = ownerId === '__unfiled__' ? unfiledCol : (ownerFunc?.leftCol ?? 0);
    const span     = ownerId === '__unfiled__' ? 1          : (ownerFunc?.cols    ?? 1);
    procs.forEach((p) => {
      const row = claimRowForRange(startCol, span);
      const touchesNames = (p.function_ids || [])
        .filter((fid) => fid && fid !== p.function_id)
        .map((fid) => byId.get(fid)?.name)
        .filter(Boolean);
      const y = headerHeight + PROC_TOP_PAD + row * (PROC_ROW_H + PROC_ROW_GAP);
      const cd = procCost.get(p.id) || { annualCost: 0, topId: null, topShare: 0, mismatch: false };
      const topDriverName = cd.topId ? (byId.get(cd.topId)?.name || null) : null;
      const declaredName = ownerFunc?.name || (ownerId === '__unfiled__' ? 'Unfiled' : '');
      const costStr = cd.annualCost > 0 ? ` · ${formatCurrency(cd.annualCost)}/yr` : '';
      const baseTooltip = touchesNames.length
        ? `${procDisplayName(p)} (owned by ${declaredName}, touches ${touchesNames.join(', ')})${costStr}`
        : `${procDisplayName(p)} (${declaredName})${costStr}`;
      // Append the cost-driver line when we have meaningful attribution.
      // For mismatched processes we surface "declared vs. top driver";
      // for matches we still show the share so the user can see where
      // the bar's annual cost is concentrated.
      const costLine = (() => {
        if (!cd.annualCost || !cd.topId) return '';
        const sharePct = Math.round(cd.topShare * 100);
        if (cd.mismatch && topDriverName) {
          return ` · Declared owner: ${declaredName} · Top cost driver: ${topDriverName} (${sharePct}%)`;
        }
        if (topDriverName && sharePct >= 60) {
          return ` · ${sharePct}% of cost in ${topDriverName}`;
        }
        return '';
      })();
      processNodes.push({
        id: `p_${p.id}`,
        ownerId,
        name: procDisplayName(p),
        touchesNames,
        x: colX + PROC_BAR_W_PAD / 2 + SIDE_PAD,
        y,
        width: colW - PROC_BAR_W_PAD,
        tooltip: baseTooltip + costLine,
        // Anchor coords for SVG edges (top-centre of the bar)
        topX: colX + colW / 2 + SIDE_PAD,
        topY: y,
        annualCost: cd.annualCost,
        mismatch: cd.mismatch,
        heatIntensity: heatProcIntensity(cd.annualCost),
      });
    });
  }

  // Total height: header + processes + bottom padding
  const maxRows = Math.max(0, ...[...colNextRow.values()]);
  const totalHeight = headerHeight + PROC_TOP_PAD + maxRows * (PROC_ROW_H + PROC_ROW_GAP) + 24;

  // Function anchor coords for SVG: bottom-centre of each function or
  // sub-function rectangle. Sub-functions anchor from the bottom of THEIR
  // sub-strip (which is the bottom of the parent's box).
  const funcAnchor = new Map();
  for (const f of flat) {
    if (f.depth === 0) {
      // Top-level function — bottom of header rect (use sub-strip bottom if it has subs)
      const x = (f.leftCol + (f.cols || 1) / 2) * COL_WIDTH + SIDE_PAD;
      const y = (f.children || []).length > 0
        ? FUNC_HEADER_H  // sub-strip is below the label; use parent's label bottom for the parent edge
        : headerHeight;
      funcAnchor.set(f.id, { x, y });
    } else {
      // Sub-function — bottom of its sub-strip
      const x = (f.leftCol + 0.5) * COL_WIDTH + SIDE_PAD;
      const y = headerHeight;
      funcAnchor.set(f.id, { x, y });
    }
  }
  if (unfiledCol != null) {
    funcAnchor.set('__unfiled__', { x: (unfiledCol + 0.5) * COL_WIDTH + SIDE_PAD, y: headerHeight });
  }

  // Build edges: owner (solid) + touches (dashed) per process.
  // When a process is filed on / touches a parent that has an injected
  // "Other" sub-function, the connector lands on Other (the bucket that
  // actually holds the cost), not on the parent header.
  const anchorIdFor = (id) => (parentsWithDirect.has(id) ? otherIdFor(id) : id);
  const edges = [];
  for (const node of processNodes) {
    const ownerAnchorId = node.ownerId === '__unfiled__'
      ? '__unfiled__'
      : anchorIdFor(node.ownerId);
    const owner = funcAnchor.get(ownerAnchorId);
    if (owner) {
      edges.push({
        id: `e_owns_${node.id}`,
        fromId: ownerAnchorId,
        toId: node.id,
        from: owner,
        to: { x: node.topX, y: node.topY },
        kind: 'owns',
      });
    }
    // Find original process row for the touches list
    const touchedIds = new Set();
    for (const p of processes || []) {
      if (`p_${p.id}` === node.id) {
        for (const fid of (p.function_ids || [])) {
          if (fid && fid !== p.function_id) touchedIds.add(fid);
        }
      }
    }
    for (const fid of touchedIds) {
      const anchorId = anchorIdFor(fid);
      const a = funcAnchor.get(anchorId);
      if (!a) continue;
      edges.push({
        id: `e_touch_${node.id}_${anchorId}`,
        fromId: anchorId,
        toId: node.id,
        from: a,
        to: { x: node.topX, y: node.topY },
        kind: 'touches',
      });
    }
  }

  return {
    topFuncs,
    totalCols: adjustedTotalCols,
    processNodes,
    edges,
    headerHeight,
    totalHeight,
    hasCostData,
    funcCostRolled,
  };
}

/**
 * Amber → red heatmap colour for a normalised intensity (0..1).
 *   intensity = 0  → amber  rgb(251, 191,  36)
 *   intensity = 1  → red    rgb(220,  38,  38)
 *
 * The fill is OPAQUE on purpose: a translucent tint blended over the
 * theme background (white in light mode, near-black navy in dark mode)
 * muddied amber into brown and killed the gradient. Opaque keeps the
 * palette true in both themes. Returns null for null/negative intensity
 * so no-cost rows keep their default CSS background.
 *
 * @param {number} intensity 0..1
 * @returns {{ bg: string, fg: string } | null} bg fill + a contrasting
 *   text colour (dark on the amber end, white on the red end).
 */
function heatColor(intensity) {
  // intensity == null  → no cost data on this row → leave it unstyled
  // intensity == 0     → lowest in the rank → pure amber
  // intensity == 1     → highest in the rank → pure red
  if (intensity == null || intensity < 0) return null;
  const i = Math.max(0, Math.min(1, intensity));
  const r = Math.round(251 + (220 - 251) * i);
  const g = Math.round(191 + ( 38 - 191) * i);
  const b = Math.round( 36 + ( 38 -  36) * i);
  // Perceived luminance → flip text to stay readable across the ramp
  // (dark text on the bright amber low end, white on the dark red end).
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const fg = lum > 140 ? '#1e293b' : '#ffffff';
  return { bg: `rgb(${r}, ${g}, ${b})`, fg };
}

/* ── SVG path helpers ──────────────────────────────────────────── */

// Cubic bezier S-curve from (x1,y1) to (x2,y2): control points sit at
// the vertical midpoint, on the same x as the endpoints. Same shape
// ReactFlow's `smoothstep`/`bezier` produces — clean S whether the
// endpoints are aligned or offset.
function sCurve({ x: x1, y: y1 }, { x: x2, y: y2 }) {
  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}

/* ── Small helpers ─────────────────────────────────────────────── */

function procDisplayName(p) {
  return p.process_name || p.company || p.contact_name || 'Untitled';
}

// Build an undirected adjacency map from the edge list so we can answer
// "who is connected to node X" in O(1) for hover-highlight.
function buildAdjacency(edges) {
  const m = new Map();
  const add = (a, b) => {
    if (!m.has(a)) m.set(a, new Set());
    m.get(a).add(b);
  };
  for (const e of edges || []) {
    if (!e.fromId || !e.toId) continue;
    add(e.fromId, e.toId);
    add(e.toId, e.fromId);
  }
  return m;
}
