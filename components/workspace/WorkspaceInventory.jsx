'use client';

/**
 * WorkspaceInventory — roles + systems CRUD on the workspace home.
 *
 * Two side-by-side panels:
 *   - Roles    (model_roles)    — name, headcount, owner, function tags
 *   - Systems  (model_systems)  — name, vendor, category, layer
 *
 * Both are admin-edit only (member read). Admins see + Add / inline edit /
 * delete affordances; members see the bare list.
 *
 * Doesn't fetch on its own — the parent (WorkspaceClient) already loaded
 * model.roles / model.systems / model.functionsFlat. CRUD operations
 * call `onChanged` so the parent refetches.
 */

import { useState, useCallback, useMemo } from 'react';
import { apiFetch } from '@/lib/api-fetch';

const SYSTEM_LAYERS = [
  { value: 'system_of_record', label: 'System of record' },
  { value: 'productivity',     label: 'Productivity' },
  { value: 'workflow',         label: 'Workflow' },
  { value: 'analytics',        label: 'Analytics' },
  { value: 'comms',            label: 'Comms' },
  { value: 'other',            label: 'Other' },
];

export default function WorkspaceInventory({
  modelId, roles, systems, functions, isAdmin, accessToken, onChanged,
}) {
  return (
    <section className="ws-pane ws-inventory">
      <div className="ws-inventory-grid">
        <RolesColumn
          modelId={modelId}
          roles={roles || []}
          functions={functions || []}
          isAdmin={isAdmin}
          accessToken={accessToken}
          onChanged={onChanged}
        />
        <SystemsColumn
          modelId={modelId}
          systems={systems || []}
          isAdmin={isAdmin}
          accessToken={accessToken}
          onChanged={onChanged}
        />
      </div>
    </section>
  );
}

/* ── Roles ────────────────────────────────────────────────── */

function RolesColumn({ modelId, roles, functions, isAdmin, accessToken, onChanged }) {
  const [adding, setAdding]       = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [confirmDelId, setConfirmDelId] = useState(null);
  const [busy, setBusy]           = useState(false);

  const capById = useMemo(() => new Map(functions.map((c) => [c.id, c])), [functions]);

  const submit = useCallback(async (id, payload) => {
    setBusy(true);
    try {
      const url = id
        ? `/api/operating-models/${modelId}/roles/${id}`
        : `/api/operating-models/${modelId}/roles`;
      const r = await apiFetch(url, {
        method: id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, accessToken);
      if (r.ok) { onChanged?.(); }
      else { alert((await r.json().catch(() => ({})))?.error || 'Failed to save role.'); }
    } finally {
      setBusy(false);
      setAdding(false);
      setEditingId(null);
    }
  }, [modelId, accessToken, onChanged]);

  const remove = useCallback(async (id) => {
    setBusy(true);
    try {
      const r = await apiFetch(
        `/api/operating-models/${modelId}/roles/${id}`,
        { method: 'DELETE' },
        accessToken,
      );
      if (r.ok) { onChanged?.(); }
      else { alert('Failed to delete role.'); }
    } finally {
      setBusy(false);
      setConfirmDelId(null);
    }
  }, [modelId, accessToken, onChanged]);

  const totalFte = roles.reduce((s, r) => s + (Number(r.headcount) || 0), 0);

  return (
    <div className="ws-inventory-col">
      <h2 className="ws-inventory-head">
        <span>Roles <span className="ws-inventory-count">{roles.length}</span></span>
        <span className="ws-inventory-meta">{totalFte} FTE total</span>
        {isAdmin && !adding && (
          <button type="button" className="ws-tree-action" onClick={() => setAdding(true)}>+ Role</button>
        )}
      </h2>

      {adding && (
        <RoleForm
          functions={functions}
          busy={busy}
          onSubmit={(p) => submit(null, p)}
          onCancel={() => setAdding(false)}
        />
      )}

      {!roles.length && !adding && (
        <p className="ws-empty-inline">
          No roles yet. {isAdmin
            ? 'Add one (Operations Manager, Account Executive, …) to make the FTE rollup meaningful.'
            : 'Ask an org admin to add roles.'}
        </p>
      )}

      <ul className="ws-inventory-list">
        {roles.map((r) => editingId === r.id ? (
          <li key={r.id} className="ws-inventory-row ws-inventory-row--editing">
            <RoleForm
              initial={r}
              functions={functions}
              busy={busy}
              onSubmit={(p) => submit(r.id, p)}
              onCancel={() => setEditingId(null)}
            />
          </li>
        ) : (
          <li key={r.id} className="ws-inventory-row">
            <div className="ws-inventory-row-main">
              <span className="ws-inventory-name">{r.name}</span>
              <span className="ws-inventory-fte">{r.headcount} FTE</span>
              {r.owner_email && <span className="ws-inventory-owner">{r.owner_email}</span>}
            </div>
            {(r.function_ids || []).length > 0 && (
              <div className="ws-inventory-tags">
                {r.function_ids.map((cid) => {
                  const c = capById.get(cid);
                  return <span key={cid} className="ws-inventory-tag">{c?.name || '(missing)'}</span>;
                })}
              </div>
            )}
            {isAdmin && confirmDelId !== r.id && (
              <div className="ws-inventory-actions">
                <button type="button" onClick={() => setEditingId(r.id)} disabled={busy}>✎</button>
                <button type="button" onClick={() => setConfirmDelId(r.id)} disabled={busy}>🗑</button>
              </div>
            )}
            {confirmDelId === r.id && (
              <div className="ws-inventory-confirm">
                Delete this role?
                <button type="button" className="ws-tree-confirm-yes" onClick={() => remove(r.id)} disabled={busy}>Confirm</button>
                <button type="button" onClick={() => setConfirmDelId(null)} disabled={busy}>Cancel</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RoleForm({ initial, functions, busy, onSubmit, onCancel }) {
  const [name,       setName]       = useState(initial?.name || '');
  const [headcount,  setHeadcount]  = useState(initial?.headcount ?? 1);
  const [ownerEmail, setOwnerEmail] = useState(initial?.owner_email || '');
  const [capIds,     setCapIds]     = useState(initial?.function_ids || []);

  const toggleCap = (id) => {
    setCapIds((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  };

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(),
      headcount: Math.max(0, Math.floor(Number(headcount) || 0)),
      owner_email: ownerEmail.trim() || null,
      function_ids: capIds,
    });
  };

  return (
    <form className="ws-inventory-form" onSubmit={submit}>
      <div className="ws-inventory-form-row">
        <label className="ws-inventory-form-name">
          <span>Name</span>
          <input
            type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Operations Manager" autoFocus
          />
        </label>
        <label className="ws-inventory-form-num">
          <span>Headcount</span>
          <input type="number" min={0} step={1} value={headcount} onChange={(e) => setHeadcount(e.target.value)} />
        </label>
      </div>
      <label className="ws-inventory-form-full">
        <span>Owner email (optional)</span>
        <input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="owner@company.com" />
      </label>
      {functions.length > 0 && (
        <div className="ws-inventory-form-full">
          <span className="ws-inventory-form-label">Spans functions</span>
          <div className="ws-inventory-cap-toggles">
            {functions.map((c) => (
              <label key={c.id} className={`ws-inventory-cap-toggle${capIds.includes(c.id) ? ' ws-inventory-cap-toggle--on' : ''}`}>
                <input
                  type="checkbox"
                  checked={capIds.includes(c.id)}
                  onChange={() => toggleCap(c.id)}
                />
                {c.name}
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="ws-inventory-form-actions">
        <button type="submit" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

/* ── Systems ──────────────────────────────────────────────── */

function SystemsColumn({ modelId, systems, isAdmin, accessToken, onChanged }) {
  const [adding, setAdding]       = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [confirmDelId, setConfirmDelId] = useState(null);
  const [busy, setBusy]           = useState(false);

  const submit = useCallback(async (id, payload) => {
    setBusy(true);
    try {
      const url = id
        ? `/api/operating-models/${modelId}/systems/${id}`
        : `/api/operating-models/${modelId}/systems`;
      const r = await apiFetch(url, {
        method: id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, accessToken);
      if (r.ok) { onChanged?.(); }
      else { alert((await r.json().catch(() => ({})))?.error || 'Failed to save system.'); }
    } finally {
      setBusy(false);
      setAdding(false);
      setEditingId(null);
    }
  }, [modelId, accessToken, onChanged]);

  const remove = useCallback(async (id) => {
    setBusy(true);
    try {
      const r = await apiFetch(
        `/api/operating-models/${modelId}/systems/${id}`,
        { method: 'DELETE' },
        accessToken,
      );
      if (r.ok) { onChanged?.(); }
      else { alert('Failed to delete system.'); }
    } finally {
      setBusy(false);
      setConfirmDelId(null);
    }
  }, [modelId, accessToken, onChanged]);

  return (
    <div className="ws-inventory-col">
      <h2 className="ws-inventory-head">
        <span>Systems <span className="ws-inventory-count">{systems.length}</span></span>
        <span className="ws-inventory-meta">canonical inventory</span>
        {isAdmin && !adding && (
          <button type="button" className="ws-tree-action" onClick={() => setAdding(true)}>+ System</button>
        )}
      </h2>

      {adding && (
        <SystemForm busy={busy} onSubmit={(p) => submit(null, p)} onCancel={() => setAdding(false)} />
      )}

      {!systems.length && !adding && (
        <p className="ws-empty-inline">
          No systems yet. {isAdmin
            ? 'Add the apps/SaaS your org uses (Salesforce, NetSuite, …). Process step.systems[] entries auto-link by name.'
            : 'Ask an org admin to populate the inventory.'}
        </p>
      )}

      <ul className="ws-inventory-list">
        {systems.map((s) => editingId === s.id ? (
          <li key={s.id} className="ws-inventory-row ws-inventory-row--editing">
            <SystemForm
              initial={s}
              busy={busy}
              onSubmit={(p) => submit(s.id, p)}
              onCancel={() => setEditingId(null)}
            />
          </li>
        ) : (
          <li key={s.id} className="ws-inventory-row">
            <div className="ws-inventory-row-main">
              <span className="ws-inventory-name">{s.name}</span>
              {s.vendor && <span className="ws-inventory-meta-inline">{s.vendor}</span>}
              {s.layer && s.layer !== 'other' && (
                <span className={`ws-inventory-layer ws-inventory-layer--${s.layer}`}>
                  {(SYSTEM_LAYERS.find((l) => l.value === s.layer)?.label) || s.layer}
                </span>
              )}
            </div>
            {(s.category || s.owner_email) && (
              <div className="ws-inventory-tags">
                {s.category    && <span className="ws-inventory-tag">{s.category}</span>}
                {s.owner_email && <span className="ws-inventory-owner">{s.owner_email}</span>}
              </div>
            )}
            {isAdmin && confirmDelId !== s.id && (
              <div className="ws-inventory-actions">
                <button type="button" onClick={() => setEditingId(s.id)} disabled={busy}>✎</button>
                <button type="button" onClick={() => setConfirmDelId(s.id)} disabled={busy}>🗑</button>
              </div>
            )}
            {confirmDelId === s.id && (
              <div className="ws-inventory-confirm">
                Delete? Process step mentions become &quot;unlinked&quot;.
                <button type="button" className="ws-tree-confirm-yes" onClick={() => remove(s.id)} disabled={busy}>Confirm</button>
                <button type="button" onClick={() => setConfirmDelId(null)} disabled={busy}>Cancel</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SystemForm({ initial, busy, onSubmit, onCancel }) {
  const [name,       setName]       = useState(initial?.name     || '');
  const [vendor,     setVendor]     = useState(initial?.vendor   || '');
  const [category,   setCategory]   = useState(initial?.category || '');
  const [layer,      setLayer]      = useState(initial?.layer    || 'other');
  const [ownerEmail, setOwnerEmail] = useState(initial?.owner_email || '');

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(),
      vendor: vendor.trim() || null,
      category: category.trim() || null,
      layer,
      owner_email: ownerEmail.trim() || null,
    });
  };

  return (
    <form className="ws-inventory-form" onSubmit={submit}>
      <div className="ws-inventory-form-row">
        <label className="ws-inventory-form-name">
          <span>Name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Salesforce" autoFocus />
        </label>
        <label className="ws-inventory-form-num">
          <span>Vendor</span>
          <input type="text" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Salesforce, Inc." />
        </label>
      </div>
      <div className="ws-inventory-form-row">
        <label className="ws-inventory-form-name">
          <span>Category</span>
          <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. CRM" />
        </label>
        <label className="ws-inventory-form-num">
          <span>Layer</span>
          <select value={layer} onChange={(e) => setLayer(e.target.value)}>
            {SYSTEM_LAYERS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </label>
      </div>
      <label className="ws-inventory-form-full">
        <span>Owner email (optional)</span>
        <input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="sysadmin@company.com" />
      </label>
      <div className="ws-inventory-form-actions">
        <button type="submit" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}
