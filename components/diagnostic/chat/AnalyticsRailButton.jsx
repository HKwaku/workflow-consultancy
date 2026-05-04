'use client';

/**
 * Rail icon for the diagnostic chat that opens the legacy /portal/analytics
 * page inside an iframe. We use an iframe deliberately:
 *
 * Previous attempts re-hosted `PortalAnalyticsPanel` directly inside the
 * modal and side-effect imported portal.css + report.css + cost.css to make
 * its classes resolve. That joined ~1,300 rules to the chat page's cascade,
 * which interacted unpredictably with diagnostic.css depending on Next.js
 * bundle ordering. Every component change reordered the cascade and broke
 * the analytics styling again. Patches were band-aids coupled to a specific
 * load order and stopped winning the moment the bundler re-ordered.
 *
 * An iframe gives us a hard CSS boundary. Whatever /portal/analytics
 * renders, renders — independent of the chat page's CSS. The trade-off is
 * the iframe scroll feel inside a modal, which is acceptable for a surface
 * the user opens infrequently.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function AnalyticsRailButton({ accessToken, sessionUserEmail }) {
  void accessToken; // iframe authenticates via the user's existing Supabase cookie
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  // Legacy /portal/analytics → redirect → ?openAnalytics=1 — auto-open once.
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

  // Stripped embed route — renders only PortalAnalyticsPanel + auth gate.
  // No portal header / dashboard chrome / sidebar. CSS still side-effect
  // imported inside the iframe but isolated from the chat surface by the
  // iframe boundary (the whole reason we picked this approach).
  const iframeSrc = '/portal/analytics/embed';

  // On mobile we don't want the modal to slap a full-screen iframe over
  // the chat — the user wants analytics to live in the Canvas tab so
  // they can flip between chat + analytics with the existing tab toggle.
  // The button dispatches a custom event the workspace listens for; the
  // workspace then mounts the iframe inside the canvas column and flips
  // mobileView to 'canvas'. Desktop keeps the overlay behaviour.
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
                <a className="deal-doc-viewer-btn" href="/portal/analytics" target="_blank" rel="noopener noreferrer">Open in new tab</a>
                <button type="button" className="deal-doc-viewer-btn" onClick={() => setOpen(false)} aria-label="Close">Close</button>
              </div>
            </div>
            <iframe
              src={iframeSrc}
              className="analytics-modal-iframe"
              title="Analytics"
              loading="lazy"
            />
          </div>
        </div>
      )}
    </div>
  );
}
