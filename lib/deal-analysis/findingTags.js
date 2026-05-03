/**
 * Recommended vocabulary for finding tags. Stored as text[] on
 * deal_findings.tags so teams can extend with custom buckets, but the UI
 * surfaces these five as quick-toggles because they map cleanly to how
 * diligence findings are actually triaged in IC:
 *
 *   deal_breaker — kills the deal unless resolved. Walking-away severity.
 *   re_trade     — opens a price renegotiation. Affects the LOI.
 *   disclose     — the buyer can live with it but must be told. SPA disclosure schedule.
 *   mitigate     — actionable inside the 100-day plan. Costs effort, not money.
 *   monitor      — track but no action required pre-close.
 */

export const RECOMMENDED_FINDING_TAGS = [
  { id: 'deal_breaker', label: 'Deal-breaker', color: 'critical', description: 'Kills the deal unless resolved.' },
  { id: 're_trade',     label: 'Re-trade',     color: 'high',     description: 'Opens a price renegotiation.' },
  { id: 'disclose',     label: 'Disclose',     color: 'medium',   description: 'Buyer can live with it but must be told.' },
  { id: 'mitigate',     label: 'Mitigate',     color: 'medium',   description: 'Actionable inside the 100-day plan.' },
  { id: 'monitor',      label: 'Monitor',      color: 'low',      description: 'Track but no action required pre-close.' },
];

export const RECOMMENDED_TAG_IDS = new Set(RECOMMENDED_FINDING_TAGS.map((t) => t.id));

export function tagMeta(id) {
  return RECOMMENDED_FINDING_TAGS.find((t) => t.id === id) || null;
}
