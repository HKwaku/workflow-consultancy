'use client';

/**
 * Operational-due-diligence style executive summary.
 * Renders at the very top of the Full report - sets the thesis in one glance.
 */

function formatCurrency(val, currency = 'GBP') {
  if (val == null || !isFinite(val)) return '\u2014';
  const symbol = currency === 'GBP' ? '\u00A3' : currency === 'EUR' ? '\u20AC' : '$';
  if (Math.abs(val) >= 1_000_000) return symbol + (val / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(val) >= 1_000) return symbol + (val / 1_000).toFixed(0) + 'K';
  return symbol + Math.round(val);
}

export default function ExecutiveSummary({
  segmentLabel,
  segmentColor,
  processNames = [],
  summary = {},
  automationPct,
  recommendations = [],
  bottleneckCount = 0,
  isMapOnly = false,
  isClientView = false,
}) {
  const processCount = processNames.length;
  const totalCost = summary.totalAnnualCost || 0;
  const totalSavings = summary.potentialSavings || 0;
  const savingsPct = totalCost > 0 ? Math.round((totalSavings / totalCost) * 100) : 0;
  const highCount = recommendations.filter((r) => r.severity === 'high').length;
  const medCount = recommendations.filter((r) => r.severity === 'medium').length;
  const lowCount = recommendations.filter((r) => r.severity === 'low').length;

  const kpis = [];
  if (!isMapOnly && totalCost > 0) {
    kpis.push({ label: 'Annual operating cost', value: formatCurrency(totalCost, summary.currency) });
  }
  if (!isMapOnly && totalSavings > 0) {
    kpis.push({ label: 'Addressable savings', value: formatCurrency(totalSavings, summary.currency), sub: `${savingsPct}% of base`, tone: 'positive' });
  }
  if (summary.paybackMonths != null) {
    kpis.push({ label: 'Payback', value: `${Math.round(summary.paybackMonths)} mo` });
  }
  if (summary.roi3yr != null) {
    kpis.push({ label: '3-yr ROI', value: `${Math.round(summary.roi3yr * 100)}%` });
  }
  if (automationPct != null) {
    kpis.push({ label: 'Automation readiness', value: `${automationPct}%` });
  }
  kpis.push({ label: 'Processes in scope', value: processCount });
  if (recommendations.length > 0) {
    kpis.push({ label: 'Recommendations', value: recommendations.length });
  }

  return (
    <section className="report-exec-summary" aria-label="Executive summary">
      {segmentLabel && (
        <header className="report-exec-summary-head">
          <span className="report-exec-summary-badge" style={segmentColor ? { background: `${segmentColor}22`, color: segmentColor, borderColor: `${segmentColor}55` } : undefined}>
            {segmentLabel}
          </span>
        </header>
      )}

      {kpis.length > 0 && (
        <div className="report-exec-summary-kpis">
          {kpis.map((k, i) => (
            <div key={i} className={`report-exec-summary-kpi${k.tone === 'positive' ? ' is-positive' : ''}`}>
              <div className="report-exec-summary-kpi-value">{k.value}</div>
              <div className="report-exec-summary-kpi-label">{k.label}</div>
              {k.sub && <div className="report-exec-summary-kpi-sub">{k.sub}</div>}
            </div>
          ))}
        </div>
      )}

      {(highCount + medCount + lowCount) > 0 && (
        <div className="report-exec-summary-severity">
          <span className="report-exec-summary-severity-label">Finding severity:</span>
          {highCount > 0 && <span className="report-exec-severity-pill report-exec-severity-pill--high">{highCount} high</span>}
          {medCount > 0 && <span className="report-exec-severity-pill report-exec-severity-pill--med">{medCount} medium</span>}
          {lowCount > 0 && <span className="report-exec-severity-pill report-exec-severity-pill--low">{lowCount} low</span>}
        </div>
      )}

      {!isClientView && (
        <p className="report-exec-summary-note">
          Prepared from operator-entered data. Estimates are model-generated, not audited. See Appendices for methodology.
        </p>
      )}
    </section>
  );
}
