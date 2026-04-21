'use client';

import { useState } from 'react';
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
  self: 'Self',
  owner: 'Owner',
};

function TypeBadge({ type }) {
  return (
    <span className="deal-type-badge" style={{ background: (TYPE_COLOR[type] || '#64748b') + '22', color: TYPE_COLOR[type] || '#64748b' }}>
      {TYPE_LABEL[type] || type}
    </span>
  );
}

/* ── New Deal Modal ───────────────────────────────────────────── */

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
    const defaultRoles = {
      pe_rollup: ['platform_company', 'portfolio_company'],
      ma: ['acquirer', 'target'],
      scaling: ['self'],
    };
    setForm((f) => ({ ...f, type }));
    setParticipants(defaultRoles[type].map((role) => ({ ...BLANK_PARTICIPANT, role })));
  }

  function updateParticipant(idx, field, value) {
    setParticipants((prev) => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  }

  function addParticipant() {
    const roles = roleOptions[form.type] || [];
    const defaultRole = form.type === 'pe_rollup' ? 'portfolio_company' : roles[0] || '';
    setParticipants((prev) => [...prev, { ...BLANK_PARTICIPANT, role: defaultRole }]);
  }

  function removeParticipant(idx) {
    setParticipants((prev) => prev.filter((_, i) => i !== idx));
  }

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
      if (resp.ok && data.success) {
        onCreated(data.deal);
      } else {
        setError(data.error || 'Failed to create deal.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setCreating(false);
    }
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
                { key: 'ma', label: 'M&A',      desc: 'Acquirer and target mapping processes for integration' },
                { key: 'scaling', label: 'Scaling',   desc: 'Single company scaling or optimising a process' },
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
                  <select
                    className="deal-participant-role"
                    value={p.role}
                    onChange={(e) => updateParticipant(idx, 'role', e.target.value)}
                  >
                    {(roleOptions[form.type] || VALID_ROLES_ALL).map((r) => (
                      <option key={r} value={r}>{ROLE_LABEL[r] || r}</option>
                    ))}
                  </select>
                  <input type="text" className="deal-participant-company" placeholder="Company name *" value={p.companyName} onChange={(e) => updateParticipant(idx, 'companyName', e.target.value)} required />
                  <input type="email" className="deal-participant-email" placeholder="Email (optional)" value={p.participantEmail} onChange={(e) => updateParticipant(idx, 'participantEmail', e.target.value)} />
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
            <button type="submit" className="portal-flow-btn portal-build-btn" disabled={creating}>
              {creating ? 'Creating…' : 'Create deal'}
            </button>
            <button type="button" className="portal-flow-btn compact" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Main component ───────────────────────────────────────────── */

export default function DealsPanel({ deals, loading, onRefresh, accessToken }) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);

  const handleCreated = (deal) => {
    setCreateOpen(false);
    onRefresh();
    router.push(`/deals/${deal.id}`);
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

      {dealList.length === 0 ? (
        <div className="portal-empty">
          <p>No deals yet.</p>
          <button type="button" className="portal-empty-cta" onClick={() => setCreateOpen(true)}>Create your first deal →</button>
        </div>
      ) : (
        <div className="deal-list">
          {dealList.map((d) => (
            <div
              key={d.id}
              className="deal-card"
              onClick={() => router.push(`/deals/${d.id}`)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && router.push(`/deals/${d.id}`)}
            >
              <div className="deal-card-left">
                <TypeBadge type={d.type} />
                <span className="deal-card-name">{d.name}</span>
                {d.process_name && <span className="deal-card-process">{d.process_name}</span>}
              </div>
              <div className="deal-card-right">
                {d.ownerRole && d.ownerRole !== 'owner' && (
                  <span className="deal-card-role">{ROLE_LABEL[d.ownerRole] || d.ownerRole}</span>
                )}
                <span className={`deal-status-pill deal-status-pill--${d.status}`}>
                  {d.status === 'collecting' ? 'Collecting' : d.status === 'complete' ? 'Complete' : 'Draft'}
                </span>
                <span className="deal-card-arrow">›</span>
              </div>
            </div>
          ))}
        </div>
      )}

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
