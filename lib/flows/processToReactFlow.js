/**
 * Converts a process (steps, handoffs) to React Flow nodes and edges.
 * Supports grid and swimlane layouts.
 */

import { prepareSteps, resolveBranchTarget, formatDuration, formatWorkWait } from './shared.js';
import { repairFlow } from './normalizer.js';

const NODE_W = 150;   // step node width
const NODE_H = 72;    // step node height — rectangle
const MERGE_W = 120;  // merge circle diameter (matches FlowNodes MERGE_SZ)
const MERGE_H = 120;  // merge circle diameter
const NODE_GAP_X = 80;
const NODE_GAP_Y = 80; // extra vertical room for below-node labels

const PAD = 80;
const TERM_W = 240;
const TERM_H = 52;
const DIAMOND_W = 240; // matches FlowNodes DIAMOND_SZ
const DIAMOND_H = 120;
const DEPT_LABEL_WIDTH = 180;

/** Default max steps per row (wrap layout only) — overridden by opts.maxCols */
const MAX_COLS = 9;

/** Department colour palette — same 10 hues as BAR_COLORS in FlowNodes */
export const DEPT_PALETTE = [
  { bar: '#0d9488', bg: 'rgba(13,148,136,0.08)',  text: '#0d9488' },
  { bar: '#3b82f6', bg: 'rgba(59,130,246,0.08)',  text: '#3b82f6' },
  { bar: '#8b5cf6', bg: 'rgba(139,92,246,0.08)',  text: '#8b5cf6' },
  { bar: '#f59e0b', bg: 'rgba(245,158,11,0.08)',  text: '#d97706' },
  { bar: '#10b981', bg: 'rgba(16,185,129,0.08)',  text: '#059669' },
  { bar: '#ef4444', bg: 'rgba(239,68,68,0.08)',   text: '#dc2626' },
  { bar: '#ec4899', bg: 'rgba(236,72,153,0.08)',  text: '#db2777' },
  { bar: '#06b6d4', bg: 'rgba(6,182,212,0.08)',   text: '#0891b2' },
  { bar: '#84cc16', bg: 'rgba(132,204,22,0.08)',  text: '#65a30d' },
  { bar: '#f97316', bg: 'rgba(249,115,22,0.08)',  text: '#ea580c' },
];

/** Build a dept→colour map for all unique departments in appearance order */
function buildDeptColorMap(allSteps) {
  const map = {};
  let idx = 0;
  allSteps.forEach((s) => {
    if (s.department != null && !(s.department in map)) {
      map[s.department] = { ...DEPT_PALETTE[idx % DEPT_PALETTE.length], name: s.department };
      idx++;
    }
  });
  return map;
}

/**
 * Compute linear positions — all nodes in a single left-to-right row, no wrapping.
 */
function computeLinearLayout(allSteps) {
  const colW = Math.max(NODE_W, DIAMOND_W) + Math.ceil(NODE_GAP_X / 2);
  const tallestNode = Math.max(NODE_H, DIAMOND_W);
  const baseY = PAD + TERM_H + 40;
  const nodePos = [];

  allSteps.forEach((s, i) => {
    const x = PAD + i * colW;
    const y = baseY;
    nodePos[i] = { x, y, cx: x + NODE_W / 2, cy: y + tallestNode / 2, row: 0, col: i };
  });

  const firstY = baseY + tallestNode / 2;
  const lastY = firstY;
  const lastX = PAD + allSteps.length * colW;

  return { nodePos, firstY, lastY, lastX, colW, rowH: tallestNode + NODE_GAP_Y, cols: allSteps.length };
}

/**
 * Compute wrap positions — every row flows left-to-right.
 * The wrap connector goes from the RIGHT end of one row to the LEFT start of the next.
 */
function computeWrapLayout(allSteps, maxCols = MAX_COLS) {
  // Horizontal: colW guarantees >= NODE_GAP_X/2 gap between any two nodes in the same row
  const colW = Math.max(NODE_W, DIAMOND_W) + Math.ceil(NODE_GAP_X / 2);
  const tallestNode = Math.max(NODE_H, DIAMOND_W);
  // Extra vertical gap keeps the orthogonal wrap connector clear of node labels
  // and gives the rows a clean, spacious appearance.
  const rowH = tallestNode + Math.max(NODE_GAP_Y, Math.ceil(NODE_GAP_X / 2)) + 60;
  const baseY = PAD + TERM_H + 40;
  const nodePos = [];

  allSteps.forEach((s, i) => {
    const col = i % maxCols;
    const row = Math.floor(i / maxCols);
    const x = PAD + col * colW;
    const y = baseY + row * rowH;
    const isDecision = s.isDecision && (s.branches || []).length > 0;
    const nodeH = isDecision ? DIAMOND_W : NODE_H;
    const yCenter = y + nodeH / 2;
    nodePos[i] = { x, y, cx: x + NODE_W / 2, cy: yCenter, row, col };
  });

  const totalRows = Math.ceil(allSteps.length / maxCols);
  const lastRowCount = allSteps.length % maxCols || maxCols;

  // firstY: vertical centre of the first row's node zone (for Start node alignment)
  const firstY = baseY + tallestNode / 2;
  // lastY: vertical centre of the last row's node zone (for End node alignment)
  const lastY = baseY + (totalRows - 1) * rowH + tallestNode / 2;
  // lastX: right edge of the last node on the last row + half-gap (End node always to the right)
  const lastX = PAD + (lastRowCount - 1) * colW + NODE_W + Math.ceil(NODE_GAP_X / 2);

  return { nodePos, firstY, lastY, lastX, colW, rowH, cols: maxCols, lastRowIsOdd: false };
}

/**
 * Compute swimlane positions (horizontal flow per department).
 */
function computeSwimlaneLayout(allSteps) {
  const deptOrder = [];
  const deptMap = {};
  allSteps.forEach((s) => {
    if (!deptMap[s.department]) {
      deptMap[s.department] = [];
      deptOrder.push(s.department);
    }
    deptMap[s.department].push(s);
  });

  // colW must accommodate the widest node (diamond) plus at least half a gap
  const colW = Math.max(NODE_W, DIAMOND_W) + Math.ceil(NODE_GAP_X / 2);
  const LANE_PAD = 30;
  const LANE_GAP = 8;
  const START_X = DEPT_LABEL_WIDTH + PAD + TERM_W + NODE_GAP_X;

  let laneY = PAD + 60;
  const nodePos = [];
  const lanes = [];

  deptOrder.forEach((dept) => {
    const deptSteps = deptMap[dept] || [];
    const hasDec = deptSteps.some((s) => s.isDecision && (s.branches || []).length > 0);
    const hasMerge = deptSteps.some((s) => s.isMerge);
    const tallest = hasDec ? DIAMOND_W : hasMerge ? MERGE_H : NODE_H;
    const laneH = tallest + LANE_PAD * 2;
    lanes.push({ dept, y: laneY, h: laneH });

    deptSteps.forEach((s) => {
      const nx = START_X + s.idx * colW;
      const nodeH = s.isDecision && (s.branches || []).length > 0 ? DIAMOND_W : s.isMerge ? MERGE_H : NODE_H;
      const ny = laneY + (laneH - nodeH) / 2;
      nodePos[s.idx] = { x: nx, y: ny, cx: nx + NODE_W / 2, cy: ny + nodeH / 2 };
    });
    laneY += laneH + LANE_GAP;
  });

  const firstLane = lanes.find((l) => l.dept === allSteps[0]?.department);
  const lastLane = lanes.find((l) => l.dept === allSteps[allSteps.length - 1]?.department);
  const firstY = firstLane ? firstLane.y + firstLane.h / 2 - TERM_H / 2 : PAD;
  const lastX = START_X + allSteps.length * colW + 20;
  const lastY = lastLane ? lastLane.y + lastLane.h / 2 - TERM_H / 2 : laneY - LANE_GAP;

  return { nodePos, firstY, lastY, lastX, lanes, colW, rowH: NODE_H + NODE_GAP_Y };
}

/**
 * Post-process node positions so decision branches fan out vertically.
 * Each branch gets its own horizontal row, spread evenly above/below the
 * decision node's centre Y.  Sequential steps within a branch continue to the
 * right at the same row Y.  A merge node (if present) is re-centred to the
 * right of all branch tails.
 *
 * Only applied for grid/wrap layouts (swimlane handles rows via departments).
 */
function fanDecisionBranches(nodes, allSteps) {
  const BRANCH_SPACING = NODE_H + NODE_GAP_Y + 20; // vertical gap between branch rows

  const nodeMap = {};
  nodes.forEach((n) => { nodeMap[n.id] = n; });

  // All step indices that are direct targets of any decision branch
  const allBranchTargetIdxs = new Set();
  allSteps.forEach((s) => {
    if (!s.isDecision || !s.branches?.length) return;
    s.branches.forEach((br) => {
      const ti = resolveBranchTarget(br.target || br.targetStep, allSteps);
      if (ti >= 0) allBranchTargetIdxs.add(ti);
    });
  });

  allSteps.forEach((s, i) => {
    if (!s.isDecision || !s.branches?.length || s.branches.length < 2) return;
    const decNode = nodeMap[`step-${i}`];
    if (!decNode) return;

    const decCenterY = decNode.position.y + DIAMOND_H / 2;
    const nBr = s.branches.length;

    const targets = s.branches
      .map((br) => resolveBranchTarget(br.target || br.targetStep, allSteps))
      .filter((ti) => ti >= 0 && ti < allSteps.length);

    const branchStartX = decNode.position.x + DIAMOND_W + NODE_GAP_X;

    // Only stop at the start of *another branch of this same decision*.
    // Using allBranchTargetIdxs (global set) would stop the walk prematurely
    // if any other decision has a branch target inside the current branch.
    const thisDecisionTargets = new Set(targets);

    // Spread each branch onto its own row
    targets.forEach((targetIdx, bi) => {
      const yOffset = (bi - (nBr - 1) / 2) * BRANCH_SPACING;
      const rowY = decCenterY + yOffset - NODE_H / 2;

      let cur = targetIdx;
      let col = 0;
      while (cur >= 0 && cur < allSteps.length) {
        const n = nodeMap[`step-${cur}`];
        if (!n) break;
        n.position.x = branchStartX + col * (NODE_W + NODE_GAP_X);
        n.position.y = rowY;
        col++;
        const nxt = cur + 1;
        if (nxt >= allSteps.length) break;
        // Stop at the start of another branch of THIS decision, or at a merge node.
        // Do NOT stop at branch targets of other decisions — that would cut the walk
        // short when a nested decision exists inside this branch.
        if (thisDecisionTargets.has(nxt)) break;
        if (allSteps[nxt]?.isMerge) break;
        cur = nxt;
      }
    });

    // Reposition merge node (parallel): right of all branch tails, centred on decision Y
    const mergeStep = allSteps.slice(i + 1).find((st) => st.isMerge);
    if (mergeStep) {
      const mi = allSteps.indexOf(mergeStep);
      const mergeNode = nodeMap[`step-${mi}`];
      if (mergeNode) {
        let maxX = branchStartX;
        targets.forEach((ti) => {
          let cur = ti;
          while (cur >= 0 && cur < mi) {
            const n = nodeMap[`step-${cur}`];
            if (n) maxX = Math.max(maxX, n.position.x + NODE_W);
            const nxt = cur + 1;
            if (nxt >= allSteps.length || thisDecisionTargets.has(nxt)) break;
            cur = nxt;
          }
        });
        mergeNode.position.x = maxX + NODE_GAP_X;
        mergeNode.position.y = decCenterY - MERGE_H / 2;
      }
    }

  });
}

/** Swimlane layout constants for use when recomputing lanes from node positions */
export const SWIMLANE_CONSTANTS = {
  NODE_H,
  DIAMOND_W,
  MERGE_H,
  LANE_PAD: 30,
  LANE_GAP: 8,
  PAD: 80,
};

/**
 * Recompute swimlane lane heights from current node positions.
 * Expands lanes in both directions and cascades upward when a lane needs
 * to shift above the previous lane.
 * @param {Array} nodes - React Flow nodes (including step/decision/merge nodes)
 * @param {Array} initialLanes - Lanes from computeSwimlaneLayout
 * @returns {{ lanes: Array, layoutHeight: number }}
 */
export function recomputeSwimlaneLanesFromNodes(nodes, initialLanes) {
  if (!initialLanes?.length) return { lanes: initialLanes, layoutHeight: 0 };
  const { NODE_H, DIAMOND_W, MERGE_H, LANE_PAD, LANE_GAP } = SWIMLANE_CONSTANTS;

  // Include merge nodes — they have a dept and occupy lane space
  const stepNodes = nodes.filter(
    (n) => (n.type === 'step' || n.type === 'decision' || n.type === 'merge') && n.data?.department != null
  );
  const deptToNodes = {};
  stepNodes.forEach((n) => {
    const dept = n.data.department;
    if (!deptToNodes[dept]) deptToNodes[dept] = [];
    deptToNodes[dept].push(n);
  });

  const nLanes = initialLanes.length;

  // For each lane, compute the tightest Y range needed to contain its nodes (+ LANE_PAD)
  const reqTop = initialLanes.map((lane) => {
    const deptNodes = deptToNodes[lane.dept] || [];
    let top = lane.y + LANE_PAD; // default: no overflow
    deptNodes.forEach((n) => { top = Math.min(top, n.position?.y ?? top); });
    return top - LANE_PAD; // ideal lane top
  });
  const reqBottom = initialLanes.map((lane) => {
    const deptNodes = deptToNodes[lane.dept] || [];
    let bottom = lane.y + lane.h - LANE_PAD; // default: no overflow
    deptNodes.forEach((n) => {
      const nodeH = n.type === 'decision' ? DIAMOND_W : n.type === 'merge' ? MERGE_H : NODE_H;
      bottom = Math.max(bottom, (n.position?.y ?? 0) + nodeH);
    });
    return bottom + LANE_PAD; // ideal lane bottom
  });

  // Start from ideal positions
  const idealY = reqTop.slice();
  const idealH = initialLanes.map((lane, i) => Math.max(lane.h, reqBottom[i] - reqTop[i]));

  // Backward pass: if lane[i] needs to start at idealY[i], cascade lane[i-1] upward
  // so it ends at idealY[i] - LANE_GAP. Repeat until stable.
  for (let pass = 0; pass < nLanes; pass++) {
    let changed = false;
    for (let i = 1; i < nLanes; i++) {
      const maxPrevBottom = idealY[i] - LANE_GAP;
      const prevBottom = idealY[i - 1] + idealH[i - 1];
      if (prevBottom > maxPrevBottom) {
        const newPrevY = maxPrevBottom - idealH[i - 1];
        if (newPrevY < idealY[i - 1]) {
          idealY[i - 1] = newPrevY;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // Forward pass: resolve any remaining overlaps top-to-bottom
  for (let i = 1; i < nLanes; i++) {
    const prevBottom = idealY[i - 1] + idealH[i - 1];
    if (idealY[i] < prevBottom + LANE_GAP) {
      idealY[i] = prevBottom + LANE_GAP;
    }
    // Height must cover content from the (possibly pushed) new Y
    idealH[i] = Math.max(initialLanes[i].h, reqBottom[i] - idealY[i]);
  }

  const reflowed = initialLanes.map((lane, i) => ({ ...lane, y: idealY[i], h: idealH[i] }));
  const layoutHeight = reflowed.length > 0 ? reflowed[reflowed.length - 1].y + reflowed[reflowed.length - 1].h : 0;
  return { lanes: reflowed, layoutHeight };
}

/**
 * Convert process to React Flow nodes and edges.
 * @param {Object} process - { steps, handoffs, definition, processName }
 * @param {'grid'|'swimlane'} layout - Layout mode
 * @param {boolean} darkTheme - Dark theme
 * @returns {{ nodes: Array, edges: Array }}
 */
export function processToReactFlow(process, layout = 'grid', darkTheme = false, opts = {}) {
  const { steps: repairedSteps } = repairFlow(process.steps || []);
  const normalizedProcess = { ...process, steps: repairedSteps };
  const { allSteps, handoffMap, startLabel, endLabel } = prepareSteps(normalizedProcess);
  if (allSteps.length === 0) return { nodes: [], edges: [], deptColorMap: {} };

  const effectiveMaxCols = opts.maxCols ?? MAX_COLS;
  const isGrid = layout === 'grid' || layout === 'wrap';
  const deptColorMap = buildDeptColorMap(allSteps);
  const layoutData = layout === 'grid'
    ? computeLinearLayout(allSteps)
    : layout === 'wrap'
      ? computeWrapLayout(allSteps, effectiveMaxCols)
      : computeSwimlaneLayout(allSteps);
  const { nodePos, firstY, lastY } = layoutData;
  const cols = 0; /* single-row grid: no row-wrap animation */
  const lastX = layoutData.lastX || nodePos[allSteps.length - 1]?.cx || PAD + 400;

  const nodes = [];
  const edges = [];

  // Swimlane: horizontal lane separators (behind) + department labels on the left
  if (!isGrid && layoutData.lanes?.length) {
    const sepWidth = (layoutData.lastX || 800) + 100;
    const lastLane = layoutData.lanes[layoutData.lanes.length - 1];
    const sepNode = (id, y) => ({
      id,
      type: 'laneSeparator',
      position: { x: 0, y },
      data: { width: sepWidth, darkTheme },
      draggable: false,
      selectable: false,
      connectable: false,
      zIndex: 0,
    });

    // Top border
    nodes.push(sepNode('lane-sep-top', layoutData.lanes[0].y));

    layoutData.lanes.forEach((lane, li) => {
      // Line between lanes
      if (li > 0) nodes.push(sepNode(`lane-sep-${li}`, lane.y - 1));
      nodes.push({
        id: `lane-${li}`,
        type: 'laneLabel',
        position: { x: 0, y: lane.y },
        data: { label: lane.dept, darkTheme, width: DEPT_LABEL_WIDTH, height: lane.h },
        draggable: false,
        selectable: false,
        connectable: false,
      });
    });

    // Bottom border
    nodes.push(sepNode('lane-sep-bottom', lastLane.y + lastLane.h));
  }

  const tallestNode = Math.max(NODE_H, DIAMOND_W);

  // Start node
  // Grid: centred above step-0 (above the first row's node zone)
  // Swimlane: to the left of the first step
  const firstStepLeft = nodePos[0]?.x ?? PAD;
  const startX = isGrid
    ? (nodePos[0]?.cx ?? PAD + TERM_W / 2)
    : firstStepLeft - TERM_W / 2 - NODE_GAP_X;
  // For grid: place start above the first row; for swimlane: align with firstY
  const startY = isGrid ? firstY - tallestNode / 2 - TERM_H - Math.ceil(NODE_GAP_X / 2) : firstY - TERM_H / 2;
  nodes.push({
    id: 'start',
    type: 'start',
    position: { x: startX - TERM_W / 2, y: startY },
    data: { label: startLabel || 'Start', darkTheme },
    draggable: true,
    deletable: false,
  });

  const rowH = layoutData.rowH || NODE_H + NODE_GAP_Y;

  // Step nodes
  allSteps.forEach((s, i) => {
    const pos = nodePos[i];
    if (!pos) return;

    const isDecision = s.isDecision && (s.branches || []).length > 0;
    const deptEntry = s.department != null ? deptColorMap[s.department] : null;
    const dc = deptEntry
      ? {
          bg: darkTheme ? 'rgba(255,255,255,0.04)' : deptEntry.bg,
          stroke: deptEntry.bar,
          bar: deptEntry.bar,
          text: deptEntry.text,
          name: deptEntry.name,
        }
      : (darkTheme ? { bg: '#2d2d2d', stroke: '#94a3b8' } : { bg: '#ffffff', stroke: '#94a3b8' });
    const isMerge = !!s.isMerge;
    const nodeW = isDecision ? DIAMOND_W : isMerge ? MERGE_W : NODE_W;
    const nodeH = isDecision ? DIAMOND_W : isMerge ? MERGE_H : NODE_H;
    const offsetX = (NODE_W - nodeW) / 2;
    // Centre within the tallest-node zone, not the full rowH (which includes inter-row gap)
    const offsetY = isGrid ? (tallestNode - nodeH) / 2 : 0;
    nodes.push({
      id: `step-${i}`,
      type: isDecision ? 'decision' : isMerge ? 'merge' : 'step',
      position: { x: pos.x + offsetX, y: pos.y + offsetY },
      data: {
        label: s.name || (isMerge ? 'Merge' : `Step ${i + 1}`),
        stepIndex: i,
        step: s,
        department: s.department,
        isDecision,
        isParallel: !!s.parallel,
        isInclusive: !!s.inclusive,
        isExternal: s.isExternal,
        isBottleneck: s.isBottleneck,
        isApproval: s.isApproval,
        auto: s.auto,
        branches: s.branches || [],
        deptColor: dc,
        showDept: !!deptEntry,
        darkTheme,
        workMinutes: s.workMinutes ?? null,
        waitMinutes: s.waitMinutes ?? null,
        durationLabel: formatWorkWait(s.workMinutes, s.waitMinutes) || formatDuration(s.durationMinutes),
      },
      draggable: true,
    });
  });

  // End node
  nodes.push({
    id: 'end',
    type: 'end',
    position: { x: lastX - TERM_W / 2, y: lastY - TERM_H / 2 },
    data: { label: endLabel || 'End', darkTheme },
    draggable: true,
    deletable: false,
  });

  // Pre-collect all branch targets so sequential edges don't block them.
  const branchTargetIds = new Set();
  allSteps.forEach((s) => {
    if (!s.isDecision || !s.branches?.length) return;
    s.branches.forEach((br) => {
      const targetIdx = resolveBranchTarget(br.target || br.targetStep, allSteps);
      if (targetIdx >= 0 && targetIdx < allSteps.length) {
        branchTargetIds.add(`step-${targetIdx}`);
      }
    });
  });

  // Track which targets already have an incoming edge (for sequential dedup only)
  const targetsWithIncoming = new Set();

  // Minimal process-derived edges. User can delete/reconnect any edge.
  // Start -> first step
  if (allSteps.length > 0) {
    edges.push({
      id: 'e-start-0',
      source: 'start',
      target: 'step-0',
      sourceHandle: 'bottom',
      targetHandle: 'top',
      type: 'default',
      style: { stroke: '#059669' },
    });
    targetsWithIncoming.add('step-0');
  }

  const isWrap = layout === 'wrap';

  if (isWrap) {
    // ── Wrap layout: purely sequential edges, no decision branches ──────────
    // Decision branches would draw cross-row diagonal connectors; in wrap mode
    // the flow is shown as a clean left-to-right snake with no branching overlay.
    for (let i = 0; i < allSteps.length - 1; i++) {
      const fromRow = nodePos[i]?.row ?? Math.floor(i / effectiveMaxCols);
      const toRow   = nodePos[i + 1]?.row ?? Math.floor((i + 1) / effectiveMaxCols);
      const crossRow = fromRow !== toRow;
      edges.push({
        id: `e-seq-${i}-${i + 1}`,
        source: `step-${i}`,
        target: `step-${i + 1}`,
        sourceHandle: 'right',
        targetHandle: 'left',
        type: crossRow ? 'wrapConnector' : 'default',
      });
    }
  } else {
    // ── Grid / swimlane: full edge logic with decision branches ──────────────
    // Sequential edges for consecutive steps. Skip step-i → step-i+1 when
    // step-i is a decision (decision branches define those connections). Also
    // skip if the next step is a decision branch target.
    if (allSteps.length >= 2) {
      for (let i = 0; i < allSteps.length - 1; i++) {
        const isDecision = allSteps[i].isDecision && (allSteps[i].branches || []).length > 0;
        if (!isDecision) {
          const tgt = `step-${i + 1}`;
          if (!targetsWithIncoming.has(tgt) && !branchTargetIds.has(tgt)) {
            edges.push({
              id: `e-seq-${i}-${i + 1}`,
              source: `step-${i}`,
              target: tgt,
              sourceHandle: 'right',
              targetHandle: 'left',
              type: 'default',
            });
            targetsWithIncoming.add(tgt);
          }
        }
      }
    }

    // Decision branches (user-configured targets).
    allSteps.forEach((s, i) => {
      if (!s.isDecision || !s.branches?.length) return;
      const isParallel = !!s.parallel;
      const isInclusive = !!s.inclusive;
      s.branches.forEach((br, bi) => {
        const targetIdx = resolveBranchTarget(br.target || br.targetStep, allSteps);
        if (targetIdx >= 0 && targetIdx < allSteps.length) {
          const targetId = `step-${targetIdx}`;
          const color = '#94a3b8';
          const rawLabel = br.label?.trim() || (bi === 0 ? 'Yes' : bi === 1 ? 'No' : `Option ${bi + 1}`);
          const branchLabel = isParallel ? `All: ${rawLabel}` : isInclusive ? `If: ${rawLabel}` : rawLabel;
          edges.push({
            id: `e-dec-${i}-${targetIdx}-${bi}`,
            source: `step-${i}`,
            target: targetId,
            sourceHandle: 'right',
            targetHandle: targetIdx < i ? 'top' : 'left',
            type: 'decisionBranch',
            label: branchLabel,
            labelShowBg: true,
            labelStyle: { fill: color, fontWeight: 600, fontSize: 11 },
            labelBgStyle: { fill: darkTheme ? '#2d2d2d' : '#ffffff', fillOpacity: 0.95 },
            labelBgPadding: [6, 4],
            labelBgBorderRadius: 4,
            data: { label: br.label || '', branchIndex: bi, isParallel, isInclusive },
            style: {
              stroke: color,
              strokeWidth: (isParallel || isInclusive) ? 2.5 : 2,
              strokeDasharray: targetIdx < i ? '6 4' : (isParallel || isInclusive) ? '4 4' : undefined,
            },
            zIndex: 1001,
          });
        }
      });
    });

    // Auto-wire branch terminals to their merge node.
    // Iterate by decision rather than by merge so each decision's branches only
    // connect to *its own* merge — not to a later merge that belongs to a
    // different decision block.
    allSteps.forEach((decStep, d) => {
      // Auto-wire branch terminals to the nearest downstream isMerge step.
      // Applies to any decision type (parallel, inclusive, exclusive) — an
      // exclusive Yes/No still benefits from an explicit rejoin when the
      // modeller flags a downstream step as the convergence point.
      if (!decStep.isDecision || !decStep.branches?.length) return;

      const targets = decStep.branches
        .map((br) => resolveBranchTarget(br.target || br.targetStep, allSteps))
        .filter((t) => t >= 0 && t < allSteps.length);
      if (!targets.length) return;

      // Find the merge node that belongs to this decision: first isMerge step
      // after the furthest branch target.
      const maxTarget = Math.max(...targets);
      let mergeIdx = -1;
      for (let m = maxTarget + 1; m < allSteps.length; m++) {
        if (allSteps[m].isMerge) { mergeIdx = m; break; }
      }
      if (mergeIdx < 0) return;

      const mergeId = `step-${mergeIdx}`;

      targets.forEach((j) => {
        // Skip backward-pointing branches (loop-backs or name-resolution collisions
        // where a branch target resolves to a step before the decision itself).
        // Auto-wiring those to the merge would incorrectly connect preceding nodes.
        if (j <= d) return;

        // Walk forward from the branch target to find its last sequential step
        // before hitting another branch start, a decision, or the merge itself.
        let terminal = j;
        for (let k = j + 1; k < mergeIdx; k++) {
          if (branchTargetIds.has(`step-${k}`)) break;
          if (allSteps[k]?.isDecision && (allSteps[k].branches || []).length > 0) break;
          terminal = k;
        }

        const terminalId = `step-${terminal}`;
        const alreadyConnected = edges.some((e) => e.source === terminalId && e.target === mergeId);
        if (!alreadyConnected) {
          edges.push({
            id: `e-merge-${terminal}-${mergeIdx}`,
            source: terminalId,
            target: mergeId,
            sourceHandle: 'right',
            targetHandle: 'left',
            type: 'default',
            style: { stroke: '#94a3b8' },
          });
        }
      });
    });
  } // end else (non-wrap edge logic)

  // Last step -> end (user can delete and reconnect)
  // In grid layout, End node is to the right of the last step → right→left
  // In wrap snake layout, odd last rows put the End node to the LEFT → left→right
  // In swimlane layout, End node is to the right as well
  if (allSteps.length > 0) {
    edges.push({
      id: 'e-last-end',
      source: `step-${allSteps.length - 1}`,
      target: 'end',
      sourceHandle: 'right',
      targetHandle: 'left',
      type: 'default',
      style: { stroke: '#059669' },
    });
  }

  // Fan decision branches vertically only for linear grid (single row).
  // Wrap layout uses a snake grid — nodes already have fixed row positions and
  // fanning would push branch targets off their rows, causing overlaps.
  if (layout === 'grid') fanDecisionBranches(nodes, allSteps);

  return {
    nodes,
    edges,
    lanes: layoutData.lanes,
    layoutHeight: isGrid ? undefined : layoutData.lanes?.reduce((acc, l) => Math.max(acc, l.y + l.h), 0) ?? 0,
    deptColorMap,
  };
}
