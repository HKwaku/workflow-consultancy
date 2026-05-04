'use client';

/**
 * Full-screen modal that fronts any flow-chart / report surface on
 * mobile. The user has to actively click "Continue on mobile" before
 * the underlying content is interactive — flow charts and report
 * cards genuinely don't work as well below 768px and the user wants
 * an active acknowledgement, not a dismissible banner.
 *
 * Persistence: per-device localStorage. Once the user opts in we
 * never gate again on that device. Reset by clearing
 * localStorage.vesno_mobile_view_acknowledged.
 */

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'vesno_mobile_view_acknowledged';

export default function MobileViewGate({ active = true, message }) {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(max-width: 768px)').matches ?? false;
  });
  const [acknowledged, setAcknowledged] = useState(() => {
    if (typeof window === 'undefined') return true;
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia('(max-width: 768px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);

  // Lock body scroll while the gate is visible so a stray scroll
  // doesn't reveal flow content underneath.
  useEffect(() => {
    if (!active || !isMobile || acknowledged) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [active, isMobile, acknowledged]);

  if (!active || !isMobile || acknowledged) return null;

  const handleAcknowledge = () => {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch {}
    setAcknowledged(true);
  };

  return (
    <div className="mobile-view-gate" role="dialog" aria-modal="true" aria-label="Best viewed on desktop">
      <div className="mobile-view-gate-card">
        <div className="mobile-view-gate-icon" aria-hidden>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        </div>
        <h2 className="mobile-view-gate-title">Best viewed on desktop</h2>
        <p className="mobile-view-gate-body">
          {message || 'Flow charts and reports are designed for a wider screen. You can still continue on mobile, but some details may be harder to read.'}
        </p>
        <div className="mobile-view-gate-actions">
          <button type="button" className="mobile-view-gate-cta" onClick={handleAcknowledge}>
            Continue on mobile
          </button>
        </div>
        <p className="mobile-view-gate-hint">For the best experience, open this page on a laptop or desktop.</p>
      </div>
    </div>
  );
}
