import { AUTOMATION_CATEGORIES } from './automation.js';
import { getDeptColor, BRANCH_COLORS, prepareSteps, wrapText, escSvg, resolveBranchTarget, formatDuration, formatWorkWait } from './shared.js';

const DARK = {
  cardBg: '#171717',
  title: '#f1f5f9',
  subtitle: '#94a3b8',
  nodeBg: '#262626',
  nodeStroke: '#404040',
  termBg: '#064e3b',
  termStroke: '#10b981',
  termText: '#6ee7b7',
  text: '#e2e8f0',
  textMuted: '#94a3b8',
  legendLine: '#404040',
  legendText: '#94a3b8',
  decisionBg: '#4c1d95',
  decisionStroke: '#a78bfa',
  decisionText: '#c4b5fd',
  bottleneck: '#ef4444',
  bottleneckText: '#fca5a5',
  approval: '#b45309',
  approvalText: '#fcd34d',
  handoffPill: '#262626',
};

export function buildGridSVG(process, options = {}) {
  const { hideLegend = false, idPrefix = '', darkTheme = false } = options;
  const id = idPrefix;
  const d = darkTheme ? DARK : null;
  const parts = [];

  const NODE_W = 210;
  const NODE_H = 76;
  const NODE_GAP_X = 60;
  const NODE_GAP_Y = 70;
  const COLS = Math.min(6, Math.max(4, Math.ceil(Math.sqrt((process.steps || []).length * 1.5))));
  const PAD_L = 80;
  const TERM_W = 140;
  const TERM_H = 44;
  const TERM_RX = 22;
  const AGENT_BADGE_R = 10;
  const DIAMOND_W = 170;
  const DIAMOND_H = 110;
  const LINE_GAP = 16;

  const p = process;
  const { allSteps, handoffMap, startLabel, endLabel } = prepareSteps(p);
  if (allSteps.length === 0) return '';

  const hasDecisions = allSteps.some(s => s.isDecision && s.branches.length > 0);
  const autoCount = allSteps.filter(s => s.auto).length;
  const numRows = Math.ceil(allSteps.length / COLS);
  const colW = NODE_W + NODE_GAP_X;

  // Start terminal sits above the first row
  const TITLE_Y = 28;
  const SUBTITLE_Y = 44;
  const TERM_TOP_Y = 60;
  const TERM_BOTTOM_Y = TERM_TOP_Y + TERM_H;
  const firstIsDecision = allSteps[0].isDecision && allSteps[0].branches.length > 0;
  const PAD_T = TERM_BOTTOM_Y + (firstIsDecision ? 38 : 22);

  // Dynamic row height based on branch line density
  const gapLineCount = {};
  allSteps.forEach((s, i) => {
    if (!s.isDecision || !s.branches || s.branches.length === 0) return;
    const srcRow = Math.floor(i / COLS);
    s.branches.forEach(br => {
      const tgtIdx = resolveBranchTarget(br.target || br.targetStep, allSteps);
      if (tgtIdx < 0 || tgtIdx >= allSteps.length) return;
      const tgtRow = Math.floor(tgtIdx / COLS);
      if (tgtIdx < i) {
        const gapKey = 'above_' + tgtRow;
        gapLineCount[gapKey] = (gapLineCount[gapKey] || 0) + 1;
      } else if (tgtRow > srcRow) {
        const gapKey = 'below_' + srcRow;
        gapLineCount[gapKey] = (gapLineCount[gapKey] || 0) + 1;
      } else {
        const gapKey = 'above_' + srcRow;
        gapLineCount[gapKey] = (gapLineCount[gapKey] || 0) + 1;
      }
    });
  });
  const maxLinesInAnyGap = Math.max(1, ...Object.values(gapLineCount), 0);
  const minGapForLines = maxLinesInAnyGap * LINE_GAP + 40;
  const baseRowH = NODE_H + NODE_GAP_Y + (hasDecisions ? 40 : 20);
  const rowH = Math.max(baseRowH, NODE_H + minGapForLines);

  // Serpentine node positions
  const nodePos = [];
  allSteps.forEach((s, i) => {
    const row = Math.floor(i / COLS);
    let col = i % COLS;
    if (row % 2 === 1) col = COLS - 1 - col;
    const nx = PAD_L + col * colW;
    const ny = PAD_T + row * rowH;
    nodePos[i] = { x: nx, y: ny, cx: nx + NODE_W / 2, cy: ny + NODE_H / 2, row, col };
  });

  // End terminal below last node
  const lastIdx = allSteps.length - 1;
  const lastNode = nodePos[lastIdx];
  const lastIsDecision = allSteps[lastIdx].isDecision && allSteps[lastIdx].branches.length > 0;
  const lastNodeBottom = lastIsDecision ? lastNode.cy + DIAMOND_H / 2 : lastNode.y + NODE_H;
  const endTermY = lastNodeBottom + 24;

  // SVG dimensions
  const contentW = PAD_L + COLS * colW + 60;
  const endTermBottom = endTermY + TERM_H;
  const legendH = hideLegend ? 0 : (autoCount > 0 ? 50 : 28);
  const totalW = Math.max(contentW, 700);
  const totalH = endTermBottom + 18 + legendH + 18;

  // ── SVG open ──
  const cardBg = d ? d.cardBg : '#ffffff';
  const titleFill = d ? d.title : '#1a2f4a';
  const subtitleFill = d ? d.subtitle : '#94a3b8';
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="${totalW}" height="${totalH}" style="font-family: 'Work Sans', Arial, sans-serif;" data-theme="${darkTheme ? 'dark' : 'light'}">`);
  parts.push(`<rect x="0" y="0" width="${totalW}" height="${totalH}" fill="${cardBg}" rx="16" filter="url(#${id}gridCardShadow)"/>`);

  // ── Title ──
  parts.push(`<text x="${totalW / 2}" y="${TITLE_Y}" text-anchor="middle" font-size="14" font-weight="600" fill="${titleFill}" letter-spacing="-0.3">${escSvg(p.processName || 'Process Flow')}</text>`);
  const decCount = allSteps.filter(s => s.isDecision).length;
  const extCount = allSteps.filter(s => s.isExternal).length;
  parts.push(`<text x="${totalW / 2}" y="${SUBTITLE_Y}" text-anchor="middle" font-size="10" fill="${subtitleFill}" letter-spacing="0.3">${allSteps.length} steps &middot; ${[...new Set(allSteps.map(s => s.department))].length} depts${decCount ? ' &middot; ' + decCount + ' decisions' : ''}${extCount ? ' &middot; ' + extCount + ' external' : ''}</text>`);

  // ── Defs ──
  parts.push(`<defs>`);
  parts.push(`<marker id="${id}arw" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 1 L 10 5 L 0 9 z" fill="#94a3b8"/></marker>`);
  parts.push(`<marker id="${id}arw-bad" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 1 L 10 5 L 0 9 z" fill="#ef4444"/></marker>`);
  parts.push(`<marker id="${id}arw-term" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 1 L 10 5 L 0 9 z" fill="#059669"/></marker>`);
  BRANCH_COLORS.forEach((c, ci) => {
    parts.push(`<marker id="${id}arwc${ci}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 1 L 10 5 L 0 9 z" fill="${c}"/></marker>`);
  });
  parts.push(`<marker id="${id}arw-teal" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 1 L 10 5 L 0 9 z" fill="#14b8a6"/></marker>`);
  parts.push(`<filter id="${id}shadow" x="-8%" y="-8%" width="116%" height="120%"><feDropShadow dx="0" dy="2" stdDeviation="4" flood-opacity="0.06"/></filter>`);
  parts.push(`<filter id="${id}gridCardShadow" x="-2%" y="-2%" width="104%" height="106%"><feDropShadow dx="0" dy="4" stdDeviation="12" flood-opacity="0.04"/><feDropShadow dx="0" dy="1" stdDeviation="3" flood-opacity="0.03"/></filter>`);
  parts.push(`<filter id="${id}gridGlow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="6" flood-opacity="0.12" flood-color="#3d8ea6"/></filter>`);
  parts.push(`</defs>`);

  // ── CSS ──
  parts.push(`<style>
    @keyframes flowDash { to { stroke-dashoffset: -40; } }
    @keyframes particleMove { 0% { offset-distance: 0%; opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { offset-distance: 100%; opacity: 0; } }
    .flow-arrow { stroke-dasharray: 8 6; animation: flowDash 1.5s linear infinite; }
    .flow-particle { r: 3; fill: #3d8ea6; animation: particleMove 3s linear infinite; }
    .gnode { cursor: pointer; transition: filter 0.25s ease, transform 0.25s cubic-bezier(0.16,1,0.3,1); transform-origin: center; transform-box: fill-box; }
    .gnode:hover { filter: url(#${id}gridGlow); transform: scale(1.04) translateY(-2px); }
  </style>`);

  // ── Start terminal (oval per flowchart convention) ──
  const startTermCX = nodePos[0].cx;
  const startTermCY = TERM_TOP_Y + TERM_H / 2;
  const termRx = TERM_W / 2;
  const termRy = TERM_H / 2;
  const termBg = d ? d.termBg : '#d1fae5';
  const termStroke = d ? d.termStroke : '#059669';
  const termText = d ? d.termText : '#064e3b';
  parts.push(`<ellipse cx="${startTermCX}" cy="${startTermCY}" rx="${termRx}" ry="${termRy}" fill="${termBg}" stroke="${termStroke}" stroke-width="2" filter="url(#${id}shadow)"/>`);
  const stLines = wrapText(startLabel, 18);
  const stFS = stLines.length > 2 ? 7 : 9;
  const stLH = stFS + 2.5;
  const stSY = startTermCY - ((stLines.length - 1) * stLH) / 2 + stFS / 2 - 1;
  stLines.forEach((line, li) => {
    parts.push(`<text x="${startTermCX}" y="${stSY + li * stLH}" text-anchor="middle" font-size="${stFS}" font-weight="600" fill="${termText}">${escSvg(line)}</text>`);
  });

  // Start arrow (with particle)
  const firstNodeEntry = firstIsDecision ? nodePos[0].cy - DIAMOND_H / 2 : nodePos[0].y;
  const startArrowD = `M ${startTermCX} ${TERM_BOTTOM_Y} L ${startTermCX} ${firstNodeEntry}`;
  parts.push(`<path d="${startArrowD}" fill="none" stroke="#059669" stroke-width="1.8" class="flow-arrow" marker-end="url(#${id}arw-term)" opacity="0.5"/>`);
  parts.push(`<circle class="flow-particle" style="offset-path:path('${startArrowD}');animation-duration:2s;fill:#059669;"/>`);

  // ── Sequential arrows (no particles on middle arrows) ──
  function drawSeqArrow(fromIdx, toIdx) {
    const fp = nodePos[fromIdx], tp = nodePos[toIdx];
    const hk = fromIdx + '->' + toIdx;
    const hd = handoffMap[hk] || { method: '', isBad: false };
    const color = hd.isBad ? '#ef4444' : '#94a3b8';
    const marker = hd.isBad ? `url(#${id}arw-bad)` : `url(#${id}arw)`;
    const fromIsDec = allSteps[fromIdx].isDecision && (allSteps[fromIdx].branches || []).length > 0;
    const toIsDec = allSteps[toIdx].isDecision && (allSteps[toIdx].branches || []).length > 0;
    let pathD;

    if (fp.row === tp.row) {
      const goRight = fp.col < tp.col;
      const x1 = goRight ? (fromIsDec ? fp.cx + DIAMOND_W / 2 : fp.x + NODE_W) : (fromIsDec ? fp.cx - DIAMOND_W / 2 : fp.x);
      const y1 = fp.cy;
      const x2 = goRight ? (toIsDec ? tp.cx - DIAMOND_W / 2 : tp.x) : (toIsDec ? tp.cx + DIAMOND_W / 2 : tp.x + NODE_W);
      const y2 = tp.cy;
      if (Math.abs(y1 - y2) < 2) {
        pathD = `M ${x1} ${y1} L ${x2} ${y2}`;
      } else {
        const midX = (x1 + x2) / 2;
        pathD = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
      }
    } else {
      const x1 = fp.cx;
      const y1 = fromIsDec ? fp.cy + DIAMOND_H / 2 : fp.y + NODE_H;
      const channelY = fp.y + NODE_H + (rowH - NODE_H) / 2;
      const x2 = tp.cx;
      const y2 = toIsDec ? tp.cy - DIAMOND_H / 2 : tp.y;
      pathD = `M ${x1} ${y1} L ${x1} ${channelY} L ${x2} ${channelY} L ${x2} ${y2}`;
    }

    parts.push(`<path d="${pathD}" fill="none" stroke="${color}" stroke-width="1.8" class="flow-arrow" marker-end="${marker}" opacity="0.5"/>`);

    // Handoff method label
    if (hd.method) {
      let mx, my;
      if (fp.row === tp.row) {
        const goRight = fp.col < tp.col;
        const x1 = goRight ? (fromIsDec ? fp.cx + DIAMOND_W / 2 : fp.x + NODE_W) : (fromIsDec ? fp.cx - DIAMOND_W / 2 : fp.x);
        const x2 = goRight ? (toIsDec ? tp.cx - DIAMOND_W / 2 : tp.x) : (toIsDec ? tp.cx + DIAMOND_W / 2 : tp.x + NODE_W);
        mx = (x1 + x2) / 2;
        my = fp.cy - 12;
      } else {
        const channelY = fp.y + NODE_H + (rowH - NODE_H) / 2;
        mx = (fp.cx + tp.cx) / 2;
        my = channelY - 10;
      }
      const pillW = Math.min(hd.method.length * 4.8 + 14, 100);
      parts.push(`<rect x="${mx - pillW / 2}" y="${my - 7}" width="${pillW}" height="14" rx="7" fill="#fff" stroke="${color}" stroke-width="0.7" opacity="0.9"/>`);
      parts.push(`<text x="${mx}" y="${my + 3}" text-anchor="middle" font-size="7" fill="${color}" font-weight="500" opacity="0.8">${escSvg(hd.method)}</text>`);
    }
  }

  const hasIncoming = new Set();
  for (let i = 0; i < allSteps.length - 1; i++) {
    if (!(allSteps[i].isDecision && allSteps[i].branches && allSteps[i].branches.length > 0)) {
      hasIncoming.add(i + 1);
      drawSeqArrow(i, i + 1);
    }
  }
  allSteps.forEach((s, i) => {
    if (!s.isDecision || !s.branches) return;
    s.branches.forEach(br => {
      const idx = resolveBranchTarget(br.target || br.targetStep, allSteps);
      if (idx >= 0) hasIncoming.add(idx);
    });
  });
  for (let i = 1; i < allSteps.length; i++) {
    if (!hasIncoming.has(i)) drawSeqArrow(i - 1, i);
  }

  // ── Decision branch arrows (with particles) ──
  const incomingRoutes = {};
  allSteps.forEach((s, i) => {
    if (!s.isDecision || s.branches.length === 0) return;
    const isParallel = !!s.parallel;
    s.branches.forEach((br, bi) => {
        const targetIdx = resolveBranchTarget(br.target || br.targetStep, allSteps);
        if (targetIdx >= 0 && targetIdx < allSteps.length) {
        if (!incomingRoutes[targetIdx]) incomingRoutes[targetIdx] = [];
        const color = isParallel ? '#14b8a6' : BRANCH_COLORS[bi % BRANCH_COLORS.length];
        incomingRoutes[targetIdx].push({ fromStep: i + 1, color, label: br.label });
      }
    });
  });

  const TITLE_ZONE = 90;
  function rowGapMidY(row) {
    const raw = PAD_T + row * rowH - (rowH - NODE_H) / 2;
    return Math.max(raw, TITLE_ZONE);
  }

  const gapChannels = {};
  function allocateChannel(gapKey) {
    if (!(gapKey in gapChannels)) gapChannels[gapKey] = 0;
    return gapChannels[gapKey]++;
  }

  allSteps.forEach((s, i) => {
    if (!s.isDecision || !s.branches || s.branches.length === 0) return;
    const pos = nodePos[i];
    if (!pos) return;
    const cx = pos.cx, cy = pos.cy;
    const hw = DIAMOND_W / 2, hh = DIAMOND_H / 2;

    let seqEntry = null;
    if (i > 0) {
      const prev = nodePos[i - 1];
      if (prev) {
        if (prev.row === pos.row) seqEntry = prev.col < pos.col ? 'left' : 'right';
        else seqEntry = 'top';
      }
    }

    const isParallel = !!s.parallel;
    const branchInfo = [];
    s.branches.forEach((br, bi) => {
      try {
        const color = isParallel ? '#14b8a6' : BRANCH_COLORS[bi % BRANCH_COLORS.length];
        let targetIdx = resolveBranchTarget(br.target || br.targetStep, allSteps);
        if (targetIdx < 0 || targetIdx >= allSteps.length) {
          targetIdx = i + 1;
          if (targetIdx >= allSteps.length) return;
        }
        const tp = nodePos[targetIdx];
        if (!tp) return;
        const goesBack = targetIdx < i;
        const sameRow = pos.row === tp.row;
        let ideal;
        if (goesBack) {
          ideal = sameRow ? (tp.col < pos.col ? 'left' : 'right') : 'top';
        } else if (sameRow) {
          ideal = tp.col > pos.col ? 'right' : 'left';
        } else if (tp.row > pos.row) {
          ideal = 'bottom';
        } else {
          ideal = 'top';
        }
        branchInfo.push({ br, bi, color, targetIdx, tp, goesBack, sameRow, ideal, isParallel });
      } catch (e) { /* branch prep error - skip this branch */ }
    });

    const vertexCount = { top: 0, right: 0, bottom: 0, left: 0 };
    function compatFallbacks(bd) {
      if (bd.goesBack && !bd.sameRow) return ['top', 'left', 'right'];
      if (bd.goesBack && bd.sameRow) return ['left', 'right', 'bottom', 'top'];
      if (!bd.sameRow && bd.tp.row > pos.row) return ['bottom', 'right', 'left', 'top'];
      return ['bottom', 'right', 'left', 'top'];
    }
    const sorted = [...branchInfo].sort((a, b) => {
      const rank = d => d.goesBack && !d.sameRow ? 0 : (!d.sameRow && d.tp.row > pos.row) ? 1 : 2;
      const r = rank(a) - rank(b);
      if (r !== 0) return r;
      // Yes/No convention: Yes flows downward (bottom), No branches right
      const yesA = /^(yes|true|approved|pass|accept|ok)/i.test((a.br.label || '').trim());
      const noA = /^(no|false|rejected|fail|reject)/i.test((a.br.label || '').trim());
      const yesB = /^(yes|true|approved|pass|accept|ok)/i.test((b.br.label || '').trim());
      const noB = /^(no|false|rejected|fail|reject)/i.test((b.br.label || '').trim());
      if (yesA && !yesB) return -1;
      if (!yesA && yesB) return 1;
      if (noA && !noB) return 1;
      if (!noA && noB) return -1;
      return 0;
    });
    const exitMap = new Map();
    sorted.forEach(bd => {
      let dir = bd.ideal;
      const fb = compatFallbacks(bd);
      if (dir === seqEntry && vertexCount[dir] === 0) {
        const alt = fb.filter(d => d !== seqEntry && vertexCount[d] === 0);
        if (alt.length) dir = alt[0];
      }
      if (vertexCount[dir] > 0) {
        const free = fb.filter(d => d !== seqEntry && vertexCount[d] === 0);
        if (free.length) dir = free[0];
      }
      vertexCount[dir]++;
      exitMap.set(bd.bi, { dir, idx: vertexCount[dir] - 1 });
    });

    branchInfo.forEach(bd => {
      try {
        const { br, bi, color, targetIdx, tp, goesBack, sameRow, isParallel: bIsParallel } = bd;
        const { dir: exitDir, idx: exitIdx } = exitMap.get(bi);
        const isTargetDec = allSteps[targetIdx].isDecision && (allSteps[targetIdx].branches || []).length > 0;
        const clampY = y => Math.max(y, TITLE_ZONE);

        let eX, eY;
        if (exitDir === 'top') { eX = cx; eY = cy - hh; }
        else if (exitDir === 'bottom') { eX = cx; eY = cy + hh; }
        else if (exitDir === 'left') { eX = cx - hw; eY = cy; }
        else { eX = cx + hw; eY = cy; }

        let nX, nY;
        const isAdjacentSameRow = sameRow && !goesBack && Math.abs(tp.col - pos.col) <= 1
          && (exitDir === 'left' || exitDir === 'right');

        if (isAdjacentSameRow) {
          const fromLeft = tp.col > pos.col;
          if (isTargetDec) { nX = fromLeft ? tp.cx - DIAMOND_W / 2 : tp.cx + DIAMOND_W / 2; nY = tp.cy; }
          else { nX = fromLeft ? tp.x : tp.x + NODE_W; nY = tp.cy; }
        } else {
          nX = tp.cx;
          nY = isTargetDec ? tp.cy - DIAMOND_H / 2 : tp.y;
        }

        let pathD;
        if (isAdjacentSameRow && Math.abs(eY - nY) < 2) {
          pathD = `M ${eX} ${eY} L ${nX} ${nY}`;
        } else if (isAdjacentSameRow) {
          const midX = (eX + nX) / 2;
          pathD = `M ${eX} ${eY} L ${midX} ${eY} L ${midX} ${nY} L ${nX} ${nY}`;
        } else {
          let gapKey, gapY;
          if (goesBack || sameRow) {
            gapKey = 'above_' + pos.row;
            const ch = allocateChannel(gapKey);
            gapY = clampY(rowGapMidY(pos.row) - ch * LINE_GAP);
          } else {
            gapKey = 'below_' + pos.row;
            const ch = allocateChannel(gapKey);
            gapY = rowGapMidY(pos.row + 1) + ch * LINE_GAP;
          }
          if (exitDir === 'top' || exitDir === 'bottom') {
            pathD = `M ${eX} ${eY} L ${eX} ${gapY} L ${nX} ${gapY} L ${nX} ${nY}`;
          } else {
            const armLen = 18 + exitIdx * 12;
            const turnX = exitDir === 'left' ? eX - armLen : eX + armLen;
            pathD = `M ${eX} ${eY} L ${turnX} ${eY} L ${turnX} ${gapY} L ${nX} ${gapY} L ${nX} ${nY}`;
          }
        }

        const dashAttr = goesBack ? 'stroke-dasharray="6,4"' : (bIsParallel ? 'stroke-dasharray="4,4"' : '');
        const markerId = bIsParallel ? `url(#${id}arw-teal)` : `url(#${id}arwc${bi % 5})`;
        parts.push(`<path d="${pathD}" fill="none" stroke="${color}" stroke-width="2" ${dashAttr} marker-end="${markerId}" opacity="0.75"/>`);
        parts.push(`<circle r="3" fill="${color}" opacity="0.8"><animateMotion dur="${2.5 + bi * 0.5}s" repeatCount="indefinite" begin="${bi * 0.4}s" path="${pathD}"><\/animateMotion><\/circle>`);

        const MAX_LBL = 18;
        const rawLabel = (bIsParallel ? 'All: ' : '') + (br.label || '');
        let lblLines;
        if (rawLabel.length > MAX_LBL) {
          const words = rawLabel.split(/\s+/); let cur = '';
          lblLines = [];
          words.forEach(w => { const t = cur ? cur + ' ' + w : w; if (t.length > MAX_LBL && cur) { lblLines.push(escSvg(cur)); cur = w; } else { cur = t; } });
          if (cur) lblLines.push(escSvg(cur));
          lblLines = lblLines.slice(0, 2);
          if (rawLabel.length > lblLines.join(' ').length + 3) { let last = lblLines[lblLines.length - 1]; if (last.length > 3) lblLines[lblLines.length - 1] = last.slice(0, -3) + '...'; }
        } else {
          lblLines = [escSvg(rawLabel)];
        }
        const longestLbl = Math.max(...lblLines.map(l => l.length));
        const pillW = Math.min(longestLbl * 4.5 + 14, 110);
        const pillH = lblLines.length > 1 ? 24 : 15;

        // Place label along the first segment of the drawn path (rendered inline, not deferred)
        // Offset by exitIdx when multiple branches share the same direction so labels don't overlap
        const pathSegs = pathD.replace(/^M\s*/, '').split(/\s*L\s*/);
        const p0 = pathSegs[0].trim().split(/[\s,]+/).map(Number);
        const p1 = pathSegs[1] ? pathSegs[1].trim().split(/[\s,]+/).map(Number) : p0;
        const segH = Math.abs(p0[1] - p1[1]) < 2;
        const LBL_OFF = 30;
        const stackOffset = exitIdx * (pillH + 6);
        let lbX, lbY;
        if (segH) {
          lbX = p0[0] + (p1[0] > p0[0] ? LBL_OFF : -LBL_OFF);
          lbY = p0[1] - pillH / 2 - 5 - stackOffset;
        } else {
          lbX = p0[0] + (exitDir === 'left' ? -pillW / 2 - 6 : pillW / 2 + 6);
          lbY = p0[1] + (p1[1] > p0[1] ? LBL_OFF : -LBL_OFF) + stackOffset;
        }
        lbX = Math.max(pillW / 2 + 4, Math.min(lbX, totalW - pillW / 2 - 4));
        parts.push(`<rect x="${lbX - pillW / 2}" y="${lbY - pillH / 2}" width="${pillW}" height="${pillH}" rx="${pillH / 2}" fill="#fff" stroke="${color}" stroke-width="0.8" opacity="0.97"/>`);
        if (!lblLines || lblLines.length <= 1) {
          parts.push(`<text x="${lbX}" y="${lbY + 4}" text-anchor="middle" font-size="7" fill="${color}" font-weight="600">${(lblLines && lblLines[0]) || ''}</text>`);
        } else {
          const lH = 8;
          const sY = lbY - (lblLines.length - 1) * lH / 2 + 3;
          lblLines.forEach((ln, li) => {
            parts.push(`<text x="${lbX}" y="${sY + li * lH}" text-anchor="middle" font-size="6.5" fill="${color}" font-weight="600">${ln}</text>`);
          });
        }
      } catch (branchErr) {
        /* branch render error - skip this branch */
      }
    });
  });

  // ── End terminal (oval per flowchart convention) ──
  const endTermCX = lastNode.cx;
  const endTermCY = endTermY + TERM_H / 2;
  const lastNodeExit = lastIsDecision ? lastNode.cy + DIAMOND_H / 2 : lastNode.y + NODE_H;
  const endArrowD = `M ${endTermCX} ${lastNodeExit} L ${endTermCX} ${endTermY}`;
  parts.push(`<path d="${endArrowD}" fill="none" stroke="#059669" stroke-width="1.8" class="flow-arrow" marker-end="url(#${id}arw-term)" opacity="0.5"/>`);
  parts.push(`<circle class="flow-particle" style="offset-path:path('${endArrowD}');animation-duration:2s;fill:#059669;"/>`);
  parts.push(`<ellipse cx="${endTermCX}" cy="${endTermCY}" rx="${termRx}" ry="${termRy}" fill="${termBg}" stroke="${termStroke}" stroke-width="2" filter="url(#${id}shadow)"/>`);
  const etLines = wrapText(endLabel, 18);
  const etFS = etLines.length > 2 ? 7 : 9;
  const etLH = etFS + 2.5;
  const etSY = endTermCY - ((etLines.length - 1) * etLH) / 2 + etFS / 2 - 1;
  etLines.forEach((line, li) => {
    parts.push(`<text x="${endTermCX}" y="${etSY + li * etLH}" text-anchor="middle" font-size="${etFS}" font-weight="600" fill="${termText}">${escSvg(line)}</text>`);
  });

  // ── Nodes ──
  allSteps.forEach((s, i) => {
    const pos = nodePos[i];
    if (!pos) return;
    const dc = getDeptColor(s.department, darkTheme);
    const isDecNode = s.isDecision && s.branches.length > 0;

    parts.push(`<g class="gnode" data-step-index="${i}" data-step-idx="${i}">`);

    if (isDecNode) {
      const cx = pos.cx, cy = pos.cy;
      const hw = DIAMOND_W / 2, hh = DIAMOND_H / 2;
      const isParallel = !!s.parallel;
      const decFill = isParallel ? (d ? '#0d3d38' : '#ecfdf5') : (d ? d.decisionBg : '#faf9ff');
      const decStroke = isParallel ? '#14b8a6' : (d ? d.decisionStroke : '#7c3aed');
      const decText = isParallel ? (d ? '#5eead4' : '#059669') : (d ? d.decisionText : '#7c3aed');
      parts.push(`<polygon points="${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}" fill="${decFill}" stroke="${decStroke}" stroke-width="1.8" filter="url(#${id}shadow)"/>`);
      if (isParallel) {
        parts.push(`<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="16" font-weight="700" fill="${decStroke}">⊕</text>`);
        parts.push(`<text x="${cx}" y="${cy - hh + 8}" text-anchor="middle" font-size="6" font-weight="700" fill="${decText}" opacity="0.8">${i + 1}</text>`);
        parts.push(`<title>Parallel: all paths run  -  ${escSvg(s.name || '')}</title>`);
      } else {
        parts.push(`<circle cx="${cx}" cy="${cy - hh + 8}" r="8" fill="${decStroke}" opacity="0.15"/>`);
        parts.push(`<text x="${cx}" y="${cy - hh + 11}" text-anchor="middle" font-size="8" font-weight="700" fill="${decText}">${i + 1}</text>`);
      }

      let dLines = isParallel ? [] : wrapText(s.name, 20);
      const dFontSize = dLines.length > 3 ? 7.5 : 9;
      const dLineH = dFontSize + 2.5;
      const dBlockH = dLines.length * dLineH;
      const dStartY = cy - dBlockH / 2 + dFontSize;
      const decTextFill = d ? d.decisionText : '#4c1d95';
      dLines.forEach((line, li) => {
        parts.push(`<text x="${cx}" y="${dStartY + li * dLineH}" text-anchor="middle" font-size="${dFontSize}" fill="${decTextFill}" font-weight="500">${escSvg(line)}</text>`);
      });
      const durDec = formatWorkWait(s.workMinutes, s.waitMinutes) || formatDuration(s.durationMinutes);
      const sysDec = (s.systems || []).slice(0, 2).map(x => escSvg(x)).join(', ');
      const deptY = durDec || sysDec ? cy + hh - 22 : cy + hh - 10;
      const decDeptFill = d ? d.decisionStroke : '#7c3aed';
      const decMutedFill = d ? d.textMuted : '#94a3b8';
      const decDurFill = d ? d.textMuted : '#64748b';
      parts.push(`<text x="${cx}" y="${deptY}" text-anchor="middle" font-size="7" fill="${decDeptFill}" opacity="0.6">${escSvg(s.department)}</text>`);
      if (sysDec && durDec) parts.push(`<text x="${cx}" y="${cy + hh - 18}" text-anchor="middle" font-size="6.5" fill="${decMutedFill}" opacity="0.75">${sysDec}</text>`);
      if (durDec) parts.push(`<text x="${cx}" y="${cy + hh - 8}" text-anchor="middle" font-size="7" fill="${decDurFill}" opacity="0.85">${escSvg(durDec)}</text>`);
      if (sysDec && !durDec) parts.push(`<text x="${cx}" y="${cy + hh - 8}" text-anchor="middle" font-size="6.5" fill="${decDurFill}" opacity="0.75">${sysDec}</text>`);

      if (s.auto) {
        parts.push(`<circle cx="${cx + hw - 4}" cy="${cy - hh + 4}" r="8" fill="${s.auto.color}" stroke="#fff" stroke-width="1.5"/>`);
        parts.push(`<text x="${cx + hw - 4}" y="${cy - hh + 7}" text-anchor="middle" font-size="7" fill="#fff" font-weight="700">${s.auto.badge}</text>`);
        parts.push(`<title>Suggestion: ${escSvg(s.auto.label || '')}${s.auto.reason ? '  -  ' + escSvg(s.auto.reason) : ''}</title>`);
      }

      const incoming = incomingRoutes[i] || [];
      incoming.forEach((inc, ii) => {
        const ix = cx - hw + 4;
        const iy = cy - 10 + ii * 12;
        parts.push(`<circle cx="${ix}" cy="${iy}" r="5" fill="${inc.color}" stroke="#fff" stroke-width="1"/>`);
        parts.push(`<text x="${ix}" y="${iy + 2}" text-anchor="middle" font-size="5" fill="#fff" font-weight="700">${inc.fromStep}</text>`);
        parts.push(`<title>From Step ${inc.fromStep}: ${escSvg(inc.label)}</title>`);
      });

    } else {
      const incoming = incomingRoutes[i] || [];
      let stroke = dc.stroke, sw = 1.2, textCol = d ? d.text : '#1e293b';
      if (s.isBottleneck) { stroke = d ? d.bottleneck : '#ef4444'; sw = 2; textCol = d ? d.bottleneckText : '#991b1b'; }
      else if (s.isApproval) { stroke = d ? d.approval : '#d97706'; sw = 1.8; textCol = d ? d.approvalText : '#92400e'; }
      else if (incoming.length === 1) { stroke = incoming[0].color; sw = 1.5; }
      const rx = s.isApproval ? 14 : 10;
      const nodeFill = d ? d.nodeBg : '#ffffff';

      parts.push(`<rect x="${pos.x}" y="${pos.y}" width="${NODE_W}" height="${NODE_H}" rx="${rx}" fill="${nodeFill}" stroke="${stroke}" stroke-width="${sw}" filter="url(#${id}shadow)"/>`);
      parts.push(`<rect x="${pos.x}" y="${pos.y}" width="${NODE_W}" height="${NODE_H}" rx="${rx}" fill="${dc.bg}" opacity="0.12"/>`);
      parts.push(`<rect x="${pos.x + 1}" y="${pos.y + 6}" width="3" height="${NODE_H - 12}" rx="1.5" fill="${dc.stroke}" opacity="0.7"/>`);

      const badgeBg = s.isBottleneck ? (d ? d.bottleneck : '#ef4444') : s.isApproval ? (d ? d.approval : '#d97706') : dc.stroke;
      parts.push(`<circle cx="${pos.x + 15}" cy="${pos.y + 15}" r="10" fill="${badgeBg}" opacity="0.12"/>`);
      parts.push(`<text x="${pos.x + 15}" y="${pos.y + 19}" text-anchor="middle" font-size="9" font-weight="700" fill="${badgeBg}">${i + 1}</text>`);
      parts.push(`<text x="${pos.x + NODE_W - 6}" y="${pos.y + 12}" text-anchor="end" font-size="7" fill="${dc.stroke}" opacity="0.7">${escSvg(s.department)}</text>`);

      incoming.forEach((inc, ii) => {
        const by = pos.y + 14 + ii * 12;
        parts.push(`<circle cx="${pos.x - 1}" cy="${by}" r="5" fill="${inc.color}" stroke="#fff" stroke-width="1.5"/>`);
        parts.push(`<text x="${pos.x - 1}" y="${by + 2}" text-anchor="middle" font-size="5" fill="#fff" font-weight="700">${inc.fromStep}</text>`);
        parts.push(`<title>From Step ${inc.fromStep}: ${escSvg(inc.label)}</title>`);
      });

      let lines = wrapText(s.name, 28);
      const fontSize = lines.length > 3 ? 8.5 : 10.5;
      const lineH = fontSize + 2;
      const blockH = lines.length * lineH;
      const textStartY = pos.y + 18 + (NODE_H - 18 - blockH) / 2 + fontSize;
      lines.forEach((line, li) => {
        parts.push(`<text x="${pos.x + NODE_W / 2}" y="${textStartY + li * lineH}" text-anchor="middle" font-size="${fontSize}" fill="${textCol}" font-weight="500">${escSvg(line)}</text>`);
      });
      const durProc = formatWorkWait(s.workMinutes, s.waitMinutes) || formatDuration(s.durationMinutes);
      const sysProc = (s.systems || []).slice(0, 2).map(x => escSvg(x)).join(', ');
      const footerY = pos.y + NODE_H - 10;
      const footerMuted = d ? d.textMuted : '#94a3b8';
      const footerFill = d ? d.textMuted : '#64748b';
      if (durProc && sysProc) {
        parts.push(`<text x="${pos.x + NODE_W / 2}" y="${footerY - 11}" text-anchor="middle" font-size="6.5" fill="${footerMuted}" opacity="0.8">${sysProc}</text>`);
        parts.push(`<text x="${pos.x + NODE_W / 2}" y="${footerY}" text-anchor="middle" font-size="8" fill="${footerFill}" opacity="0.9">${escSvg(durProc)}</text>`);
      } else if (durProc) {
        parts.push(`<text x="${pos.x + NODE_W / 2}" y="${footerY}" text-anchor="middle" font-size="8" fill="${footerFill}" opacity="0.9">${escSvg(durProc)}</text>`);
      } else if (sysProc) {
        parts.push(`<text x="${pos.x + NODE_W / 2}" y="${footerY}" text-anchor="middle" font-size="6.5" fill="${footerMuted}" opacity="0.8">${sysProc}</text>`);
      }

      if (s.auto) {
        const bx = pos.x + NODE_W - 6, by = pos.y - 4;
        parts.push(`<circle cx="${bx}" cy="${by}" r="${AGENT_BADGE_R}" fill="${s.auto.color}" stroke="#fff" stroke-width="2"/>`);
        parts.push(`<text x="${bx}" y="${by + 4}" text-anchor="middle" font-size="9" fill="#fff" font-weight="700">${s.auto.badge}</text>`);
        parts.push(`<title>Suggestion: ${escSvg(s.auto.label || '')}${s.auto.reason ? '  -  ' + escSvg(s.auto.reason) : ''}</title>`);
      }

      if (s.checklist?.length > 0) {
        const done = s.checklist.filter(c => c.checked).length;
        const total = s.checklist.length;
        const clColor = done === total ? '#10b981' : '#64748b';
        const cx = pos.x + NODE_W - 18, cy = pos.y + NODE_H - 8;
        parts.push(`<rect x="${cx - 14}" y="${cy - 7}" width="28" height="14" rx="7" fill="${clColor}" opacity="0.15"/>`);
        parts.push(`<text x="${cx}" y="${cy + 3}" text-anchor="middle" font-size="7.5" fill="${clColor}" font-weight="600">${done}/${total}</text>`);
        parts.push(`<title>Checklist: ${done} of ${total} complete</title>`);
      }
    }
    parts.push(`</g>`);
  });

  // ── Legend (conditional) ──
  if (!hideLegend) {
    const hasBottleneck = allSteps.some(s => s.isBottleneck);
    const hasApproval = allSteps.some(s => s.isApproval);
    const hasBadHandoff = Object.values(handoffMap).some(h => h.isBad);
    const legendY = endTermBottom + 18;
    const legendLine = d ? d.legendLine : '#e2e8f0';
    const legendRectFill = d ? d.nodeBg : '#fff';
    const legendTextFill = d ? d.legendText : '#64748b';
    parts.push(`<line x1="${PAD_L}" y1="${legendY - 8}" x2="${totalW - PAD_L}" y2="${legendY - 8}" stroke="${legendLine}" stroke-width="0.5"/>`);
    let lx = PAD_L;
    parts.push(`<rect x="${lx}" y="${legendY}" width="14" height="14" rx="4" fill="${legendRectFill}" stroke="#94a3b8" stroke-width="1.2"/>`);
    parts.push(`<text x="${lx + 20}" y="${legendY + 11}" font-size="9" fill="${legendTextFill}">Process Step</text>`);
    lx += 100;
    if (hasDecisions) {
      const hasParallel = allSteps.some(s => s.isDecision && s.parallel && (s.branches || []).length > 0);
      const dx = lx + 7, dy = legendY + 7, dd = 7;
      const legDecFill = d ? d.decisionBg : '#f5f3ff';
      const legDecStroke = d ? d.decisionStroke : '#7c3aed';
      parts.push(`<polygon points="${dx},${dy - dd} ${dx + dd},${dy} ${dx},${dy + dd} ${dx - dd},${dy}" fill="${legDecFill}" stroke="${legDecStroke}" stroke-width="1.2"/>`);
      parts.push(`<text x="${lx + 20}" y="${legendY + 11}" font-size="9" fill="${legendTextFill}">Exclusive</text>`);
      lx += 75;
      if (hasParallel) {
        const pdx = lx + 8, pdy = legendY + 7;
        parts.push(`<rect x="${pdx - 8}" y="${pdy - 8}" width="16" height="16" rx="4" fill="#ecfdf5" stroke="#14b8a6" stroke-width="1.2"/>`);
        parts.push(`<text x="${pdx}" y="${pdy + 4}" text-anchor="middle" font-size="12" font-weight="700" fill="#14b8a6">⊕</text>`);
        parts.push(`<text x="${lx + 22}" y="${legendY + 11}" font-size="9" fill="${legendTextFill}">Parallel</text>`);
        lx += 75;
      }
    }
    if (hasBottleneck) {
      const bnFill = d ? '#7f1d1d' : '#fee2e2';
      parts.push(`<rect x="${lx}" y="${legendY}" width="14" height="14" rx="4" fill="${bnFill}" stroke="#ef4444" stroke-width="1.2"/>`);
      parts.push(`<text x="${lx + 20}" y="${legendY + 11}" font-size="9" fill="${legendTextFill}">Bottleneck</text>`);
      lx += 90;
    }
    if (hasApproval) {
      const appFill = d ? '#422006' : '#fef3c7';
      const appStroke = d ? d.approval : '#d97706';
      parts.push(`<rect x="${lx}" y="${legendY}" width="14" height="14" rx="4" fill="${appFill}" stroke="${appStroke}" stroke-width="1.2"/>`);
      parts.push(`<text x="${lx + 20}" y="${legendY + 11}" font-size="9" fill="${legendTextFill}">Approval gate</text>`);
      lx += 95;
    }
    if (hasBadHandoff) {
      parts.push(`<line x1="${lx}" y1="${legendY + 7}" x2="${lx + 20}" y2="${legendY + 7}" stroke="#ef4444" stroke-width="1.5" stroke-dasharray="5,3"/>`);
      parts.push(`<text x="${lx + 26}" y="${legendY + 11}" font-size="9" fill="${legendTextFill}">Bad handoff</text>`);
      lx += 100;
    }
    if (hasDecisions) {
      parts.push(`<line x1="${lx}" y1="${legendY + 7}" x2="${lx + 20}" y2="${legendY + 7}" stroke="#7c3aed" stroke-width="2"/>`);
      parts.push(`<polygon points="${lx + 18},${legendY + 4} ${lx + 24},${legendY + 7} ${lx + 18},${legendY + 10}" fill="#7c3aed"/>`);
      parts.push(`<text x="${lx + 30}" y="${legendY + 11}" font-size="9" fill="${legendTextFill}">Alternate path</text>`);
    }
    if (autoCount > 0) {
      const row2Y = legendY + 18;
      lx = PAD_L;
      const autoLabelFill = d ? d.textMuted : '#475569';
      parts.push(`<text x="${lx}" y="${row2Y + 10}" font-size="9" font-weight="600" fill="${autoLabelFill}">Suggested Automation:</text>`);
      lx += 120;
      const cats = [AUTOMATION_CATEGORIES.simple, AUTOMATION_CATEGORIES.agent, AUTOMATION_CATEGORIES.humanLoop, AUTOMATION_CATEGORIES.multiAgent];
      cats.forEach(cat => {
        const count = allSteps.filter(s => s.auto && s.auto.key === cat.key).length;
        if (count > 0) {
          parts.push(`<circle cx="${lx + 7}" cy="${row2Y + 6}" r="7" fill="${cat.color}" stroke="#fff" stroke-width="1.5"/>`);
          parts.push(`<text x="${lx + 7}" y="${row2Y + 9}" text-anchor="middle" font-size="7" fill="#fff" font-weight="700">${cat.badge}</text>`);
          parts.push(`<text x="${lx + 18}" y="${row2Y + 10}" font-size="9" fill="${cat.color}" font-weight="500">${cat.label} (${count})</text>`);
          lx += 18 + cat.label.length * 6 + 26;
        }
      });
    }
  }

  parts.push('</svg>');
  return parts.join('');
}
