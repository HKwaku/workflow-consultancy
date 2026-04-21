'use client';

/**
 * Consolidated value case: operating cost, savings breakdown, NPV / ROI /
 * payback, automation readiness. Replaces the scattered Cost Summary extra.
 */

function formatCurrency(val, currency = 'GBP') {
  if (val == null || !isFinite(val)) return '\u2014';
  const symbol = currency === 'GBP' ? '\u00A3' : currency === 'EUR' ? '\u20AC' : '$';
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}${symbol}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${symbol}${(abs / 1_000).toFixed(0)}K`;
  return `${sign}${symbol}${Math.round(abs)}`;
}

export default function ValueOpportunity({ summary = {}, automationPct, hasCostAccess = true, onEditCosts, onAskCopilot, isClientView = false }) {
  const totalCost = summary.totalAnnualCost || 0;
  const totalSavings = summary.potentialSavings || 0;
  const savingsPct = totalCost > 0 ? Math.round((totalSavings / totalCost) * 100) : 0;

  if (!hasCostAccess || totalCost <= 0) return null;

  const costParts = [
    { label: 'Direct labour', value: summary.totalLabour },
    { label: 'Hidden cost (rework, handoffs, coordination)', value: summary.totalHiddenCost },
    { label: 'Fixed overhead', value: summary.totalFixed },
  ].filter((p) => p.value != null && p.value > 0);
  const knownParts = costParts.reduce((s, p) => s + p.value, 0);
  const partsPct = (v) => (totalCost > 0 ? Math.round((v / totalCost) * 100) : 0);

  const investmentRows = [
    summary.implementationCostTotal != null ? { label: 'Implementation (one-off)', value: summary.implementationCostTotal } : null,
    summary.implementationMaintenanceAnnual != null ? { label: 'Ongoing maintenance (annual)', value: summary.implementationMaintenanceAnnual } : null,
  ].filter(Boolean);

  const returnRows = [
    summary.npv3yr != null ? { label: '3-yr NPV', value: formatCurrency(summary.npv3yr, summary.currency) } : null,
    summary.roi3yr != null ? { label: '3-yr ROI', value: `${Math.round(summary.roi3yr * 100)}%` } : null,
    summary.paybackMonths != null ? { label: 'Payback', value: `${Math.round(summary.paybackMonths)} mo` } : null,
    summary.fteEquivalent != null ? { label: 'FTE equivalent unlocked', value: summary.fteEquivalent.toFixed ? summary.fteEquivalent.toFixed(1) : summary.fteEquivalent } : null,
  ].filter(Boolean);

  return (
    <section className="report-value-opportunity" aria-labelledby="value-opportunity-heading">
      <header className="report-section-header">
        <h2 id="value-opportunity-heading" className="report-section-title">Financial case</h2>
        <p className="report-section-sub">
          Aggregate operating cost, addressable savings, and the investment required to realise them.
          {!isClientView && (onEditCosts || onAskCopilot) && (
            <span className="report-section-actions">
              {onEditCosts && <button type="button" className="report-section-action" onClick={onEditCosts}>Edit inputs</button>}
              {onAskCopilot && <button type="button" className="report-section-action" onClick={onAskCopilot}>Ask co-pilot</button>}
            </span>
          )}
        </p>
      </header>

      <div className="report-value-headline-row">
        <HeadlineStat label="Total annual operating cost" value={formatCurrency(totalCost, summary.currency)} />
        <HeadlineStat
          label="Addressable savings"
          value={formatCurrency(totalSavings, summary.currency)}
          sub={totalCost > 0 ? `${savingsPct}% of base` : undefined}
          tone="positive"
        />
        {automationPct != null && <HeadlineStat label="Automation readiness" value={`${automationPct}%`} />}
      </div>

      {costParts.length > 0 && (
        <div className="report-value-block">
          <h3 className="report-value-block-title">Cost composition</h3>
          <div className="report-value-stacked">
            {costParts.map((p, i) => (
              <div
                key={i}
                className={`report-value-stacked-seg report-value-stacked-seg--${i}`}
                style={{ width: `${partsPct(p.value)}%` }}
                title={`${p.label}: ${formatCurrency(p.value, summary.currency)}`}
              />
            ))}
            {totalCost > knownParts && (
              <div
                className="report-value-stacked-seg report-value-stacked-seg--rest"
                style={{ width: `${partsPct(totalCost - knownParts)}%` }}
                title={`Other: ${formatCurrency(totalCost - knownParts, summary.currency)}`}
              />
            )}
          </div>
          <ul className="report-value-legend">
            {costParts.map((p, i) => (
              <li key={i} className={`report-value-legend-item report-value-legend-item--${i}`}>
                <span className="report-value-legend-dot" />
                <span className="report-value-legend-label">{p.label}</span>
                <span className="report-value-legend-value">{formatCurrency(p.value, summary.currency)} \u00B7 {partsPct(p.value)}%</span>
              </li>
            ))}
            {totalCost > knownParts && (
              <li className="report-value-legend-item report-value-legend-item--rest">
                <span className="report-value-legend-dot" />
                <span className="report-value-legend-label">Other / unassigned</span>
                <span className="report-value-legend-value">{formatCurrency(totalCost - knownParts, summary.currency)} \u00B7 {partsPct(totalCost - knownParts)}%</span>
              </li>
            )}
          </ul>
        </div>
      )}

      {(investmentRows.length > 0 || returnRows.length > 0) && (
        <div className="report-value-case-grid">
          {investmentRows.length > 0 && (
            <div className="report-value-block">
              <h3 className="report-value-block-title">Investment required</h3>
              <ul className="report-value-rows">
                {investmentRows.map((r, i) => (
                  <li key={i} className="report-value-row">
                    <span>{r.label}</span>
                    <strong>{formatCurrency(r.value, summary.currency)}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {returnRows.length > 0 && (
            <div className="report-value-block">
              <h3 className="report-value-block-title">Return</h3>
              <ul className="report-value-rows">
                {returnRows.map((r, i) => (
                  <li key={i} className="report-value-row">
                    <span>{r.label}</span>
                    <strong>{r.value}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function HeadlineStat({ label, value, sub, tone }) {
  return (
    <div className={`report-value-headline${tone === 'positive' ? ' is-positive' : ''}`}>
      <div className="report-value-headline-value">{value}</div>
      <div className="report-value-headline-label">{label}</div>
      {sub && <div className="report-value-headline-sub">{sub}</div>}
    </div>
  );
}
