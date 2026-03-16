/**
 * Converts a process (steps, handoffs) to React Flow nodes and edges.
 * Supports grid and swimlane layouts.
 */

import { prepareSteps, resolveBranchTarget, formatDuration, formatWorkWait } from './shared.js';

const NODE_W = 150;   // step/merge node width (matches FlowNodes NODE_W)
const NODE_H = 72;    // step/merge node height — rectangle
const NODE_GAP_X = 80;
const NODE_GAP_Y = 80; // extra vertical room for below-node labels

const PAD = 80;
const TERM_W = 240;
const TERM_H = 52;
const DIAMOND_W = 240; // matches FlowNodes DIAMOND_SZ
const DIAMOND_H = 120;
const DEPT_LABEL_WIDTH = 180;

/** Max steps per row before wrapping to the next row (wrap layout only) */
const MAX_COLS = 7;

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
 * Compute wrap positions — nodes flow left-to-right then wrap to the next row.
 * Minimum gap rule applies both horizontally and vertically.
 */
function computeWrapLayout(allSteps) {
  // Horizontal: colW guarantees >= NODE_GAP_X/2 gap between any two nodes in the same row
  const colW = Math.max(NODE_W, DIAMOND_W) + Math.ceil(NODE_GAP_X / 2);
  // Vertical: rowH guarantees >= NODE_GAP_X/2 gap between any two nodes in adjacent rows
  const tallestNode = Math.max(NODE_H, DIAMOND_W);
  const rowH = tallestNode + Math.max(NODE_GAP_Y, Math.ceil(NODE_GAP_X / 2));
  const baseY = PAD + TERM_H + 40;
  const nodePos = [];

  allSteps.forEach((s, i) => {
    const col = i % MAX_COLS;
    const row = Math.floor(i / MAX_COLS);
    const x = PAD + col * colW;
    const y = baseY + row * rowH;
    const isDecision = s.isDecision && (s.branches || []).length > 0;
    const nodeH = isDecision ? DIAMOND_W : NODE_H;
    const yCenter = y + nodeH / 2;
    nodePos[i] = { x, y, cx: x + NODE_W / 2, cy: yCenter, row, col };
  });

  const totalRows = Math.ceil(allSteps.length / MAX_COLS);
  const lastRowCount = allSteps.length % MAX_COLS || MAX_COLS;

  // firstY: vertical centre of the first row's node zone (for Start node alignment)
  const firstY = baseY + tallestNode / 2;
  // lastY: vertical centre of the last row's node zone (for End node alignment)
  const lastY = baseY + (totalRows - 1) * rowH + tallestNode / 2;
  // lastX: right edge of the last node on the last row + half-gap
  const lastX = PAD + (lastRowCount - 1) * colW + NODE_W + Math.ceil(NODE_GAP_X / 2);

  return { nodePos, firstY, lastY, lastX, colW, rowH, cols: MAX_COLS };
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
    const laneH = hasDec ? DIAMOND_W + LANE_PAD * 2 : NODE_H + LANE_PAD * 2;
    lanes.push({ dept, y: laneY, h: laneH });

    deptSteps.forEach((s) => {
      const nx = START_X + s.idx * colW;
      const nodeH = s.isDecision && (s.branches || []).length > 0 ? DIAMOND_W : NODE_H;
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
        // Stop when entering another branch's territory or a merge/decision
        if (allBranchTargetIdxs.has(nxt)) break;
        if (allSteps[nxt]?.isMerge) break;
        if (allSteps[nxt]?.isDecision && (allSteps[nxt]?.branches?.length ?? 0) > 0) break;
        cur = nxt;
      }
    });

    // Reposition merge node: right of all branch tails, centred on the decision Y
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
            if (nxt >= allSteps.length || allBranchTargetIdxs.has(nxt)) break;
            cur = nxt;
          }
        });
        mergeNode.position.x = maxX + NODE_GAP_X;
        mergeNode.position.y = decCenterY - NODE_H / 2;
      }
    }
  });
}

/** Swimlane layout constants for use when recomputing lanes from node positions */
export const SWIMLANE_CONSTANTS = {
  NODE_H,
  DIAMOND_W,
  LANE_PAD: 30,
  LANE_GAP: 8,
  PAD: 80,
};

/**
 * Recompute swimlane lane heights from current node positions.
 * Expands lane rows when nodes are dragged below the lane bottom.
 * @param {Array} nodes - React Flow nodes (including step/decision nodes)
 * @param {Array} initialLanes - Lanes from computeSwimlaneLayout
 * @returns {{ lanes: Array, layoutHeight: number }}
 */
export function recomputeSwimlaneLanesFromNodes(nodes, initialLanes) {
  if (!initialLanes?.length) return { lanes: initialLanes, layoutHeight: 0 };
  const { NODE_H, DIAMOND_W, LANE_PAD, LANE_GAP } = SWIMLANE_CONSTANTS;

  const stepNodes = nodes.filter((n) => (n.type === 'step' || n.type === 'decision') && n.data?.department != null);
  const deptToNodes = {};
  stepNodes.forEach((n) => {
    const dept = n.data.department;
    if (!deptToNodes[dept]) deptToNodes[dept] = [];
    deptToNodes[dept].push(n);
  });

  const newLanes = initialLanes.map((lane, i) => {
    const deptNodes = deptToNodes[lane.dept] || [];
    let requiredH = lane.h;
    deptNodes.forEach((n) => {
      const nodeH = n.data?.isDecision ? DIAMOND_W : NODE_H;
      const nodeBottom = (n.position?.y ?? 0) + nodeH;
      const spaceNeeded = nodeBottom - lane.y + LANE_PAD;
      if (spaceNeeded > requiredH) requiredH = spaceNeeded;
    });
    return { ...lane, h: requiredH };
  });

  const startY = initialLanes[0]?.y ?? 0;
  let laneY = startY;
  const reflowed = newLanes.map((l) => {
    const out = { ...l, y: laneY };
    laneY += l.h + LANE_GAP;
    return out;
  });

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
export function processToReactFlow(process, layout = 'grid', darkTheme = false) {
  const { allSteps, handoffMap, startLabel, endLabel } = prepareSteps(process);
  if (allSteps.length === 0) return { nodes: [], edges: [] };

  const isGrid = layout === 'grid' || layout === 'wrap';
  const layoutData = layout === 'grid'
    ? computeLinearLayout(allSteps)
    : layout === 'wrap'
      ? computeWrapLayout(allSteps)
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
    const dc = darkTheme ? { bg: '#2d2d2d', stroke: '#94a3b8' } : { bg: '#ffffff', stroke: '#94a3b8' };
    const nodeW = isDecision ? DIAMOND_W : NODE_W;
    const nodeH = isDecision ? DIAMOND_W : NODE_H;
    const offsetX = (NODE_W - nodeW) / 2;
    // Centre within the tallest-node zone, not the full rowH (which includes inter-row gap)
    const offsetY = isGrid ? (tallestNode - nodeH) / 2 : 0;

    const isMerge = !!s.isMerge;
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
        isExternal: s.isExternal,
        isBottleneck: s.isBottleneck,
        isApproval: s.isApproval,
        auto: s.auto,
        branches: s.branches || [],
        deptColor: dc,
        darkTheme,
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

  // Sequential edges for consecutive steps. Skip step-i → step-i+1 when step-i is a decision
  // (decision branches define those connections). Also skip if the next step is a decision branch
  // target — the branch edge is the authoritative connection in that case.
  if (allSteps.length >= 2) {
    for (let i = 0; i < allSteps.length - 1; i++) {
      const isDecision = allSteps[i].isDecision && (allSteps[i].branches || []).length > 0;
      if (!isDecision) {
        const tgt = `step-${i + 1}`;
        if (!targetsWithIncoming.has(tgt) && !branchTargetIds.has(tgt)) {
          // In grid layout, detect cross-row transitions and use bottom→top handles
          const fromRow = nodePos[i]?.row ?? Math.floor(i / MAX_COLS);
          const toRow = nodePos[i + 1]?.row ?? Math.floor((i + 1) / MAX_COLS);
          const crossRow = isGrid && fromRow !== toRow;
          edges.push({
            id: `e-seq-${i}-${i + 1}`,
            source: `step-${i}`,
            target: tgt,
            sourceHandle: crossRow ? 'bottom' : 'right',
            targetHandle: crossRow ? 'top' : 'left',
            type: 'default',
          });
          targetsWithIncoming.add(tgt);
        }
      }
    }
  }

  // Decision branches (user-configured targets). Always render when set — no targetsWithIncoming guard.
  allSteps.forEach((s, i) => {
    if (!s.isDecision || !s.branches?.length) return;
    const isParallel = !!s.parallel;
    s.branches.forEach((br, bi) => {
      const targetIdx = resolveBranchTarget(br.target || br.targetStep, allSteps);
      if (targetIdx >= 0 && targetIdx < allSteps.length) {
        const targetId = `step-${targetIdx}`;
        const color = '#94a3b8';
        const rawLabel = br.label?.trim() || (bi === 0 ? 'Yes' : bi === 1 ? 'No' : `Option ${bi + 1}`);
        const branchLabel = isParallel ? `All: ${rawLabel}` : rawLabel;
        const sourceHandle = 'right';
        edges.push({
          id: `e-dec-${i}-${targetIdx}-${bi}`,
          source: `step-${i}`,
          target: targetId,
          sourceHandle,
          targetHandle: targetIdx < i ? 'top' : 'left',
          type: 'decisionBranch',
          label: branchLabel,
          labelShowBg: true,
          labelStyle: { fill: color, fontWeight: 600, fontSize: 11 },
          labelBgStyle: { fill: darkTheme ? '#2d2d2d' : '#ffffff', fillOpacity: 0.95 },
          labelBgPadding: [6, 4],
          labelBgBorderRadius: 4,
          data: { label: br.label || '', branchIndex: bi, isParallel },
          style: {
            stroke: color,
            strokeWidth: isParallel ? 2.5 : 2,
            strokeDasharray: targetIdx < i ? '6 4' : isParallel ? '4 4' : undefined,
          },
          zIndex: 1001,
        });
      }
    });
  });

  // Auto-wire branch terminals to their merge node.
  // The sequential edge builder blocks step-j → step-j+1 when step-j+1 is a branch target,
  // so the last step of every branch except the final one never gets connected to the merge node.
  // For each merge node we trace every branch-target's sequential path and add the missing edge.
  allSteps.forEach((mergeStep, m) => {
    if (!mergeStep.isMerge) return;
    const mergeId = `step-${m}`;

    branchTargetIds.forEach((btId) => {
      const j = parseInt(btId.replace('step-', ''), 10);
      if (isNaN(j) || j >= m) return;

      // Walk forward from j until we hit another branch start, a decision, or the merge index.
      let terminal = j;
      for (let k = j + 1; k < m; k++) {
        if (branchTargetIds.has(`step-${k}`)) break;
        if (allSteps[k]?.isDecision && (allSteps[k].branches || []).length > 0) break;
        terminal = k;
      }

      const terminalId = `step-${terminal}`;
      const alreadyConnected = edges.some((e) => e.source === terminalId && e.target === mergeId);
      if (!alreadyConnected) {
        edges.push({
          id: `e-merge-${terminal}-${m}`,
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

  // Last step -> end (user can delete and reconnect)
  // In grid layout, End node is to the right of the last step on the same row → right→left
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

  // Fan decision branches vertically for grid/wrap layouts
  if (isGrid) fanDecisionBranches(nodes, allSteps);

  return {
    nodes,
    edges,
    lanes: layoutData.lanes,
    layoutHeight: isGrid ? undefined : layoutData.lanes?.reduce((acc, l) => Math.max(acc, l.y + l.h), 0) ?? 0,
  };
}
