'use client';
import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '@/lib/api-fetch';

/**
 * Manages flow canvas state (node positions, custom edges, deleted edges) with
 * debounced auto-save back to the database via /api/update-diagnostic.
 * Save is best-effort and silent — only fires when reportId and processIndex are provided.
 */
export function useFlowLayoutSave({ reportId, processIndex, accessToken, redesignId = null, initialPositions = {}, initialCustomEdges = [], initialDeletedEdges = [] }) {
  const [flowNodePositions, setFlowNodePositions] = useState(initialPositions);
  const [customEdges, setCustomEdges] = useState(initialCustomEdges);
  const [deletedEdges, setDeletedEdges] = useState(initialDeletedEdges);
  const timerRef = useRef(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (!reportId || processIndex == null) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const entry = { processIndex, flowNodePositions, flowCustomEdges: customEdges, flowDeletedEdges: deletedEdges };
      const updateKey = redesignId ? 'redesignFlowLayouts' : 'flowLayouts';
      if (redesignId) entry.redesignId = redesignId;
      apiFetch('/api/update-diagnostic', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId, updates: { [updateKey]: [entry] } }),
      }, accessToken).catch(() => {});
    }, 1500);
    return () => clearTimeout(timerRef.current);
  }, [flowNodePositions, customEdges, deletedEdges, reportId, processIndex, redesignId, accessToken]);

  return { flowNodePositions, setFlowNodePositions, customEdges, setCustomEdges, deletedEdges, setDeletedEdges };
}
