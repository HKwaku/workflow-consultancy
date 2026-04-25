'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api-fetch';

/* ── labels / colours ─────────────────────────────────────────── */

const TYPE_LABEL = { pe_rollup: 'PE Roll-up', ma: 'M&A', scaling: 'Scaling' };
const TYPE_COLOR = { pe_rollup: '#8b5cf6', ma: '#6366f1', scaling: '#0d9488' };
const ROLE_LABEL = {
  platform_company: 'Platform Co.',
  portfolio_company: 'Portfolio Co.',
  acquirer: 'Acquirer',
  target: 'Target',
  self: 'Company',
  owner: 'Owner',
  collaborator: 'Collaborator',
};

function TypeBadge({ type }) {
  return (
    <span className="deal-type-badge" style={{ background: (TYPE_COLOR[type] || '#64748b') + '22', color: TYPE_COLOR[type] || '#64748b' }}>
      {TYPE_LABEL[type] || type}
    </span>
  );
}

function formatCurrency(n) {
  if (typeof n !== 'number' || !isFinite(n)) return '-';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

/* ── New Deal Modal (unchanged) ──────────────────────────────── */

const BLANK_PARTICIPANT = { role: '', companyName: '', participantEmail: '', participantName: '' };
const VALID_ROLES_ALL = ['platform_company', 'portfolio_company', 'acquirer', 'target', 'self'];

function NewDealModal({ onClose, onCreated, accessToken }) {
  const [form, setForm] = useState({ type: 'pe_rollup', name: '', processName: '' });
  const [participants, setParticipants] = useState([
    { ...BLANK_PARTICIPANT, role: 'platform_company' },
    { ...BLANK_PARTICIPANT, role: 'portfolio_company' },
  ]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  const roleOptions = {
    pe_rollup: ['platform_company', 'portfolio_company'],
    ma: ['acquirer', 'target'],
    scaling: ['self'],
  };

  function handleTypeChange(type) {
    const defaults = {
      pe_rollup: ['platform_company', 'portfolio_company'],
      ma: ['acquirer', 'target'],
      scaling: ['self'],
    };
    setForm((f) => ({ ...f, type }));
    setParticipants(defaults[type].map((role) => ({ ...BLANK_PARTICIPANT, role })));
  }
  function updateParticipant(idx, field, value) { setParticipants((prev) => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p)); }
  function addParticipant() {
    const roles = roleOptions[form.type] || [];
    const defaultRole = form.type === 'pe_rollup' ? 'portfolio_company' : roles[0] || '';
    setParticipants((prev) => [...prev, { ...BLANK_PARTICIPANT, role: defaultRole }]);
  }
  function removeParticipant(idx) { setParticipants((prev) => prev.filter((_, i) => i !== idx)); }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) { setError('Deal name is required.'); return; }
    if (participants.some((p) => !p.companyName.trim())) { setError('Each participant needs a company name.'); return; }
    setCreating(true);
    try {
      const resp = await apiFetch('/api/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: form.type,
          name: form.name.trim(),
          processName: form.processName.trim() || undefined,
          participants: participants.map((p) => ({
            role: p.role,
            companyName: p.companyName.trim(),
            participantEmail: p.participantEmail.trim() || undefined,
            participantName: p.participantName.trim() || undefined,
          })),
        }),
      }, accessToken);
      const data = await resp.json();
      if (resp.ok && data.success) onCreated(data.deal);
      else setError(data.error || 'Failed to create deal.');
    } catch { setError('Network error. Please try again.'); }
    finally { setCreating(false); }
  }

  return (
    <div className="portal-modal-overlay" onClick={onClose}>
      <div className="portal-save-modal deal-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="portal-save-modal-title">New deal</h3>
        <form onSubmit={handleSubmit}>
          <div className="deal-modal-field">
            <label>Deal type</label>
            <div className="deal-type-choices">
              {[
                { key: 'pe_rollup', label: 'PE Roll-up', desc: 'Platform + portfolio companies mapping the same process' },
                { key: 'ma',        label: 'M&A',         desc: 'Acquirer and target mapping processes for integration' },
                { key: 'scaling',   label: 'Scaling',     desc: 'Single company scaling or optimising a process' },
              ].map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={`deal-type-choice ${form.type === t.key ? 'deal-type-choice--active' : ''}`}
                  style={form.type === t.key ? { borderColor: TYPE_COLOR[t.key], background: TYPE_COLOR[t.key] + '15' } : {}}
                  onClick={() => handleTypeChange(t.key)}
                >
                  <span className="deal-type-choice-label" style={form.type === t.key ? { color: TYPE_COLOR[t.key] } : {}}>{t.label}</span>
                  <span className="deal-type-choice-desc">{t.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="deal-modal-field">
            <label htmlFor="deal-name">Deal name *</label>
            <input id="deal-name" type="text" className="portal-save-name-input" placeholder="e.g. Q2 PE Benchmarking" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
          </div>

          <div className="deal-modal-field">
            <label htmlFor="deal-process">Process to map (optional)</label>
            <input id="deal-process" type="text" className="portal-save-name-input" placeholder="e.g. Invoice approval" value={form.processName} onChange={(e) => setForm((f) => ({ ...f, processName: e.target.value }))} />
          </div>

          <div className="deal-modal-field">
            <label>Participants</label>
            <div className="deal-participants-list">
              {participants.map((p, idx) => (
                <div key={idx} className="deal-participant-row">
                  <select className="deal-participant-role" value={p.role} onChange={(e) => updateParticipant(idx, 'role', e.target.value)}>
                    {(roleOptions[form.type] || VALID_ROLES_ALL).map((r) => (
                      <option key={r} value={r}>{ROLE_LABEL[r] || r}</option>
                    ))}
                  </select>
                  <input type="text" className="deal-participant-company" placeholder="Company name *" value={p.companyName} onChange={(e) => updateParticipant(idx, 'companyName', e.target.value)} required />
                  <input type="email" className="deal-participant-email" placeholder="Email (optional - gets invite link)" value={p.participantEmail} onChange={(e) => updateParticipant(idx, 'participantEmail', e.target.value)} />
                  {participants.length > 1 && (
                    <button type="button" className="deal-participant-remove" onClick={() => removeParticipant(idx)} title="Remove">×</button>
                  )}
                </div>
              ))}
            </div>
            {form.type === 'pe_rollup' && (
              <button type="button" className="deal-add-participant" onClick={addParticipant}>+ Add portfolio company</button>
            )}
          </div>

          {error && <p className="deal-modal-error">{error}</p>}

          <div className="portal-save-modal-actions">
            <button type="submit" className="portal-flow-btn portal-build-btn" disabled={creating}>{creating ? 'Creating…' : 'Create deal'}</button>
            <button type="button" className="portal-flow-btn compact" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Helpers ──────────────────────────────────────────────────── */

/** Return a human-readable status line that says who/what we're waiting on. */
function deriveDealStatusText(deal, detail) {
  if (!detail) {
    if (deal.status === 'complete') return 'All flows complete';
    if (deal.status === 'draft') return 'Draft - not yet shared';
    return 'Collecting flows';
  }
  const parts = detail.participants || [];
  const flows = detail.flows || [];
  if (!flows.length && parts.every((p) => p.status === 'invited')) {
    return 'No flows yet - invite companies or create a flow';
  }
  const pendingByCompany = parts.filter((p) => !flows.some((f) => f.participantId === p.id && f.status === 'complete'));
  if (pendingByCompany.length === 0) return 'All companies have at least one complete flow';
  if (pendingByCompany.length === 1) return `Awaiting: ${pendingByCompany[0].companyName}`;
  return `Awaiting ${pendingByCompany.length} companies`;
}

/* ── Company sub-card (inside expanded deal) ─────────────────── */

function FlowRow({ flow, canEdit, onOpen, onDelete }) {
  const statusLabel = flow.status === 'complete' ? 'Complete'
    : flow.status === 'in_progress' ? 'In progress'
    : flow.reportId ? 'Saved' : 'Not started';
  return (
    <div className="deal-flow-row">
      <div className="deal-flow-main">
        <span className={`deal-flow-dot deal-flow-dot--${flow.status}`} />
        <span className="deal-flow-label">{flow.label}</span>
        {flow.flowKind && <span className="deal-flow-kind">{flow.flowKind}</span>}
        <span className="deal-flow-status">{statusLabel}</span>
        {flow.report?.totalAnnualCost != null && (
          <span className="deal-flow-cost">{formatCurrency(flow.report.totalAnnualCost)}</span>
        )}
      </div>
      <div className="deal-flow-actions">
        <button type="button" className="deal-table-link" onClick={onOpen}>
          {flow.reportId ? 'Open' : 'Start mapping'}
        </button>
        {canEdit && (
          <button type="button" className="deal-flow-delete" onClick={onDelete} title="Remove flow slot">×</button>
        )}
      </div>
    </div>
  );
}

function CompanyBlock({ participant, flows, canEdit, dealId, onCreateFlow, onOpenFlow, onDeleteFlow, onCopyInvite, onDeleteParticipant }) {
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newKind, setNewKind] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!newLabel.trim()) return;
    setSaving(true);
    await onCreateFlow({ participantId: participant.id, label: newLabel.trim(), flowKind: newKind.trim() || undefined });
    setSaving(false);
    setNewLabel('');
    setNewKind('');
    setAdding(false);
  }

  return (
    <div className="deal-company-block">
      <div className="deal-company-block-header">
        <div className="deal-company-block-name">
          <span className="deal-company-role-chip">{ROLE_LABEL[participant.role] || participant.role}</span>
          <span className="deal-company-block-title">{participant.companyName}</span>
          {participant.participantEmail && canEdit && (
            <span className="deal-company-block-email">{participant.participantEmail}</span>
          )}
        </div>
        <div className="deal-company-block-actions">
          {canEdit && participant.inviteUrl && (
            <button type="button" className="deal-table-link" onClick={() => onCopyInvite(participant.inviteUrl)}>
              Copy invite link
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              className="deal-company-delete"
              onClick={() => onDeleteParticipant(participant)}
              title="Remove company from deal"
            >
              Remove company
            </button>
          )}
        </div>
      </div>

      {flows.length === 0 ? (
        <p className="deal-company-empty">No flows yet for this company.</p>
      ) : (
        <div className="deal-flow-list">
          {flows.map((f) => (
            <FlowRow
              key={f.id}
              flow={f}
              canEdit={canEdit}
              onOpen={() => onOpenFlow(f)}
              onDelete={() => onDeleteFlow(f)}
            />
          ))}
        </div>
      )}

      {canEdit && (
        adding ? (
          <div className="deal-flow-new">
            <input
              type="text"
              className="deal-participant-company"
              placeholder="Flow name * (e.g. AP Process)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              autoFocus
            />
            <input
              type="text"
              className="deal-participant-company"
              placeholder="Kind (optional - e.g. accounts_payable)"
              value={newKind}
              onChange={(e) => setNewKind(e.target.value)}
            />
            <button type="button" className="portal-flow-btn compact" onClick={handleCreate} disabled={saving || !newLabel.trim()}>
              {saving ? 'Creating…' : 'Create'}
            </button>
            <button type="button" className="portal-flow-btn compact" onClick={() => { setAdding(false); setNewLabel(''); setNewKind(''); }}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="deal-add-participant" onClick={() => setAdding(true)}>
            + Add flow for this company
          </button>
        )
      )}
    </div>
  );
}

/* ── Collaborators section ────────────────────────────────────── */

function CollaboratorsSection({ dealId, collaboratorEmails, accessToken, onChanged, flashToast }) {
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const list = Array.isArray(collaboratorEmails) ? collaboratorEmails : [];

  async function handleAdd() {
    const clean = email.trim().toLowerCase();
    if (!clean) return;
    setBusy(true);
    try {
      const resp = await apiFetch(`/api/deals/${encodeURIComponent(dealId)}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: [clean] }),
      }, accessToken);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to add collaborator.');
      setEmail('');
      setAdding(false);
      flashToast(`Added ${clean}`);
      onChanged();
    } catch (err) {
      flashToast(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(target) {
    if (!confirm(`Remove ${target} from this deal?`)) return;
    setBusy(true);
    try {
      const resp = await apiFetch(
        `/api/deals/${encodeURIComponent(dealId)}/collaborators?email=${encodeURIComponent(target)}`,
        { method: 'DELETE' },
        accessToken
      );
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to remove collaborator.');
      flashToast(`Removed ${target}`);
      onChanged();
    } catch (err) {
      flashToast(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="deal-collaborators">
      <div className="deal-collaborators-header">
        <h4 className="deal-collaborators-title">Collaborators</h4>
        <span className="deal-collaborators-hint">Owners only. Collaborators can edit flows and run analyses.</span>
      </div>
      {list.length === 0 ? (
        <p className="deal-collaborators-empty">No collaborators yet.</p>
      ) : (
        <ul className="deal-collaborators-list">
          {list.map((e) => (
            <li key={e} className="deal-collaborators-item">
              <span className="deal-collaborators-email">{e}</span>
              <button
                type="button"
                className="deal-collaborators-remove"
                onClick={() => handleRemove(e)}
                disabled={busy}
                title="Remove collaborator"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <div className="deal-collaborators-add-row">
          <input
            type="email"
            className="deal-participant-email"
            placeholder="collaborator@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            disabled={busy}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
          />
          <button type="button" className="portal-flow-btn compact" onClick={handleAdd} disabled={busy || !email.trim()}>
            {busy ? 'Adding…' : 'Add'}
          </button>
          <button type="button" className="portal-flow-btn compact" onClick={() => { setAdding(false); setEmail(''); }} disabled={busy}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className="deal-add-participant" onClick={() => setAdding(true)}>
          + Add collaborator
        </button>
      )}
    </div>
  );
}

/* ── Expanded deal detail ─────────────────────────────────────── */

function ExpandedDeal({ deal, detail, detailLoading, detailError, canEdit, canDelete, canManage, accessToken, flashToast, onReloadDetail, onCreateFlow, onDeleteFlow, onOpenFlow, onCopyInvite, onGoToDealPage, onDeleteParticipant, onDeleteDeal }) {
  if (detailLoading) {
    return <div className="deal-expanded-body"><div className="portal-loading"><div className="spinner" /><p>Loading companies…</p></div></div>;
  }
  if (detailError) {
    return (
      <div className="deal-expanded-body">
        <p className="deal-modal-error">{detailError}</p>
        <button type="button" className="portal-flow-btn compact" onClick={onReloadDetail}>Retry</button>
      </div>
    );
  }
  if (!detail) return null;

  const flowsByParticipant = {};
  for (const f of (detail.flows || [])) {
    if (!flowsByParticipant[f.participantId]) flowsByParticipant[f.participantId] = [];
    flowsByParticipant[f.participantId].push(f);
  }

  return (
    <div className="deal-expanded-body">
      {detail.participants.length === 0 ? (
        <p className="deal-pending-note">No companies yet. Open the deal page to invite participants.</p>
      ) : (
        <div className="deal-companies">
          {detail.participants.map((p) => (
            <CompanyBlock
              key={p.id}
              participant={p}
              flows={flowsByParticipant[p.id] || []}
              canEdit={canEdit}
              dealId={deal.id}
              onCreateFlow={onCreateFlow}
              onOpenFlow={onOpenFlow}
              onDeleteFlow={onDeleteFlow}
              onCopyInvite={onCopyInvite}
              onDeleteParticipant={onDeleteParticipant}
            />
          ))}
        </div>
      )}
      {canManage && (
        <CollaboratorsSection
          dealId={deal.id}
          collaboratorEmails={detail.deal?.collaboratorEmails || []}
          accessToken={accessToken}
          onChanged={onReloadDetail}
          flashToast={flashToast}
        />
      )}
      <div className="deal-expanded-footer">
        <button type="button" className="portal-flow-btn compact" onClick={onGoToDealPage}>Open deal page →</button>
        {canDelete && (
          <button type="button" className="deal-delete-btn" onClick={onDeleteDeal}>
            Delete deal
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────── */

export default function DealsPanel({ deals, loading, onRefresh, accessToken }) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [detailByDeal, setDetailByDeal] = useState({});   // { [dealId]: { participants, flows, deal } }
  const [detailLoading, setDetailLoading] = useState({}); // { [dealId]: bool }
  const [detailError, setDetailError] = useState({});     // { [dealId]: string }
  const [toast, setToast] = useState(null);

  const flashToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2400); };

  const handleCreated = (deal) => {
    setCreateOpen(false);
    onRefresh();
    router.push(`/deals/${deal.id}`);
  };

  const loadDetail = useCallback(async (dealId) => {
    setDetailLoading((s) => ({ ...s, [dealId]: true }));
    setDetailError((s) => ({ ...s, [dealId]: null }));
    try {
      const resp = await apiFetch(`/api/deals/${encodeURIComponent(dealId)}`, { method: 'GET' }, accessToken);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to load deal.');
      setDetailByDeal((s) => ({ ...s, [dealId]: data }));
    } catch (err) {
      setDetailError((s) => ({ ...s, [dealId]: err.message || 'Failed to load deal.' }));
    } finally {
      setDetailLoading((s) => ({ ...s, [dealId]: false }));
    }
  }, [accessToken]);

  const toggleExpanded = (dealId) => {
    if (expandedId === dealId) { setExpandedId(null); return; }
    setExpandedId(dealId);
    loadDetail(dealId);
  };

  useEffect(() => {
    if (!expandedId) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') loadDetail(expandedId);
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [expandedId, loadDetail]);

  const handleCreateFlow = useCallback(async (dealId, { participantId, label, flowKind }) => {
    try {
      const resp = await apiFetch(`/api/deals/${encodeURIComponent(dealId)}/flows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId, label, flowKind }),
      }, accessToken);
      const data = await resp.json();
      if (!resp.ok || !data.success) throw new Error(data.error || 'Failed to create flow.');
      await loadDetail(dealId);
      // Send user straight to the new flow
      router.push(data.startUrl);
    } catch (err) {
      flashToast(err.message);
    }
  }, [accessToken, router, loadDetail]);

  const handleDeleteFlow = useCallback(async (dealId, flow) => {
    if (!confirm(`Remove flow "${flow.label}"? The saved artefact stays but will be unlinked.`)) return;
    try {
      const resp = await apiFetch(`/api/deals/${encodeURIComponent(dealId)}/flows/${encodeURIComponent(flow.id)}`, { method: 'DELETE' }, accessToken);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to delete flow.');
      await loadDetail(dealId);
    } catch (err) {
      flashToast(err.message);
    }
  }, [accessToken, loadDetail]);

  const handleOpenFlow = (flow) => {
    // If the flow has a saved report, resume in process-audit. Otherwise start fresh.
    const url = flow.openUrl || flow.startUrl || (flow.reportId ? `/report?id=${flow.reportId}` : null);
    if (url) router.push(url);
  };

  const handleDeleteParticipant = useCallback(async (dealId, participant) => {
    const flowCount = (detailByDeal[dealId]?.flows || []).filter((f) => f.participantId === participant.id).length;
    const msg = flowCount > 0
      ? `Remove "${participant.companyName}" from this deal? ${flowCount} flow${flowCount === 1 ? '' : 's'} will be deleted. Saved reports are kept but unlinked.`
      : `Remove "${participant.companyName}" from this deal?`;
    if (!confirm(msg)) return;
    try {
      const resp = await apiFetch(
        `/api/deals/${encodeURIComponent(dealId)}/participants/${encodeURIComponent(participant.id)}`,
        { method: 'DELETE' },
        accessToken
      );
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to remove company.');
      await loadDetail(dealId);
      flashToast(`${participant.companyName} removed`);
    } catch (err) {
      flashToast(err.message);
    }
  }, [accessToken, detailByDeal, loadDetail]);

  const handleDeleteDeal = useCallback(async (deal) => {
    if (!confirm(`Delete "${deal.name}"? This removes all companies, flows, and analyses. Saved reports are kept but unlinked.`)) return;
    try {
      const resp = await apiFetch(`/api/deals/${encodeURIComponent(deal.id)}`, { method: 'DELETE' }, accessToken);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to delete deal.');
      setExpandedId(null);
      setDetailByDeal((s) => { const n = { ...s }; delete n[deal.id]; return n; });
      onRefresh();
      flashToast(`${deal.name} deleted`);
    } catch (err) {
      flashToast(err.message);
    }
  }, [accessToken, onRefresh]);

  const handleCopyInvite = async (url) => {
    try { await navigator.clipboard.writeText(url); flashToast('Invite link copied'); }
    catch { flashToast('Copy failed - select the URL manually'); }
  };

  const dealList = deals || [];

  if (loading) {
    return (
      <div className="dash-card portal-content-card">
        <div className="portal-loading"><div className="spinner" /><p>Loading deals…</p></div>
      </div>
    );
  }

  return (
    <div className="dash-card portal-content-card">
      <div className="portal-content-header">
        <h2 className="portal-content-title">Deals</h2>
        <button type="button" className="dash-card-action" onClick={() => setCreateOpen(true)}>+ New Deal</button>
      </div>

      <p className="deal-panel-hint">
        A deal groups process flows across the companies involved (platform + portfolio, acquirer + target, etc).
        Each company can have one or more flows. The owner and collaborators can create flows on any company's behalf.
      </p>

      {dealList.length === 0 ? (
        <div className="portal-empty">
          <p>No deals yet.</p>
          <button type="button" className="portal-empty-cta" onClick={() => setCreateOpen(true)}>Create your first deal →</button>
        </div>
      ) : (
        <div className="deal-list">
          {dealList.map((d) => {
            const expanded = expandedId === d.id;
            const detail = detailByDeal[d.id] || null;
            const statusText = deriveDealStatusText(d, detail);
            const canEdit = detail?.deal ? !!detail.deal.canEdit : (d.accessMode === 'owner' || d.accessMode === 'collaborator');
            const participantCount = detail?.participants?.length ?? null;
            const flowCount = detail?.flows?.length ?? null;
            return (
              <div key={d.id} className={`deal-card deal-card--expandable${expanded ? ' deal-card--expanded' : ''}`}>
                <div
                  className="deal-card-header"
                  onClick={() => toggleExpanded(d.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpanded(d.id); } }}
                >
                  <div className="deal-card-left">
                    <span className={`deal-chevron${expanded ? ' deal-chevron--open' : ''}`}>▸</span>
                    <TypeBadge type={d.type} />
                    <span className="deal-card-name">{d.name}</span>
                    {d.process_name && <span className="deal-card-process">{d.process_name}</span>}
                  </div>
                  <div className="deal-card-right">
                    {d.accessMode && d.accessMode !== 'owner' && (
                      <span className="deal-card-role">{ROLE_LABEL[d.accessMode] || d.accessMode}</span>
                    )}
                    {participantCount !== null && (
                      <span className="deal-card-counts">
                        {participantCount} {participantCount === 1 ? 'company' : 'companies'}
                        {flowCount !== null ? ` · ${flowCount} ${flowCount === 1 ? 'flow' : 'flows'}` : ''}
                      </span>
                    )}
                    <span className={`deal-status-pill deal-status-pill--${d.status}`}>{statusText}</span>
                  </div>
                </div>

                {expanded && (
                  <ExpandedDeal
                    deal={d}
                    detail={detail}
                    detailLoading={!!detailLoading[d.id]}
                    detailError={detailError[d.id] || null}
                    canEdit={canEdit}
                    canDelete={detail?.deal ? !!detail.deal.canDelete : (d.accessMode === 'owner')}
                    canManage={detail?.deal ? !!detail.deal.isOwner : (d.accessMode === 'owner')}
                    accessToken={accessToken}
                    flashToast={flashToast}
                    onReloadDetail={() => loadDetail(d.id)}
                    onCreateFlow={(args) => handleCreateFlow(d.id, args)}
                    onDeleteFlow={(flow) => handleDeleteFlow(d.id, flow)}
                    onOpenFlow={handleOpenFlow}
                    onCopyInvite={handleCopyInvite}
                    onGoToDealPage={() => router.push(`/deals/${d.id}`)}
                    onDeleteParticipant={(p) => handleDeleteParticipant(d.id, p)}
                    onDeleteDeal={() => handleDeleteDeal(d)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {toast && <div className="deal-toast">{toast}</div>}

      {createOpen && (
        <NewDealModal
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
          accessToken={accessToken}
        />
      )}
    </div>
  );
}
