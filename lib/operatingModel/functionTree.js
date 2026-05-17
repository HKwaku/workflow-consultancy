/**
 * Shared function-tree helpers — keep the Graph view, the List filter,
 * and the List sidebar (CapabilityTree) telling exactly the same story.
 *
 * "Other" sub-functions: when cost is tagged directly to a function that
 * HAS sub-functions (e.g. a step tagged to top-level "Operations" while
 * Operations also has "Fulfilment"), that parent-direct cost gets its
 * own explicit synthetic sub-function called "Other" under the parent.
 * Parents stay pure rollups and Σ(sub-functions incl. Other) == parent.
 *
 * Pure / client-safe (no Node deps).
 */

export const OTHER_SUFFIX = '::__other__';
export function otherIdFor(parentId) { return `${parentId}${OTHER_SUFFIX}`; }
export function isOtherId(id) { return typeof id === 'string' && id.endsWith(OTHER_SUFFIX); }

/**
 * Returns { tree, flat, parentsWithDirect }:
 *   tree   — the function tree with an "Other" leaf appended to every
 *            parent that receives directly-attributed cost. Synthetic
 *            nodes carry `__other: true` and `parent_function_id`.
 *   flat   — every node (incl. Other), each with `parent_function_id`.
 *   parentsWithDirect — Set of real parent ids that got direct cost.
 */
export function augmentFunctionsWithOther(functions, processes) {
  const rawFns = functions || [];
  const nonLeaf = new Set();
  (function mark(nodes) {
    for (const n of nodes || []) {
      if ((n.children || []).length) { nonLeaf.add(n.id); mark(n.children); }
    }
  })(rawFns);

  const parentsWithDirect = new Set();
  for (const p of processes || []) {
    const cbf = p.cost_by_function || {};
    for (const [fid, cost] of Object.entries(cbf)) {
      if ((Number(cost) || 0) > 0 && nonLeaf.has(fid)) parentsWithDirect.add(fid);
    }
  }

  const clone = (node) => {
    const kids = (node.children || []).map(clone);
    if (parentsWithDirect.has(node.id)) {
      kids.push({
        id: otherIdFor(node.id),
        name: 'Other',
        parent_function_id: node.id,
        layer: node.layer,
        children: [],
        __other: true,
      });
    }
    return { ...node, children: kids };
  };
  const tree = rawFns.map(clone);

  const flat = [];
  (function walk(nodes, parentId) {
    for (const n of nodes || []) {
      flat.push({ ...n, parent_function_id: n.parent_function_id ?? parentId ?? null });
      walk(n.children, n.id);
    }
  })(tree, null);

  return { tree, flat, parentsWithDirect };
}

/** Selected function id → Set of itself + all descendant ids (from flat). */
export function scopeForFunction(flat, selectedFuncId) {
  const childrenByParent = new Map();
  for (const f of flat || []) {
    const pid = f.parent_function_id || null;
    if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
    childrenByParent.get(pid).push(f.id);
  }
  const scope = new Set([selectedFuncId]);
  const stack = [selectedFuncId];
  while (stack.length) {
    const cur = stack.pop();
    for (const cid of (childrenByParent.get(cur) || [])) {
      if (!scope.has(cid)) { scope.add(cid); stack.push(cid); }
    }
  }
  return scope;
}

/**
 * Does process p belong to `scope`? Owner (function_id) or any touched
 * function (function_ids). Cost tagged directly to a parent that has an
 * "Other" bucket maps onto that bucket's id, so selecting "Other"
 * surfaces exactly the parent-direct processes.
 */
export function processInScope(p, scope, parentsWithDirect) {
  if (!p) return false;
  const ids = [p.function_id, ...(p.function_ids || [])].filter(Boolean);
  for (const id of ids) {
    if (scope.has(id)) return true;
    if (parentsWithDirect && parentsWithDirect.has(id) && scope.has(otherIdFor(id))) return true;
  }
  return false;
}

/**
 * Per-function process counts (subtree + touches, Other-aware) so the
 * sidebar count matches what the List actually shows when that node is
 * selected and what the Graph attributes. Each process counts once per
 * function in its association closure (node + all ancestors).
 */
export function countsByFunction(flat, processes, parentsWithDirect) {
  const parentOf = new Map((flat || []).map((f) => [f.id, f.parent_function_id || null]));
  const counts = {};
  for (const p of processes || []) {
    const assoc = new Set();
    for (const id of [p.function_id, ...(p.function_ids || [])].filter(Boolean)) {
      assoc.add(parentsWithDirect && parentsWithDirect.has(id) ? otherIdFor(id) : id);
    }
    const bumped = new Set();
    for (const start of assoc) {
      let cur = start;
      while (cur && !bumped.has(cur)) {
        bumped.add(cur);
        counts[cur] = (counts[cur] || 0) + 1;
        cur = parentOf.get(cur) || null;
      }
    }
  }
  return counts;
}
