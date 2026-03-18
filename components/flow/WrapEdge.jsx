'use client';

import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer } from '@xyflow/react';

/**
 * Orthogonal wrap connector.
 * Path: exit source right → drop to mid-gap → travel left through gap → enter target top.
 *
 *   source ──┐
 *            │  (drop to gap)
 *   ◄────────┘  (horizontal return line runs in the gap between rows)
 *   │
 *   └──► target
 */
const OVERHANG = 40; // px to the right before the first vertical turn

function WrapEdge({ id, sourceX, sourceY, targetX, targetY, style, markerEnd, data = {} }) {
  const turnX = sourceX + OVERHANG;
  // midY sits in the gap between the two rows
  const midY = (sourceY + targetY) / 2;

  const d = [
    `M ${sourceX},${sourceY}`,  // exit source right handle
    `L ${turnX},${sourceY}`,    // short hop right
    `L ${turnX},${midY}`,       // drop to mid-gap
    `L ${targetX},${midY}`,     // travel left through the inter-row gap
    `L ${targetX},${targetY}`,  // descend into target left handle
  ].join(' ');

  // Label and buttons sit in the middle of the horizontal gap segment
  const labelX = (turnX + targetX) / 2;
  const labelY = midY;

  const { onDelete, onAddBetween, sourceId, targetId, wrapLabel } = data;
  const hasActions = onDelete || onAddBetween;

  return (
    <>
      <BaseEdge id={id} path={d} markerEnd={markerEnd} style={style} />
      {wrapLabel && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'none',
              fontSize: 11,
              fontWeight: 600,
              color: style?.stroke ?? '#94a3b8',
              background: 'var(--flow-bg, #1a1a1a)',
              padding: '2px 6px',
              borderRadius: 4,
              whiteSpace: 'nowrap',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }}
          >
            {wrapLabel}
          </div>
        </EdgeLabelRenderer>
      )}
      {hasActions && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan flow-edge-actions"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {onAddBetween && sourceId && targetId && (
              <button
                type="button"
                className="flow-edge-add-btn"
                onClick={(e) => { e.stopPropagation(); onAddBetween(sourceId, targetId); }}
                title="Add step between"
                aria-label="Add step between"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                className="flow-edge-delete-btn"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                title="Delete connection"
                aria-label="Delete connection"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </button>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export default memo(WrapEdge);
