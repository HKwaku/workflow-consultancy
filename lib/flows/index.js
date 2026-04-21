/**
 * Flow diagram renderers for process diagnostics.
 * Exports buildFlowSVG(process, viewMode) - viewMode: 'grid' | 'swimlane'
 * Exports buildListHTML(process) for list view
 */

import { buildGridSVG } from './grid.js';
import { buildSwimlaneSVG, getSwimlaneLaneData } from './swimlane.js';
import { buildListHTML } from './list.js';

export { AUTOMATION_CATEGORIES, classifyAutomation } from './automation.js';
export { escSvg } from './escSvg.js';
export { buildGridSVG, buildSwimlaneSVG, buildListHTML, getSwimlaneLaneData };
export {
  layoutKeyV1,
  layoutKeyV2,
  redesignLayoutKey,
  resolveStoredPositions,
  writeLayoutKey,
} from './layoutStorageKeys.js';

function isDarkTheme() {
  if (typeof document === 'undefined') return false;
  return document.documentElement?.getAttribute('data-theme') === 'dark';
}

/**
 * Build flow diagram for a process.
 * @param {Object} process - Process with steps, handoffs, approvals, etc.
 * @param {'grid'|'swimlane'|'list'} viewMode - Layout mode (default: 'grid')
 * @param {Object} [options] - { hideLegend: boolean, idPrefix: string, darkTheme: boolean } darkTheme auto-detected from data-theme when not set
 * @returns {string} SVG or HTML markup
 */
export function buildFlowSVG(process, viewMode = 'grid', options = {}) {
  if (viewMode === 'list') return buildListHTML(process);
  const opts = { ...options, darkTheme: options.darkTheme ?? isDarkTheme() };
  if (viewMode === 'swimlane') opts.hideLaneLabels = true;
  return viewMode === 'swimlane' ? buildSwimlaneSVG(process, opts) : buildGridSVG(process, opts);
}
