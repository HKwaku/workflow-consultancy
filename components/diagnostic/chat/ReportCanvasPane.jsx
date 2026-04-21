'use client';

/**
 * ReportCanvasPane — right-pane canvas for the chat-first diagnostic.
 *
 * Shows either the interactive Flow or the embedded Report, with four states:
 *   - preview:    empty state with a "Generate full report" call to action
 *   - generating: spinner + live progress message
 *   - ready:      Flow canvas or report iframe
 *   - error:      error message with retry
 *
 * Consumers own `mode` ('flow' | 'report') and `status`. The pane is
 * presentational; inline generation lives in `generateReportInline` from
 * `@/lib/diagnostic`.
 */

import InteractiveFlowCanvas from '@/components/flow/InteractiveFlowCanvas';

export default function ReportCanvasPane({
  mode = 'flow',
  onModeChange,
  status = 'preview',
  progressMessage = '',
  errorMessage = '',
  findings = [],

  // Flow canvas props (forwarded to InteractiveFlowCanvas)
  process: proc,
  layout = 'grid',
  darkTheme = false,
  storedPositions,
  onPositionsChange,
  customEdges,
  onCustomEdgesChange,
  deletedEdges,
  onDeletedEdgesChange,
  onStepClick,
  onAddNodeBetween,
  onDeleteNode,

  // Report state
  reportId,

  // Actions
  onGenerate,
  onRetry,
  canGenerate = true,
  generateLabel = 'Generate full report',
}) {
  const reportUrl = reportId
    ? `/report?id=${encodeURIComponent(reportId)}&embed=1&detail=full`
    : null;

  return (
    <div className="rcp-root" data-theme={darkTheme ? 'dark' : 'light'} data-status={status}>
      <div className="rcp-toolbar">
        <div className="rcp-toggle" role="tablist" aria-label="Canvas view">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'flow'}
            className={`rcp-toggle-btn${mode === 'flow' ? ' active' : ''}`}
            onClick={() => onModeChange?.('flow')}
          >
            Flow
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'report'}
            className={`rcp-toggle-btn${mode === 'report' ? ' active' : ''}`}
            onClick={() => onModeChange?.('report')}
            disabled={status !== 'ready' && !reportUrl}
          >
            Report
          </button>
        </div>

        {status === 'ready' && reportUrl && mode === 'report' && (
          <a
            href={`/report?id=${encodeURIComponent(reportId)}&portal=1`}
            target="_blank"
            rel="noopener noreferrer"
            className="rcp-newtab"
          >
            Open in new tab ↗
          </a>
        )}
      </div>

      <div className="rcp-body">
        {status === 'generating' && (
          <div className="rcp-state rcp-state-generating" role="status" aria-live="polite">
            <div className="rcp-spinner" aria-hidden />
            <p className="rcp-state-message">{progressMessage || 'Analysing your process…'}</p>
          </div>
        )}

        {status === 'error' && (
          <div className="rcp-state rcp-state-error" role="alert">
            <h3 className="rcp-state-title">Something went wrong</h3>
            <p className="rcp-state-message">{errorMessage || 'We couldn’t generate the report. Please try again.'}</p>
            {onRetry && (
              <button type="button" className="button button-primary" onClick={onRetry}>
                Try again
              </button>
            )}
          </div>
        )}

        {status !== 'generating' && status !== 'error' && mode === 'flow' && (
          proc?.steps?.length ? (
            <div className="rcp-flow-wrap">
              <InteractiveFlowCanvas
                process={proc}
                layout={layout}
                darkTheme={darkTheme}
                storedPositions={storedPositions}
                onPositionsChange={onPositionsChange}
                customEdges={customEdges}
                onCustomEdgesChange={onCustomEdgesChange}
                deletedEdges={deletedEdges}
                onDeletedEdgesChange={onDeletedEdgesChange}
                onStepClick={onStepClick}
                onAddNodeBetween={onAddNodeBetween}
                onDeleteNode={onDeleteNode}
                className="rcp-flow-canvas"
              />
              {status === 'preview' && canGenerate && (
                <div className="rcp-flow-cta">
                  <button type="button" className="button button-primary" onClick={onGenerate}>
                    {generateLabel}
                  </button>
                </div>
              )}
              {status === 'ready' && findings.length > 0 && (
                <aside className="rcp-findings">
                  <h4 className="rcp-findings-title">Top findings</h4>
                  <ul className="rcp-findings-list">
                    {findings.map((f, i) => (
                      <li key={i} className="rcp-findings-item">{f}</li>
                    ))}
                  </ul>
                </aside>
              )}
            </div>
          ) : (
            <div className="rcp-state rcp-state-preview">
              <h3 className="rcp-state-title">Map a process to get started</h3>
              <p className="rcp-state-message">Once you add steps, the flow will render here and you can generate a full report.</p>
            </div>
          )
        )}

        {status !== 'generating' && status !== 'error' && mode === 'report' && (
          reportUrl ? (
            <iframe
              src={reportUrl}
              title="Report preview"
              className="rcp-report-iframe"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          ) : (
            <div className="rcp-state rcp-state-preview">
              <h3 className="rcp-state-title">Report not generated yet</h3>
              <p className="rcp-state-message">Generate a full report from the Flow tab to preview it here.</p>
              {canGenerate && (
                <button type="button" className="button button-primary" onClick={onGenerate}>
                  {generateLabel}
                </button>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}
