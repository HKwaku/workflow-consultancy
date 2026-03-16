'use client';

import { memo } from 'react';
import {
  BaseEdge,
  getBezierPath,
  EdgeLabelRenderer,
  Position,
} from '@xyflow/react';

/**
 * Custom edge for decision branches. Places the label ~30% along the path from source
 * so it sits in the gap between nodes rather than over the target node.
 */
function DecisionBranchEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition = Position.Right,
  targetPosition = Position.Left,
  label,
  labelStyle = {},
  labelShowBg = true,
  labelBgStyle = {},
  labelBgPadding = [6, 4],
  labelBgBorderRadius = 4,
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

  // Place label close to the source so it's visible above the connector, not buried near the target
  const t = 0.18;
  let adjX = sourceX + t * (targetX - sourceX);
  let adjY = sourceY + t * (targetY - sourceY);
  // Offset above the path so it clears the node edge
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const perp = 18;
  if (Math.abs(dx) >= Math.abs(dy)) {
    adjY -= perp; // horizontal-ish path: push label above
  } else {
    adjX += perp; // vertical-ish path: push label to the right
  }

  const isParallel = data?.isParallel ?? false;
  const stroke = style?.stroke ?? '#14b8a6';
  const onDelete = data?.onDelete;
  const onAddBetween = data?.onAddBetween;
  const sourceId = data?.sourceId;
  const targetId = data?.targetId;

  return (
    <>
      {isParallel && (
        <path
          d={edgePath}
          fill="none"
          stroke={stroke}
          strokeWidth={(style?.strokeWidth ?? 2) + 2}
          strokeDasharray="4 4"
          opacity={0.35}
          style={{ pointerEvents: 'none' }}
        />
      )}
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      {label != null && label !== '' && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${adjX}px, ${adjY}px)`,
              pointerEvents: 'all',
              fontSize: 13,
              fontWeight: 600,
              ...labelStyle,
              color: labelStyle.fill ?? labelStyle.color ?? 'inherit',
              ...(labelShowBg && {
                background: labelBgStyle.fill ?? labelBgStyle.background ?? 'rgba(255,255,255,0.95)',
                opacity: labelBgStyle.fillOpacity ?? labelBgStyle.opacity ?? 0.95,
                padding: `${labelBgPadding[0] ?? 6}px ${labelBgPadding[1] ?? 4}px`,
                borderRadius: labelBgBorderRadius ?? 4,
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              }),
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
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

export default memo(DecisionBranchEdge);
