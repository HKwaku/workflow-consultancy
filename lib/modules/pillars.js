import { MODULES, MODULE_IDS } from './index.js';

// Legacy segment ID aliases → current module IDs
const ALIASES = {
  highstakes: 'high-risk-ops',
  'high-stakes': 'high-risk-ops',
  'high_risk_ops': 'high-risk-ops',
  mergers: 'ma',
  'mergers-acquisitions': 'ma',
  private_equity: 'pe',
  scale: 'scaling',
};

/**
 * Normalise a raw segment/module string to a canonical module ID.
 * Returns null if the ID is unrecognised.
 */
export function normalisePillarId(id) {
  if (!id || typeof id !== 'string') return null;
  const clean = id.trim().toLowerCase();
  if (MODULE_IDS.includes(clean)) return clean;
  return ALIASES[clean] || null;
}

/**
 * Returns display metadata for a canonical module ID.
 * @returns {{ label: string, color: string, tagline: string, variant: string } | null}
 */
export function getPillarMeta(id) {
  const mod = MODULES[id];
  if (!mod) return null;
  return {
    label: mod.label,
    color: mod.color,
    tagline: mod.tagline,
    variant: mod.variant,
  };
}
