'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useTheme } from '@/components/ThemeProvider';
import InteractiveFlowCanvas from '@/components/flow/InteractiveFlowCanvas';

const MIN_W = 360;
const MIN_H = 280;

export default function FloatingFlowViewer({ proc, onClose, initialViewMode = 'grid', onStepClick, darkTheme: darkThemeProp, flowNodePositions = {}, onPositionsChange, customEdges, onCustomEdgesChange, deletedEdges = [], onDeletedEdgesChange, stepsLength, onAddNodeBetween, onDeleteNode, stepListContent, chatContent, stepDetailContent, chatLoading = false }) {
  const { theme } = useTheme();
  const darkTheme = darkThemeProp ?? (theme === 'dark');
  const [viewMode, setViewMode] = useState(initialViewMode);
  const isWrapped = viewMode === 'wrap';
  const handleWrapToggle = () => setViewMode((v) => v === 'wrap' ? 'grid' : 'wrap');
  const [ffvTab, setFfvTab] = useState(null); // null = no panel open (matches unfloated: both panels start closed)
  const hasSidebar = !!(stepListContent || chatContent);
  const [fullScreen, setFullScreen] = useState(false);
  const [pos, setPos] = useState({ x: 80, y: 60 });
  const [size, setSize] = useState({ w: Math.min(1100, window.innerWidth - 120), h: Math.min(760, window.innerHeight - 80) });
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(null);
  const dragStart = useRef(null);
  const containerRef = useRef(null);
  const prevSizeRef = useRef(null);

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
        ref={containerRef}
        className={`ffv-container${dragging ? ' ffv-dragging' : ''}${fullScreen ? ' ffv-fullscreen' : ''}`}
        style={fullScreen ? undefined : { left: pos.x, top: pos.y, width: size.w, height: size.h }}
        data-theme={darkTheme ? 'dark' : 'light'}
      >
        {!fullScreen && Object.entries(edgeCursors).map(([edge, cursor]) => (
          <div key={edge} className={`ffv-edge ffv-edge-${edge}`} style={{ cursor }} onMouseDown={(e) => handleMouseDown(e, 'resize', edge)} />
        ))}

        <div className="ffv-header" onMouseDown={(e) => handleMouseDown(e, 'drag')}>
          <div className="ffv-header-left">
            <span className="ffv-title">{proc.processName || 'Process Flow'}</span>
            <div className="ffv-toggle">
              {['grid', 'swimlane'].map(m => (
                <button key={m} type="button" className={`ffv-toggle-btn${(viewMode === m || (m === 'grid' && isWrapped)) ? ' active' : ''}`} onClick={() => setViewMode(m)}>{m === 'grid' ? 'Linear' : 'Swimlane'}</button>
              ))}
            </div>
          </div>
          <div className="ffv-header-right">
            <button type="button" className="ffv-fullscreen-btn" onClick={toggleFullScreen} title={fullScreen ? 'Exit full screen' : 'Full screen'}>
              {fullScreen ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"/></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg>
              )}
            </button>
            <button type="button" className="ffv-close" onClick={onClose} title="Close (Esc)">×</button>
          </div>
        </div>

        <div className="ffv-body ffv-body-interactive">
          {/* Floating icons overlay — no sidebar, canvas stays full size */}
          {hasSidebar && (
            <div className="ffv-floating-icons" data-theme={darkTheme ? 'dark' : 'light'}>
              {chatContent && (
                <button type="button" className={`ffv-floating-icon-btn${ffvTab === 'chat' ? ' active' : ''}`} onClick={() => setFfvTab((p) => (p === 'chat' ? null : 'chat'))} title="AI Chat">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
                  {chatLoading && <span className="s7-chat-dot" />}
                </button>
              )}
              {stepListContent && (
                <button type="button" className={`ffv-floating-icon-btn${ffvTab === 'steps' ? ' active' : ''}`} onClick={() => setFfvTab((p) => (p === 'steps' ? null : 'steps'))} title="Steps">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1.5"/><circle cx="4" cy="12" r="1.5"/><circle cx="4" cy="18" r="1.5"/></svg>
                  {(stepsLength ?? proc?.steps?.length ?? 0) > 0 && <span className="ffv-floating-icon-count">{stepsLength ?? proc?.steps?.length ?? 0}</span>}
                </button>
              )}
            </div>
          )}
          {/* Floating panel overlay when icon selected — overlays canvas, doesn't reduce it */}
          {hasSidebar && ffvTab && (
            <div className="ffv-floating-panel" data-theme={darkTheme ? 'dark' : 'light'}>
              <div className="ffv-floating-panel-header">
                {ffvTab === 'chat' ? (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>
                    <span>AI Chat</span>
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1.5"/><circle cx="4" cy="12" r="1.5"/><circle cx="4" cy="18" r="1.5"/></svg>
                    <span>Steps {(stepsLength ?? proc?.steps?.length ?? 0) > 0 ? `(${stepsLength ?? proc?.steps?.length ?? 0})` : ''}</span>
                  </>
                )}
                <button type="button" className="ffv-floating-panel-close" onClick={() => setFfvTab(null)} title="Close">&times;</button>
              </div>
              <div className="ffv-floating-panel-body">
                {ffvTab === 'steps' ? stepListContent : chatContent}
              </div>
            </div>
          )}
          <div className="ffv-canvas-wrap">
            {proc?.steps?.length ? (
              <InteractiveFlowCanvas
                process={proc}
                layout={viewMode}
                darkTheme={darkTheme}
                onStepClick={onStepClick}
                className="ffv-flow-canvas"
                storedPositions={flowNodePositions[`${stepsLength ?? proc?.steps?.length ?? 0}`] || null}
                onPositionsChange={onPositionsChange}
                customEdges={customEdges}
                onCustomEdgesChange={onCustomEdgesChange}
                deletedEdges={deletedEdges}
                onDeletedEdgesChange={onDeletedEdgesChange}
                onAddNodeBetween={onAddNodeBetween}
                onDeleteNode={onDeleteNode}
                onWrapToggle={handleWrapToggle}
                isWrapped={isWrapped}
              />
            ) : (
              <div className="ffv-empty">No flow data</div>
            )}
          </div>
          {/* Right step detail panel — reuses s7-detail-panel styles exactly */}
          <div className={`s7-detail-panel${stepDetailContent ? ' open' : ''}`} data-theme={darkTheme ? 'dark' : 'light'}>
            {stepDetailContent}
          </div>
        </div>
      </div>
    </div>
  );
}
