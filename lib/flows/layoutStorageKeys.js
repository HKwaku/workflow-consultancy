/**
 * Canonical keys for persisting node-position offsets inside
 * `process.flowNodePositions` (current processes) and
 * `op.flowNodePositions` (redesign/optimised processes).
 *
 * v1 (legacy) shape: `${count}-${viewMode}` and bare `${count}`.
 * v2 shape:          `v2-${count}-${viewMode}`.
 *
 * Redesign flows must never apply v1 offsets — the auto-layout algorithm
 * changed, so stale nudges saved against the old positions produced
 * overlapping nodes in the optimised view. Use `redesignLayoutKey` for any
 * read/write on a redesign/optimised process so legacy keys are ignored.
 *
 * Current-map flows keep reading v1 (with v2 fallback) until operators
 * explicitly re-save; then they're written under v2.
 */

/** v1 key (legacy): `${count}-${viewMode}` */
export function layoutKeyV1(count, viewMode) {
  return `${count}-${viewMode}`;
}

/** v2 key: `v2-${count}-${viewMode}` */
export function layoutKeyV2(count, viewMode) {
  return `v2-${count}-${viewMode}`;
}

/**
 * Key a redesign/optimised process should use. Always v2 — v1 offsets
 * don't apply to optimised layouts.
 */
export function redesignLayoutKey(count, viewMode) {
  return layoutKeyV2(count, viewMode);
}

/**
 * Read stored positions for a process.
 *
 * - Redesign flows: only v2 (no legacy fallback).
 * - Current flows:   prefer v2, fall back to v1 `${count}-${viewMode}`,
 *                    then bare `${count}` for pre-viewMode saves.
 *
 * @param {Object|undefined} positions   The `flowNodePositions` map.
 * @param {number} count                 Step count.
 * @param {string} viewMode              'grid' | 'swimlane'.
 * @param {Object} [opts]
 * @param {boolean} [opts.isRedesign]    True when reading optimised/redesign positions.
 * @returns {Object|null}
 */
export function resolveStoredPositions(positions, count, viewMode, opts = {}) {
  if (!positions) return null;
  if (opts.isRedesign) {
    return positions[layoutKeyV2(count, viewMode)] || null;
  }
  return (
    positions[layoutKeyV2(count, viewMode)] ||
    positions[layoutKeyV1(count, viewMode)] ||
    positions[`${count}`] ||
    null
  );
}

/**
 * Key to use when *writing* positions. New writes always use v2 so that the
 * store migrates forward as operators interact with canvases.
 */
export function writeLayoutKey(count, viewMode) {
  return layoutKeyV2(count, viewMode);
}
