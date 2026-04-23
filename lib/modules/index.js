/**
 * Module registry.
 *
 * Two kinds of modules live here:
 *
 * 1) **Pillar modules** - the 4 audience segments (pe, ma, scaling,
 *    high-risk-ops). Each has metadata, an AI system prompt, and process
 *    templates. Registered in `MODULES` below.
 *
 * 2) **Feature modules** - capability-oriented code groupings used across
 *    pillars: diagnostic intake, flow canvas, report rendering, redesign
 *    agent, cost analysis, portal, build, marketing, shared primitives.
 *    Consumed via `@/modules/<name>` re-export files; not in the `MODULES`
 *    registry (they're not audience-segment content).
 */

import { peConfig } from './pe/config.js';
import { maConfig } from './ma/config.js';
import { scalingConfig } from './scaling/config.js';
import { highRiskOpsConfig } from './high-risk-ops/config.js';

import { SYSTEM_PROMPT as PE_SYSTEM_PROMPT, SEGMENT_BLOCK as PE_SEGMENT_BLOCK, buildSegmentBlock as PE_BUILD_SEGMENT_BLOCK } from './pe/agentConfig.js';
import { SYSTEM_PROMPT as MA_SYSTEM_PROMPT, SEGMENT_BLOCK as MA_SEGMENT_BLOCK } from './ma/agentConfig.js';
import { SYSTEM_PROMPT as SCALING_SYSTEM_PROMPT, SEGMENT_BLOCK as SCALING_SEGMENT_BLOCK } from './scaling/agentConfig.js';
import { SYSTEM_PROMPT as HRO_SYSTEM_PROMPT, SEGMENT_BLOCK as HRO_SEGMENT_BLOCK } from './high-risk-ops/agentConfig.js';

import { PE_TEMPLATES } from './pe/templates.js';
import { MA_TEMPLATES } from './ma/templates.js';
import { SCALING_TEMPLATES } from './scaling/templates.js';
import { HIGH_RISK_OPS_TEMPLATES } from './high-risk-ops/templates.js';

export const MODULE_IDS = ['pe', 'ma', 'scaling', 'high-risk-ops'];

export const MODULES = {
  pe: {
    ...peConfig,
    agentConfig: { systemPrompt: PE_SYSTEM_PROMPT, segmentBlock: PE_SEGMENT_BLOCK, buildSegmentBlock: PE_BUILD_SEGMENT_BLOCK },
    templates: PE_TEMPLATES,
  },
  ma: {
    ...maConfig,
    agentConfig: { systemPrompt: MA_SYSTEM_PROMPT, segmentBlock: MA_SEGMENT_BLOCK },
    templates: MA_TEMPLATES,
  },
  scaling: {
    ...scalingConfig,
    agentConfig: { systemPrompt: SCALING_SYSTEM_PROMPT, segmentBlock: SCALING_SEGMENT_BLOCK },
    templates: SCALING_TEMPLATES,
  },
  'high-risk-ops': {
    ...highRiskOpsConfig,
    agentConfig: { systemPrompt: HRO_SYSTEM_PROMPT, segmentBlock: HRO_SEGMENT_BLOCK },
    templates: HIGH_RISK_OPS_TEMPLATES,
  },
};

/**
 * Returns the module config for a given moduleId, or null if not found.
 * @param {string} id
 * @returns {{ id, label, tagline, color, variant, reportBanner, agentConfig, templates } | null}
 */
export function getModule(id) {
  return MODULES[id] || null;
}

/**
 * Returns all module configs as an array, in display order.
 */
export function getAllModules() {
  return MODULE_IDS.map((id) => MODULES[id]);
}

/**
 * Manifest of feature modules - for tooling / documentation only. Each entry
 * maps to `lib/modules/<id>/` containing `index.js` (public API re-exports)
 * and `<id>.css` (module-owned styles).
 */
export const FEATURE_MODULES = [
  'diagnostic',
  'flow',
  'report',
  'redesign',
  'cost',
  'portal',
  'build',
  'marketing',
  'shared',
];
