'use client';

/**
 * Inline viewer for a deal_analyses row, opened from the artefacts panel.
 *
 * Visual + interaction parity with /report's RedesignSection
 * (app/report/page.jsx:955+):
 *   - Wraps in `.report-page` so report.css applies.
 *   - Each item in `result.redesignedProcess[]` and each entry in
 *     `result.removedSteps[]` is rendered as a `.report-redesign-change-card`
 *     with ✓/✗ verdict buttons (`.verdict-btn.accept` / `.verdict-btn.reject`).
 *   - Decision bar at the top with stats + bulk Accept/Reject All matches
 *     the report's `.report-redesign-decision-bar`.
 *   - Local decisions state, key = `step:<stepNumber>` or
 *     `removed:<index>`. Toggle behaviour matches `handleDecision`
 *     in app/report/page.jsx:974.
 *
 * Persistence is intentionally deferred — the "Save as version" and
 * "Save as override" buttons are wired but disabled until the
 * accept/override schema decision (A/B/C in the proposal) is settled.
 * The visible button labels will read "(persistence pending)" so the
 * user sees the gating reason rather than a silent no-op.
 *
 * Result shape (lib/deal-analysis/prompts.js:230-270):
 *   redesignedProcess[] = [{ stepNumber, name, department, isDecision,
 *     changeType: 'kept'|'merged'|'new'|'moved',
 *     sourceSteps: [{ companyName, originalName }, ...],
 *     rationale, notes }]
 *   removedSteps[] = [{ name, companyName, reason }]
 *   summary, processName, changeOverview, phasing, risks
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import InteractiveFlowCanvas from '@/components/flow/InteractiveFlowCanvas';
import FloatingFlowViewer from '../FloatingFlowViewer';

const MODE_LABEL = {
  redesign: 'Redesign analysis',
  diligence: 'Diligence analysis',
  synergy: 'Synergy analysis',
  comparison: 'Comparison analysis',
};

// Mirrors FLOW_VIEWS in app/report/page.jsx:433. Same id/label/icon
// vocabulary so the toolbar reads identically to the report's flow view.
const FLOW_VIEWS = [
  { id: 'grid', label: 'Linear', icon: '→' },
  { id: 'swimlane', label: 'Swimlane', icon: '⏸' },
];

// Same legend ribbon as app/report/page.jsx:481 — Exclusive / Parallel /
// Merge symbols. Re-using the .flow-legend / .report-flow-legend classes
// the report already styles.
function FlowLegend({ darkTheme }) {
  return (
    <div className="flow-legend report-flow-legend" data-theme={darkTheme ? 'dark' : 'light'}>
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
  );
}

function FlowFloatBtn({ onClick }) {
  return (
    <button type="button" className="flow-reset-btn report-flow-float-btn" onClick={onClick} title="Open in floating window">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 3 21 3 21 9"/><line x1="21" y1="3" x2="14" y2="10"/>
        <path d="M10 5H5a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-5"/>
      </svg>
      <span className="flow-reset-label">Open fullscreen</span>
    </button>
  );
}

// Visual treatment per change type, mirroring the colour cues used in
// /report (`change-${meta.cls}`). Same vocabulary: kept / merged / new /
// moved / removed. Adjacent to PRINCIPLE_LABELS in app/report/page.jsx.
const CHANGE_META = {
  kept:    { icon: '○', label: 'Kept',    cls: 'kept' },
  merged:  { icon: '⧉', label: 'Merged',  cls: 'merged' },
  new:     { icon: '+', label: 'New',     cls: 'added' },
  moved:   { icon: '⇄', label: 'Moved',   cls: 'modified' },
  removed: { icon: '✖', label: 'Removed', cls: 'removed' },
};

function decisionKeyFor(scope, idx) { return `${scope}:${idx}`; }

// Build the live flow from the AI's redesignedProcess plus any
// removedSteps the user has rejected (i.e. "keep this one") and minus
// any redesignedProcess steps the user has rejected (i.e. "drop this
// one"). Mirrors the buildReportAfterSvgProc behaviour in
// app/report/page.jsx:421-431 so the chart reflects every decision.
function redesignedProcessToFlow(redesignedProcess, removedSteps, decisions) {
  const baseList = Array.isArray(redesignedProcess) ? redesignedProcess : [];
  const removedList = Array.isArray(removedSteps) ? removedSteps : [];
  if (baseList.length === 0 && removedList.length === 0) return null;

  const kept = [];
  baseList.forEach((s, i) => {
    const stepNum = s.stepNumber ?? i;
    if (decisions[decisionKeyFor('step', stepNum)] === 'rejected') return;
    kept.push({
      sourceKey: `step:${stepNum}`,
      name: s.name || `Step ${stepNum}`,
      department: s.department || '',
      isDecision: !!s.isDecision,
    });
  });

  // Re-inject any removedSteps the user has rejected. These weren't in
  // the AI's redesignedProcess, so we don't have an exact slot — append
  // at the end with the source company as the department so the user
  // can see them sitting in the flow as restored steps.
  removedList.forEach((s, i) => {
    const key = decisionKeyFor('removed', i);
    if (decisions[key] !== 'rejected') return;
    kept.push({
      sourceKey: `removed:${i}`,
      name: s.name || `Restored step ${i + 1}`,
      department: s.companyName || '',
      isDecision: false,
    });
  });

  if (kept.length === 0) return null;

  // IDs encode the source decision key so ReactFlow's reconciler treats
  // adds / drops / reinjections as genuine node-set changes, not
  // mid-array index shifts (which can confuse the layout cache).
  const steps = kept.map((s, i) => ({
    id: `redesign-${s.sourceKey.replace(':', '-')}`,
    name: s.name,
    department: s.department,
    isDecision: s.isDecision,
    durationMinutes: 0,
    workMinutes: 0,
    systems: [],
    branches: [],
    contributor: '',
    checklist: [],
  }));
  const handoffs = steps.slice(0, -1).map((_, i) => ({
    from: steps[i].id,
    to: steps[i + 1].id,
    method: 'system',
  }));
  return { steps, handoffs };
}

function VerdictButtons({ value, onAccept, onReject, disabled }) {
  if (disabled) return null;
  return (
    <div className="report-redesign-change-verdict">
      <button
        type="button"
        className={`verdict-btn accept ${value === 'accepted' ? 'active' : ''}`}
        onClick={onAccept}
        title="Accept"
        aria-pressed={value === 'accepted'}
      >&#10003;</button>
      <button
        type="button"
        className={`verdict-btn reject ${value === 'rejected' ? 'active' : ''}`}
        onClick={onReject}
        title="Reject"
        aria-pressed={value === 'rejected'}
      >&#10005;</button>
    </div>
  );
}

function DecisionCard({ decisionKey, type, stepName, stepNumber, department, description, sourceSteps, rationale, expectedImpact, owner, notes, decisions, onToggle, finalised, isEditing, edited, onStartEdit, onCancelEdit, onChangeEdit }) {
  const meta = CHANGE_META[type] || CHANGE_META.kept;
  const verdict = decisions[decisionKey];
  const cardCls = [
    'report-redesign-change-card',
    `change-${meta.cls}`,
    verdict === 'accepted' ? 'decision-accepted' : '',
    verdict === 'rejected' ? 'decision-rejected' : '',
  ].filter(Boolean).join(' ');
  const editable = type !== 'removed' && stepNumber != null;
  // Inputs read live values from props; the parent owns the edit state
  // so leaving the field (or hitting "Save edits") writes through.
  const inputStyle = { width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid var(--border, #e5e7eb)', borderRadius: 4, background: 'transparent', font: 'inherit' };

  return (
    <div className={cardCls}>
      <div className="report-redesign-change-icon" aria-hidden>{meta.icon}</div>
      <div className="report-redesign-change-body">
        <div className="report-redesign-change-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: '1 1 auto', minWidth: 0 }}>
            <span className={`report-redesign-change-badge change-${meta.cls}`}>{meta.label}</span>
            {edited && <span className="redesign-stat" style={{ fontSize: 11, color: 'var(--accent, #0d9488)' }}>edited</span>}
            {isEditing ? (
              <input value={stepName || ''} onChange={(e) => onChangeEdit('name', e.target.value)} placeholder="Step name" style={{ ...inputStyle, fontWeight: 600 }} />
            ) : (
              <span className={`report-redesign-change-step ${type === 'removed' ? 'strikethrough' : ''}`}>{stepName}</span>
            )}
          </div>
          {editable && !finalised && (
            <button
              type="button"
              onClick={isEditing ? onCancelEdit : onStartEdit}
              title={isEditing ? 'Done editing' : 'Edit step'}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-mid, #64748b)', cursor: 'pointer', padding: 4, fontSize: 14 }}
            >{isEditing ? '✕' : '✎'}</button>
          )}
        </div>
        {description && <p className="report-redesign-change-desc">{description}</p>}
        {Array.isArray(sourceSteps) && sourceSteps.length > 0 && (
          <ul className="report-redesign-change-checklist">
            {sourceSteps.map((s, i) => (
              <li key={i}>
                <strong>{s.companyName || 'Source'}</strong>{s.originalName ? `: ${s.originalName}` : ''}
              </li>
            ))}
          </ul>
        )}
        {isEditing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-mid, #64748b)' }}>Department
              <input value={department || ''} onChange={(e) => onChangeEdit('department', e.target.value)} placeholder="Department" style={inputStyle} />
            </label>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-mid, #64748b)' }}>Owner
              <input value={owner || ''} onChange={(e) => onChangeEdit('owner', e.target.value)} placeholder="Role or team accountable" style={inputStyle} />
            </label>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-mid, #64748b)' }}>Impact
              <textarea value={expectedImpact || ''} onChange={(e) => onChangeEdit('expectedImpact', e.target.value)} placeholder="Quantified impact" rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
            </label>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-mid, #64748b)' }}>Rationale
              <textarea value={rationale || ''} onChange={(e) => onChangeEdit('rationale', e.target.value)} placeholder="Why this version won" rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
            </label>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-mid, #64748b)' }}>Notes
              <textarea value={notes || ''} onChange={(e) => onChangeEdit('notes', e.target.value)} placeholder="Implementation guidance" rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
            </label>
          </div>
        ) : (
          <>
            {department && (
              <p className="report-redesign-change-desc" style={{ fontSize: 12, color: 'var(--text-mid, #64748b)' }}>
                <strong>Department:</strong> {department}
              </p>
            )}
            {owner && (
              <p className="report-redesign-change-desc" style={{ fontSize: 12, color: 'var(--text-mid, #64748b)' }}>
                <strong>Owner:</strong> {owner}
              </p>
            )}
            {expectedImpact && (
              <p className="report-redesign-change-desc" style={{ fontWeight: 600 }}>
                <strong style={{ color: 'var(--accent, #0d9488)' }}>Impact:</strong> {expectedImpact}
              </p>
            )}
            {rationale && (
              <div className="report-redesign-change-principle">
                <span className="report-redesign-principle-icon" aria-hidden>&#128161;</span>
                {rationale}
              </div>
            )}
            {notes && (
              <p className="report-redesign-change-desc" style={{ fontStyle: 'italic', opacity: 0.85 }}>{notes}</p>
            )}
          </>
        )}
      </div>
      <VerdictButtons
        value={verdict}
        onAccept={() => onToggle(decisionKey, 'accepted')}
        onReject={() => onToggle(decisionKey, 'rejected')}
        disabled={finalised}
      />
    </div>
  );
}

export default function DealAnalysisInline({ dealId, analysisId, accessToken, darkTheme }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [layout, setLayout] = useState('grid');
  const [decisions, setDecisions] = useState({});
  const [dirty, setDirty] = useState(false);
  // Top-level view switch between the flow chart (with per-step decision
  // cards) and the written analysis (summary, phasing, risks, findings).
  // Mirrors /report's redesignTab state at app/report/page.jsx:957.
  const [view, setView] = useState('flow'); // 'flow' | 'analysis'
  const [floating, setFloating] = useState(false);
  // Editable name. Mirrors deal_analyses.name; PATCH /api/deals/{dealId}/
  // analyses/{analysisId} persists. Defaults to a friendly auto-name
  // (e.g. "Redesign analysis") on initial open if the row's name is null.
  const [nameDraft, setNameDraft] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [savedName, setSavedName] = useState(null);
  // Manual per-step edits. stepEdits is keyed by stepNumber and stores
  // { name, department, owner, rationale, expectedImpact, notes }.
  // Edits stay local until the user clicks "Save edits"; that PATCHes
  // the merged result back to deal_analyses.result.
  const [stepEdits, setStepEdits] = useState({});
  const [editingStepKey, setEditingStepKey] = useState(null);
  const [savingEdits, setSavingEdits] = useState(false);

  useEffect(() => {
    if (!dealId || !analysisId || !accessToken) return undefined;
    let cancelled = false;
    setLoading(true); setError(null); setDecisions({}); setDirty(false);
    setEditingName(false); setSavedName(null);
    setStepEdits({}); setEditingStepKey(null);
    apiFetch(`/api/deals/${dealId}/analyses/${analysisId}`, {}, accessToken)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (cancelled) return;
        setData(d);
        const a = d?.analysis || d;
        setSavedName(a?.name || null);
        setLoading(false);
      })
      .catch((e) => { if (!cancelled) { setError(e.message || 'Failed to load analysis'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [dealId, analysisId, accessToken]);

  const editsDirty = Object.keys(stepEdits).length > 0;

  const updateStepEdit = useCallback((stepNum, field, value) => {
    setStepEdits((prev) => {
      const next = { ...prev };
      const cur = { ...(next[stepNum] || {}) };
      cur[field] = value;
      next[stepNum] = cur;
      return next;
    });
  }, []);

  const clearEdits = useCallback(() => { setStepEdits({}); setEditingStepKey(null); }, []);

  // Merge stepEdits into result.redesignedProcess and PATCH the whole
  // result back. Backend stores into deal_analyses.result so subsequent
  // reads see the override directly. After save we mutate local data so
  // the UI reflects the saved state without a full re-fetch.
  const saveEdits = useCallback(async () => {
    if (!dealId || !analysisId || !accessToken) return;
    if (!editsDirty) return;
    const analysisRow = data?.analysis || data;
    const baseResult = analysisRow?.result || {};
    const mergedSteps = (Array.isArray(baseResult.redesignedProcess) ? baseResult.redesignedProcess : []).map((s, i) => {
      const stepNum = s.stepNumber ?? i;
      const edit = stepEdits[stepNum];
      return edit ? { ...s, ...edit } : s;
    });
    const nextResult = { ...baseResult, redesignedProcess: mergedSteps };
    setSavingEdits(true);
    try {
      const r = await apiFetch(`/api/deals/${dealId}/analyses/${analysisId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result: nextResult }),
      }, accessToken);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData((prev) => {
        if (!prev) return prev;
        if (prev.analysis) return { ...prev, analysis: { ...prev.analysis, result: nextResult } };
        return { ...prev, result: nextResult };
      });
      clearEdits();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[deal-analysis] saveEdits failed', e);
    } finally {
      setSavingEdits(false);
    }
  }, [dealId, analysisId, accessToken, editsDirty, data, stepEdits, clearEdits]);

  const saveName = useCallback(async (next) => {
    const trimmed = (next || '').trim().slice(0, 120);
    if (!dealId || !analysisId || !accessToken) return;
    if (trimmed === (savedName || '').trim()) { setEditingName(false); return; }
    setSavingName(true);
    try {
      const r = await apiFetch(`/api/deals/${dealId}/analyses/${analysisId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed || null }),
      }, accessToken);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSavedName(trimmed || null);
      setEditingName(false);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[deal-analysis] rename failed', e);
    } finally {
      setSavingName(false);
    }
  }, [dealId, analysisId, accessToken, savedName]);

  const analysis = data?.analysis || data;
  const result = analysis?.result || null;
  const mode = analysis?.mode || result?.mode || '';
  const finalised = !!(analysis?.accepted_at || analysis?.acceptedAt);

  const decisionList = useMemo(() => {
    if (!result || mode !== 'redesign') return [];
    const list = [];
    (result.redesignedProcess || []).forEach((s, i) => {
      const stepNum = s.stepNumber ?? i;
      const edit = stepEdits[stepNum] || {};
      list.push({
        decisionKey: decisionKeyFor('step', stepNum),
        type: s.changeType || 'kept',
        stepNumber: stepNum,
        stepName: edit.name ?? s.name ?? `Step ${stepNum}`,
        department: edit.department ?? s.department,
        description: '',
        sourceSteps: s.sourceSteps,
        rationale: edit.rationale ?? s.rationale,
        expectedImpact: edit.expectedImpact ?? s.expectedImpact,
        owner: edit.owner ?? s.owner,
        notes: edit.notes ?? s.notes,
        edited: Object.keys(edit).length > 0,
      });
    });
    (result.removedSteps || []).forEach((s, i) => {
      list.push({
        decisionKey: decisionKeyFor('removed', i),
        type: 'removed',
        stepName: s.name || `Removed step ${i + 1}`,
        description: s.companyName ? `From ${s.companyName}` : '',
        rationale: s.reason,
      });
    });
    return list;
  }, [result, mode, stepEdits]);

  const acceptedCount = decisionList.filter((d) => decisions[d.decisionKey] === 'accepted').length;
  const rejectedCount = decisionList.filter((d) => decisions[d.decisionKey] === 'rejected').length;
  const pendingCount = decisionList.length - acceptedCount - rejectedCount;

  const flow = useMemo(
    () => (mode === 'redesign'
      ? redesignedProcessToFlow(result?.redesignedProcess, result?.removedSteps, decisions)
      : null),
    [mode, result, decisions],
  );

  const toggleDecision = useCallback((key, verdict) => {
    setDecisions((prev) => {
      const next = { ...prev };
      if (next[key] === verdict) { delete next[key]; }
      else { next[key] = verdict; }
      return next;
    });
    setDirty(true);
  }, []);

  const acceptAll = useCallback(() => {
    const next = {};
    decisionList.forEach((d) => { next[d.decisionKey] = 'accepted'; });
    setDecisions(next); setDirty(true);
  }, [decisionList]);

  const rejectAll = useCallback(() => {
    const next = {};
    decisionList.forEach((d) => { next[d.decisionKey] = 'rejected'; });
    setDecisions(next); setDirty(true);
  }, [decisionList]);

  // Persistence intentionally NOT wired yet — the schema decision (reuse
  // report_redesigns vs new deal_analysis_decisions table) is still open.
  // These two stub handlers exist so the buttons report a clear reason
  // rather than fail silently when clicked.
  const persistencePending = (label) => () => {
    // eslint-disable-next-line no-alert
    window.alert(`${label} is not wired yet — pending the deal-analysis decision-flow schema choice. See DiagnosticsCapabilities Legacy archive note plus the in-conversation A/B/C proposal.`);
  };

  if (loading) {
    return (
      <div className="report-page" data-theme={darkTheme ? 'dark' : 'light'} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, padding: 60 }}>
        <div className="loading-spinner" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="report-page" data-theme={darkTheme ? 'dark' : 'light'} style={{ padding: 24 }}>
        <div className="report-card" style={{ padding: 16 }}>
          <strong>Failed to load analysis.</strong>
          <div style={{ marginTop: 6, color: 'var(--text-mid, #64748b)', fontSize: 13 }}>{error}</div>
        </div>
      </div>
    );
  }
  if (!result) {
    return (
      <div className="report-page" data-theme={darkTheme ? 'dark' : 'light'} style={{ padding: 24 }}>
        <div className="report-card" style={{ padding: 16 }}>
          Analysis row exists but has no result body. Status: {analysis?.status || 'unknown'}.
        </div>
      </div>
    );
  }

  const eyebrowText = MODE_LABEL[mode] || `${mode || 'Deal'} analysis`;
  const completed = analysis?.completed_at || analysis?.completedAt;
  const dateText = completed ? new Date(completed).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  return (
    <div className="report-page report-page--portal" data-theme={darkTheme ? 'dark' : 'light'} style={{ height: '100%', overflowY: 'auto' }}>
      <header className="report-section-header" style={{ padding: '20px 24px 12px', borderBottom: '1px solid var(--border, #e5e7eb)', margin: 0 }}>
        <div className="report-section-eyebrow">
          {eyebrowText}{dateText ? ` · ${dateText}` : ''}{finalised ? ' · accepted' : ''}
        </div>
        {/* Editable analysis name. Falls back to "{Mode} analysis" when
            the row's name column is null so a fresh redesign reads as
            "Redesign analysis" until the user names it. Click the title
            (or the pencil) to edit; blur or Enter saves; Esc cancels. */}
        {(() => {
          const fallbackName = MODE_LABEL[mode] || `${mode || 'Deal'} analysis`;
          const displayName = (savedName && savedName.trim()) || fallbackName;
          if (editingName) {
            return (
              <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  autoFocus
                  defaultValue={savedName || ''}
                  placeholder={fallbackName}
                  maxLength={120}
                  disabled={savingName}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); saveName(e.target.value); }
                    else if (e.key === 'Escape') { setEditingName(false); }
                  }}
                  onBlur={(e) => saveName(e.target.value)}
                  className="report-section-title"
                  style={{ flex: '1 1 auto', minWidth: 0, padding: '4px 8px', border: '1px solid var(--border, #e5e7eb)', borderRadius: 6, background: 'transparent', font: 'inherit' }}
                />
              </div>
            );
          }
          return (
            <h2
              className="report-section-title"
              style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
              onClick={() => setEditingName(true)}
              title="Click to rename"
            >
              <span style={{ flex: '0 1 auto' }}>{displayName}</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setEditingName(true); }}
                aria-label="Rename"
                style={{ background: 'transparent', border: 'none', color: 'var(--text-mid, #64748b)', cursor: 'pointer', padding: 4, fontSize: 14 }}
              >✎</button>
            </h2>
          );
        })()}
        {result.summary && (
          <p className="report-section-sub" style={{ marginTop: 8 }}>
            {result.summary}
          </p>
        )}
        {/* Change-overview metrics row sits directly under the title and
            summary so the headline counts (kept / merged / new / removed
            / total) are visible regardless of which tab is active. Same
            .report-metric-grid + .report-metric-card vocabulary as
            /report (lib/modules/report/report.css:542 + line 64). */}
        {result.changeOverview && (
          <div className="report-metric-grid" style={{ marginTop: 16 }}>
            {(() => {
              const LABELS = {
                kept: 'Kept',
                merged: 'Merged',
                new: 'New',
                removed: 'Removed',
                totalSteps: 'Total steps',
              };
              const ORDER = ['new', 'kept', 'merged', 'removed', 'totalSteps'];
              const overview = result.changeOverview;
              return ORDER
                .filter((k) => overview[k] != null)
                .map((k) => (
                  <div key={k} className="report-metric-card">
                    <div className="report-metric-value">{overview[k]}</div>
                    <div className="report-metric-label">{LABELS[k] || k}</div>
                  </div>
                ));
            })()}
          </div>
        )}

        {/* Top-level view toggle: Flow chart vs Written analysis. Uses
            the same .report-section-tabs vocabulary as /report so it
            visually matches. The decision bar below stays visible in
            both views so the user can act while reading either. */}
        <div className="report-section-tabs" style={{ marginTop: 14 }} role="tablist" aria-label="Analysis view">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'flow'}
            className={`report-section-tab${view === 'flow' ? ' active' : ''}`}
            onClick={() => setView('flow')}
          >Flow chart</button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'analysis'}
            className={`report-section-tab${view === 'analysis' ? ' active' : ''}`}
            onClick={() => setView('analysis')}
          >Written analysis</button>
        </div>
      </header>

      {/* ── Decision bar (parity with report-redesign-decision-bar) ── */}
      {mode === 'redesign' && decisionList.length > 0 && (
        <div className="report-redesign-decision-bar" style={{ padding: '12px 24px' }}>
          <div className="report-redesign-decision-stats">
            <span className="redesign-stat accepted">{acceptedCount} accepted</span>
            <span className="redesign-stat rejected">{rejectedCount} rejected</span>
            <span className="redesign-stat pending">{pendingCount} pending</span>
          </div>
          <div className="report-redesign-decision-actions">
            {!finalised && (
              <>
                {/* Inline colours: the global .redesign-bulk-btn rule sets
                    no `color`, and the decision bar forces `background:
                    #fff` — in dark mode that lands white-on-white. Force
                    the green/red text + stable backgrounds here so the
                    buttons read in both themes. */}
                <button
                  type="button"
                  className="redesign-bulk-btn accept"
                  onClick={acceptAll}
                  style={{ color: '#166534', background: '#f0fdf4', borderColor: '#22c55e' }}
                >Accept All</button>
                <button
                  type="button"
                  className="redesign-bulk-btn reject"
                  onClick={rejectAll}
                  style={{ color: '#991b1b', background: '#fef2f2', borderColor: '#dc2626' }}
                >Reject All</button>
                {editsDirty && (
                  <>
                    <button
                      type="button"
                      className="redesign-save-btn"
                      onClick={saveEdits}
                      disabled={savingEdits}
                    >{savingEdits ? 'Saving edits…' : 'Save edits'}</button>
                    <button
                      type="button"
                      className="redesign-bulk-btn"
                      onClick={clearEdits}
                      disabled={savingEdits}
                      style={{ color: 'var(--text-mid, #64748b)' }}
                    >Discard edits</button>
                  </>
                )}
                <button
                  type="button"
                  className="redesign-save-btn"
                  onClick={persistencePending('Save decisions')}
                  disabled={!dirty}
                  title="Persistence pending — see in-conversation A/B/C proposal"
                >
                  {dirty ? 'Save decisions' : 'Saved'}
                </button>
                <button
                  type="button"
                  className="redesign-finalise-btn"
                  onClick={persistencePending('Save as new version')}
                  title="Persistence pending — see in-conversation A/B/C proposal"
                >
                  Save as new version
                </button>
                <button
                  type="button"
                  className="redesign-finalise-btn"
                  onClick={persistencePending('Override + accept')}
                  disabled={pendingCount > 0}
                  title={pendingCount > 0 ? 'Decide on every change before accepting' : 'Persistence pending — see in-conversation A/B/C proposal'}
                >
                  Override &amp; accept
                </button>
              </>
            )}
            {finalised && (
              <span className="redesign-stat accepted">Accepted{dateText ? ` on ${dateText}` : ''}</span>
            )}
          </div>
        </div>
      )}

      {/* ─────────────────  FLOW VIEW (chart only)  ─────────────────
          Structure mirrors FlowDiagramsSection in app/report/page.jsx:603
          for visual + spacing parity:
            .report-flow-diagrams
              .report-flow-toolbar      ← view toggle + legend + float
              .report-flow-canvas-wrap  ← canvas
          Re-uses the same class vocabulary so report.css styles apply. */}
      {view === 'flow' && flow && (
        <div className="report-flow-diagrams" style={{ padding: '16px 24px 24px' }}>
          <div className="report-flow-toolbar">
            <div className="report-flow-view-toggle">
              {FLOW_VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={`report-flow-view-btn${layout === v.id ? ' active' : ''}`}
                  onClick={() => setLayout(v.id)}
                  title={v.label}
                >
                  <span className="report-flow-view-icon">{v.icon}</span>
                  {v.label}
                </button>
              ))}
            </div>
            <FlowLegend darkTheme={darkTheme} />
            <FlowFloatBtn onClick={() => setFloating(true)} />
          </div>
          <div className="report-flow-canvas-wrap" style={{ height: 'min(70vh, 560px)', minHeight: 360 }}>
            <InteractiveFlowCanvas
              process={{ processName: result.processName || 'Redesigned process', ...flow }}
              layout={layout}
              darkTheme={darkTheme}
              className="s7-interactive-flow"
              onStepClick={() => {}}
            />
          </div>
        </div>
      )}

      {floating && flow && (
        <FloatingFlowViewer
          proc={{ processName: result.processName || 'Redesigned process', ...flow }}
          initialViewMode={layout}
          darkTheme={darkTheme}
          onClose={() => setFloating(false)}
        />
      )}

      {/* ─────────────────  WRITTEN ANALYSIS VIEW (everything else)  ───────────────── */}
      {view === 'analysis' && (
        <section style={{ padding: '16px 24px 24px' }}>
        {/* Live mini flow at the top of the Written analysis tab so the
            chart updates visibly as the user clicks ✓/✗ on the decision
            cards below. Same data source as the Flow chart tab — flow
            recomputes via useMemo on every decision change so this and
            the Flow chart tab stay in sync. */}
        {mode === 'redesign' && flow && (
          <div className="report-flow-diagrams" style={{ marginBottom: 20 }}>
            <div className="report-flow-toolbar">
              <div className="report-flow-view-toggle">
                {FLOW_VIEWS.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className={`report-flow-view-btn${layout === v.id ? ' active' : ''}`}
                    onClick={() => setLayout(v.id)}
                    title={v.label}
                  >
                    <span className="report-flow-view-icon">{v.icon}</span>
                    {v.label}
                  </button>
                ))}
              </div>
              <FlowLegend darkTheme={darkTheme} />
              <FlowFloatBtn onClick={() => setFloating(true)} />
            </div>
            <div className="report-flow-canvas-wrap" style={{ height: 'min(45vh, 380px)', minHeight: 240 }}>
              <InteractiveFlowCanvas
                process={{ processName: result.processName || 'Redesigned process', ...flow }}
                layout={layout}
                darkTheme={darkTheme}
                className="s7-interactive-flow"
                onStepClick={() => {}}
              />
            </div>
          </div>
        )}
        {mode === 'redesign' && decisionList.length > 0 && (
          <div className="report-redesign-changes" style={{ marginBottom: 24 }}>
            {decisionList.map((d) => (
              <DecisionCard
                key={d.decisionKey}
                decisionKey={d.decisionKey}
                type={d.type}
                stepNumber={d.stepNumber}
                stepName={d.stepName}
                department={d.department}
                description={d.description}
                sourceSteps={d.sourceSteps}
                rationale={d.rationale}
                expectedImpact={d.expectedImpact}
                owner={d.owner}
                notes={d.notes}
                edited={d.edited}
                isEditing={editingStepKey === d.decisionKey}
                onStartEdit={() => setEditingStepKey(d.decisionKey)}
                onCancelEdit={() => setEditingStepKey(null)}
                onChangeEdit={(field, value) => updateStepEdit(d.stepNumber, field, value)}
                decisions={decisions}
                onToggle={toggleDecision}
                finalised={finalised}
              />
            ))}
          </div>
        )}
        {/* changeOverview is rendered as the metric-card row at the
            top of the page (in the header) — shared between both views.
            Don't duplicate it here. */}

        {Array.isArray(result.keyBenefits) && result.keyBenefits.length > 0 && (
          <div className="report-card" style={{ padding: 14, marginBottom: 16 }}>
            <header className="report-section-header" style={{ marginBottom: 8 }}>
              <h3 className="report-section-title" style={{ fontSize: 14 }}>Key benefits</h3>
            </header>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.55 }}>
              {result.keyBenefits.map((b, i) => (
                <li key={i} style={{ marginBottom: 10 }}>
                  <strong>{b.benefit || `Benefit ${i + 1}`}</strong>
                  {b.description ? <div style={{ marginTop: 2 }}>{b.description}</div> : null}
                  {b.measurement ? <div style={{ color: 'var(--text-mid, #64748b)', marginTop: 2 }}><em>How we'll know:</em> {b.measurement}</div> : null}
                </li>
              ))}
            </ul>
          </div>
        )}

        {Array.isArray(result.tradeoffs) && result.tradeoffs.length > 0 && (
          <div className="report-card" style={{ padding: 14, marginBottom: 16 }}>
            <header className="report-section-header" style={{ marginBottom: 8 }}>
              <h3 className="report-section-title" style={{ fontSize: 14 }}>Trade-offs</h3>
            </header>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.55 }}>
              {result.tradeoffs.map((t, i) => (
                <li key={i} style={{ marginBottom: 10 }}>
                  {t.decision ? <div><strong>Decision:</strong> {t.decision}</div> : null}
                  {t.accepted ? <div><strong>Accepted:</strong> {t.accepted}</div> : null}
                  {t.alternative ? <div style={{ color: 'var(--text-mid, #64748b)' }}><strong>Rejected:</strong> {t.alternative}</div> : null}
                </li>
              ))}
            </ul>
          </div>
        )}

        {Array.isArray(result.assumptions) && result.assumptions.length > 0 && (
          <div className="report-card" style={{ padding: 14, marginBottom: 16 }}>
            <header className="report-section-header" style={{ marginBottom: 8 }}>
              <h3 className="report-section-title" style={{ fontSize: 14 }}>Assumptions</h3>
            </header>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.55 }}>
              {result.assumptions.map((a, i) => (
                <li key={i} style={{ marginBottom: 6 }}>{typeof a === 'string' ? a : (a.assumption || JSON.stringify(a))}</li>
              ))}
            </ul>
          </div>
        )}

        {Array.isArray(result.kpis) && result.kpis.length > 0 && (
          <div className="report-card" style={{ padding: 14, marginBottom: 16 }}>
            <header className="report-section-header" style={{ marginBottom: 8 }}>
              <h3 className="report-section-title" style={{ fontSize: 14 }}>KPIs</h3>
            </header>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-mid, #64748b)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.04 }}>
                  <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border, #e2e8f0)' }}>Indicator</th>
                  <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border, #e2e8f0)' }}>Baseline</th>
                  <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border, #e2e8f0)' }}>Target</th>
                  <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border, #e2e8f0)' }}>Cadence</th>
                </tr>
              </thead>
              <tbody>
                {result.kpis.map((k, i) => (
                  <tr key={i}>
                    <td style={{ padding: '6px 8px', verticalAlign: 'top' }}><strong>{k.kpi || k.name || `KPI ${i + 1}`}</strong></td>
                    <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>{k.baseline || '—'}</td>
                    <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>{k.target || '—'}</td>
                    <td style={{ padding: '6px 8px', verticalAlign: 'top' }}>{k.frequency || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {Array.isArray(result.phasing) && result.phasing.length > 0 && (
          <div className="report-card" style={{ padding: 14, marginBottom: 16 }}>
            <header className="report-section-header" style={{ marginBottom: 8 }}>
              <h3 className="report-section-title" style={{ fontSize: 14 }}>Phasing</h3>
            </header>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.55 }}>
              {result.phasing.map((p, i) => (
                <li key={i} style={{ marginBottom: 12 }}>
                  <strong>{p.label || `Phase ${p.phase || i + 1}`}</strong>
                  {p.timeframe ? <span style={{ color: 'var(--text-mid, #64748b)' }}> ({p.timeframe})</span> : null}
                  {Array.isArray(p.goals) && p.goals.length > 0 ? (
                    <div style={{ marginTop: 2 }}><em>Goals:</em> {p.goals.join(', ')}</div>
                  ) : null}
                  {Array.isArray(p.deliverables) && p.deliverables.length > 0 ? (
                    <div style={{ marginTop: 2 }}><em>Deliverables:</em> {p.deliverables.join(', ')}</div>
                  ) : null}
                  {Array.isArray(p.prerequisites) && p.prerequisites.length > 0 ? (
                    <div style={{ marginTop: 2, color: 'var(--text-mid, #64748b)' }}><em>Prerequisites:</em> {p.prerequisites.join(', ')}</div>
                  ) : null}
                  {Array.isArray(p.successMeasures) && p.successMeasures.length > 0 ? (
                    <div style={{ marginTop: 2 }}><em>Done when:</em> {p.successMeasures.join(', ')}</div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )}

        {Array.isArray(result.risks) && result.risks.length > 0 && (
          <div className="report-card" style={{ padding: 14, marginBottom: 16 }}>
            <header className="report-section-header" style={{ marginBottom: 8 }}>
              <h3 className="report-section-title" style={{ fontSize: 14 }}>Risks</h3>
            </header>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.55 }}>
              {result.risks.map((r, i) => (
                <li key={i} style={{ marginBottom: 12 }}>
                  <strong>{r.risk}</strong>
                  {r.severity || r.probability ? (
                    <span style={{ color: 'var(--text-mid, #64748b)' }}>
                      {' '}({[r.severity ? `severity: ${r.severity}` : null, r.probability ? `probability: ${r.probability}` : null].filter(Boolean).join(', ')})
                    </span>
                  ) : null}
                  {Array.isArray(r.leadingIndicators) && r.leadingIndicators.length > 0 ? (
                    <div style={{ marginTop: 2 }}><em>Watch for:</em> {r.leadingIndicators.join(', ')}</div>
                  ) : null}
                  {r.mitigation ? <div style={{ marginTop: 2 }}><em>Mitigation:</em> {r.mitigation}</div> : null}
                  {r.contingency ? <div style={{ marginTop: 2, color: 'var(--text-mid, #64748b)' }}><em>If it happens:</em> {r.contingency}</div> : null}
                </li>
              ))}
            </ul>
          </div>
        )}

        {Array.isArray(result.findings) && result.findings.length > 0 && (
          <div className="report-card" style={{ padding: 14, marginBottom: 16 }}>
            <header className="report-section-header" style={{ marginBottom: 8 }}>
              <h3 className="report-section-title" style={{ fontSize: 14 }}>Findings</h3>
            </header>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.55 }}>
              {result.findings.slice(0, 20).map((f, i) => (
                <li key={i} style={{ marginBottom: 8 }}>
                  <strong>{f.title || f.name || 'Finding'}</strong>{f.severity ? ` (${f.severity})` : ''}
                  {f.body || f.detail ? <div style={{ color: 'var(--text-mid, #64748b)', marginTop: 2 }}>{f.body || f.detail}</div> : null}
                </li>
              ))}
            </ul>
          </div>
        )}
        </section>
      )}
    </div>
  );
}
