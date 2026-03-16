'use client';

import { memo } from 'react';
import {
  BaseEdge,
  getBezierPath,
  EdgeLabelRenderer,
  Position,
} from '@xyflow/react';

/**
 * Smoothstep edge with a small delete (bin) button at the midpoint.
 * Shows the button when data.onDelete is provided (editable flow).
 */
function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition = Position.Right,
  targetPosition = Position.Left,
  style = {},
  markerEnd,
  data = {},
}) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const onDelete = data?.onDelete;
  const onAddBetween = data?.onAddBetween;
  const sourceId = data?.sourceId;
  const targetId = data?.targetId;

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      {(onDelete || onAddBetween) && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan flow-edge-actions"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
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

export default memo(DeletableEdge);
