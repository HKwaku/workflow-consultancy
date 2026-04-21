'use client';

import { useState } from 'react';

/**
 * Per-process section toggle: Flowchart vs Written write-up. Parent supplies
 * the two panes as nodes — this component only owns the toggle state + UI.
 */

export default function ProcessViewToggle({
  processName,
  healthIndicator,
  flowNode,
  writtenNode,
  defaultView = 'written',
}) {
  const [view, setView] = useState(defaultView);
  const hasFlow = Boolean(flowNode);

  return (
    <div className="report-process-block">
      <header className="report-process-block-head">
        {processName && <h3 className="report-process-block-title">{processName}</h3>}
        {healthIndicator}
        {hasFlow && (
          <div className="report-process-view-toggle" role="tablist" aria-label={`View: ${processName || 'process'}`}>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'written'}
              className={`report-process-view-btn${view === 'written' ? ' is-active' : ''}`}
              onClick={() => setView('written')}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="18" x2="14" y2="18" />
              </svg>
              Written
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'flow'}
              className={`report-process-view-btn${view === 'flow' ? ' is-active' : ''}`}
              onClick={() => setView('flow')}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="3" y="3" width="6" height="6" rx="1" />
                <rect x="15" y="3" width="6" height="6" rx="1" />
                <rect x="9" y="15" width="6" height="6" rx="1" />
                <path d="M6 9v2a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9" />
                <line x1="12" y1="13" x2="12" y2="15" />
              </svg>
              Flowchart
            </button>
          </div>
        )}
      </header>

      <div className="report-process-view-body">
        {view === 'flow' && hasFlow ? (
          <div className="report-process-view-flow">{flowNode}</div>
        ) : (
          writtenNode
        )}
      </div>
    </div>
  );
}
