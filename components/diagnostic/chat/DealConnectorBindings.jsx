'use client';

/**
 * Per-deal connector bindings UI — sits inside the data-room section of
 * DealWorkspaceModal. Lets a deal editor:
 *
 *   • see active "sync from <provider> folder X" bindings + last sync time
 *   • add a new binding by browsing the provider's folder tree
 *   • trigger a manual sync (kicks the connector-binding.sync-requested event)
 *   • remove a binding (existing synced docs stay; future syncs stop)
 *
 * Provider availability is gated on what's connected at the org level —
 * if no integrations are active, we show a help line pointing the user
 * to /org-admin → Integrations.
 *
 * The folder picker is a small breadcrumb-driven tree (sites → drives →
 * folders for SharePoint; folders for Drive). Picking a leaf submits the
 * binding via POST and an immediate sync fires server-side.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';

const PROVIDER_LABEL = {
  sharepoint:   'Microsoft 365 / SharePoint',
  google_drive: 'Google Drive',
  datasite:     'Datasite',
  box:          'Box',
};

function fmtRelative(d) {
  if (!d) return 'never';
  const ms = Date.now() - new Date(d).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export default function DealConnectorBindings({ dealId, accessToken, editable }) {
  const [bindings, setBindings] = useState([]);
  const [availableProviders, setAvailableProviders] = useState([]); // ids of integrations active for this org
  const [pickerOpen, setPickerOpen] = useState(null); // provider id when active
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    if (!dealId || !accessToken) return;
    try {
      const r = await apiFetch(`/api/deals/${dealId}/connector-bindings`, {}, accessToken);
      const j = r.ok ? await r.json() : null;
      if (j?.bindings) setBindings(j.bindings);
    } catch { /* swallow */ }
  }, [dealId, accessToken]);

  // Discover which providers are connected for this org. We don't know the
  // orgId here — the integrations endpoint requires it — so we infer from
  // what the connector-bindings POST will accept by trying both. Quick
  // heuristic: list provider availability via a tiny dedicated endpoint on
  // the deal route; for now, expose the union of providers the user could
  // pick. The picker call itself returns 400 if the integration is missing.
  useEffect(() => {
    setAvailableProviders(['sharepoint', 'google_drive']);
  }, []);

  useEffect(() => { load(); }, [load]);

  const removeBinding = async (bindingId) => {
    if (!confirm('Remove this binding? Existing synced documents stay; future syncs stop.')) return;
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch(
        `/api/deals/${dealId}/connector-bindings?id=${encodeURIComponent(bindingId)}`,
        { method: 'DELETE' }, accessToken,
      );
      if (r.ok) await load();
      else { const j = await r.json(); setErr(j?.error || 'Remove failed.'); }
    } finally { setBusy(false); }
  };

  const triggerSync = async (bindingId) => {
    setBusy(true); setErr(null);
    try {
      // Use a no-body POST to a sub-route; backend triggers the event.
      const r = await apiFetch(
        `/api/deals/${dealId}/connector-bindings/${encodeURIComponent(bindingId)}/sync`,
        { method: 'POST' }, accessToken,
      );
      if (r.ok) {
        // Optimistic update — backend will overwrite next_sync_after on the actual run.
        setBindings((b) => b.map((x) => x.id === bindingId
          ? { ...x, sync_status: 'syncing', last_sync_error: null }
          : x));
      } else { const j = await r.json(); setErr(j?.error || 'Sync failed to enqueue.'); }
    } finally { setBusy(false); }
  };

  const onPicked = async ({ provider, source_ref, display_path }) => {
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch(
        `/api/deals/${dealId}/connector-bindings`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, source_ref, display_path }) },
        accessToken,
      );
      const j = await r.json();
      if (r.ok) { setPickerOpen(null); await load(); }
      else setErr(j?.error || 'Failed to add binding.');
    } finally { setBusy(false); }
  };

  return (
    <div className="deal-connector-bindings">
      <div className="deal-connector-bindings-head">
        <span className="deal-connector-bindings-title">Synced from</span>
        {editable && (
          <span className="deal-connector-bindings-add">
            {availableProviders.map((pid) => (
              <button
                key={pid}
                type="button"
                className="deal-connector-add-btn"
                onClick={() => setPickerOpen(pid)}
                disabled={busy}
                title={`Add a folder from ${PROVIDER_LABEL[pid] || pid}`}
              >+ {PROVIDER_LABEL[pid] || pid}</button>
            ))}
          </span>
        )}
      </div>
      {err && <div className="deal-workspace-error" style={{ padding: '4px 0', fontSize: 11 }}>{err}</div>}
      {bindings.length === 0 ? (
        <p className="deal-connector-bindings-empty">
          No external folders bound yet. {editable
            ? 'Add one above, or connect a new provider via Org admin → Integrations.'
            : 'Ask the deal team to bind a folder.'}
        </p>
      ) : (
        <ul className="deal-connector-bindings-list">
          {bindings.map((b) => {
            const provider = b.org_integrations?.provider;
            return (
              <li key={b.id} className={`deal-connector-binding deal-connector-binding--${b.sync_status}`}>
                <span className={`deal-connector-binding-status deal-connector-binding-status--${b.sync_status}`}>
                  {b.sync_status}
                </span>
                <span className="deal-connector-binding-label">
                  <strong>{PROVIDER_LABEL[provider] || provider}</strong>
                  <span className="deal-connector-binding-path">
                    {b.display_path || (typeof b.source_ref === 'object' ? JSON.stringify(b.source_ref).slice(0, 80) : 'folder')}
                  </span>
                </span>
                <span className="deal-connector-binding-meta">
                  Last sync {fmtRelative(b.last_sync_at)}
                  {b.last_sync_error && <span className="deal-connector-binding-err" title={b.last_sync_error}> · error</span>}
                </span>
                {editable && (
                  <span className="deal-connector-binding-actions">
                    <button type="button" className="deal-connector-action-btn"
                      onClick={() => triggerSync(b.id)} disabled={busy || b.sync_status === 'syncing'}>
                      {b.sync_status === 'syncing' ? 'Syncing…' : 'Sync now'}
                    </button>
                    <button type="button" className="deal-connector-action-btn deal-connector-action-btn--danger"
                      onClick={() => removeBinding(b.id)} disabled={busy}>Remove</button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {pickerOpen && (
        <FolderPicker
          provider={pickerOpen}
          accessToken={accessToken}
          onCancel={() => setPickerOpen(null)}
          onPick={onPicked}
        />
      )}
    </div>
  );
}

/**
 * Two-stage browser: SharePoint walks sites → drives → folders. Drive jumps
 * straight to folders rooted at "My Drive". Each click into a folder
 * pushes a breadcrumb; the bottom Pick button binds whatever the cursor
 * is currently on.
 */
function FolderPicker({ provider, accessToken, onCancel, onPick }) {
  const [crumbs, setCrumbs] = useState(initialCrumbs(provider));
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const cur = crumbs[crumbs.length - 1];

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr(null);
    const sp = new URLSearchParams(cur.query || {});
    apiFetch(`/api/integrations/${provider}/folders?${sp.toString()}`, {}, accessToken)
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (cancelled) return;
        if (!ok) setErr(j?.error || 'Picker failed.');
        else setItems(j.items || []);
      })
      .catch((e) => { if (!cancelled) setErr(e?.message || 'Network error.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [provider, accessToken, cur]);

  const drillInto = (item) => {
    const next = nextCrumb(provider, cur, item);
    if (next) setCrumbs((c) => [...c, next]);
  };

  const popTo = (idx) => setCrumbs((c) => c.slice(0, idx + 1));

  const submit = () => {
    const sourceRef = sourceRefFromCrumbs(provider, crumbs);
    if (!sourceRef) return;
    const displayPath = '/' + crumbs.slice(1).map((c) => c.label).join('/');
    onPick({ provider, source_ref: sourceRef, display_path: displayPath });
  };

  const canPick = canPickHere(provider, crumbs);

  return (
    <div className="deal-folder-picker-overlay" role="dialog" aria-modal>
      <div className="deal-folder-picker">
        <div className="deal-folder-picker-head">
          <span className="deal-folder-picker-title">Pick a folder · {PROVIDER_LABEL[provider] || provider}</span>
          <button type="button" className="deal-folder-picker-close" onClick={onCancel} aria-label="Close">×</button>
        </div>
        <div className="deal-folder-picker-crumbs">
          {crumbs.map((c, i) => (
            <span key={i}>
              {i > 0 && <span className="deal-folder-picker-sep">/</span>}
              <button type="button" className="deal-folder-picker-crumb"
                onClick={() => popTo(i)}>{c.label}</button>
            </span>
          ))}
        </div>
        <div className="deal-folder-picker-body">
          {loading && <div className="deal-workspace-empty">Loading…</div>}
          {err && <div className="deal-workspace-error">{err}</div>}
          {!loading && !err && items.length === 0 && (
            <div className="deal-workspace-empty">Nothing here.</div>
          )}
          {!loading && !err && items.length > 0 && (
            <ul className="deal-folder-picker-list">
              {items.map((it) => (
                <li key={it.id}>
                  <button type="button" className="deal-folder-picker-item" onClick={() => drillInto(it)}>
                    <span aria-hidden>📁</span> {it.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="deal-folder-picker-foot">
          <button type="button" className="deal-folder-picker-cancel" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="deal-folder-picker-pick"
            onClick={submit}
            disabled={!canPick}
            title={canPick ? 'Bind this folder to the deal' : 'Drill into a folder first'}
          >Sync this folder</button>
        </div>
      </div>
    </div>
  );
}

/* ── Provider-specific picker traversal helpers ──────────────────────── */

function initialCrumbs(provider) {
  if (provider === 'sharepoint') return [{ label: 'Sites', query: { kind: 'sites' } }];
  if (provider === 'google_drive') return [{ label: 'My Drive', query: { kind: 'folders', parent_id: 'root' } }];
  return [];
}

function nextCrumb(provider, cur, item) {
  if (provider === 'sharepoint') {
    if (cur.query.kind === 'sites') return { label: item.name, item, query: { kind: 'drives', site_id: item.id } };
    if (cur.query.kind === 'drives') return { label: item.name, item, query: { kind: 'items', drive_id: item.id } };
    if (cur.query.kind === 'items') return { label: item.name, item, query: { kind: 'items', drive_id: cur.query.drive_id, item_id: item.id } };
  }
  if (provider === 'google_drive') {
    return { label: item.name, item, query: { kind: 'folders', parent_id: item.id } };
  }
  return null;
}

function canPickHere(provider, crumbs) {
  if (crumbs.length < 2) return false; // need to drill into at least one level
  const cur = crumbs[crumbs.length - 1];
  if (provider === 'sharepoint') return cur.query.kind === 'items';
  if (provider === 'google_drive') return cur.query.kind === 'folders';
  return false;
}

function sourceRefFromCrumbs(provider, crumbs) {
  const cur = crumbs[crumbs.length - 1];
  if (provider === 'sharepoint') {
    return {
      drive_id: cur.query.drive_id,
      item_id: cur.query.item_id || null,
      site_id: crumbs.find((c) => c.query?.kind === 'drives')?.query?.site_id || null,
    };
  }
  if (provider === 'google_drive') {
    return { folder_id: cur.query.parent_id };
  }
  return null;
}
