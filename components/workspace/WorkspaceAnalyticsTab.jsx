'use client';

/**
 * WorkspaceAnalyticsTab — analytics rendered natively in the workspace
 * canvas (no iframe, no /portal/analytics dependency).
 */

import AnalyticsCanvasPanel from './AnalyticsCanvasPanel';

export default function WorkspaceAnalyticsTab() {
  return (
    <section className="ws-pane ws-analytics-tab" style={{ display: 'flex', flexDirection: 'column', minHeight: '70vh' }}>
      <div className="ws-insight-card" style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: 0, overflow: 'hidden' }}>
        <AnalyticsCanvasPanel />
      </div>
    </section>
  );
}
