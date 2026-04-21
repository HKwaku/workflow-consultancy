'use client';

const SEGMENT_LABELS = {
  scaling: 'Scaling Business',
  ma: 'M&A Integration',
  pe: 'Private Equity',
  'high-risk-ops': 'High Risk Ops',
};

const SEGMENT_COLORS = {
  scaling: '#0d9488',
  ma: '#7c3aed',
  pe: '#d97706',
  'high-risk-ops': '#e11d48',
};

export default function ReportReadyHero({
  segment,
  processName,
  detailLevel,
  onSummary,
  onFull,
  hideOpenInNewTab,
  reportUrl,
}) {
  const segmentLabel = segment ? SEGMENT_LABELS[segment] : null;
  const segmentColor = segment ? SEGMENT_COLORS[segment] : null;

  return (
    <div className="report-ready-hero">
      <div className="report-ready-hero-left">
        {processName && (
          <h2 className="report-ready-hero-title">{processName}</h2>
        )}
        {segmentLabel && (
          <span
            className="report-ready-hero-badge"
            style={{ background: segmentColor ? `${segmentColor}18` : undefined, color: segmentColor || undefined }}
          >
            {segmentLabel}
          </span>
        )}
      </div>

      <div className="report-ready-hero-controls">
        <div className="report-ready-detail-toggle" role="group" aria-label="Detail level">
          <button
            type="button"
            className={`report-ready-toggle-btn${detailLevel === 'summary' ? ' active' : ''}`}
            onClick={onSummary}
          >
            Summary
          </button>
          <button
            type="button"
            className={`report-ready-toggle-btn${detailLevel === 'full' ? ' active' : ''}`}
            onClick={onFull}
          >
            Full report
          </button>
        </div>

        {!hideOpenInNewTab && reportUrl && (
          <a
            href={reportUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="report-ready-newtab-btn"
            title="Open in new tab"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            Open in new tab
          </a>
        )}
      </div>
    </div>
  );
}
