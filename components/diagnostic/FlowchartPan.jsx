'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { getSwimlaneLaneData } from '@/lib/flows';

const DRAG_THRESHOLD = 4;
const LANE_LABEL_W = 140;

/**
 * Wraps flowchart SVG content and adds pan/drag with grab cursor.
 * Use wherever flowcharts are displayed (report, portal, preview, floating).
 * When viewMode is swimlane and process is provided, renders sticky department labels that stay visible on horizontal pan.
 */
export default function FlowchartPan({ children, className = '', process, viewMode, darkTheme = false }) {
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isPointerDown, setIsPointerDown] = useState(false);
  const startRef = useRef(null);
  const scrollRef = useRef(null);

  const isSwimlane = viewMode === 'swimlane';
  const laneData = isSwimlane && process ? getSwimlaneLaneData(process, darkTheme) : null;

  const handleMouseDown = useCallback((e) => {
    if (e.target.closest?.('[data-step-index]') || e.target.closest?.('[data-step-idx]')) return;
    if (e.target.closest?.('.flowchart-pan-labels')) return;
    startRef.current = { mx: e.clientX, my: e.clientY, panX: pan.x, panY: pan.y };
    setIsPointerDown(true);
  }, [pan]);

  const handleSwimlaneMouseDown = useCallback((e) => {
    if (e.target.closest?.('[data-step-index]') || e.target.closest?.('[data-step-idx]')) return;
    const el = scrollRef.current;
    if (el) startRef.current = { mx: e.clientX, my: e.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop, isScroll: true };
    setIsPointerDown(true);
  }, []);

  const handleUp = useCallback(() => {
    startRef.current = null;
    setIsPointerDown(false);
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (!isPointerDown) return;
    const onMove = (e) => {
      const s = startRef.current;
      if (!s) return;
      const dx = e.clientX - s.mx;
      const dy = e.clientY - s.my;
      if (s.isScroll && scrollRef.current) {
        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
          setIsDragging(true);
          scrollRef.current.scrollLeft = (s.scrollLeft ?? 0) - dx;
          scrollRef.current.scrollTop = (s.scrollTop ?? 0) - dy;
          startRef.current = { mx: e.clientX, my: e.clientY, scrollLeft: scrollRef.current.scrollLeft, scrollTop: scrollRef.current.scrollTop, isScroll: true };
        }
      } else if (!s.isScroll) {
        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
          setIsDragging(true);
          const newPan = { x: s.panX + dx, y: s.panY + dy };
          startRef.current = { mx: e.clientX, my: e.clientY, panX: newPan.x, panY: newPan.y };
          setPan(newPan);
        }
      }
    };
    const onUp = () => handleUp();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isPointerDown, handleUp]);

  const cardBg = darkTheme ? '#171717' : '#ffffff';
  const content = (
    <div
      className="flowchart-pan-inner"
      style={{ transform: isSwimlane ? 'none' : `translate(${pan.x}px, ${pan.y}px)` }}
    >
      {children}
    </div>
  );

  if (isSwimlane && laneData) {
    const svgW = laneData.totalW - LANE_LABEL_W;
    return (
      <div
        className={`flowchart-pan-container flowchart-pan-swimlane ${className}`}
        style={{ display: 'flex', overflow: 'hidden' }}
      >
        <div
          className="flowchart-pan-labels"
          style={{
            position: 'relative',
            width: LANE_LABEL_W,
            flexShrink: 0,
            background: cardBg,
            minHeight: laneData.totalH,
            borderRight: `1px solid ${darkTheme ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`,
          }}
        >
          {laneData.lanes.map((lane) => (
            <div
              key={lane.dept}
              style={{
                position: 'absolute',
                left: 0,
                top: lane.y,
                width: LANE_LABEL_W,
                height: lane.h,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 600,
                color: lane.stroke,
              }}
            >
              {lane.dept}
            </div>
          ))}
        </div>
        <div
          ref={scrollRef}
          className="flowchart-pan-scroll"
          style={{
            overflowX: 'auto',
            overflowY: 'auto',
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            cursor: isDragging ? 'grabbing' : 'grab',
          }}
          onMouseDown={handleSwimlaneMouseDown}
          onMouseUp={handleUp}
          onMouseLeave={handleUp}
        >
          <div style={{ minWidth: svgW, display: 'inline-block' }}>{content}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flowchart-pan-container ${className}`}
      onMouseDown={handleMouseDown}
      onMouseUp={handleUp}
      onMouseLeave={handleUp}
      style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
    >
      {content}
    </div>
  );
}
