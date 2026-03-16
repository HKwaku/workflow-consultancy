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
  legendText: '#94a3b8',
  decisionBg: '#4c1d95',
  decisionStroke: '#a78bfa',
  decisionText: '#c4b5fd',
  handoffPill: '#262626',
  bottleneck: '#ef4444',
  bottleneckText: '#fca5a5',
  approval: '#b45309',
  approvalText: '#fcd34d',
};

export function buildSwimlaneSVG(process, options = {}) {
  const { hideLegend = false, idPrefix = '', darkTheme = false, hideLaneLabels = false } = options;
  const id = idPrefix;
  const d = darkTheme ? DARK : null;
  const parts = [];

  const LANE_LABEL_W = 140;
  const NODE_W = 190;
  const NODE_H = 72;
  const NODE_GAP_X = 60;
  const LANE_PAD_Y = 28;
  const LANE_GAP = 3;
  const TERM_W = 160;
  const TERM_H = 46;
  const TOP_PAD = 90;
  const START_X = LANE_LABEL_W + TERM_W + NODE_GAP_X;
  const TERM_RX = 23;

  const p = process;
  const { allSteps, handoffMap, startLabel, endLabel } = prepareSteps(p);
  if (allSteps.length === 0) return '';

  // Department grouping
  const deptOrder = [];
  const deptMap = {};
  allSteps.forEach(s => {
    if (!deptMap[s.department]) { deptMap[s.department] = []; deptOrder.push(s.department); }
    deptMap[s.department].push(s);
  });

  // Sequential connections
  const connections = [];
  connections.push({ fromType: 'start', toIdx: 0 });
  for (let i = 0; i < allSteps.length - 1; i++) {
    if (allSteps[i].isDecision && allSteps[i].branches && allSteps[i].branches.length > 0) continue;
    const hk = i + '->' + (i + 1);
    const hd = handoffMap[hk] || { method: '', isBad: false };
    connections.push({ fromIdx: i, toIdx: i + 1, method: hd.method, isBad: hd.isBad });
  }
  connections.push({ fromIdx: allSteps.length - 1, toType: 'end' });

  // Layout: each step = column, each dept = row (lane)
  const colW = NODE_W + NODE_GAP_X;
  const nodePos = [];
  let laneY = TOP_PAD;
  const lanes = [];

  deptOrder.forEach(dept => {
    const dc = getDeptColor(dept, !!d);
    const deptSteps = deptMap[dept] || [];
    const hasDecInLane = deptSteps.some(s => s.isDecision && (s.branches || []).length > 0);
    const extraForDiamond = hasDecInLane ? 50 : 0;
    const laneH = NODE_H + LANE_PAD_Y * 2 + extraForDiamond;
    lanes.push({ dept, y: laneY, h: laneH, bg: dc.bg, stroke: dc.stroke });
    deptMap[dept].forEach(s => {
      const nx = START_X + s.idx * colW;
      const ny = laneY + LANE_PAD_Y;
      nodePos[s.idx] = { x: nx, y: ny, cx: nx + NODE_W / 2, cy: ny + NODE_H / 2, dept };
    });
    laneY += laneH + LANE_GAP;
  });

  const firstLane = lanes.find(l => l.dept === allSteps[0].department);
  const lastLane = lanes.find(l => l.dept === allSteps[allSteps.length - 1].department);

  const startPos = {
    x: LANE_LABEL_W,
    y: firstLane.y + (firstLane.h - TERM_H) / 2,
    cx: LANE_LABEL_W + TERM_W / 2,
    cy: firstLane.y + firstLane.h / 2
  };
  const endPos = {
    x: START_X + allSteps.length * colW + 10,
    y: lastLane.y + (lastLane.h - TERM_H) / 2,
    cx: START_X + allSteps.length * colW + 10 + TERM_W / 2,
    cy: lastLane.y + lastLane.h / 2
  };

  const totalW = endPos.x + TERM_W + 30;
  const autoCount = allSteps.filter(s => s.auto).length;
  const legendH = hideLegend ? 0 : (autoCount > 0 ? 50 : 28);
  const totalH = laneY + legendH + 20;

  // ── SVG open (when hideLaneLabels, clip left 140px so FlowchartPan sticky labels are the only labels) ──
  const cardBg = d ? d.cardBg : '#ffffff';
  const titleFill = d ? d.title : '#1a2f4a';
  const subtitleFill = d ? d.subtitle : '#94a3b8';
  const svgW = hideLaneLabels ? totalW - LANE_LABEL_W : totalW;
  const viewBox = hideLaneLabels ? `${LANE_LABEL_W} 0 ${svgW} ${totalH}` : `0 0 ${totalW} ${totalH}`;
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${svgW}" height="${totalH}" style="font-family:'Work Sans',Arial,sans-serif;">`);
  parts.push(`<rect x="0" y="0" width="${totalW}" height="${totalH}" fill="${cardBg}" rx="16" filter="url(#${id}slCardShadow)"/>`);

  // ── Title ──
  parts.push(`<text x="${totalW / 2}" y="28" text-anchor="middle" font-size="14" font-weight="600" fill="${titleFill}" letter-spacing="-0.3">${escSvg(p.processName || 'Process Flow')}</text>`);
  parts.push(`<text x="${totalW / 2}" y="44" text-anchor="middle" font-size="10" fill="${subtitleFill}" letter-spacing="0.3">Swimlane view &middot; ${allSteps.length} steps &middot; ${deptOrder.length} departments</text>`);

  // ── Lane bands (skip label column when hideLaneLabels - FlowchartPan renders sticky labels) ──
  lanes.forEach(l => {
    parts.push(`<rect x="0" y="${l.y}" width="${totalW}" height="${l.h}" fill="${l.bg}" stroke="${l.stroke}" stroke-width="0.5" rx="0" opacity="0.35"/>`);
    if (!hideLaneLabels) {
      parts.push(`<rect x="0" y="${l.y}" width="${LANE_LABEL_W}" height="${l.h}" fill="${l.stroke}" opacity="0.08" rx="0"/>`);
      parts.push(`<rect x="0" y="${l.y}" width="4" height="${l.h}" fill="${l.stroke}" rx="0"/>`);
      parts.push(`<text x="${LANE_LABEL_W / 2 + 2}" y="${l.y + l.h / 2 + 5}" text-anchor="middle" font-size="11" font-weight="600" fill="${l.stroke}">${escSvg(l.dept)}</text>`);
    }
  });

  // ── Defs ──
  parts.push(`<defs>`);
  parts.push(`<marker id="${id}sarw" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 1 L 10 5 L 0 9 z" fill="#475569"/></marker>`);
  parts.push(`<marker id="${id}sarw-bad" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 1 L 10 5 L 0 9 z" fill="#ef4444"/></marker>`);
  parts.push(`<marker id="${id}sarw-term" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 1 L 10 5 L 0 9 z" fill="#059669"/></marker>`);
  BRANCH_COLORS.forEach((c, ci) => {
    parts.push(`<marker id="${id}sarwc${ci}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 1 L 10 5 L 0 9 z" fill="${c}"/></marker>`);
  });
  parts.push(`<marker id="${id}sarw-teal" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 1 L 10 5 L 0 9 z" fill="#14b8a6"/></marker>`);
  parts.push(`<filter id="${id}sshadow" x="-8%" y="-8%" width="116%" height="120%"><feDropShadow dx="0" dy="2" stdDeviation="4" flood-opacity="0.06"/></filter>`);
  parts.push(`<filter id="${id}slCardShadow" x="-2%" y="-2%" width="104%" height="106%"><feDropShadow dx="0" dy="4" stdDeviation="12" flood-opacity="0.04"/><feDropShadow dx="0" dy="1" stdDeviation="3" flood-opacity="0.03"/></filter>`);
  parts.push(`<filter id="${id}slGlow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="6" flood-opacity="0.12" flood-color="#3d8ea6"/></filter>`);
  parts.push(`</defs>`);

  // ── CSS ──
  parts.push(`<style>
    @keyframes flowDash { to { stroke-dashoffset: -40; } }
    @keyframes particleMove { 0% { offset-distance: 0%; opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { offset-distance: 100%; opacity: 0; } }
    .sl-arrow { stroke-dasharray: 8 6; animation: flowDash 1.5s linear infinite; }
    .sl-particle { r: 3; fill: #3d8ea6; animation: particleMove 3s linear infinite; }
    .sl-node { cursor: pointer; transition: filter 0.25s ease, transform 0.25s cubic-bezier(0.16,1,0.3,1); transform-origin: center; transform-box: fill-box; }
    .sl-node:hover { filter: url(#${id}slGlow); transform: scale(1.04) translateY(-2px); }
  </style>`);

  // ── Sequential arrows (particles only on start/end connections) ──
  function drawSLArrow(x1, y1, x2, y2, isCross, isBad, withParticle) {
    const color = isBad ? '#ef4444' : '#3d8ea6';
    const marker = isBad ? `url(#${id}sarw-bad)` : `url(#${id}sarw)`;
    let pathD;
    if (isCross && Math.abs(y1 - y2) > 10) {
      const mx = (x1 + x2) / 2;
      pathD = `M ${x1} ${y1} L ${mx} ${y1} L ${mx} ${y2} L ${x2} ${y2}`;
    } else {
      pathD = `M ${x1} ${y1} L ${x2} ${y2}`;
    }
    parts.push(`<path d="${pathD}" fill="none" stroke="${color}" stroke-width="1.8" class="sl-arrow" marker-end="${marker}" opacity="0.55"/>`);
    if (withParticle) {
      parts.push(`<circle class="sl-particle" style="offset-path:path('${pathD}');animation-duration:2.5s;fill:${isBad ? '#ef4444' : '#3d8ea6'};"/>`);
    }
    return pathD;
  }

  connections.forEach(c => {
    let x1, y1, x2, y2, isCross;
    const isTerminal = !!(c.fromType === 'start' || c.toType === 'end');
    if (c.fromType === 'start') {
      x1 = startPos.x + TERM_W; y1 = startPos.cy;
      x2 = nodePos[c.toIdx].x; y2 = nodePos[c.toIdx].cy;
      isCross = Math.abs(y1 - y2) > 10;
    } else if (c.toType === 'end') {
      x1 = nodePos[c.fromIdx].x + NODE_W; y1 = nodePos[c.fromIdx].cy;
      x2 = endPos.x; y2 = endPos.cy;
      isCross = Math.abs(y1 - y2) > 10;
    } else {
      x1 = nodePos[c.fromIdx].x + NODE_W; y1 = nodePos[c.fromIdx].cy;
      x2 = nodePos[c.toIdx].x; y2 = nodePos[c.toIdx].cy;
      isCross = nodePos[c.fromIdx].dept !== nodePos[c.toIdx].dept;
    }
    const pathD = drawSLArrow(x1, y1, x2, y2, isCross, c.isBad || false, isTerminal);

    // Handoff method label on middle arrows
    if (c.method && !c.fromType && !c.toType) {
      const mx = (x1 + x2) / 2;
      const my = isCross ? (y1 + y2) / 2 - 10 : y1 - 12;
      const pillW = Math.min(c.method.length * 4.8 + 14, 100);
      const pillFill = d ? d.handoffPill : '#fff';
      const pillTextFill = d ? d.textMuted : '#64748b';
      parts.push(`<rect x="${mx - pillW / 2}" y="${my - 7}" width="${pillW}" height="14" rx="7" fill="${pillFill}" stroke="#94a3b8" stroke-width="0.7" opacity="0.9"/>`);
      parts.push(`<text x="${mx}" y="${my + 3}" text-anchor="middle" font-size="7" fill="${pillTextFill}" font-weight="500" opacity="0.8">${escSvg(c.method)}</text>`);
    }
  });

  // ── Start terminal (oval per flowchart convention) ──
  const slTermRx = TERM_W / 2, slTermRy = TERM_H / 2;
  const termFill = d ? d.termBg : '#d1fae5';
  const termStroke = d ? d.termStroke : '#059669';
  const termTextFill = d ? d.termText : '#064e3b';
  parts.push(`<ellipse cx="${startPos.cx}" cy="${startPos.cy}" rx="${slTermRx}" ry="${slTermRy}" fill="${termFill}" stroke="${termStroke}" stroke-width="2" filter="url(#${id}sshadow)"/>`);
  const stLines = wrapText(startLabel, 22);
  const stFS = stLines.length > 2 ? 6.5 : 7.5;
  const stLH = stFS + 2;
  const stSY = startPos.cy - ((stLines.length - 1) * stLH) / 2 + stFS / 2;
  stLines.forEach((line, li) => {
    parts.push(`<text x="${startPos.cx}" y="${stSY + li * stLH}" text-anchor="middle" font-size="${stFS}" font-weight="600" fill="${termTextFill}">${escSvg(line)}</text>`);
  });

  // ── End terminal (oval per flowchart convention) ──
  parts.push(`<ellipse cx="${endPos.cx}" cy="${endPos.cy}" rx="${slTermRx}" ry="${slTermRy}" fill="${termFill}" stroke="${termStroke}" stroke-width="2" filter="url(#${id}sshadow)"/>`);
  const etLines = wrapText(endLabel, 22);
  const etFS = etLines.length > 2 ? 6.5 : 7.5;
  const etLH = etFS + 2;
  const etSY = endPos.cy - ((etLines.length - 1) * etLH) / 2 + etFS / 2;
  etLines.forEach((line, li) => {
    parts.push(`<text x="${endPos.cx}" y="${etSY + li * etLH}" text-anchor="middle" font-size="${etFS}" font-weight="600" fill="${termTextFill}">${escSvg(line)}</text>`);
  });

  // ── Incoming route map ──
  const slIncoming = {};
  allSteps.forEach((s, i) => {
    if (!s.isDecision || s.branches.length === 0) return;
    const isParallel = !!s.parallel;
    s.branches.forEach((br, bi) => {
      const targetIdx = resolveBranchTarget(br.target || br.targetStep, allSteps);
      if (targetIdx >= 0 && targetIdx < allSteps.length) {
        if (!slIncoming[targetIdx]) slIncoming[targetIdx] = [];
        const color = isParallel ? '#14b8a6' : BRANCH_COLORS[bi % BRANCH_COLORS.length];
        slIncoming[targetIdx].push({ fromStep: i + 1, color, label: br.label });
      }
    });
  });

  // ── Step nodes ──
  const SL_DIA_HW = 65, SL_DIA_HH = 40;

  allSteps.forEach((s, i) => {
    const pos = nodePos[i];
    if (!pos) return;
    const isDecNode = s.isDecision && s.branches.length > 0;

    parts.push(`<g class="sl-node" data-step-index="${i}">`);

    if (isDecNode) {
      const cx = pos.cx, cy = pos.cy;
      const isParallel = !!s.parallel;
      const decFill = isParallel ? (d ? '#0d3d38' : '#ecfdf5') : (d ? d.decisionBg : '#faf9ff');
      const decStroke = isParallel ? '#14b8a6' : (d ? d.decisionStroke : '#7c3aed');
      const decTextFill = isParallel ? (d ? '#5eead4' : '#0d3d38') : (d ? d.decisionText : '#4c1d95');
      if (isParallel) {
        parts.push(`<rect x="${cx - SL_DIA_HW}" y="${cy - SL_DIA_HH}" width="${SL_DIA_HW * 2}" height="${SL_DIA_HH * 2}" rx="12" fill="${decFill}" stroke="${decStroke}" stroke-width="1.8" filter="url(#${id}sshadow)"/>`);
        parts.push(`<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="18" font-weight="700" fill="${decStroke}">⊕</text>`);
        parts.push(`<text x="${cx}" y="${cy - SL_DIA_HH + 10}" text-anchor="middle" font-size="6" font-weight="700" fill="${decTextFill}" opacity="0.9">${i + 1}</text>`);
        parts.push(`<title>Parallel: all paths run  -  ${escSvg(s.name || '')}</title>`);
      } else {
        parts.push(`<polygon points="${cx},${cy - SL_DIA_HH} ${cx + SL_DIA_HW},${cy} ${cx},${cy + SL_DIA_HH} ${cx - SL_DIA_HW},${cy}" fill="${decFill}" stroke="${decStroke}" stroke-width="1.8" filter="url(#${id}sshadow)"/>`);
        parts.push(`<text x="${cx}" y="${cy - SL_DIA_HH + 12}" text-anchor="middle" font-size="8" font-weight="700" fill="${decStroke}">${i + 1}</text>`);
      }

      let dLines = isParallel ? [] : wrapText(s.name, 16);
      const slDFS = dLines.length > 3 ? 7 : 8;
      const slDLH = slDFS + 2;
      const slDBH = dLines.length * slDLH;
      const slDSY = cy - slDBH / 2 + slDFS;
      dLines.forEach((line, li) => {
        parts.push(`<text x="${cx}" y="${slDSY + li * slDLH}" text-anchor="middle" font-size="${slDFS}" fill="${decTextFill}" font-weight="500">${escSvg(line)}</text>`);
      });
      const durDec = formatWorkWait(s.workMinutes, s.waitMinutes) || formatDuration(s.durationMinutes);
      const sysDec = (s.systems || []).slice(0, 2).map(x => escSvg(x)).join(', ');
      const footerY = cy + SL_DIA_HH - 8;
      if (durDec) parts.push(`<text x="${cx}" y="${footerY}" text-anchor="middle" font-size="7" fill="#64748b" opacity="0.85">${escSvg(durDec)}</text>`);
      if (sysDec && !durDec) parts.push(`<text x="${cx}" y="${footerY}" text-anchor="middle" font-size="6.5" fill="#94a3b8" opacity="0.75">${sysDec}</text>`);

      if (s.auto) {
        parts.push(`<circle cx="${cx + SL_DIA_HW - 4}" cy="${cy - SL_DIA_HH + 4}" r="7" fill="${s.auto.color}" stroke="#fff" stroke-width="1.5"/>`);
        parts.push(`<text x="${cx + SL_DIA_HW - 4}" y="${cy - SL_DIA_HH + 7}" text-anchor="middle" font-size="6" fill="#fff" font-weight="700">${s.auto.badge}</text>`);
        parts.push(`<title>Suggestion: ${escSvg(s.auto.label || '')}${s.auto.reason ? '  -  ' + escSvg(s.auto.reason) : ''}</title>`);
      }

      const incoming = slIncoming[i] || [];
      incoming.forEach((inc, ii) => {
        const ix = cx - SL_DIA_HW + 4;
        const iy = cy - 8 + ii * 11;
        parts.push(`<circle cx="${ix}" cy="${iy}" r="4.5" fill="${inc.color}" stroke="#fff" stroke-width="1"/>`);
        parts.push(`<text x="${ix}" y="${iy + 2}" text-anchor="middle" font-size="4.5" fill="#fff" font-weight="700">${inc.fromStep}</text>`);
        parts.push(`<title>From Step ${inc.fromStep}: ${escSvg(inc.label)}</title>`);
      });

    } else {
      const incoming = slIncoming[i] || [];
      const laneData = lanes.find(l => l.dept === pos.dept);
      let deptStroke = laneData ? laneData.stroke : '#cbd5e1';
      let stroke = deptStroke, sw = 1.2, textCol = d ? d.text : '#1e293b';
      if (s.isBottleneck) { stroke = d ? d.bottleneck : '#ef4444'; sw = 2.5; textCol = d ? d.bottleneckText : '#991b1b'; }
      else if (s.isApproval) { stroke = d ? d.approval : '#d97706'; sw = 2; textCol = d ? d.approvalText : '#92400e'; }
      else if (incoming.length === 1) { stroke = incoming[0].color; sw = 1.5; }
      const rx = s.isApproval ? 14 : 10;
      const nodeFill = d ? d.nodeBg : '#ffffff';
      const laneOverlay = laneData ? laneData.bg : (d ? '#475569' : '#f8fafc');

      parts.push(`<rect x="${pos.x}" y="${pos.y}" width="${NODE_W}" height="${NODE_H}" rx="${rx}" fill="${nodeFill}" stroke="${stroke}" stroke-width="${sw}" filter="url(#${id}sshadow)"/>`);
      parts.push(`<rect x="${pos.x}" y="${pos.y}" width="${NODE_W}" height="${NODE_H}" rx="${rx}" fill="${laneOverlay}" opacity="0.12"/>`);
      parts.push(`<rect x="${pos.x + 1}" y="${pos.y + 6}" width="3" height="${NODE_H - 12}" rx="1.5" fill="${deptStroke}" opacity="0.7"/>`);

      const badgeBg = s.isBottleneck ? (d ? d.bottleneck : '#ef4444') : s.isApproval ? (d ? d.approval : '#d97706') : stroke;
      parts.push(`<circle cx="${pos.x + 14}" cy="${pos.y + 14}" r="10" fill="${badgeBg}" opacity="0.12"/>`);
      parts.push(`<text x="${pos.x + 14}" y="${pos.y + 18}" text-anchor="middle" font-size="9" font-weight="700" fill="${badgeBg}">${i + 1}</text>`);

      incoming.forEach((inc, ii) => {
        const by = pos.y + 14 + ii * 12;
        parts.push(`<circle cx="${pos.x - 1}" cy="${by}" r="4.5" fill="${inc.color}" stroke="#fff" stroke-width="1"/>`);
        parts.push(`<text x="${pos.x - 1}" y="${by + 2}" text-anchor="middle" font-size="4.5" fill="#fff" font-weight="700">${inc.fromStep}</text>`);
        parts.push(`<title>From Step ${inc.fromStep}: ${escSvg(inc.label)}</title>`);
      });

      let lines = wrapText(s.name, 22);
      const slFS = lines.length > 3 ? 8 : 9.5;
      const lineH = slFS + 2.5;
      const slBH = lines.length * lineH;
      const textStartY = pos.y + 16 + (NODE_H - 16 - slBH) / 2 + slFS;
      lines.forEach((line, li) => {
        parts.push(`<text x="${pos.x + NODE_W / 2}" y="${textStartY + li * lineH}" text-anchor="middle" font-size="${slFS}" fill="${textCol}" font-weight="500">${escSvg(line)}</text>`);
      });
      const durProc = formatWorkWait(s.workMinutes, s.waitMinutes) || formatDuration(s.durationMinutes);
      const sysProc = (s.systems || []).slice(0, 2).map(x => escSvg(x)).join(', ');
      const slFooterY = pos.y + NODE_H - 10;
      if (durProc && sysProc) {
        parts.push(`<text x="${pos.x + NODE_W / 2}" y="${slFooterY - 11}" text-anchor="middle" font-size="6.5" fill="#94a3b8" opacity="0.8">${sysProc}</text>`);
        parts.push(`<text x="${pos.x + NODE_W / 2}" y="${slFooterY}" text-anchor="middle" font-size="8" fill="#64748b" opacity="0.9">${escSvg(durProc)}</text>`);
      } else if (durProc) {
        parts.push(`<text x="${pos.x + NODE_W / 2}" y="${slFooterY}" text-anchor="middle" font-size="8" fill="#64748b" opacity="0.9">${escSvg(durProc)}</text>`);
      } else if (sysProc) {
        parts.push(`<text x="${pos.x + NODE_W / 2}" y="${slFooterY}" text-anchor="middle" font-size="6.5" fill="#94a3b8" opacity="0.8">${sysProc}</text>`);
      }

      if (s.auto) {
        const bx = pos.x + NODE_W - 6, by = pos.y - 4;
        parts.push(`<circle cx="${bx}" cy="${by}" r="9" fill="${s.auto.color}" stroke="#fff" stroke-width="2"/>`);
        parts.push(`<text x="${bx}" y="${by + 3}" text-anchor="middle" font-size="8" fill="#fff" font-weight="700">${s.auto.badge}</text>`);
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

  // ── Decision branch lines (with particles) ──
  allSteps.forEach((s, i) => {
    if (!s.isDecision || !s.branches || s.branches.length === 0) return;
    const pos = nodePos[i];
    if (!pos) return;
    const isParallel = !!s.parallel;
    const cx = pos.cx, cy = pos.cy;
    const brCount = s.branches.length;
    const sortedBranches = [...s.branches].sort((a, b) => {
      const yesA = /^(yes|true|approved|pass|accept|ok)/i.test((a.label || '').trim());
      const noA = /^(no|false|rejected|fail|reject)/i.test((a.label || '').trim());
      const yesB = /^(yes|true|approved|pass|accept|ok)/i.test((b.label || '').trim());
      const noB = /^(no|false|rejected|fail|reject)/i.test((b.label || '').trim());
      if (yesA && !yesB) return -1;
      if (!yesA && yesB) return 1;
      if (noA && !noB) return 1;
      if (!noA && noB) return -1;
      return 0;
    });

    sortedBranches.forEach((br, bi) => {
      const color = isParallel ? '#14b8a6' : BRANCH_COLORS[bi % BRANCH_COLORS.length];
      let targetIdx = resolveBranchTarget(br.target || br.targetStep, allSteps);
      if (targetIdx < 0 || targetIdx >= allSteps.length) {
        targetIdx = i + 1;
        if (targetIdx >= allSteps.length) return;
      }

      const tp = nodePos[targetIdx];
      if (!tp) return;
      const isTargetDec = allSteps[targetIdx].isDecision && (allSteps[targetIdx].branches || []).length > 0;
      const goesBack = targetIdx < i;
      const chOff = bi * 12;

      let pathD;
      if (goesBack) {
        const exitX = cx + (bi - (brCount - 1) / 2) * 14;
        const exitY = cy - SL_DIA_HH;
        const channelY = TOP_PAD - 28 - chOff;
        const entryX = tp.cx;
        const entryY = isTargetDec ? tp.cy - SL_DIA_HH : tp.y;
        pathD = `M ${exitX} ${exitY} L ${exitX} ${channelY} L ${entryX} ${channelY} L ${entryX} ${entryY}`;
      } else {
        const exitX = cx + (bi - (brCount - 1) / 2) * 14;
        const exitY = cy + SL_DIA_HH;
        const entryX = isTargetDec ? tp.cx - SL_DIA_HW : tp.x;
        const entryY = tp.cy;
        const srcLane = lanes.find(l => l.dept === pos.dept);
        const laneBottom = srcLane ? srcLane.y + srcLane.h : exitY + 20;
        const jogY = laneBottom + chOff;
        const gapMidX = pos.x + NODE_W + NODE_GAP_X / 2 + chOff;
        if (Math.abs(exitY - entryY) < 5 && Math.abs(exitX - entryX) < colW * 2) {
          pathD = `M ${exitX} ${exitY} L ${exitX} ${jogY} L ${entryX} ${jogY} L ${entryX} ${entryY}`;
        } else {
          pathD = `M ${exitX} ${exitY} L ${exitX} ${jogY} L ${gapMidX} ${jogY} L ${gapMidX} ${entryY} L ${entryX} ${entryY}`;
        }
      }

      const slDashAttr = (goesBack || isParallel) ? 'stroke-dasharray="6,4"' : '';
      const markerId = isParallel ? `url(#${id}sarw-teal)` : `url(#${id}sarwc${bi % 5})`;
      parts.push(`<path d="${pathD}" fill="none" stroke="${color}" stroke-width="2" ${slDashAttr} marker-end="${markerId}" opacity="0.8"/>`);
      parts.push(`<circle r="3" fill="${color}" opacity="0.85"><animateMotion dur="${2.5 + bi * 0.5}s" repeatCount="indefinite" begin="${bi * 0.4}s" path="${pathD}"><\/animateMotion><\/circle>`);

      // Branch label pill - use wider spacing so Yes/No/Other don't overlap
      const brText = escSvg(isParallel ? 'All: ' + (br.label || '') : (br.label || ''));
      const slPillW = Math.max(brText.length * 5.2 + 18, 36);
      const slPillH = 18;
      const labelSpacing = Math.max(40, slPillW * 0.9);
      if (goesBack) {
        const elX = cx + (bi - (brCount - 1) / 2) * labelSpacing;
        const elY = cy - SL_DIA_HH - 20;
        parts.push(`<rect x="${elX - slPillW / 2}" y="${elY - slPillH / 2}" width="${slPillW}" height="${slPillH}" rx="${slPillH / 2}" fill="#fff" stroke="${color}" stroke-width="1" opacity="0.95"/>`);
        parts.push(`<text x="${elX}" y="${elY + 4}" text-anchor="middle" font-size="8" fill="${color}" font-weight="700">${brText}</text>`);
      } else {
        const elX = cx + (bi - (brCount - 1) / 2) * labelSpacing;
        const elY = cy + SL_DIA_HH + 22;
        parts.push(`<rect x="${elX - slPillW / 2}" y="${elY - slPillH / 2}" width="${slPillW}" height="${slPillH}" rx="${slPillH / 2}" fill="#fff" stroke="${color}" stroke-width="1" opacity="0.95"/>`);
        parts.push(`<text x="${elX}" y="${elY + 4}" text-anchor="middle" font-size="8" fill="${color}" font-weight="700">${brText}</text>`);
      }
    });
  });

  // ── Legend (conditional) ──
  if (!hideLegend) {
    const hasDecisions = allSteps.some(s => s.isDecision && s.branches.length > 0);
    const legendY = laneY + 8;
    const legTextFill = d ? d.legendText : '#64748b';
    const legTermFill = d ? termFill : '#d1fae5';
    const legStepFill = d ? d.nodeBg : '#fff';
    let slx = LANE_LABEL_W + 10;
    parts.push(`<rect x="${slx}" y="${legendY}" width="14" height="14" rx="3" fill="${legTermFill}" stroke="${termStroke}" stroke-width="1.5"/>`);
    parts.push(`<text x="${slx + 20}" y="${legendY + 11}" font-size="9" fill="${legTextFill}">Start / End</text>`);
    slx += 90;
    parts.push(`<rect x="${slx}" y="${legendY}" width="14" height="14" rx="3" fill="${legStepFill}" stroke="#cbd5e1" stroke-width="1.5"/>`);
    parts.push(`<text x="${slx + 20}" y="${legendY + 11}" font-size="9" fill="${legTextFill}">Step</text>`);
    slx += 60;
    if (hasDecisions) {
      const hasParallel = allSteps.some(s => s.isDecision && s.parallel && (s.branches || []).length > 0);
      const dx = slx + 7, dy = legendY + 7, dd = 7;
      const legDecFill = d ? d.decisionBg : '#f5f3ff';
      const legDecStroke = d ? d.decisionStroke : '#7c3aed';
      parts.push(`<polygon points="${dx},${dy - dd} ${dx + dd},${dy} ${dx},${dy + dd} ${dx - dd},${dy}" fill="${legDecFill}" stroke="${legDecStroke}" stroke-width="1.5"/>`);
      parts.push(`<text x="${slx + 20}" y="${legendY + 11}" font-size="9" fill="${legTextFill}">Exclusive</text>`);
      slx += 80;
      if (hasParallel) {
        const pdx = slx + 8, pdy = legendY + 7;
        parts.push(`<rect x="${pdx - 8}" y="${pdy - 8}" width="16" height="16" rx="4" fill="#ecfdf5" stroke="#14b8a6" stroke-width="1.5"/>`);
        parts.push(`<text x="${pdx}" y="${pdy + 4}" text-anchor="middle" font-size="12" font-weight="700" fill="#14b8a6">⊕</text>`);
        parts.push(`<text x="${slx + 22}" y="${legendY + 11}" font-size="9" fill="${legTextFill}">Parallel</text>`);
        slx += 75;
      }
    }
    const legBnFill = d ? '#7f1d1d' : '#fee2e2';
    parts.push(`<rect x="${slx}" y="${legendY}" width="14" height="14" rx="3" fill="${legBnFill}" stroke="#ef4444" stroke-width="1.5"/>`);
    parts.push(`<text x="${slx + 20}" y="${legendY + 11}" font-size="9" fill="${legTextFill}">Bottleneck</text>`);
    slx += 90;
    const legAppFill = d ? '#422006' : '#fef3c7';
    const legAppStroke = d ? d.approval : '#d97706';
    parts.push(`<rect x="${slx}" y="${legendY}" width="14" height="14" rx="3" fill="${legAppFill}" stroke="${legAppStroke}" stroke-width="1.5"/>`);
    parts.push(`<text x="${slx + 20}" y="${legendY + 11}" font-size="9" fill="${legTextFill}">Approval</text>`);
    slx += 85;
    parts.push(`<line x1="${slx}" y1="${legendY + 7}" x2="${slx + 20}" y2="${legendY + 7}" stroke="#ef4444" stroke-width="1.5" stroke-dasharray="5,3"/>`);
    parts.push(`<text x="${slx + 26}" y="${legendY + 11}" font-size="9" fill="${legTextFill}">Bad handoff</text>`);
    if (hasDecisions) {
      slx += 100;
      parts.push(`<line x1="${slx}" y1="${legendY + 7}" x2="${slx + 20}" y2="${legendY + 7}" stroke="#7c3aed" stroke-width="2"/>`);
      parts.push(`<polygon points="${slx + 18},${legendY + 4} ${slx + 24},${legendY + 7} ${slx + 18},${legendY + 10}" fill="#7c3aed"/>`);
      parts.push(`<text x="${slx + 30}" y="${legendY + 11}" font-size="9" fill="#64748b">Alternate path</text>`);
    }
    if (autoCount > 0) {
      const row2Y = legendY + 18;
      slx = LANE_LABEL_W + 10;
      parts.push(`<text x="${slx}" y="${row2Y + 10}" font-size="9" font-weight="600" fill="#475569">Auto:</text>`);
      slx += 40;
      const cats = [AUTOMATION_CATEGORIES.simple, AUTOMATION_CATEGORIES.agent, AUTOMATION_CATEGORIES.humanLoop, AUTOMATION_CATEGORIES.multiAgent];
      cats.forEach(cat => {
        const count = allSteps.filter(s => s.auto && s.auto.key === cat.key).length;
        if (count > 0) {
          parts.push(`<circle cx="${slx + 7}" cy="${row2Y + 6}" r="7" fill="${cat.color}" stroke="#fff" stroke-width="1.5"/>`);
          parts.push(`<text x="${slx + 7}" y="${row2Y + 9}" text-anchor="middle" font-size="7" fill="#fff" font-weight="700">${cat.badge}</text>`);
          parts.push(`<text x="${slx + 18}" y="${row2Y + 10}" font-size="9" fill="${cat.color}" font-weight="500">${cat.label} (${count})</text>`);
          slx += 18 + cat.label.length * 6 + 26;
        }
      });
    }
  }

  parts.push('</svg>');
  return parts.join('');
}

const LANE_LABEL_W_EXPORT = 140;
const NODE_W_EXPORT = 190;
const NODE_GAP_X_EXPORT = 60;
const TERM_W_EXPORT = 160;

/**
 * Returns lane data for sticky label overlay when viewMode is swimlane.
 * Used by FlowchartPan to render frozen department labels on horizontal scroll.
 */
export function getSwimlaneLaneData(process, darkTheme = false) {
  const { allSteps } = prepareSteps(process);
  if (allSteps.length === 0) return null;
  const deptOrder = [];
  const deptMap = {};
  allSteps.forEach(s => {
    if (!deptMap[s.department]) { deptMap[s.department] = []; deptOrder.push(s.department); }
    deptMap[s.department].push(s);
  });
  const NODE_H = 72;
  const LANE_PAD_Y = 28;
  const LANE_GAP = 3;
  const colW = NODE_W_EXPORT + NODE_GAP_X_EXPORT;
  const d = darkTheme ? { stroke: '#94a3b8' } : null;
  let laneY = 90;
  const lanes = [];
  deptOrder.forEach(dept => {
    const dc = getDeptColor(dept, !!d);
    const deptSteps = deptMap[dept] || [];
    const hasDecInLane = deptSteps.some(s => s.isDecision && (s.branches || []).length > 0);
    const extraForDiamond = hasDecInLane ? 50 : 0;
    const laneH = NODE_H + LANE_PAD_Y * 2 + extraForDiamond;
    lanes.push({ dept, y: laneY, h: laneH, stroke: dc.stroke });
    laneY += laneH + LANE_GAP;
  });
  const START_X = LANE_LABEL_W_EXPORT + TERM_W_EXPORT + NODE_GAP_X_EXPORT;
  const totalW = START_X + allSteps.length * colW + 10 + TERM_W_EXPORT + 30;
  const totalH = laneY + 48;
  return { lanes, totalH, totalW };
}
