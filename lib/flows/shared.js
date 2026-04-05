import { classifyAutomation, AUTOMATION_CATEGORIES } from './automation.js';
import { escSvg } from './escSvg.js';

export { classifyAutomation, AUTOMATION_CATEGORIES, escSvg };

export const DEPT_COLORS = {
  'Sales': { bg: '#dbeafe', stroke: '#3b82f6' },
  'Operations': { bg: '#fef3c7', stroke: '#f59e0b' },
  'Finance': { bg: '#dcfce7', stroke: '#22c55e' },
  'IT': { bg: '#e0e7ff', stroke: '#6366f1' },
  'Customer Success': { bg: '#fce7f3', stroke: '#ec4899' },
  'Product': { bg: '#f3e8ff', stroke: '#a855f7' },
  'Leadership': { bg: '#fef9c3', stroke: '#ca8a04' },
  'HR': { bg: '#ffedd5', stroke: '#ea580c' },
  'Procurement': { bg: '#e0f2fe', stroke: '#0284c7' },
  'Legal': { bg: '#fce4ec', stroke: '#e91e63' },
  'Compliance': { bg: '#f3e5f5', stroke: '#9c27b0' },
  'Engineering': { bg: '#e8eaf6', stroke: '#3f51b5' },
  'Risk': { bg: '#fff3e0', stroke: '#e65100' },
  'Data Protection': { bg: '#e8f5e9', stroke: '#2e7d32' },
  'Quality Assurance': { bg: '#e1f5fe', stroke: '#0277bd' },
  'Quality': { bg: '#e1f5fe', stroke: '#0277bd' },
  'Facilities': { bg: '#efebe9', stroke: '#795548' },
  'Executive Board': { bg: '#fef9c3', stroke: '#ca8a04' }
};

/** Single neutral palette for flow nodes - no department-based colors */
const NEUTRAL_LIGHT = { bg: '#f1f5f9', stroke: '#94a3b8' };
const NEUTRAL_DARK = { bg: '#2d2d2d', stroke: '#94a3b8' };

export function getDeptColor(dept, dark = false) {
  return dark ? NEUTRAL_DARK : NEUTRAL_LIGHT;
}

export const BRANCH_COLORS = ['#7c3aed', '#2563eb', '#059669', '#d97706', '#dc2626'];

export function prepareSteps(process) {
  const steps = process.steps || [];
  const handoffs = process.handoffs || [];
  const startLabel = process.definition?.startsWhen || 'Start';
  const endLabel = process.definition?.completesWhen || 'Complete';

  const allSteps = steps.map((s, i) => {
    const isApproval = !!(s.name && /\bapprov/i.test(s.name));
    let isBottleneck = false;
    if (process.bottleneck?.longestStep) {
      const bnIdx = parseInt(String(process.bottleneck.longestStep).replace('step-', ''));
      if (bnIdx === i) isBottleneck = true;
    }
    const auto = classifyAutomation(s, i, process);
    return {
      idx: i,
      name: s.name || 'Step ' + (i + 1),
      department: s.department || 'Other',
      isApproval,
      isBottleneck,
      isDecision: !!s.isDecision,
      isMerge: !!s.isMerge,
      branches: s.branches || [],
      isExternal: !!s.isExternal,
      parallel: !!s.parallel,
      auto,
      checklist: (s.checklist || []).map(c =>
        typeof c === 'string' ? { text: c, checked: false } : c
      ),
      systems: (s.systems || []).map(x => (typeof x === 'string' ? x : x?.name || x)).filter(Boolean),
      workMinutes: s.workMinutes ?? null,
      waitMinutes: s.waitMinutes ?? null,
      durationMinutes: s.durationMinutes ?? s.duration ?? ((s.workMinutes != null || s.waitMinutes != null) ? ((s.workMinutes ?? 0) + (s.waitMinutes ?? 0)) : null),
    };
  });

  const handoffMap = {};
  handoffs.forEach((h, i) => {
    if (i + 1 < allSteps.length) {
      handoffMap[i + '->' + (i + 1)] = {
        method: h.method ? h.method.replace(/-/g, ' ') : '',
        isBad: h.clarity === 'yes-multiple' || h.clarity === 'yes-major'
      };
    }
  });

  return { allSteps, handoffMap, startLabel, endLabel };
}

/**
 * Resolve a branch target string to a 0-based step index.
 * Supports: "Step 5" (1-indexed), "step-4" (0-indexed), step names, or bare numbers.
 */
export function resolveBranchTarget(target, allSteps) {
  if (!target) return -1;
  const t = String(target).trim();

  const numMatch = t.match(/^(?:step[\s-]*)?(\d+)$/i);
  if (numMatch) {
    const n = parseInt(numMatch[1]);
    // "step-4" is 0-indexed (internal format); "Step 5" is 1-indexed (human format)
    const idx = /step-\d+/i.test(t) ? n : n - 1;
    if (idx >= 0 && idx < allSteps.length) return idx;
  }

  const lower = t.toLowerCase();
  const exact = allSteps.findIndex(s => s.name?.toLowerCase() === lower);
  if (exact >= 0) return exact;

  const partial = allSteps.findIndex(s => s.name?.toLowerCase().includes(lower) || lower.includes(s.name?.toLowerCase()));
  if (partial >= 0) return partial;

  const anyNum = t.match(/(\d+)/);
  if (anyNum) {
    const idx = parseInt(anyNum[1]) - 1;
    if (idx >= 0 && idx < allSteps.length) return idx;
  }

  return -1;
}

export function formatDuration(min) {
  if (min == null || min <= 0) return '';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Format work + wait for display (e.g. "15m work, 2h wait") */
export function formatWorkWait(workMin, waitMin) {
  const w = formatDuration(workMin);
  const wt = formatDuration(waitMin);
  if (w && wt) return `${w} work, ${wt} wait`;
  return w || wt || '';
}

export function wrapText(text, maxChars) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  words.forEach(w => {
    const t = cur ? cur + ' ' + w : w;
    if (t.length > maxChars && cur) { lines.push(cur); cur = w; }
    else { cur = t; }
  });
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Compute reachable steps from a target by following idx+1 until decision or end.
 */
function reachableFrom(allSteps, targetIdx) {
  const reachable = new Set();
  let idx = targetIdx;
  while (idx >= 0 && idx < allSteps.length) {
    reachable.add(idx);
    if (idx >= allSteps.length - 1) break;
    const next = idx + 1;
    const nextIsDecision = allSteps[next]?.isDecision && (allSteps[next]?.branches || []).length > 0;
    if (nextIsDecision) break;
    idx = next;
  }
  return reachable;
}

/**
 * Compute parallel and exclusive branch structure for flow validation.
 * For parallel decisions: nodes in one branch must not connect to another branch without a merge.
 * For exclusive decisions: merge is the first step where all branches converge.
 * @param {Array} allSteps - Prepared steps with idx, isDecision, parallel, branches
 * @returns {{ branchOfStep: Map, mergeSteps: Set, parallelDecisions: Array, isEdgeValid: (from, to) => boolean, getMergeEdges: () => Array<{from,to}> }}
 */
export function computeParallelBranchStructure(allSteps) {
  const branchOfStep = new Map(); // stepIdx -> { decisionIdx, branchIdx } for first decision containing it
  const mergeSteps = new Set();
  const mergeToDecision = new Map(); // mergeStepIdx -> decisionIdx (which decision owns this merge)
  const parallelDecisions = [];

  allSteps.forEach((s, i) => {
    if (!s.isDecision || !(s.branches || []).length) return;
    const targets = (s.branches || []).map((br) => resolveBranchTarget(br.target || br.targetStep, allSteps));
    const validTargets = targets.filter((t) => t >= 0 && t < allSteps.length);
    if (validTargets.length < 2) return;

    const isParallel = !!s.parallel || !!s.inclusive;
    const branchSteps = validTargets.map(() => new Set());
    validTargets.forEach((t, bi) => branchSteps[bi].add(t));
    const branchTargetSet = new Set(validTargets);

    let mergeCandidate = -1;

    if (isParallel) {
      // Expand each branch by following sequential path (idx+1). Stop when:
      // - next is another branch's immediate target
      // - next is a decision
      // - next is already in another branch (convergence = merge)
      for (let round = 0; round < allSteps.length; round++) {
        let changed = false;
        const wouldAdd = new Map();
        for (let bi = 0; bi < branchSteps.length; bi++) {
          for (const idx of Array.from(branchSteps[bi])) {
            if (idx >= allSteps.length - 1) continue;
            const next = idx + 1;
            const nextIsDecision = allSteps[next]?.isDecision && (allSteps[next]?.branches || []).length > 0;
            if (nextIsDecision) continue;
            const nextIsOtherBranchTarget = branchTargetSet.has(next) && validTargets[bi] !== next;
            if (nextIsOtherBranchTarget) continue;
            const nextInOtherBranch = branchSteps.some((steps, bj) => bj !== bi && steps.has(next));
            if (nextInOtherBranch) continue;
            if (!branchSteps[bi].has(next)) {
              wouldAdd.set(next, (wouldAdd.get(next) || []).concat(bi));
            }
          }
        }
        wouldAdd.forEach((bids, nextIdx) => {
          if (bids.length !== 1) return;
          // Don't expand into the merge step - merge is first step after last in any branch
          let maxInBranches = -1;
          branchSteps.forEach((steps) => {
            steps.forEach((si) => { if (si > maxInBranches) maxInBranches = si; });
          });
          if (nextIdx === maxInBranches + 1) return; // nextIdx is the merge, don't add to branch
          branchSteps[bids[0]].add(nextIdx);
          changed = true;
        });
        if (!changed) break;
      }

      // Merge = first step after the last step in any branch
      let maxStepInAnyBranch = -1;
      branchSteps.forEach((steps) => {
        steps.forEach((si) => {
          if (si > maxStepInAnyBranch) maxStepInAnyBranch = si;
        });
      });
      mergeCandidate = maxStepInAnyBranch + 1;
    } else {
      // Exclusive: merge = smallest step in intersection of reachable from each target
      const reachableSets = validTargets.map((t) => reachableFrom(allSteps, t));
      let intersection = reachableSets[0];
      for (let r = 1; r < reachableSets.length; r++) {
        intersection = new Set([...intersection].filter((x) => reachableSets[r].has(x)));
      }
      if (intersection.size > 0) {
        mergeCandidate = Math.min(...intersection);
      }
    }

    if (mergeCandidate >= 0 && mergeCandidate < allSteps.length) {
      mergeSteps.add(mergeCandidate);
      mergeToDecision.set(mergeCandidate, i);
    }

    // Only populate branchOfStep for parallel (exclusive allows sequential cross-branch to merge)
    if (isParallel) {
      for (let si = 0; si < allSteps.length; si++) {
        for (let bi = 0; bi < branchSteps.length; bi++) {
          if (branchSteps[bi].has(si) && !mergeSteps.has(si)) {
            const existing = branchOfStep.get(si);
            if (!existing) branchOfStep.set(si, { decisionIdx: i, branchIdx: bi });
            break;
          }
        }
      }
    }

    parallelDecisions.push({
      decisionIdx: i,
      branchTargets: validTargets,
      branchSteps,
      isParallel,
    });
  });

  function isEdgeValid(fromIdx, toIdx) {
    if (fromIdx < 0 || toIdx < 0 || fromIdx >= allSteps.length || toIdx >= allSteps.length) return true;
    if (mergeSteps.has(toIdx)) return true;
    const fromBranch = branchOfStep.get(fromIdx);
    const toBranch = branchOfStep.get(toIdx);
    if (!fromBranch || !toBranch) return true;
    if (fromBranch.decisionIdx !== toBranch.decisionIdx) return true;
    return fromBranch.branchIdx === toBranch.branchIdx;
  }

  function getMergeEdges(hasEdge) {
    const edges = [];
    const added = new Set();
    mergeSteps.forEach((m) => {
      const decIdx = mergeToDecision.get(m);
      if (decIdx == null) return;
      const dec = parallelDecisions.find((d) => d.decisionIdx === decIdx);
      if (!dec) return;
      dec.branchSteps.forEach((steps, bi) => {
        const target = dec.branchTargets[bi];
        let last = -1;
        steps.forEach((si) => {
          if (si < m && si > last) last = si;
        });
        // For exclusive: branch target may be after merge (backwards edge)
        if (last < 0 && target !== m && target > m) last = target;
        if (last < 0) return;
        const key = `${last}-${m}`;
        if (!hasEdge(last, m) && !added.has(key)) {
          added.add(key);
          edges.push({ from: last, to: m });
        }
      });
    });
    return edges;
  }

  return {
    branchOfStep,
    mergeSteps,
    parallelDecisions,
    isEdgeValid,
    getMergeEdges,
  };
}
