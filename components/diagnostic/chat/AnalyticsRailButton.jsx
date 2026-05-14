'use client';

/**
 * Rail icon for the diagnostic chat that opens analytics in an overlay.
 * Renders AnalyticsCanvasPanel directly — no iframe — so analytics lives
 * in the canvas alongside the rest of the workspace.
 *
 * Mobile dispatches `vesno:open-analytics-canvas` which the workspace
 * listens for and mounts the same panel inside its canvas column.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AnalyticsCanvasPanel from '@/components/workspace/AnalyticsCanvasPanel';

export default function AnalyticsRailButton({ accessToken, sessionUserEmail }) {
  void accessToken;
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (searchParams?.get('openAnalytics') === '1') setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const handleClick = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches) {
      window.dispatchEvent(new CustomEvent('vesno:open-analytics-canvas'));
      return;
    }
    setOpen(true);
  };

  return (
    <div className="s7-split-rail-deals">
      <button
        type="button"
        className={`s7-split-rail-btn${open ? ' active' : ''}`}
        onClick={handleClick}
        title="Analytics"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <line x1="4" y1="20" x2="4" y2="10" />
          <line x1="10" y1="20" x2="10" y2="4" />
          <line x1="16" y1="20" x2="16" y2="14" />
          <line x1="20" y1="20" x2="20" y2="8" />
        </svg>
      </button>

      {open && (
        <div className="deal-workspace-overlay" role="dialog" aria-modal aria-label="Analytics" onClick={() => setOpen(false)}>
          <div className="deal-workspace-frame analytics-modal-frame" onClick={(e) => e.stopPropagation()}>
            <div className="deal-workspace-bar">
              <div className="deal-workspace-bar-left">
                <span className="deal-workspace-bar-eyebrow">Analytics</span>
                <span className="deal-workspace-bar-name">{sessionUserEmail || ''}</span>
              </div>
              <div className="deal-workspace-bar-actions">
                <button type="button" className="deal-doc-viewer-btn" onClick={() => setOpen(false)} aria-label="Close">Close</button>
              </div>
            </div>
            <div className="analytics-modal-content" style={{ flex: 1, overflow: 'auto' }}>
              <AnalyticsCanvasPanel />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
