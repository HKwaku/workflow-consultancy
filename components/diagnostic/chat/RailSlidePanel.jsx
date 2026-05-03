'use client';

/**
 * Shared chrome for rail slide-in panels (Reports, Deals, Docs, Steps,
 * Artefacts, Activity log). Keeps the anchoring + outside-click + close
 * affordance consistent with `s7-rail-pane` so every rail icon opens the
 * same way. Caller passes the trigger button + the panel body.
 *
 * Anchors flush to the right edge of the rail so it visually extends the
 * rail (rail | panel | rest of workspace), not floats over it. Portals to
 * document.body to escape rail overflow clipping.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function RailSlidePanel({
  open,
  onClose,
  triggerRef,
  title,
  headerRight = null,
  children,
  width,
}) {
  const paneRef = useRef(null);
  const [pos, setPos] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    const compute = () => {
      const rail = triggerRef?.current?.closest('.s7-split-rail');
      if (!rail) return;
      const r = rail.getBoundingClientRect();
      setPos({ left: r.right, top: r.top, height: r.height });
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [open, triggerRef]);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => {
      if (paneRef.current?.contains(e.target)) return;
      if (triggerRef?.current?.contains(e.target)) return;
      const rail = triggerRef?.current?.closest('.s7-split-rail');
      if (rail?.contains(e.target)) return;
      onClose?.();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, triggerRef]);

  if (!open || !pos || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={paneRef}
      className="s7-rail-pane"
      role="menu"
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        height: pos.height,
        ...(width ? { width } : null),
      }}
    >
      <div className="s7-rail-pane-head">
        <span className="s7-rail-pane-title">{title}</span>
        <div className="s7-rail-pane-head-actions">
          {headerRight}
          <button
            type="button"
            className="s7-rail-pane-close"
            onClick={() => onClose?.()}
            aria-label="Close panel"
            title="Close"
          >×</button>
        </div>
      </div>
      {children}
    </div>,
    document.body,
  );
}
