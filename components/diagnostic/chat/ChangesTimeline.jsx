'use client';

/**
 * Reusable Changes timeline — works for both deals and reports.
 *
 * Pass exactly one of `dealId` or `reportId`. The component picks the
 * matching endpoint family:
 *
 *   { dealId   } → /api/deals/[id]/changes(/[changeId](/outcomes))
 *   { reportId } → /api/diagnostic-changes/[reportId](/[changeId](/outcomes))
 *
 * Lazy-loaded on first expand. Editor-only state controls + outcome entry
 * form; viewers see the same feed read-only.
 *
 * Optional `focusChangeId` prop scrolls + pulses the matching row on mount
 * (auto-expanding the section if collapsed). Mirrors the existing
 * `focusFinding=` deep-link UX pattern.
 */

import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { apiFetch } from '@/lib/api-fetch';

const STATE_META = {
  proposed: { label: 'Proposed', cls: 'proposed' },
  accepted: { label: 'Accepted', cls: 'accepted' },
  applied:  { label: 'Applied',  cls: 'applied'  },
  live:     { label: 'Live',     cls: 'live'     },
  measured: { label: 'Measured', cls: 'measured' },
  reverted: { label: 'Reverted', cls: 'reverted' },
  rejected: { label: 'Rejected', cls: 'rejected' },
};

const KIND_LABEL = {
  added: 'added', removed: 'removed', modified: 'updated',
  merged: 'merged', reordered: 'reordered',
  automated: 'automated', reverted: 'reverted',
};

const SUBJECT_LABEL = {
  process: 'process', process_step: 'step', handoff: 'handoff',
  cost_input: 'cost input', redesign: 'redesign / analysis',
  deal_finding: 'finding', participant: 'participant', document: 'document',
};

const FILTERS = ['all', 'open', 'applied', 'live', 'measured', 'reverted'];

// Recommended outcome metric vocabulary. Free-form on the server, but
// suggesting these keeps cross-deal aggregates sensible. KEEP IN SYNC with
// lib/changes/repo.js header comment.
const METRIC_SUGGESTIONS = [
  { metric: 'cycle_time_minutes', unit: 'minutes' },
  { metric: 'work_minutes',       unit: 'minutes' },
  { metric: 'cost_per_run',       unit: 'usd' },
  { metric: 'annual_cost',        unit: 'usd' },
  { metric: 'automation_pct',     unit: 'pct' },
  { metric: 'error_rate_pct',     unit: 'pct' },
  { metric: 'fte',                unit: 'count' },
];

const OUTCOME_SOURCES = [
  { value: 'manual',           label: 'Manual entry' },
  { value: 'process_instance', label: 'Live process instance' },
  { value: 'report_rerun',     label: 'Report re-run' },
  { value: 'inferred_from_doc', label: 'Inferred from doc' },
];

function fmtRelative(d) {
  if (!d) return '';
  const ms = Date.now() - new Date(d).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  if (ms < 30 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d ago`;
  try { return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); }
  catch { return ''; }
}

function summariseSubject(c) {
  const ref = c.subject_ref || {};
  if (c.subject_type === 'process_step') {
    return ref.stepName ? `step "${ref.stepName}"` : 'a step';
  }
  if (c.subject_type === 'deal_finding') {
    return ref.finding_key ? `finding ${String(ref.finding_key).slice(0, 12)}` : 'a finding';
  }
  if (c.subject_type === 'participant') {
    return ref.companyName || ref.company_name
      ? `participant "${ref.companyName || ref.company_name}"`
      : 'a participant';
  }
  if (c.subject_type === 'document') {
    return ref.filename ? `document "${ref.filename}"` : 'a document';
  }
  if (c.subject_type === 'redesign') {
    return ref.mode ? `${ref.mode} analysis` : (ref.scope ? `${String(ref.scope).replace(/_/g, ' ')} report` : 'a redesign');
  }
  return SUBJECT_LABEL[c.subject_type] || 'an item';
}

function summariseImpact(c) {
  const i = c.expected_impact || {};
  const parts = [];
  if (i.time_minutes != null) parts.push(`~${Math.round(i.time_minutes)}m saved`);
  if (i.cost_pct != null)     parts.push(`${Math.round(i.cost_pct)}% cost`);
  if (i.fte != null)          parts.push(`${i.fte} FTE`);
  return parts.join(' · ');
}

function summariseOutcomes(outcomes) {
  if (!Array.isArray(outcomes) || !outcomes.length) return null;
  const latest = outcomes[0];
  const delta = latest.delta;
  if (delta == null) return `${outcomes.length} measurement${outcomes.length === 1 ? '' : 's'}`;
  const sign = delta >= 0 ? '+' : '';
  return `${latest.metric} ${sign}${delta}${latest.unit ? ' ' + latest.unit : ''}`;
}

/**
 * Resolve the endpoint family for a scope. Returns helpers because callers
 * need three URLs per change (PATCH state, POST outcome). Centralising means
 * the deal/report split lives in exactly one place.
 */
function buildEndpoints({ dealId, reportId }) {
  if (dealId) {
    return {
      list:    `/api/deals/${dealId}/changes`,
      patch:   (cid) => `/api/deals/${dealId}/changes/${cid}`,
      outcome: (cid) => `/api/deals/${dealId}/changes/${cid}/outcomes`,
    };
  }
  if (reportId) {
    const enc = encodeURIComponent(reportId);
    return {
      list:    `/api/diagnostic-changes/${enc}`,
      patch:   (cid) => `/api/diagnostic-changes/${enc}/${cid}`,
      outcome: (cid) => `/api/diagnostic-changes/${enc}/${cid}/outcomes`,
    };
  }
  return null;
}

export default function ChangesTimeline({
  dealId, reportId,
  accessToken, canEdit,
  focusChangeId = null,
  defaultOpen = false,
  title = 'Changes',
  pollIntervalMs = 0,
}) {
  const endpoints = useMemo(() => buildEndpoints({ dealId, reportId }), [dealId, reportId]);

  const [open, setOpen] = useState(defaultOpen || Boolean(focusChangeId));
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all');
  const [busyById, setBusyById] = useState({});
  const [outcomeOpenId, setOutcomeOpenId] = useState(null);
  const [pulseId, setPulseId] = useState(null);
  // Live-polling state. Default ON when pollIntervalMs > 0; toggleable
  // via the header button so a long-form review session isn't disrupted.
  const [pollEnabled, setPollEnabled] = useState(pollIntervalMs > 0);
  // Set of change ids that landed via a poll-refresh after the initial
  // load — pulse them briefly so the user notices new rows.
  const [newRowIds, setNewRowIds] = useState(new Set());
  const seenIdsRef = useRef(new Set());
  const rowRefs = useRef({});

  const load = useCallback(async ({ background = false } = {}) => {
    if (!endpoints) return;
    if (!background) setLoading(true);
    try {
      const r = await apiFetch(`${endpoints.list}?limit=200`, {}, accessToken);
      const j = r.ok ? await r.json() : null;
      if (j?.changes) {
        // First load seeds the seen-set silently; subsequent loads diff
        // against it so genuinely-new rows can pulse to draw the eye.
        const incoming = j.changes;
        if (seenIdsRef.current.size === 0 && !background) {
          for (const c of incoming) seenIdsRef.current.add(c.id);
        } else {
          const fresh = new Set();
          for (const c of incoming) {
            if (!seenIdsRef.current.has(c.id)) {
              fresh.add(c.id);
              seenIdsRef.current.add(c.id);
            }
          }
          if (fresh.size > 0) {
            setNewRowIds((prev) => new Set([...prev, ...fresh]));
            // Clear the new-row highlight after the pulse animation finishes.
            setTimeout(() => {
              setNewRowIds((prev) => {
                const next = new Set(prev);
                for (const id of fresh) next.delete(id);
                return next;
              });
            }, 2600);
          }
        }
        setItems(incoming);
      }
    } finally { if (!background) setLoading(false); }
  }, [endpoints, accessToken]);

  useEffect(() => { if (open && items === null) load(); }, [open, items, load]);

  // Live polling. Only fires when the panel is open + pollEnabled, so the
  // collapsed state never costs anything. Pause on hidden tab so we don't
  // burn requests for nothing.
  useEffect(() => {
    if (!open || !pollEnabled || !pollIntervalMs || pollIntervalMs < 1000) return;
    let timer = null;
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      load({ background: true });
    };
    timer = setInterval(tick, pollIntervalMs);
    return () => { if (timer) clearInterval(timer); };
  }, [open, pollEnabled, pollIntervalMs, load]);

  // focusChange deep-link: scroll + pulse the matching row once items load.
  // Mirrors the focusFinding pattern used for deal findings.
  useEffect(() => {
    if (!focusChangeId || !items) return;
    const el = rowRefs.current[focusChangeId];
    if (!el) return;
    const t = setTimeout(() => {
      try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
      setPulseId(focusChangeId);
      setTimeout(() => setPulseId(null), 2400);
    }, 120);
    return () => clearTimeout(t);
  }, [focusChangeId, items]);

  const filtered = useMemo(() => {
    if (!items) return [];
    if (filter === 'all') return items;
    if (filter === 'open') return items.filter((c) => c.state === 'proposed' || c.state === 'accepted');
    return items.filter((c) => c.state === filter);
  }, [items, filter]);

  const counts = useMemo(() => {
    const c = { all: items?.length || 0, open: 0, applied: 0, live: 0, measured: 0, reverted: 0 };
    for (const it of items || []) {
      if (it.state === 'proposed' || it.state === 'accepted') c.open += 1;
      else if (c[it.state] != null) c[it.state] += 1;
    }
    return c;
  }, [items]);

  const transition = useCallback(async (change, toState) => {
    if (!canEdit || !endpoints) return;
    setBusyById((s) => ({ ...s, [change.id]: true }));
    try {
      const r = await apiFetch(
        endpoints.patch(change.id),
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: toState }),
        },
        accessToken,
      );
      if (r.ok) {
        const now = new Date().toISOString();
        setItems((rows) => (rows || []).map((c) => c.id === change.id ? {
          ...c,
          state: toState,
          ...(toState === 'live'     && { live_at:     now }),
          ...(toState === 'reverted' && { reverted_at: now }),
          ...(toState === 'applied'  && { applied_at:  now }),
        } : c));
      }
    } finally {
      setBusyById((s) => { const n = { ...s }; delete n[change.id]; return n; });
    }
  }, [canEdit, endpoints, accessToken]);

  const submitOutcome = useCallback(async (changeId, payload) => {
    if (!canEdit || !endpoints) return false;
    setBusyById((s) => ({ ...s, [changeId]: true }));
    try {
      const r = await apiFetch(
        endpoints.outcome(changeId),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        accessToken,
      );
      if (!r.ok) return false;
      const j = await r.json().catch(() => null);
      if (j?.outcome) {
        // Splice the new outcome in front of the existing list AND flip the
        // row's state to 'measured' to match what the server did via
        // recordOutcome's opportunistic transition.
        setItems((rows) => (rows || []).map((c) => c.id === changeId ? {
          ...c,
          state: 'measured',
          measured_at: new Date().toISOString(),
          change_outcomes: [j.outcome, ...(c.change_outcomes || [])],
        } : c));
      }
      return true;
    } finally {
      setBusyById((s) => { const n = { ...s }; delete n[changeId]; return n; });
    }
  }, [canEdit, endpoints, accessToken]);

  if (!endpoints) return null;

  return (
    <section className="deal-workspace-section deal-changes">
      <h3 className="deal-workspace-section-title">
        <button
          type="button"
          className="deal-activity-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        ><span aria-hidden>{open ? '−' : '+'}</span> {title}</button>
        <span className="deal-workspace-section-sub">
          {items ? `${counts.open} open · ${counts.applied + counts.live + counts.measured} landed` : ''}
        </span>
        {open && pollIntervalMs > 0 && (
          <button
            type="button"
            className={`deal-activity-filter ws-changes-live${pollEnabled ? ' ws-changes-live--on' : ''}`}
            onClick={() => setPollEnabled((v) => !v)}
            title={pollEnabled
              ? `Auto-refreshing every ${Math.round(pollIntervalMs / 1000)}s — click to pause`
              : 'Live updates paused — click to resume'}
          >{pollEnabled ? '● Live' : '○ Paused'}</button>
        )}
      </h3>

      {open && (
        <>
          <div className="deal-activity-filters">
            {FILTERS.map((k) => (
              <button
                key={k}
                type="button"
                className={`deal-activity-filter${filter === k ? ' active' : ''}`}
                onClick={() => setFilter(k)}
              >{k}{counts[k] != null ? ` (${counts[k]})` : ''}</button>
            ))}
            <button type="button" className="deal-activity-filter" onClick={load} disabled={loading}>
              {loading ? '↻ Loading…' : '↻ Refresh'}
            </button>
          </div>

          {loading && <div className="deal-workspace-empty">Loading…</div>}
          {!loading && items && filtered.length === 0 && (
            <div className="deal-workspace-empty">
              {items.length === 0
                ? 'No changes recorded yet. Proposals from Reina and accepted redesigns appear here.'
                : 'No changes match this filter.'}
            </div>
          )}

          {!loading && filtered.length > 0 && (
            <ul className="deal-changes-list">
              {filtered.map((c) => {
                const meta = STATE_META[c.state] || { label: c.state, cls: c.state };
                const subject = summariseSubject(c);
                const verb = KIND_LABEL[c.kind] || c.kind;
                const impact = summariseImpact(c);
                const outcomeSummary = summariseOutcomes(c.change_outcomes);
                const busy = !!busyById[c.id];
                const outcomeFormOpen = outcomeOpenId === c.id;
                const pulsing = pulseId === c.id || newRowIds.has(c.id);

                return (
                  <li
                    key={c.id}
                    ref={(el) => { if (el) rowRefs.current[c.id] = el; }}
                    className={`deal-change-row deal-change-row--${meta.cls}${pulsing ? ' deal-change-row--pulse' : ''}${newRowIds.has(c.id) ? ' deal-change-row--new' : ''}`}
                  >
                    <div className="deal-change-row-head">
                      <span className={`deal-change-state deal-change-state--${meta.cls}`}>{meta.label}</span>
                      <span className="deal-change-summary">
                        {c.agent_name === 'redesign' ? 'Redesign' : c.agent_name === 'chat' ? 'Reina' : (c.actor_email || 'system')}
                        {' '}{verb}{' '}{subject}
                      </span>
                      <span className="deal-change-when">{fmtRelative(c.proposed_at || c.created_at)}</span>
                    </div>

                    {c.rationale && (
                      <div className="deal-change-rationale">{c.rationale}</div>
                    )}

                    <div className="deal-change-meta">
                      {c.principle && <span className="deal-change-tag">{c.principle}</span>}
                      {impact && <span className="deal-change-tag deal-change-tag--impact">{impact}</span>}
                      {outcomeSummary && <span className="deal-change-tag deal-change-tag--outcome">{outcomeSummary}</span>}
                      {Number.isFinite(c.confidence) && (
                        <span className="deal-change-tag">{Math.round(c.confidence * 100)}% conf</span>
                      )}
                    </div>

                    {canEdit && (
                      <div className="deal-change-actions">
                        {(c.state === 'applied') && (
                          <button
                            type="button"
                            className="deal-change-action"
                            onClick={() => transition(c, 'live')}
                            disabled={busy}
                            title="Mark this change as live in production. Use when the team has actually rolled it out."
                          >Mark live</button>
                        )}
                        {(c.state === 'applied' || c.state === 'live') && (
                          <button
                            type="button"
                            className="deal-change-action deal-change-action--danger"
                            onClick={() => transition(c, 'reverted')}
                            disabled={busy}
                            title="Mark as reverted — the change was rolled back."
                          >Mark reverted</button>
                        )}
                        {(c.state === 'applied' || c.state === 'live' || c.state === 'measured') && (
                          <button
                            type="button"
                            className="deal-change-action"
                            onClick={() => setOutcomeOpenId((cur) => cur === c.id ? null : c.id)}
                            disabled={busy}
                          >{outcomeFormOpen ? '× Cancel' : '+ Outcome'}</button>
                        )}
                      </div>
                    )}

                    {outcomeFormOpen && canEdit && (
                      <OutcomeForm
                        changeId={c.id}
                        existingOutcomes={c.change_outcomes || []}
                        busy={busy}
                        onSubmit={async (payload) => {
                          const ok = await submitOutcome(c.id, payload);
                          if (ok) setOutcomeOpenId(null);
                          return ok;
                        }}
                      />
                    )}

                    {(c.change_outcomes?.length || 0) > 1 && (
                      <details className="deal-change-outcomes-history">
                        <summary>{c.change_outcomes.length} measurements</summary>
                        <ul>
                          {c.change_outcomes.map((o) => (
                            <li key={o.id}>
                              <span className="deal-change-outcome-metric">{o.metric}</span>
                              {' '}
                              {o.value_before != null ? `${o.value_before} → ` : ''}{o.value_after != null ? o.value_after : ''}
                              {o.unit ? ` ${o.unit}` : ''}
                              {' · '}
                              <span className="deal-change-outcome-meta">{o.source} · {fmtRelative(o.measured_at)}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function OutcomeForm({ changeId, existingOutcomes, busy, onSubmit }) {
  const [metric, setMetric]   = useState(existingOutcomes[0]?.metric || 'cycle_time_minutes');
  const [unit, setUnit]       = useState(existingOutcomes[0]?.unit   || 'minutes');
  const [before, setBefore]   = useState('');
  const [after, setAfter]     = useState('');
  const [source, setSource]   = useState('manual');
  const [notes, setNotes]     = useState('');
  const [error, setError]     = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!metric.trim()) { setError('Metric required.'); return; }
    const payload = {
      metric: metric.trim(),
      unit: unit.trim() || null,
      value_before: before === '' ? null : Number(before),
      value_after:  after  === '' ? null : Number(after),
      source,
      notes: notes.trim() || null,
    };
    if (payload.value_before != null && !Number.isFinite(payload.value_before)) {
      setError('value_before must be a number.'); return;
    }
    if (payload.value_after != null && !Number.isFinite(payload.value_after)) {
      setError('value_after must be a number.'); return;
    }
    const ok = await onSubmit(payload);
    if (!ok) setError('Failed to save. Try again.');
  };

  return (
    <form className="deal-change-outcome-form" onSubmit={submit}>
      <div className="deal-change-outcome-form-row">
        <label>
          Metric
          <input
            type="text" value={metric}
            list={`metric-suggestions-${changeId}`}
            onChange={(e) => {
              const v = e.target.value;
              setMetric(v);
              const match = METRIC_SUGGESTIONS.find((m) => m.metric === v);
              if (match) setUnit(match.unit);
            }}
            placeholder="e.g. cycle_time_minutes"
          />
          <datalist id={`metric-suggestions-${changeId}`}>
            {METRIC_SUGGESTIONS.map((m) => (
              <option key={m.metric} value={m.metric}>{m.unit}</option>
            ))}
          </datalist>
        </label>
        <label>
          Unit
          <input type="text" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="minutes / usd / pct" />
        </label>
      </div>

      <div className="deal-change-outcome-form-row">
        <label>
          Before
          <input type="number" step="any" value={before} onChange={(e) => setBefore(e.target.value)} placeholder="e.g. 240" />
        </label>
        <label>
          After
          <input type="number" step="any" value={after} onChange={(e) => setAfter(e.target.value)} placeholder="e.g. 90" />
        </label>
      </div>

      <div className="deal-change-outcome-form-row">
        <label>
          Source
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            {OUTCOME_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
      </div>

      <label className="deal-change-outcome-form-notes">
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional context — sample size, conditions, caveats…" />
      </label>

      {error && <div className="deal-change-outcome-form-error">{error}</div>}

      <div className="deal-change-actions">
        <button type="submit" className="deal-change-action" disabled={busy}>
          {busy ? 'Saving…' : 'Save outcome'}
        </button>
      </div>
    </form>
  );
}
