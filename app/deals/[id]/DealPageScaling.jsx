'use client';

import Link from 'next/link';

function fmt(val) {
  if (val == null || val === 0) return '-';
  if (val >= 1_000_000) return '£' + (val / 1_000_000).toFixed(1) + 'M';
  if (val >= 1_000) return '£' + (val / 1_000).toFixed(0) + 'K';
  return '£' + Math.round(val);
}

export default function DealPageScaling({ deal, participants, summary }) {
  const p = participants[0];

  if (!p) {
    return (
      <div className="scaling-page">
        <p className="scaling-empty">No participant linked yet.</p>
      </div>
    );
  }

  const statusLabel = p.status === 'complete' ? 'Complete' : p.status === 'in_progress' ? 'In progress' : 'Invited';
  const isComplete = p.status === 'complete';

  return (
    <div className="scaling-page">
      <div className="scaling-header">
        <div className="scaling-header-left">
          <h2 className="scaling-company">{p.companyName}</h2>
          <span className={`scaling-status scaling-status--${p.status}`}>{statusLabel}</span>
        </div>
        {p.report?.reportUrl && (
          <Link href={p.report.reportUrl} className="deal-btn deal-btn--primary" target="_blank" rel="noopener noreferrer">
            View full report →
          </Link>
        )}
        {!p.report && p.inviteUrl && (
          <button
            type="button"
            className="deal-btn deal-btn--primary"
            onClick={() => navigator.clipboard?.writeText(p.inviteUrl)}
          >
            Copy invite link
          </button>
        )}
      </div>

      {isComplete && p.report ? (
        <>
          <div className="scaling-metrics">
            <div className="scaling-metric">
              <span className="scaling-metric-val">{fmt(p.report.totalAnnualCost)}</span>
              <span className="scaling-metric-lbl">Annual process cost</span>
            </div>
            <div className="scaling-metric">
              <span className="scaling-metric-val">
                {p.report.automationPercentage != null ? p.report.automationPercentage + '%' : '-'}
              </span>
              <span className="scaling-metric-lbl">Automation readiness</span>
            </div>
            <div className="scaling-metric">
              <span className="scaling-metric-val">{fmt(p.report.potentialSavings)}</span>
              <span className="scaling-metric-lbl">Savings potential</span>
            </div>
            <div className="scaling-metric">
              <span className="scaling-metric-val">
                {p.report.rawSteps?.length ?? p.report.processes?.[0]?.stepsCount ?? '-'}
              </span>
              <span className="scaling-metric-lbl">Process steps</span>
            </div>
          </div>

          {p.report.processes?.length > 0 && (
            <div className="scaling-processes">
              <h3 className="scaling-section-title">Processes mapped</h3>
              <div className="scaling-process-list">
                {p.report.processes.map((proc, i) => (
                  <div key={i} className="scaling-process-row">
                    <span className="scaling-process-name">{proc.name || `Process ${i + 1}`}</span>
                    <span className="scaling-process-meta">
                      {proc.stepsCount ? `${proc.stepsCount} steps` : ''}
                      {proc.stepsCount && proc.annualCost ? ' · ' : ''}
                      {proc.annualCost ? fmt(proc.annualCost) + '/yr' : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="scaling-view-report">
            <p className="scaling-view-report-text">
              The full report includes detailed observations, bottleneck analysis, automation recommendations, and a redesign tool.
            </p>
            <Link href={p.report.reportUrl} className="deal-btn deal-btn--primary" target="_blank" rel="noopener noreferrer">
              Open full report →
            </Link>
          </div>
        </>
      ) : (
        <div className="scaling-pending">
          <p>
            {p.status === 'invited'
              ? 'The process map has not been started yet.'
              : 'The process map is in progress.'}
          </p>
          {p.inviteUrl && (
            <div className="scaling-invite-section">
              <p className="scaling-invite-label">Invite link:</p>
              <div className="scaling-invite-row">
                <code className="scaling-invite-url">{p.inviteUrl}</code>
                <button
                  type="button"
                  className="deal-btn deal-btn--sm"
                  onClick={() => navigator.clipboard?.writeText(p.inviteUrl)}
                >
                  Copy
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
