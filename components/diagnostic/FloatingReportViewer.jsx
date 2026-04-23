'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useTheme } from '@/components/ThemeProvider';

const MIN_W = 380;
const MIN_H = 320;

export default function FloatingReportViewer({ reportId, processName, onClose }) {
  const { theme } = useTheme();
  const darkTheme = theme === 'dark';

  const [fullScreen, setFullScreen] = useState(false);
  const [pos, setPos] = useState({ x: 80, y: 60 });
  const [size, setSize] = useState({
    w: Math.min(860, typeof window !== 'undefined' ? window.innerWidth - 120 : 860),
    h: Math.min(740, typeof window !== 'undefined' ? window.innerHeight - 80 : 740),
  });
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(null);
  const dragStart = useRef(null);
  const prevSizeRef = useRef(null);
  const iframeRef = useRef(null);

  const reportUrl = `/report?id=${encodeURIComponent(reportId)}&embed=1`;
  const fullReportUrl = `/report?id=${encodeURIComponent(reportId)}&portal=1`;

  const toggleFullScreen = useCallback(() => {
    if (fullScreen) {
      const prev = prevSizeRef.current;
      if (prev) { setPos(prev.pos); setSize(prev.size); prevSizeRef.current = null; }
      setFullScreen(false);
    } else {
      prevSizeRef.current = { pos: { ...pos }, size: { ...size } };
      setFullScreen(true);
    }
  }, [fullScreen, pos, size]);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        if (fullScreen) toggleFullScreen();
        else onClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose, fullScreen, toggleFullScreen]);

  const handleMouseDown = useCallback((e, type, edge) => {
    e.preventDefault();
    e.stopPropagation();
    dragStart.current = { mx: e.clientX, my: e.clientY, ...pos, ...size, type, edge };
    if (type === 'drag') setDragging(true);
    else setResizing(edge);
  }, [pos, size]);

  useEffect(() => {
    if (!dragging && !resizing) return;
    const handleMove = (e) => {
      const s = dragStart.current;
      if (!s) return;
      const dx = e.clientX - s.mx;
      const dy = e.clientY - s.my;
      if (s.type === 'drag') {
        setPos({ x: s.x + dx, y: Math.max(0, s.y + dy) });
        return;
      }
      let newX = s.x, newY = s.y, newW = s.w, newH = s.h;
      const edge = s.edge;
      if (edge.includes('e')) newW = Math.max(MIN_W, s.w + dx);
      if (edge.includes('s')) newH = Math.max(MIN_H, s.h + dy);
      if (edge.includes('w')) { const dw = Math.min(dx, s.w - MIN_W); newX = s.x + dw; newW = s.w - dw; }
      if (edge.includes('n')) { const dh = Math.min(dy, s.h - MIN_H); newY = s.y + dh; newH = s.h - dh; }
      setPos({ x: newX, y: newY });
      setSize({ w: newW, h: newH });
    };
    const handleUp = () => { setDragging(false); setResizing(null); dragStart.current = null; };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); };
  }, [dragging, resizing]);

  const edgeCursors = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize', sw: 'nesw-resize' };

  return (
    <div className="ffv-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`ffv-container frv-container${dragging ? ' ffv-dragging' : ''}${fullScreen ? ' ffv-fullscreen' : ''}`}
        style={fullScreen ? undefined : { left: pos.x, top: pos.y, width: size.w, height: size.h }}
        data-theme={darkTheme ? 'dark' : 'light'}
      >
        {!fullScreen && Object.entries(edgeCursors).map(([edge, cursor]) => (
          <div key={edge} className={`ffv-edge ffv-edge-${edge}`} style={{ cursor }} onMouseDown={(e) => handleMouseDown(e, 'resize', edge)} />
        ))}

        <div className="ffv-header" onMouseDown={(e) => handleMouseDown(e, 'drag')}>
          <div className="ffv-header-left">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
            </svg>
            <span className="ffv-title">{processName ? `${processName} - Report` : 'Report'}</span>
          </div>
          <div className="ffv-header-right">
            <a
              href={fullReportUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="frv-newtab-btn"
              title="Open full report in new tab"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              New tab
            </a>
            <button type="button" className="ffv-fullscreen-btn" onClick={toggleFullScreen} title={fullScreen ? 'Exit full screen' : 'Full screen'} onMouseDown={(e) => e.stopPropagation()}>
              {fullScreen ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg>
              )}
            </button>
            <button type="button" className="ffv-close" onClick={onClose} title="Close (Esc)" onMouseDown={(e) => e.stopPropagation()}>×</button>
          </div>
        </div>

        <div className="ffv-body frv-body">
          <iframe
            ref={iframeRef}
            src={reportUrl}
            title="Report"
            className="frv-iframe"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        </div>
      </div>
    </div>
  );
}
