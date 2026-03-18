/**
 * Flow Consistency Normalizer — synchronous, no AI dependency.
 * Validates and repairs a process's step array before rendering.
 *
 * Used by:
 *   - lib/flows/processToReactFlow.js  (before React Flow layout)
 *   - lib/mermaid-helper.js            (before Mermaid code gen)
 *   - lib/agents/flow/graph.js         (before the AI repair pass)
 */

import { resolveBranchTarget } from './shared.js';

/* ── Department normalization ─────────────────────────────────── */

const CANONICAL_DEPARTMENTS = [
  'Sales', 'Operations', 'Finance', 'IT', 'Customer Success', 'Product',
  'Leadership', 'HR', 'Procurement', 'Legal', 'Compliance', 'Engineering',
  'Risk', 'Data Protection', 'Quality Assurance', 'Quality', 'Facilities',
  'Executive Board', 'Marketing', 'Support', 'Other',
];

/**
 * Fuzzy-match a department name to a canonical one.
 * Returns the canonical name if matched, otherwise returns the original.
 */
export function normalizeDepartment(dept) {
  if (!dept) return 'Other';
  const clean = dept.trim();
  const exact = CANONICAL_DEPARTMENTS.find(
    (c) => c.toLowerCase() === clean.toLowerCase()
  );
  if (exact) return exact;
  const partial = CANONICAL_DEPARTMENTS.find(
    (c) =>
      clean.toLowerCase().includes(c.toLowerCase()) ||
      c.toLowerCase().includes(clean.toLowerCase())
  );
  return partial || clean;
}

/* ── Validation ───────────────────────────────────────────────── */

/**
 * Validate a process's steps and return an array of issues.
 * Each issue: { type, stepIndex, branchIndex?, field, description, severity }
 *
 * @param {object[]} steps
 * @returns {object[]}
 */
export function validateFlow(steps) {
  const issues = [];
  if (!Array.isArray(steps) || steps.length === 0) return issues;

  const names = steps.map((s) => (s.name || '').trim().toLowerCase());
  const duplicateNames = names.filter((n, i) => n && names.indexOf(n) !== i);

  steps.forEach((s, i) => {
    // Step has branches but isDecision not flagged
    if ((s.branches || []).length > 0 && !s.isDecision) {
      issues.push({
        type: 'missing-decision-flag',
        stepIndex: i,
        field: 'isDecision',
        description: `Step ${i + 1} ("${s.name}") has branches but isDecision is not set`,
        severity: 'error',
      });
    }

    // Decision node with fewer than 2 branches
    if (s.isDecision && (s.branches || []).length < 2) {
      issues.push({
        type: 'insufficient-branches',
        stepIndex: i,
        field: 'branches',
        description: `Step ${i + 1} ("${s.name}") is a decision node but has ${(s.branches || []).length} branch(es) — needs at least 2`,
        severity: 'error',
      });
    }

    // Branch target issues
    if (s.isDecision && (s.branches || []).length > 0) {
      s.branches.forEach((b, bi) => {
        if (!b.target) {
          issues.push({
            type: 'missing-branch-target',
            stepIndex: i,
            branchIndex: bi,
            field: 'branches',
            description: `Step ${i + 1} branch ${bi + 1} has no target`,
            severity: 'error',
          });
          return;
        }
        const resolved = resolveBranchTarget(b.target, steps);
        if (resolved < 0) {
          issues.push({
            type: 'unresolvable-branch',
            stepIndex: i,
            branchIndex: bi,
            field: 'branches',
            description: `Step ${i + 1} branch ${bi + 1} target "${b.target}" cannot be resolved to any step`,
            severity: 'error',
          });
        } else if (resolved === i) {
          issues.push({
            type: 'self-referencing-branch',
            stepIndex: i,
            branchIndex: bi,
            field: 'branches',
            description: `Step ${i + 1} branch ${bi + 1} targets itself`,
            severity: 'error',
          });
        }
      });
    }

    // Parallel decision without a downstream isMerge step
    if (s.isDecision && s.parallel && (s.branches || []).length >= 2) {
      const hasMerge = steps.slice(i + 1).some((ss) => ss.isMerge);
      if (!hasMerge) {
        issues.push({
          type: 'missing-merge-node',
          stepIndex: i,
          field: 'isMerge',
          description: `Step ${i + 1} ("${s.name}") is a parallel gateway but no merge node follows it`,
          severity: 'warning',
        });
      }
    }

    // Duplicate step names (causes name-based branch resolution to be ambiguous)
    const lowName = (s.name || '').trim().toLowerCase();
    if (lowName && duplicateNames.includes(lowName) && names.indexOf(lowName) === i) {
      issues.push({
        type: 'duplicate-name',
        stepIndex: i,
        field: 'name',
        description: `Step name "${s.name}" is duplicated — name-based branch resolution will be ambiguous`,
        severity: 'warning',
      });
    }
  });

  // isMerge step with no corresponding PARALLEL decision upstream
  steps.forEach((s, i) => {
    if (!s.isMerge) return;
    const hasParallelDecisionUpstream = steps.slice(0, i).some(
      (ss) => ss.isDecision && ss.parallel && (ss.branches || []).length >= 2
    );
    if (!hasParallelDecisionUpstream) {
      issues.push({
        type: 'orphaned-merge',
        stepIndex: i,
        field: 'isMerge',
        description: `Step ${i + 1} ("${s.name}") is marked as a merge node but no parallel gateway precedes it — isMerge is only valid after parallel (simultaneous) branches`,
        severity: 'error',
      });
    }
  });

  return issues;
}

/* ── Repair ───────────────────────────────────────────────────── */

/**
 * Attempt deterministic repairs on the steps array.
 *
 * Repairs applied (in order):
 *  1. Set isDecision=true on steps that have branches
 *  2. Normalise branch targets to canonical "Step N" format
 *  3. Remove self-referencing branches
 *  4. Mark the first step after max(branchTargets) as isMerge for parallel decisions
 *  5. Normalize department names
 *
 * @param {object[]} steps
 * @returns {{ steps: object[], changes: string[] }}
 */
export function repairFlow(steps) {
  if (!Array.isArray(steps) || steps.length === 0) return { steps, changes: [] };

  const changes = [];

  // Deep-clone to avoid mutating caller's data
  let repaired = steps.map((s) => ({
    ...s,
    branches: (s.branches || []).map((b) => ({ ...b })),
  }));

  // ── Pass 1: set isDecision when branches present ─────────────
  repaired = repaired.map((s, i) => {
    if ((s.branches || []).length > 0 && !s.isDecision) {
      changes.push(`Step ${i + 1} ("${s.name}"): set isDecision=true (has ${s.branches.length} branch(es))`);
      return { ...s, isDecision: true };
    }
    return s;
  });

  // ── Pass 2: normalise branch targets to "Step N" ─────────────
  repaired = repaired.map((s, i) => {
    if (!s.isDecision || !(s.branches || []).length) return s;

    const fixedBranches = s.branches.map((b, bi) => {
      if (!b.target) return b;

      // Already resolves cleanly → keep as-is but normalise to "Step N"
      const resolved = resolveBranchTarget(b.target, repaired);
      if (resolved >= 0) {
        const canonical = `Step ${resolved + 1}`;
        if (b.target !== canonical) {
          changes.push(
            `Step ${i + 1} branch ${bi + 1}: canonicalised target "${b.target}" → "${canonical}"`
          );
        }
        return { ...b, target: canonical };
      }

      // Try stripping non-numeric characters to get a step number
      const stripped = String(b.target).replace(/[^0-9]/g, '');
      if (stripped) {
        const n = parseInt(stripped, 10);
        if (n >= 1 && n <= repaired.length) {
          const canonical = `Step ${n}`;
          const check = resolveBranchTarget(canonical, repaired);
          if (check >= 0) {
            changes.push(
              `Step ${i + 1} branch ${bi + 1}: repaired target "${b.target}" → "${canonical}"`
            );
            return { ...b, target: canonical };
          }
        }
      }

      return b; // Leave unresolvable — AI pass handles these
    });

    return { ...s, branches: fixedBranches };
  });

  // ── Pass 3: remove self-referencing branches ──────────────────
  repaired = repaired.map((s, i) => {
    if (!s.isDecision || !(s.branches || []).length) return s;
    const valid = s.branches.filter((b, bi) => {
      const resolved = resolveBranchTarget(b.target, repaired);
      if (resolved === i) {
        changes.push(
          `Step ${i + 1} branch ${bi + 1}: removed self-referencing branch to "Step ${i + 1}"`
        );
        return false;
      }
      return true;
    });
    return { ...s, branches: valid };
  });

  // ── Pass 4a: strip isMerge from steps that no parallel decision justifies ──
  // isMerge is only valid when a PARALLEL (not exclusive) gateway's branches
  // converge at that step. A step receiving edges from a regular sequential
  // predecessor AND a branch is a structural error (two inbound connectors of
  // different types). Strip isMerge from any step that:
  //   (a) has no parallel decision upstream at all, OR
  //   (b) is only reachable from an exclusive (non-parallel) decision's branch
  const parallelDecisionIndices = repaired
    .map((s, i) => (s.isDecision && s.parallel && (s.branches || []).length >= 2 ? i : -1))
    .filter((i) => i >= 0);

  repaired = repaired.map((s, i) => {
    if (!s.isMerge) return s;

    // Is this step targeted by any parallel decision's branches?
    const justifiedByParallel = parallelDecisionIndices.some((di) => {
      const targets = (repaired[di].branches || [])
        .map((b) => resolveBranchTarget(b.target, repaired))
        .filter((t) => t >= 0);
      // The merge candidate is the step after the furthest branch target
      const maxTarget = targets.length ? Math.max(...targets) : -1;
      return maxTarget >= 0 && maxTarget + 1 === i;
    });

    if (!justifiedByParallel) {
      changes.push(
        `Step ${i + 1} ("${s.name}"): removed isMerge — no parallel gateway flows into this step`
      );
      return { ...s, isMerge: false };
    }
    return s;
  });

  // ── Pass 4: mark merge nodes for parallel decisions ───────────
  repaired.forEach((s, i) => {
    if (!s.isDecision || !s.parallel || (s.branches || []).length < 2) return;
    const hasMergeAlready = repaired.slice(i + 1).some((ss) => ss.isMerge);
    if (hasMergeAlready) return;

    const targets = s.branches
      .map((b) => resolveBranchTarget(b.target, repaired))
      .filter((t) => t >= 0 && t < repaired.length);
    if (targets.length < 2) return;

    const maxTarget = Math.max(...targets);
    const candidateIdx = maxTarget + 1;
    if (candidateIdx < repaired.length && !repaired[candidateIdx].isMerge) {
      changes.push(
        `Step ${i + 1} parallel gateway: marked Step ${candidateIdx + 1} ("${repaired[candidateIdx].name}") as merge node`
      );
      repaired[candidateIdx] = { ...repaired[candidateIdx], isMerge: true };
    }
  });

  // ── Pass 5: normalise department names ────────────────────────
  repaired = repaired.map((s, i) => {
    const normalized = normalizeDepartment(s.department);
    if (normalized !== s.department) {
      changes.push(
        `Step ${i + 1}: normalised department "${s.department}" → "${normalized}"`
      );
      return { ...s, department: normalized };
    }
    return s;
  });

  return { steps: repaired, changes };
}
