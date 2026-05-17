'use client';

/**
 * Rail icon — opens the operating-model **Analysis** tab. Analytics is
 * no longer a separate scope/panel; it's consolidated into the
 * workspace Analysis view (AnalysisPanel). This button is a shortcut:
 * it opens the workspace canvas (standard scope) and switches it to
 * the Analysis tab via the same events the chat agent uses.
 */

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

function openAnalysis() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('vesno:open-workspace', { detail: { scope: 'standard' } }));
  // The embedded WorkspaceClient registers the set-view listener on
  // mount; give it a tick when opening from a closed state.
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent('vesno:set-workspace-view', { detail: { view: 'analysis' } }));
  }, 140);
}

export default function AnalyticsRailButton({ accessToken, sessionUserEmail }) {
  void accessToken; void sessionUserEmail;
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams?.get('openAnalytics') === '1') openAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="s7-split-rail-deals">
      <button
        type="button"
        className="s7-split-rail-btn"
        onClick={openAnalysis}
        title="Analysis"
        aria-label="Analysis"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <line x1="4" y1="20" x2="4" y2="10" />
          <line x1="10" y1="20" x2="10" y2="4" />
          <line x1="16" y1="20" x2="16" y2="14" />
          <line x1="20" y1="20" x2="20" y2="8" />
        </svg>
      </button>
    </div>
  );
}
