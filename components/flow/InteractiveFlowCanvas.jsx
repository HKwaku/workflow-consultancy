'use client';

import { useCallback, useMemo, useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  Panel,
  useViewport,
  applyNodeChanges,
  reconnectEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { processToReactFlow, recomputeSwimlaneLanesFromNodes } from '@/lib/flows/processToReactFlow';
import { AUTOMATION_CATEGORIES } from '@/lib/flows/automation';
import { StartNode, EndNode, StepNode, DecisionNode, MergeNode, LaneLabelNode, LaneSeparatorNode } from './FlowNodes';
import DecisionBranchEdge from './DecisionBranchEdge';
import DeletableEdge from './DeletableEdge';

const nodeTypes = { start: StartNode, end: EndNode, step: StepNode, decision: DecisionNode, merge: MergeNode, laneLabel: LaneLabelNode, laneSeparator: LaneSeparatorNode };
const edgeTypes = { decisionBranch: DecisionBranchEdge, deletable: DeletableEdge };
const DEPT_LABEL_WIDTH = 180;


function SwimlaneLabelsPanel({ lanes, layoutHeight, darkTheme }) {
  const { y, zoom } = useViewport();
  const textColor = darkTheme ? '#a0a0a0' : '#64748b';
  const bg = darkTheme ? '#252525' : '#f1f5f9';
  const borderColor = darkTheme ? '#404040' : '#e2e8f0';

  return (
    <div
      className="flow-labels-panel"
      style={{
        width: DEPT_LABEL_WIDTH,
        flexShrink: 0,
        overflow: 'hidden',
        position: 'relative',
        backgroundColor: darkTheme ? '#1a1a1a' : '#f8fafc',
        borderRight: `1px solid ${borderColor}`,
        zIndex: 5,
      }}
    >
      <div
        className="flow-labels-inner"
        style={{
          transform: `translate(0, ${y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          minHeight: layoutHeight,
          position: 'relative',
          width: `${DEPT_LABEL_WIDTH / Math.max(zoom, 0.01)}px`,
        }}
      >
        {lanes?.map((lane, li) => (
          <div
            key={li}
            className="flow-node flow-node-lane-label"
            style={{
              position: 'absolute',
              left: 0,
              top: lane.y,
              width: `${DEPT_LABEL_WIDTH / Math.max(zoom, 0.01)}px`,
              height: lane.h,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              padding: '0 12px',
              backgroundColor: bg,
              borderRight: `1px solid ${borderColor}`,
              fontSize: 24,
              fontWeight: 600,
              color: textColor,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              boxSizing: 'border-box',
            }}
          >
            {lane.dept || 'Department'}
          </div>
        ))}
      </div>
    </div>
  );
}

function FlowCanvasInner({
  process,
  layout = 'grid',
  darkTheme = false,
  onStepClick,
  className = '',
  storedPositions = null,
  onPositionsChange,
  customEdges = [],
  onCustomEdgesChange,
  deletedEdges = [],
  onDeletedEdgesChange,
  onAddNodeBetween,
  onDeleteNode,
  onFloat,
  onWrapToggle,
  isWrapped = false,
  hideBuiltInToolbar = false,
  innerRef = null,
}) {
  const flowData = useMemo(
    () => processToReactFlow(process, layout, darkTheme),
    [process, layout, darkTheme]
  );

  const { nodes: initialNodes, edges: initialEdges, lanes, layoutHeight } = flowData;

  const deletedSet = useMemo(() => new Set(deletedEdges || []), [deletedEdges]);
  const filteredCustomEdges = useMemo(() => {
    // Deduplicate: skip custom edges identical to a non-deleted auto-generated edge.
    // Deleted auto edges are excluded so the user can manually recreate them after deleting.
    const fromInitial = new Set(
      initialEdges
        .filter((e) => !deletedSet.has(e.id))
        .map((e) => `${e.source}|${e.target}|${e.sourceHandle || 'right'}|${e.targetHandle || 'left'}`)
    );
    const seen = new Set();
    return (customEdges || []).filter((c) => {
      const key = `${c.source}|${c.target}|${c.sourceHandle || 'right'}|${c.targetHandle || 'left'}`;
      if (fromInitial.has(key)) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [initialEdges, customEdges, deletedSet]);

  const allEdges = useMemo(() => {
    const baseEdges = initialEdges.filter((e) => !deletedSet.has(e.id));
    return [
      ...baseEdges,
      ...filteredCustomEdges.map((c) => ({
        id: `e-custom-${c.source}-${c.target}-${c.sourceHandle || 'r'}-${c.targetHandle || 'l'}`,
        source: c.source,
        target: c.target,
        sourceHandle: c.sourceHandle || 'right',
        targetHandle: c.targetHandle || 'left',
        type: 'default',
        style: { stroke: '#94a3b8', strokeDasharray: '4 4' },
        data: { isCustom: true },
      })),
    ];
  }, [initialEdges, filteredCustomEdges, deletedSet]);

  useEffect(() => {
    if (onCustomEdgesChange && filteredCustomEdges.length < (customEdges || []).length) {
      onCustomEdgesChange(filteredCustomEdges);
    }
  }, [filteredCustomEdges, customEdges, onCustomEdgesChange]);

  const [nodes, setNodes, onNodesChangeBase] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(allEdges);
  const instanceRef = useRef(null);
  const containerRef = useRef(null);
  const initialNodesRef = useRef(initialNodes);
  const [mobileAccepted, setMobileAccepted] = useState(() => {
    if (typeof window === 'undefined') return true;
    if (window.innerWidth >= 768) return true;
    try { return sessionStorage.getItem('flow-mobile-accepted') === '1'; } catch { return false; }
  });


  const isSwimlane = layout === 'swimlane' && lanes?.length > 0;
  const isGridOrWrap = layout === 'grid' || layout === 'wrap';
  const flowNodes = isSwimlane ? nodes.filter((n) => !n.id.match(/^lane-\d+$/)) : nodes;

  const { lanes: computedLanes, layoutHeight: computedLayoutHeight } = useMemo(() => {
    if (!isSwimlane || !lanes?.length) return { lanes, layoutHeight: layoutHeight || 600 };
    return recomputeSwimlaneLanesFromNodes(nodes, lanes);
  }, [isSwimlane, nodes, lanes, layoutHeight]);

  const typeSignature = (process?.steps || []).map((s) => s.isMerge ? 'M' : s.isDecision ? (s.parallel ? 'P' : 'D') : 'S').join('');
  const layoutKey = `${process?.steps?.length ?? 0}-${layout}`;
  const structureKey = `${layoutKey}-${typeSignature}`;
  const structureKeyRef = useRef(structureKey);
  const layoutKeyRef = useRef(layoutKey);
  const isInitialMount = useRef(true);
  const layoutChangedRef = useRef(false);

  // Track step names/labels so node data updates without position reset when only names change.
  const dataKey = (process?.steps || []).map((s) => s.name || '').join('\x00');
  const dataKeyRef = useRef(dataKey);

  initialNodesRef.current = initialNodes;

  // Only sync edges when content actually changes — allEdges gets new ref every render
  // because process prop is recreated by parent, which would cause infinite setEdges loop.
  const allEdgesKey = useMemo(
    () => allEdges.map((e) => `${e.id}:${e.source}-${e.target}`).join('|'),
    [allEdges]
  );
  const prevEdgesKeyRef = useRef('');
  useEffect(() => {
    if (prevEdgesKeyRef.current === allEdgesKey) return;
    prevEdgesKeyRef.current = allEdgesKey;
    setEdges(allEdges);
  }, [allEdgesKey, allEdges, setEdges]);

  useEffect(() => {
    const prevKey = structureKeyRef.current;
    const keyChanged = prevKey !== structureKey;
    const prevLayoutKey = layoutKeyRef.current;
    const layoutChanged = prevLayoutKey !== layoutKey;
    structureKeyRef.current = structureKey;
    layoutKeyRef.current = layoutKey;
    // Reset positions only when step count or layout changes (not just node type changes).
    layoutChangedRef.current = layoutChanged || isInitialMount.current;
    isInitialMount.current = false;

    setNodes((prev) =>
      initialNodesRef.current.map((initN) => {
        const stored = storedPositions?.[initN.id];
        if (stored) return { ...initN, position: stored };
        // On layout switch fall back to computed initial position, not the
        // previous layout's dragged position (wrong coordinate system).
        if (layoutChangedRef.current) return initN;
        const cur = prev.find((p) => p.id === initN.id);
        return cur ? { ...initN, position: cur.position } : initN;
      })
    );
  }, [structureKey, setNodes, storedPositions]);

  // Sync node labels/data when step names change without a structural change (no position reset).
  useEffect(() => {
    if (dataKeyRef.current === dataKey) return;
    dataKeyRef.current = dataKey;
    setNodes((prev) =>
      prev.map((node) => {
        const initN = initialNodesRef.current.find((n) => n.id === node.id);
        if (!initN) return node;
        return { ...node, data: initN.data };
      })
    );
  }, [dataKey, setNodes]);

  const onNodesChange = useCallback(
    (changes) => {
      const removeChanges = changes.filter((c) => c.type === 'remove');
      let changesToApply = changes;
      if (removeChanges.length > 0 && onDeleteNode) {
        const toDelete = removeChanges
          .map((c) => nodes.find((n) => n.id === c.id))
          .filter((n) => n && (n.type === 'step' || n.type === 'decision' || n.type === 'merge'))
          .map((n) => n.data?.stepIndex)
          .filter((idx) => typeof idx === 'number');
        toDelete.sort((a, b) => b - a).forEach((idx) => onDeleteNode(idx));
        changesToApply = changes.filter((c) => c.type !== 'remove');
      }
      const nextNodes = applyNodeChanges(changesToApply, nodes);
      const positionChanges = changes.filter((c) => c.type === 'position' && c.dragging === false);
      if (positionChanges.length > 0 && onPositionsChange) {
        const positions = {};
        nextNodes.forEach((n) => {
          if (n.position && (n.type === 'step' || n.type === 'decision' || n.type === 'merge')) {
            positions[n.id] = n.position;
          }
        });
        onPositionsChange(positions, layout);
      }
      if (!isSwimlane || !lanes?.length) {
        setNodes(nextNodes);
        return;
      }
      const { lanes: updatedLanes } = recomputeSwimlaneLanesFromNodes(nextNodes, lanes);
      const result = nextNodes.map((n) => {
        const sepMatch = n.id?.match(/^lane-sep-(\d+)$/);
        const labelMatch = n.id?.match(/^lane-(\d+)$/);
        if (sepMatch) {
          const li = parseInt(sepMatch[1], 10);
          const lane = updatedLanes[li];
          if (lane) return { ...n, position: { x: 0, y: lane.y - 1 } };
        }
        if (labelMatch) {
          const li = parseInt(labelMatch[1], 10);
          const lane = updatedLanes[li];
          if (lane) return { ...n, position: { x: 0, y: lane.y }, data: { ...n.data, height: lane.h } };
        }
        return n;
      });
      setNodes(result);
    },
    [nodes, setNodes, isSwimlane, lanes, onPositionsChange, onDeleteNode]
  );

  // Keep isValidConnection lightweight — only self-loops and exact duplicates are
  // rejected here. This function runs during drag to show the green/red preview;
  // heavy business-logic here would silently block every drag because auto-generated
  // edges already fill all step slots.
  const isValidConnection = useCallback(
    (connection) => {
      if (!connection?.source || !connection?.target) return false;
      if (connection.source === connection.target) return false;
      // Prevent exact duplicate (same source+target+same handles)
      const dup = edges.some(
        (e) => e.source === connection.source &&
               e.target === connection.target &&
               (e.sourceHandle || 'right') === (connection.sourceHandle || 'right') &&
               (e.targetHandle || 'left')  === (connection.targetHandle  || 'left')
      );
      return !dup;
    },
    [edges]
  );

  const handleConnect = useCallback(
    (conn) => {
      if (!conn?.source || !conn?.target) return;
      if (!isValidConnection(conn)) return;
      const { source, target, sourceHandle, targetHandle } = conn;
      const newCustom = {
        source,
        target,
        sourceHandle: sourceHandle || 'right',
        targetHandle: targetHandle || 'left',
      };
      if (onCustomEdgesChange) {
        onCustomEdgesChange([...(customEdges || []), newCustom]);
      } else {
        // No persistence: add edge to local state so connection appears (n8n-style)
        const sh = sourceHandle || 'right';
        const th = targetHandle || 'left';
        const newEdge = {
          id: `e-custom-${source}-${target}-${sh}-${th}`,
          source,
          target,
          sourceHandle: sh,
          targetHandle: th,
          type: 'default',
          style: { stroke: '#94a3b8', strokeDasharray: '4 4' },
          data: { isCustom: true },
        };
        setEdges((eds) => [...eds, newEdge]);
      }
    },
    [customEdges, onCustomEdgesChange, setEdges, isValidConnection]
  );

  const handleEdgesChange = useCallback(
    (changes) => {
      const removeIds = changes.filter((c) => c.type === 'remove').map((c) => c.id).filter(Boolean);
      if (removeIds.length > 0) {
        const customIds = new Set(removeIds.filter((id) => id?.startsWith('e-custom-')));
        const processIds = removeIds.filter((id) => !id?.startsWith('e-custom-'));
        if (customIds.size > 0 && onCustomEdgesChange) {
          const toId = (c) => `e-custom-${c.source}-${c.target}-${c.sourceHandle || 'r'}-${c.targetHandle || 'l'}`;
          const next = customEdges.filter((c) => !customIds.has(toId(c)));
          onCustomEdgesChange(next);
        }
        if (processIds.length > 0 && onDeletedEdgesChange) {
          onDeletedEdgesChange([...(deletedEdges || []), ...processIds]);
        }
      }
      onEdgesChange(changes);
    },
    [customEdges, onCustomEdgesChange, onEdgesChange, deletedEdges, onDeletedEdgesChange]
  );

  const handleDeleteEdge = useCallback(
    (edgeId) => {
      const isCustom = edgeId?.startsWith('e-custom-');
      if (isCustom && onCustomEdgesChange) {
        const toId = (c) => `e-custom-${c.source}-${c.target}-${c.sourceHandle || 'r'}-${c.targetHandle || 'l'}`;
        const next = customEdges.filter((c) => toId(c) !== edgeId);
        onCustomEdgesChange(next);
      } else if (!isCustom && onDeletedEdgesChange) {
        onDeletedEdgesChange([...(deletedEdges || []), edgeId]);
      }
      setEdges((eds) => eds.filter((e) => e.id !== edgeId));
    },
    [customEdges, onCustomEdgesChange, deletedEdges, onDeletedEdgesChange, setEdges]
  );

  const canAddBetween = useCallback((sourceId, targetId) => {
    const m = sourceId?.match(/^step-(\d+)$/);
    const n = targetId?.match(/^step-(\d+)$/);
    if (!m || !n) return false;
    const si = parseInt(m[1], 10);
    const ti = parseInt(n[1], 10);
    return si >= 0 && ti >= 0 && Math.abs(si - ti) === 1;
  }, []);

  const handleAddNodeBetween = useCallback(
    (sourceId, targetId) => {
      const m = sourceId?.match(/^step-(\d+)$/);
      const n = targetId?.match(/^step-(\d+)$/);
      if (!m || !n || !onAddNodeBetween) return;
      const si = parseInt(m[1], 10);
      const ti = parseInt(n[1], 10);
      const insertIdx = Math.min(si, ti) + 1;
      const edgeId = edges.find((e) => e.source === sourceId && e.target === targetId)?.id;
      if (edgeId) {
        const isCustom = edgeId?.startsWith('e-custom-');
        if (isCustom && onCustomEdgesChange) {
          const toId = (c) => `e-custom-${c.source}-${c.target}-${c.sourceHandle || 'r'}-${c.targetHandle || 'l'}`;
          onCustomEdgesChange(customEdges.filter((c) => toId(c) !== edgeId));
        }
        // Don't add auto-generated edges to deletedEdges: after insertion processToReactFlow
        // regenerates e-seq-si-(si+1) pointing source→new step (same ID), so it must not be blocked.
        setEdges((eds) => eds.filter((e) => e.id !== edgeId));
      }
      const srcNode = nodes.find((nd) => nd.id === sourceId);
      const tgtNode = nodes.find((nd) => nd.id === targetId);
      const NODE_W = 100;
      let midPos = null;
      if (srcNode?.position && tgtNode?.position) {
        const srcRight = srcNode.position.x + NODE_W;
        const tgtLeft = tgtNode.position.x;
        const gapCenterX = (srcRight + tgtLeft) / 2;
        const idealX = gapCenterX - NODE_W / 2;
        const newX = Math.max(srcRight, Math.min(idealX, tgtLeft - NODE_W));
        midPos = {
          x: newX,
          y: (srcNode.position.y + tgtNode.position.y) / 2,
        };
      }
      onAddNodeBetween(insertIdx, midPos);
    },
    [nodes, edges, customEdges, onCustomEdgesChange, deletedEdges, onDeletedEdgesChange, onAddNodeBetween, setEdges]
  );

  const displayEdges = useMemo(() => {
    if (!onCustomEdgesChange && !onDeletedEdgesChange) return edges;
    return edges.map((e) => {
      const sourceId = e.source;
      const targetId = e.target;
      const showAddBetween = onAddNodeBetween && canAddBetween(sourceId, targetId);
      return {
        ...e,
        type: e.type === 'decisionBranch' ? 'decisionBranch' : 'deletable',
        data: {
          ...e.data,
          sourceId,
          targetId,
          onDelete: () => handleDeleteEdge(e.id),
          onAddBetween: showAddBetween ? handleAddNodeBetween : undefined,
        },
      };
    });
  }, [edges, onCustomEdgesChange, onDeletedEdgesChange, handleDeleteEdge, handleAddNodeBetween, onAddNodeBetween, canAddBetween]);

  const handleReconnect = useCallback(
    (oldEdge, newConnection) => {
      if (!newConnection?.source || !newConnection?.target) return;
      const edgesWithoutOld = edges.filter((e) => e.id !== oldEdge.id);
      const sourceNode = nodes.find((n) => n.id === newConnection.source);
      const targetNode = nodes.find((n) => n.id === newConnection.target);
      const sourceType = sourceNode?.type;
      const targetType = targetNode?.type;
      if (targetType !== 'merge' && targetType !== 'end') {
        const incomingCount = edgesWithoutOld.filter((e) => e.target === newConnection.target).length;
        if (incomingCount >= 2) return;
      }
      if (sourceType !== 'decision' && sourceType !== 'start') {
        const outgoingCount = edgesWithoutOld.filter((e) => e.source === newConnection.source).length;
        if (outgoingCount >= 2) return;
      }
      setEdges((els) => reconnectEdge(oldEdge, newConnection, els));
      const isCustom = oldEdge.id?.startsWith('e-custom-');
      if (isCustom && onCustomEdgesChange) {
        const toId = (c) => `e-custom-${c.source}-${c.target}-${c.sourceHandle || 'r'}-${c.targetHandle || 'l'}`;
        const next = customEdges.filter((c) => toId(c) !== oldEdge.id);
        next.push({ source: newConnection.source, target: newConnection.target });
        onCustomEdgesChange(next);
      } else if (!isCustom && onCustomEdgesChange && onDeletedEdgesChange) {
        queueMicrotask(() => {
          onDeletedEdgesChange([...(deletedEdges || []), oldEdge.id]);
          onCustomEdgesChange([...(customEdges || []), { source: newConnection.source, target: newConnection.target }]);
        });
      }
    },
    [customEdges, onCustomEdgesChange, deletedEdges, onDeletedEdgesChange, setEdges, nodes, edges]
  );

  const onNodeClick = useCallback(
    (_, node) => {
      if (node.type === 'step' || node.type === 'decision' || node.type === 'merge') {
        const idx = node.data?.stepIndex;
        if (typeof idx === 'number' && onStepClick) onStepClick(idx);
      }
    },
    [onStepClick]
  );

  const handleResetPositions = useCallback(() => {
    const defaults = initialNodesRef.current;
    setNodes(defaults);
    setEdges(initialEdges);
    if (onPositionsChange) {
      const positions = {};
      defaults.forEach((n) => {
        if (n.position && (n.type === 'step' || n.type === 'decision' || n.type === 'merge')) {
          positions[n.id] = n.position;
        }
      });
      onPositionsChange(positions, layout);
    }
    if (onCustomEdgesChange) onCustomEdgesChange([]);
    if (onDeletedEdgesChange) onDeletedEdgesChange([]);
    instanceRef.current?.fitView({ padding: 0.12, maxZoom: 1, minZoom: 0.35, duration: 200 });
  }, [setNodes, setEdges, initialEdges, onPositionsChange, onCustomEdgesChange, onDeletedEdgesChange]);

  useImperativeHandle(innerRef, () => ({ resetView: handleResetPositions }), [handleResetPositions]);

  const fitOpts = { padding: 0.12, maxZoom: 1, minZoom: 0.35 };
  const onInit = useCallback((instance) => {
    instanceRef.current = instance;
    instance.fitView({ ...fitOpts, duration: 150 });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // Intentionally no fitView here — only the explicit reset button should refit the view.
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const proOptions = { hideAttribution: true };

  const [showAutoLegend, setShowAutoLegend] = useState(false);

  const automationContent = (
    <div className="flow-legend-automation" data-theme={darkTheme ? 'dark' : 'light'}>
      <div className="flow-legend-automation-heading">
        Automation opportunities
        <span
          className="flow-auto-hint"
          onMouseEnter={() => setShowAutoLegend(true)}
          onMouseLeave={() => setShowAutoLegend(false)}
        >?</span>
      </div>
      {showAutoLegend && (
        <div className="flow-legend flow-legend-right">
          {Object.values(AUTOMATION_CATEGORIES).map((cat) => (
            <span key={cat.key} className="flow-legend-item" title={cat.label}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 14, height: 14, borderRadius: 3,
                background: cat.bg, color: cat.color,
                border: `1px solid ${cat.color}`,
                fontSize: 8, fontWeight: 900, lineHeight: 1, flexShrink: 0,
              }}>{cat.badge}</span>
              <span className="flow-legend-label">{cat.label}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );

  const toolbarContent = (
    <>
      <div className="flow-legend flow-legend-left" data-theme={darkTheme ? 'dark' : 'light'}>
        <span className="flow-legend-item">
          <span className="flow-legend-symbol flow-legend-exclusive" title="Exclusive: one path chosen">◇</span>
          <span className="flow-legend-label">Exclusive</span>
        </span>
        <span className="flow-legend-item">
          <span className="flow-legend-symbol flow-legend-parallel" title="Parallel: all paths run">⊕</span>
          <span className="flow-legend-label">Parallel</span>
        </span>
        <span className="flow-legend-item">
          <span className="flow-legend-symbol flow-legend-merge" title="Merge: parallel branches converge">⧉</span>
          <span className="flow-legend-label">Merge</span>
        </span>
      </div>
      {onCustomEdgesChange && (
        <span className="flow-legend-hint" title="Drag from a node's grey dot to another to create a connection">
          Drag dots to connect
        </span>
      )}
      <button type="button" className="flow-reset-btn" onClick={handleResetPositions} title="Reset positions">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
        </svg>
      </button>
      {onWrapToggle && (
        <button
          type="button"
          className={`flow-reset-btn${isWrapped ? ' flow-wrap-btn-active' : ''}`}
          onClick={onWrapToggle}
          title={isWrapped ? 'Switch to linear' : 'Wrap flow'}
        >
          ↩
        </button>
      )}
      {onFloat && (
        <button type="button" className="flow-reset-btn" onClick={onFloat} title="Open in floating window">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9"/><line x1="21" y1="3" x2="14" y2="10"/>
            <path d="M10 5H5a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-5"/>
          </svg>
        </button>
      )}
    </>
  );

  const flowContent = (
    <ReactFlow
      nodes={flowNodes}
      edges={displayEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={(onCustomEdgesChange || onDeletedEdgesChange) ? handleEdgesChange : onEdgesChange}
      onConnect={handleConnect}
      onReconnect={onCustomEdgesChange ? handleReconnect : undefined}
      edgesReconnectable={!!onCustomEdgesChange}
      isValidConnection={isValidConnection}
      onNodeClick={onNodeClick}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      proOptions={proOptions}
      fitView
      fitViewOptions={{ padding: 0.12, maxZoom: 1, minZoom: 0.35 }}
      onInit={onInit}
      minZoom={0.25}
      maxZoom={2}
      snapToGrid
      snapGrid={[20, 20]}
      defaultEdgeOptions={{ type: 'default', zIndex: 1001 }}
      panOnScroll
      panOnScrollMode="free"
      nodesConnectable={true}
      deleteKeyCode={onDeleteNode ? ['Backspace', 'Delete'] : []}
      connectionMode="loose"
      autoPanOnConnect={true}
      connectionLineType="bezier"
      connectionLineStyle={{ stroke: 'var(--flow-text-muted, #94a3b8)', strokeWidth: 2 }}
    >
      <Background gap={20} size={1} color={darkTheme ? '#2a2a2a' : '#e2e8f0'} />
      <Controls showInteractive={false} position="bottom-right" />
      <MiniMap
        nodeColor={(n) => {
          if (n.type === 'laneSeparator') return 'transparent';
          if (n.type === 'start' || n.type === 'end') return '#059669';
          return '#94a3b8';
        }}
        maskColor={darkTheme ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.7)'}
        style={{ width: 120, height: 80 }}
      />
      {!hideBuiltInToolbar && (
        <Panel position="top-left" className="flow-legend-panel">
          {toolbarContent}
        </Panel>
      )}
      <Panel position="top-right" className="flow-automation-panel">
        {automationContent}
      </Panel>
    </ReactFlow>
  );

  if (!mobileAccepted) {
    return (
      <div ref={containerRef} className={`interactive-flow-canvas ${className}`} data-theme={darkTheme ? 'dark' : 'light'}>
        <div className="flow-mobile-prompt">
          <svg className="flow-mobile-prompt-icon" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="17" r="1"/>
          </svg>
          <p className="flow-mobile-prompt-title">Best viewed on desktop</p>
          <p className="flow-mobile-prompt-body">This flow chart is designed for a larger screen. For the full experience, open this page on a desktop or laptop.</p>
          <button
            type="button"
            className="flow-mobile-prompt-btn"
            onClick={() => {
              try { sessionStorage.setItem('flow-mobile-accepted', '1'); } catch {}
              setMobileAccepted(true);
            }}
          >
            View anyway
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`interactive-flow-canvas ${className}`} data-theme={darkTheme ? 'dark' : 'light'}>
      {isSwimlane ? (
        <div className="flow-swimlane-container" style={{ display: 'flex', width: '100%', height: '100%', minHeight: 0 }}>
          <SwimlaneLabelsPanel lanes={computedLanes} layoutHeight={computedLayoutHeight || 600} darkTheme={darkTheme} />
          <div className="flow-pane" style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
            {flowContent}
          </div>
        </div>
      ) : (
        flowContent
      )}
    </div>
  );
}

const InteractiveFlowCanvas = forwardRef(function InteractiveFlowCanvas(props, ref) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} innerRef={ref} />
    </ReactFlowProvider>
  );
});
export default InteractiveFlowCanvas;
