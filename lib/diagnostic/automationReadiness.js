/**
 * Automation readiness colour coding: <40% red, 40–70% amber, >70% green
 */
export function getAutomationReadinessColor(pct) {
  if (pct >= 70) return '#16a34a';
  if (pct >= 40) return '#d97706';
  return '#dc2626';
}

export function getAutomationReadinessClass(pct) {
  if (pct >= 70) return 'green';
  if (pct >= 40) return 'amber';
  return 'red';
}
