/**
 * Cost module - savings calculator only.
 *
 * The owner cost co-pilot (CostCopilotPanel) and the snapshot-time
 * redesign cost profiler (computeRedesignCostProfile) are gone with the
 * living-workspace migration: cost editing happens directly on the
 * canvas. Only the deterministic per-process savings calculator remains;
 * it powers Analysis-tab opportunities and the chat agent's live
 * recommendations.
 */

export { calculateProcessSavings } from '../../costSavingsCalculator.js';
