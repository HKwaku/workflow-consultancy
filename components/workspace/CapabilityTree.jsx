'use client';

/**
 * Hierarchical function tree. Click a function to scope the processes
 * panel; admins also get add / rename / delete + the "+ Sub-function"
 * affordance on each node.
 *
 * The tree comes pre-nested from /api/operating-models/[id] (functions
 * field). Per-function process counts come from rollup.byFunction so
 * the tree shows badges without an extra round-trip.
 */

import { useState, useCallback, useMemo } from 'react';
import { apiFetch } from '@/lib/api-fetch';

const LAYERS = [
  { value: 'value_chain', label: 'Value chain' },
  { value: 'enabling',    label: 'Enabling'    },
  { value: 'governance',  label: 'Governance'  },
  { value: 'unspecified', label: 'Unspecified' },
];

export default function CapabilityTree({
  modelId, functions, rollup, isAdmin, accessToken,
  selectedFuncId, onSelect, onChanged,
}) {
  // Process counts keyed by function_id (and "__unfiled__" for null bucket).
  const countsById = useMemo(() => {
    const m = {};
    for (const b of rollup?.byFunction || []) {
      m[b.functionId || '__unfiled__'] = b.processCount;
    }
    return m;
  }, [rollup]);

  const [adding, setAdding] = useState(false);

  const onAddRoot = useCallback(async (name) => {
    if (!name) return;
    await apiFetch(
      `/api/operating-models/${modelId}/functions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parent_function_id: null }),
      },
      accessToken,
    );
    setAdding(false);
    onChanged?.();
  }, [modelId, accessToken, onChanged]);

  return (
    <div className="ws-tree">
      <div className="ws-tree-head">
        <h2>Functions</h2>
        {isAdmin && !adding && (
          <button type="button" className="ws-tree-action" onClick={() => setAdding(true)}>
            + Function
          </button>
        )}
      </div>

      {adding && (
        <InlineNameInput
          placeholder="New function name…"
          onSubmit={onAddRoot}
          onCancel={() => setAdding(false)}
        />
      )}

      {/* All-processes selector — clears any function filter */}
      <button
        type="button"
        className={`ws-tree-all${selectedFuncId == null ? ' ws-tree-all--selected' : ''}`}
        onClick={() => onSelect?.(null)}
      >
        All processes
        <span className="ws-tree-count">{rollup?.totals?.processes ?? 0}</span>
      </button>

      {(functions || []).length === 0 && !adding && (
        isAdmin ? (
          <div className="ws-onboard-card">
            <div className="ws-onboard-icon" aria-hidden>📁</div>
            <div className="ws-onboard-title">No functions yet</div>
            <div className="ws-onboard-body">
              Functions are how you organise your operating model: Finance,
              Sales, Operations, IT… Each process you map files under one,
              so the workspace can roll up cost, FTE, and risk per area.
            </div>
            <div className="ws-onboard-actions">
              <button type="button" className="ws-cta" onClick={() => setAdding(true)}>+ Add your first function</button>
              <span className="ws-onboard-tip">e.g. Finance · Sales · Operations · IT · HR</span>
            </div>
          </div>
        ) : (
          <p className="ws-empty-inline">No functions yet. Ask an org admin to add some.</p>
        )
      )}

      <ul className="ws-tree-list">
        {(functions || []).map((cap) => (
          <CapNode
            key={cap.id}
            cap={cap}
            depth={0}
            isAdmin={isAdmin}
            modelId={modelId}
            accessToken={accessToken}
            countsById={countsById}
            selectedFuncId={selectedFuncId}
            onSelect={onSelect}
            onChanged={onChanged}
          />
        ))}
      </ul>

      {(rollup?.unfiledProcesses || 0) > 0 && (
        <button
          type="button"
          className={`ws-tree-unfiled${selectedFuncId === '__unfiled__' ? ' ws-tree-unfiled--selected' : ''}`}
          onClick={() => onSelect?.('__unfiled__')}
        >
          Unfiled
          <span className="ws-tree-count">{rollup.unfiledProcesses}</span>
        </button>
      )}
    </div>
  );
}

function CapNode({
  cap, depth, isAdmin, modelId, accessToken,
  countsById, selectedFuncId, onSelect, onChanged,
}) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);

  const count = countsById[cap.id] || 0;
  const hasChildren = (cap.children || []).length > 0;

  const update = useCallback(async (patch) => {
    setBusy(true);
    try {
      await apiFetch(
        `/api/operating-models/${modelId}/functions/${cap.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        },
        accessToken,
      );
      onChanged?.();
    } finally {
      setBusy(false);
      setEditing(false);
    }
  }, [modelId, cap.id, accessToken, onChanged]);

  const remove = useCallback(async () => {
    setBusy(true);
    try {
      await apiFetch(
        `/api/operating-models/${modelId}/functions/${cap.id}`,
        { method: 'DELETE' },
        accessToken,
      );
      onChanged?.();
    } finally {
      setBusy(false);
      setConfirmDel(false);
    }
  }, [modelId, cap.id, accessToken, onChanged]);

  const addChild = useCallback(async (name) => {
    if (!name) return;
    setBusy(true);
    try {
      await apiFetch(
        `/api/operating-models/${modelId}/functions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, parent_function_id: cap.id }),
        },
        accessToken,
      );
      onChanged?.();
    } finally {
      setBusy(false);
      setAddingChild(false);
    }
  }, [modelId, cap.id, accessToken, onChanged]);

  const selected = selectedFuncId === cap.id;

  return (
    <li className="ws-tree-node">
      <div
        className={`ws-tree-row ws-tree-row--depth-${Math.min(depth, 4)}${selected ? ' ws-tree-row--selected' : ''}`}
      >
        {hasChildren && (
          <button
            type="button"
            className="ws-tree-toggle"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Collapse' : 'Expand'}
          >{open ? '▾' : '▸'}</button>
        )}
        {!hasChildren && <span className="ws-tree-toggle ws-tree-toggle--leaf" />}

        {editing ? (
          <InlineNameInput
            initial={cap.name}
            onSubmit={(name) => update({ name })}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <button
            type="button"
            className="ws-tree-label"
            onClick={() => onSelect?.(cap.id)}
          >
            {cap.name}
            <span className="ws-tree-count">{count}</span>
            {cap.layer && cap.layer !== 'value_chain' && (
              <span className={`ws-tree-layer ws-tree-layer--${cap.layer}`}>{cap.layer}</span>
            )}
          </button>
        )}

        {isAdmin && !editing && !addingChild && !confirmDel && (
          <span className="ws-tree-actions">
            <button type="button" title="Add sub-function" onClick={() => setAddingChild(true)} disabled={busy}>＋</button>
            <button type="button" title="Rename" onClick={() => setEditing(true)} disabled={busy}>✎</button>
            <button type="button" title="Delete" onClick={() => setConfirmDel(true)} disabled={busy}>🗑</button>
          </span>
        )}
        {confirmDel && (
          <span className="ws-tree-confirm">
            Delete? Sub-functions become top-level; processes become unfiled.
            <button type="button" onClick={remove} disabled={busy} className="ws-tree-confirm-yes">Confirm</button>
            <button type="button" onClick={() => setConfirmDel(false)} disabled={busy}>Cancel</button>
          </span>
        )}
      </div>

      {addingChild && (
        <div className={`ws-tree-row ws-tree-row--depth-${Math.min(depth + 1, 4)}`}>
          <span className="ws-tree-toggle ws-tree-toggle--leaf" />
          <InlineNameInput
            placeholder={`Sub-function of ${cap.name}…`}
            onSubmit={addChild}
            onCancel={() => setAddingChild(false)}
          />
        </div>
      )}

      {open && hasChildren && (
        <ul className="ws-tree-list">
          {cap.children.map((child) => (
            <CapNode
              key={child.id}
              cap={child}
              depth={depth + 1}
              isAdmin={isAdmin}
              modelId={modelId}
              accessToken={accessToken}
              countsById={countsById}
              selectedFuncId={selectedFuncId}
              onSelect={onSelect}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function InlineNameInput({ initial = '', placeholder = 'Name…', onSubmit, onCancel }) {
  const [value, setValue] = useState(initial);
  return (
    <form
      className="ws-inline-input"
      onSubmit={(e) => { e.preventDefault(); const t = value.trim(); if (t) onSubmit(t); }}
    >
      <input
        autoFocus
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
      />
      <button type="submit">Save</button>
      <button type="button" onClick={onCancel}>Cancel</button>
    </form>
  );
}
