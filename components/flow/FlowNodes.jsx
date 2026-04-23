'use client';

import { Handle, Position } from '@xyflow/react';

const NODE_W     = 150;  // step / merge width
const NODE_H     = 72;   // step / merge height (rectangle)
const TERM_W     = 240;  // start / end oval width
const TERM_H     = 52;   // start / end oval height
const DIAMOND_SZ = 240;  // decision diamond size

const BAR_COLORS = [
  '#0d9488', '#3b82f6', '#8b5cf6', '#f59e0b', '#10b981',
  '#ef4444', '#ec4899', '#06b6d4', '#84cc16', '#f97316',
];

/* ── Label rendered below the node shape ────────────────────────────────── */
function NodeLabel({ label, darkTheme, width = 120 }) {
  if (!label) return null;
  return (
    <div
      style={{
        position: 'absolute',
        top: '100%',
        left: '50%',
        transform: 'translateX(-50%)',
        paddingTop: 6,
        fontSize: 22,
        fontWeight: 600,
        color: darkTheme ? '#d4d4d4' : '#334155',
        fontFamily: 'Work Sans, sans-serif',
        textAlign: 'center',
        width,
        lineHeight: 1.35,
        pointerEvents: 'none',
        overflow: 'visible',
      }}
    >
      {label}
    </div>
  );
}

/* ── Shared handles ──────────────────────────────────────────────────────── */
function NodeHandles() {
  return (
    <>
      <Handle id="top"    type="target" position={Position.Top}    className="flow-handle" />
      <Handle id="left"   type="target" position={Position.Left}   className="flow-handle" />
      <Handle id="right"  type="source" position={Position.Right}  className="flow-handle" />
      <Handle id="bottom" type="source" position={Position.Bottom} className="flow-handle" />
    </>
  );
}

/* ── Start ──────────────────────────────────────────────────────────────── */
export function StartNode({ data }) {
  const { label = 'Start', darkTheme } = data;
  return (
    <div style={{ position: 'relative', width: TERM_W, overflow: 'visible' }}>
      <div
        className="flow-node flow-node-start"
        style={{
          width: TERM_W,
          height: TERM_H,
          background: darkTheme ? '#14532d' : '#dcfce7',
          borderColor: '#16a34a',
          fontSize: 11,
          fontWeight: 700,
          fontFamily: 'Work Sans, sans-serif',
          color: darkTheme ? '#86efac' : '#16a34a',
        }}
      >
        ▶
        <Handle id="bottom" type="source" position={Position.Bottom} className="flow-handle" />
      </div>
      <NodeLabel label={label} darkTheme={darkTheme} width={TERM_W} />
    </div>
  );
}

/* ── End ────────────────────────────────────────────────────────────────── */
export function EndNode({ data }) {
  const { label = 'End', darkTheme } = data;
  return (
    <div style={{ position: 'relative', width: TERM_W, overflow: 'visible' }}>
      <div
        className="flow-node flow-node-end"
        style={{
          width: TERM_W,
          height: TERM_H,
          background: darkTheme ? '#7f1d1d' : '#fee2e2',
          borderColor: '#dc2626',
          fontSize: 11,
          fontWeight: 700,
          fontFamily: 'Work Sans, sans-serif',
          color: darkTheme ? '#fca5a5' : '#dc2626',
        }}
      >
        ■
        <Handle id="top"    type="target" position={Position.Top}    className="flow-handle" />
        <Handle id="left"   type="target" position={Position.Left}   className="flow-handle" />
        <Handle id="bottom" type="target" position={Position.Bottom} className="flow-handle" />
      </div>
      <NodeLabel label={label} darkTheme={darkTheme} width={TERM_W} />
    </div>
  );
}

/* ── Step ───────────────────────────────────────────────────────────────── */
export function StepNode({ data, selected }) {
  const {
    label, stepIndex = 0,
    deptColor, showDept, darkTheme,
    isBottleneck, auto, durationLabel, isApproval,
    workMinutes, waitMinutes,
  } = data;

  const fmtMin = (m) => {
    if (!m || m <= 0) return null;
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
  };
  const workLabel = fmtMin(workMinutes);
  const waitLabel = fmtMin(waitMinutes);

  const bg     = deptColor?.bg  || (darkTheme ? '#2d2d2d' : '#ffffff');
  const stroke = isBottleneck
    ? '#ef4444'
    : (deptColor?.stroke || (darkTheme ? '#404040' : '#e2e8f0'));
  const barColor = deptColor?.bar || BAR_COLORS[stepIndex % BAR_COLORS.length];

  return (
    <div style={{ position: 'relative', width: NODE_W, overflow: 'visible' }}>
      <div
        className={`flow-node flow-node-step flow-node-step-wrapper${isBottleneck ? ' bottleneck' : ''}${selected ? ' selected' : ''}`}
        style={{ width: NODE_W, height: NODE_H, background: bg, borderColor: stroke, position: 'relative' }}
      >
        <div className="flow-node-step-bar" style={{ background: barColor }} />

        {/* Step number - top-left */}
        <span className="flow-node-step-num" style={{ position: 'absolute', top: 6, left: 8 }}>
          {stepIndex + 1}
        </span>

        {/* Automation letter - large, centered in node body */}
        {auto && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
            title={auto.label}
          >
            <span
              style={{
                fontSize: 32,
                fontWeight: 800,
                lineHeight: 1,
                color: auto.color,
                opacity: 0.9,
                fontFamily: 'Work Sans, sans-serif',
                letterSpacing: '-1px',
              }}
            >
              {auto.badge}
            </span>
          </div>
        )}

        {/* Corner badges - approval + timing */}
        {(isApproval || workLabel || waitLabel) && (
          <div style={{ position: 'absolute', top: 5, right: 6, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
            {isApproval && (
              <span style={{ fontSize: 8, color: darkTheme ? '#86efac' : '#16a34a', lineHeight: 1 }}>✓ approval</span>
            )}
            {(workLabel || waitLabel) && (
              <div style={{ display: 'flex', gap: 3 }}>
                {workLabel && (
                  <span style={{
                    fontSize: 8, lineHeight: 1, padding: '1px 4px',
                    borderRadius: 4,
                    background: darkTheme ? 'rgba(99,102,241,0.18)' : 'rgba(99,102,241,0.1)',
                    color: darkTheme ? '#a5b4fc' : '#6366f1',
                    fontWeight: 600,
                  }} title="Active work time">⚡ {workLabel}</span>
                )}
                {waitLabel && (
                  <span style={{
                    fontSize: 8, lineHeight: 1, padding: '1px 4px',
                    borderRadius: 4,
                    background: darkTheme ? 'rgba(245,158,11,0.18)' : 'rgba(245,158,11,0.1)',
                    color: darkTheme ? '#fcd34d' : '#b45309',
                    fontWeight: 600,
                  }} title="Wait / idle time">⏳ {waitLabel}</span>
                )}
              </div>
            )}
          </div>
        )}

        <NodeHandles />
      </div>
      <NodeLabel label={label} darkTheme={darkTheme} width={NODE_W} />
    </div>
  );
}

/* ── Decision (diamond) ─────────────────────────────────────────────────── */
export function DecisionNode({ data, selected }) {
  const { label, stepIndex = 0, isParallel, isInclusive, darkTheme, deptColor, showDept } = data;
  const stroke = deptColor?.stroke || (darkTheme ? '#94a3b8' : '#94a3b8');
  const bg     = deptColor?.bg ? deptColor.bg : (darkTheme ? '#2d2d2d' : '#ffffff');

  return (
    <div style={{ position: 'relative', width: DIAMOND_SZ, overflow: 'visible' }}>
      <div
        className={`flow-node flow-node-decision flow-node-decision-wrapper${selected ? ' selected' : ''}`}
        style={{ width: DIAMOND_SZ, height: DIAMOND_SZ, position: 'relative' }}
      >
        <div
          className="flow-node-decision-inner"
          style={{ background: bg, borderColor: stroke }}
        >
          <span className="flow-node-decision-num">{stepIndex + 1}</span>
          {isParallel && (
            <span className="flow-node-decision-parallel" style={{ fontSize: 13 }}>⊕</span>
          )}
          {isInclusive && (
            <span className="flow-node-decision-parallel" style={{ fontSize: 13 }}>◎</span>
          )}
        </div>
        <NodeHandles />
      </div>
      <NodeLabel label={label} darkTheme={darkTheme} width={DIAMOND_SZ} />
    </div>
  );
}

/* ── Merge (circle join gateway) ───────────────────────────────────────── */
const MERGE_SZ = 120; // merge circle diameter

export function MergeNode({ data, selected }) {
  const { label = 'Merge', darkTheme } = data;
  return (
    <div style={{ position: 'relative', width: MERGE_SZ, overflow: 'visible' }}>
      <div
        className={`flow-node flow-node-merge-wrapper${selected ? ' selected' : ''}`}
        style={{
          width: MERGE_SZ,
          height: MERGE_SZ,
          borderRadius: '50%',
          background: '#0d9488',
          boxShadow: selected
            ? '0 0 0 3px #fff, 0 0 0 5px #0d9488'
            : '0 2px 6px rgba(13,148,136,0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          cursor: 'default',
        }}
      >
        <NodeHandles />
      </div>
      <NodeLabel label={label} darkTheme={darkTheme} width={MERGE_SZ} />
    </div>
  );
}

/* ── Lane Label (swimlane sidebar) ──────────────────────────────────────── */
export function LaneLabelNode({ data }) {
  const { label, darkTheme, width = 180, height = 160 } = data;
  return (
    <div
      style={{
        width,
        height,
        background: darkTheme ? '#252525' : '#f1f5f9',
        borderRight: `1px solid ${darkTheme ? '#333333' : '#e2e8f0'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '0 12px',
        fontSize: 22,
        fontWeight: 600,
        color: darkTheme ? '#a0a0a0' : '#64748b',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        boxSizing: 'border-box',
        fontFamily: 'Work Sans, sans-serif',
        pointerEvents: 'none',
      }}
    >
      {label || 'Team'}
    </div>
  );
}

/* ── Lane Separator (swimlane horizontal rule) ──────────────────────────── */
export function LaneSeparatorNode({ data }) {
  const { width = 2000, darkTheme } = data;
  return (
    <div
      style={{
        width,
        height: 1,
        background: 'none',
        borderTop: `1px solid ${darkTheme ? '#2e2e2e' : '#e8edf2'}`,
        pointerEvents: 'none',
      }}
    />
  );
}
