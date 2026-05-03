'use client';

/**
 * Shared "long-running action" channel between the chat thread (where actions
 * are kicked off via DealProposalCards / etc.) and the right canvas area
 * (where the loading state should render). Without this the user kicks off
 * an analysis in the chat and gets no visible feedback that anything's
 * happening — the canvas stays empty.
 *
 * Usage:
 *   const { action, beginAction, updateAction, endAction } = useCanvasAction();
 *
 *   beginAction({ id, kind: 'analysis', label: 'Running diligence analysis',
 *                 detail: 'Acme rollup' });
 *   updateAction({ id, status: 'embedding...' });
 *   endAction({ id });
 *
 * The provider holds at most one action at a time. Starting a second begins
 * replaces the first (we surface only one canvas state).
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const CanvasActionContext = createContext({
  action: null,
  beginAction: () => {},
  updateAction: () => {},
  endAction: () => {},
});

export function CanvasActionProvider({ children }) {
  const [action, setAction] = useState(null);

  const beginAction = useCallback((next) => {
    if (!next) return;
    setAction({ startedAt: Date.now(), status: 'starting…', ...next });
  }, []);

  const updateAction = useCallback((patch) => {
    setAction((prev) => (prev && (!patch?.id || patch.id === prev.id) ? { ...prev, ...patch } : prev));
  }, []);

  const endAction = useCallback((opts) => {
    setAction((prev) => {
      if (!prev) return null;
      if (opts?.id && opts.id !== prev.id) return prev;
      return null;
    });
  }, []);

  const value = useMemo(() => ({ action, beginAction, updateAction, endAction }),
    [action, beginAction, updateAction, endAction]);

  return (
    <CanvasActionContext.Provider value={value}>
      {children}
    </CanvasActionContext.Provider>
  );
}

export function useCanvasAction() {
  return useContext(CanvasActionContext);
}
