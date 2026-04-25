'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';

/* ── Mode definitions ─────────────────────────────────────────── */

const ALL_MODES = [
  {
    key: 'comparison',
    label: 'Comparison',
    blurb: 'Side-by-side differences, common steps, and a proposed standard process.',
  },
  {
    key: 'synergy',
    label: 'Synergy',
    blurb: 'Quantified overlap - consolidation opportunities, FTE overlap, systems rationalisation.',
  },
  {
    key: 'redesign',
    label: 'Redesign',
    blurb: 'Decisive unified target process with per-step lineage, phasing, and adoption notes.',
  },
];

/* ── Subcomponents ────────────────────────────────────────────── */

function AnalysisCTA({ onRunAnalysis, modes, ctaTitle, ctaText }) {
  const visible = ALL_MODES.filter((m) => modes.includes(m.key));
  const [mode, setMode] = useState(visible[0]?.key || 'comparison');
  return (
    <div className="pe-analysis-cta">
      <div className="pe-analysis-cta-icon">✓</div>
      <h3 className="pe-analysis-cta-title">{ctaTitle}</h3>
      <p className="pe-analysis-cta-text">{ctaText}</p>
      <div className="pe-analysis-mode-picker" role="radiogroup" aria-label="Analysis mode">
        {visible.map((m) => (
          <button
            key={m.key}
            type="button"
            role="radio"
            aria-checked={mode === m.key}
            className={`pe-analysis-mode-btn ${mode === m.key ? 'pe-analysis-mode-btn--active' : ''}`}
            onClick={() => setMode(m.key)}
          >
            <span className="pe-analysis-mode-label">{m.label}</span>
            <span className="pe-analysis-mode-blurb">{m.blurb}</span>
          </button>
        ))}
      </div>
      <button type="button" className="deal-btn deal-btn--primary pe-analysis-run-btn" onClick={() => onRunAnalysis(mode)}>
        Run {mode} analysis
      </button>
    </div>
  );
}

function AnalysisProgress({ message }) {
  return (
    <div className="pe-analysis-progress">
      <div className="pe-analysis-spinner" />
      <p className="pe-analysis-progress-msg">{message}</p>
    </div>
  );
}

function SynergyResults({ analysis, onRerun }) {
  const { result } = analysis;
  const overall = result.overallSavingPct || {};
  const opps = result.opportunities || [];
  const ftes = result.fteOverlap || [];
  const systems = result.systemsConsolidation || [];
  const risks = result.integrationRisks || [];
  const companies = analysis.companiesAnalysed || [];
  const runDate = analysis.runAt ? new Date(analysis.runAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const totalReducibleFte = ftes.reduce((sum, f) => sum + (Number(f.estimatedReducibleFte) || 0), 0);

  return (
    <div className="pe-results">
      <div className="pe-results-header">
        <div>
          <h2 className="pe-results-title">Integration synergy analysis</h2>
          <p className="pe-results-meta">{companies.length} companies · {runDate}</p>
        </div>
        <button type="button" className="deal-btn pe-rerun-btn" onClick={onRerun}>Re-run analysis</button>
      </div>

      <div className="pe-results-summary"><p>{result.summary}</p></div>

      {(overall.low != null || overall.base != null || overall.high != null) && (
        <section className="pe-section pe-synergy-headline">
          <h3 className="pe-section-title">Overall synergy range (% of process cost base)</h3>
          <div className="pe-synergy-range">
            <div className="pe-synergy-range-tile"><span className="pe-synergy-range-val">{overall.low ?? '-'}%</span><span className="pe-synergy-range-lbl">Low</span></div>
            <div className="pe-synergy-range-tile pe-synergy-range-tile--base"><span className="pe-synergy-range-val">{overall.base ?? '-'}%</span><span className="pe-synergy-range-lbl">Base</span></div>
            <div className="pe-synergy-range-tile"><span className="pe-synergy-range-val">{overall.high ?? '-'}%</span><span className="pe-synergy-range-lbl">High</span></div>
          </div>
        </section>
      )}

      {opps.length > 0 && (
        <section className="pe-section">
          <h3 className="pe-section-title">Consolidation opportunities</h3>
          <div className="pe-synergy-opps">
            {opps.map((o, i) => {
              const pct = o.savingPct || {};
              return (
                <div key={i} className="pe-synergy-opp">
                  <div className="pe-synergy-opp-top">
                    <span className="pe-synergy-opp-title">{o.title}</span>
                    <div className="pe-synergy-opp-tags">
                      {o.effort && <span className={`pe-tag pe-tag--effort-${o.effort}`}>{o.effort} effort</span>}
                      {o.timeHorizon && <span className="pe-tag">{o.timeHorizon}</span>}
                    </div>
                  </div>
                  <p className="pe-synergy-opp-rationale">{o.rationale}</p>
                  <div className="pe-synergy-opp-meta">
                    {o.affectedCompanies?.length > 0 && (<span><strong>Companies:</strong> {o.affectedCompanies.join(', ')}</span>)}
                    {o.affectedSteps?.length > 0 && (<span><strong>Steps:</strong> {o.affectedSteps.join(' · ')}</span>)}
                  </div>
                  {(pct.low != null || pct.base != null || pct.high != null) && (
                    <div className="pe-synergy-opp-savings">
                      Savings: <strong>{pct.low ?? '-'}% / {pct.base ?? '-'}% / {pct.high ?? '-'}%</strong>
                      <span className="pe-synergy-opp-savings-note">low · base · high</span>
                    </div>
                  )}
                  {o.risks?.length > 0 && (<ul className="pe-synergy-opp-risks">{o.risks.map((r, ri) => <li key={ri}>{r}</li>)}</ul>)}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {ftes.length > 0 && (
        <section className="pe-section">
          <h3 className="pe-section-title">FTE overlap</h3>
          <p className="pe-section-sub">Total reducible FTE across platform: <strong>~{totalReducibleFte}</strong></p>
          <div className="pe-fte-list">
            {ftes.map((f, i) => (
              <div key={i} className="pe-fte-row">
                <div className="pe-fte-left"><span className="pe-fte-function">{f.function}</span><span className="pe-fte-across">{f.duplicatedAcross?.join(', ')}</span></div>
                <div className="pe-fte-right"><span className="pe-fte-count">~{f.estimatedReducibleFte ?? '?'} FTE</span><span className="pe-fte-reason">{f.reasoning}</span></div>
              </div>
            ))}
          </div>
        </section>
      )}

      {systems.length > 0 && (
        <section className="pe-section">
          <h3 className="pe-section-title">Systems consolidation</h3>
          <ul className="pe-systems-list">
            {systems.map((s, i) => (<li key={i} className="pe-systems-item"><strong>{s.topic}:</strong> {s.recommendation}{s.reasoning && <span className="pe-systems-reason"> - {s.reasoning}</span>}</li>))}
          </ul>
        </section>
      )}

      {risks.length > 0 && (
        <section className="pe-section">
          <h3 className="pe-section-title">Integration risks</h3>
          <div className="pe-risks-list">
            {risks.map((r, i) => (
              <div key={i} className={`pe-risk-row pe-risk-row--${r.severity || 'medium'}`}>
                <div className="pe-risk-top"><span className="pe-risk-sev">{r.severity || 'medium'}</span><span className="pe-risk-desc">{r.risk}</span></div>
                {r.mitigation && <p className="pe-risk-mit">Mitigation: {r.mitigation}</p>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

const CHANGE_TYPE_META = {
  kept:    { label: 'Kept',    className: 'pe-redesign-change--kept' },
  merged:  { label: 'Merged',  className: 'pe-redesign-change--merged' },
  new:     { label: 'New',     className: 'pe-redesign-change--new' },
  moved:   { label: 'Moved',   className: 'pe-redesign-change--moved' },
};

function RedesignResults({ analysis, onRerun }) {
  const { result } = analysis;
  const overview = result.changeOverview || {};
  const steps = result.redesignedProcess || [];
  const removed = result.removedSteps || [];
  const phases = result.phasing || [];
  const adoption = result.adoptionNotes || [];
  const risks = result.risks || [];
  const companies = analysis.companiesAnalysed || [];
  const runDate = analysis.runAt ? new Date(analysis.runAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const processName = result.processName || 'Unified process';

  return (
    <div className="pe-results">
      <div className="pe-results-header">
        <div>
          <h2 className="pe-results-title">Unified process design</h2>
          <p className="pe-results-meta">{processName} · {companies.length} source companies · {runDate}</p>
        </div>
        <button type="button" className="deal-btn pe-rerun-btn" onClick={onRerun}>Re-run analysis</button>
      </div>

      <div className="pe-results-summary"><p>{result.summary}</p></div>

      {(overview.totalSteps != null) && (
        <div className="pe-stats-row">
          <div className="pe-stat"><span className="pe-stat-val">{overview.totalSteps}</span><span className="pe-stat-lbl">Total steps</span></div>
          <div className="pe-stat"><span className="pe-stat-val">{overview.kept ?? 0}</span><span className="pe-stat-lbl">Kept</span></div>
          <div className="pe-stat"><span className="pe-stat-val">{overview.merged ?? 0}</span><span className="pe-stat-lbl">Merged</span></div>
          <div className="pe-stat"><span className="pe-stat-val">{overview.new ?? 0}</span><span className="pe-stat-lbl">New</span></div>
          <div className="pe-stat"><span className="pe-stat-val">{overview.removed ?? 0}</span><span className="pe-stat-lbl">Removed</span></div>
        </div>
      )}

      {steps.length > 0 && (
        <section className="pe-section">
          <h3 className="pe-section-title">Proposed unified process</h3>
          <div className="pe-redesign-timeline">
            {steps.map((s, i) => {
              const meta = CHANGE_TYPE_META[s.changeType] || { label: s.changeType || '-', className: '' };
              return (
                <div key={i} className="pe-redesign-step">
                  <div className="pe-redesign-step-num">{s.stepNumber || i + 1}</div>
                  <div className="pe-redesign-step-body">
                    <div className="pe-redesign-step-top">
                      <span className="pe-redesign-step-name">
                        {s.name}
                        {s.isDecision && <span className="pe-redesign-decision-flag" title="Decision point">◆</span>}
                      </span>
                      <span className={`pe-redesign-change ${meta.className}`}>{meta.label}</span>
                    </div>
                    <div className="pe-redesign-step-meta">
                      {s.department && <span className="pe-redesign-dept">{s.department}</span>}
                      {s.sourceSteps?.length > 0 && (
                        <span className="pe-redesign-sources">
                          from {s.sourceSteps.map((src) => `${src.companyName}: "${src.originalName}"`).join(' · ')}
                        </span>
                      )}
                    </div>
                    {s.rationale && <p className="pe-redesign-rationale">{s.rationale}</p>}
                    {s.notes && <p className="pe-redesign-notes">{s.notes}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {removed.length > 0 && (
        <section className="pe-section">
          <h3 className="pe-section-title">Steps removed from source processes</h3>
          <ul className="pe-redesign-removed">
            {removed.map((r, i) => (
              <li key={i} className="pe-redesign-removed-item">
                <span className="pe-redesign-removed-name">{r.name}</span>
                <span className="pe-redesign-removed-company">({r.companyName})</span>
                <span className="pe-redesign-removed-reason">- {r.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {phases.length > 0 && (
        <section className="pe-section">
          <h3 className="pe-section-title">Rollout phases</h3>
          <div className="pe-redesign-phases">
            {phases.map((p, i) => (
              <div key={i} className="pe-redesign-phase">
                <div className="pe-redesign-phase-head">
                  <span className="pe-redesign-phase-num">Phase {p.phase || i + 1}</span>
                  <span className="pe-redesign-phase-label">{p.label}</span>
                  {p.timeframe && <span className="pe-tag">{p.timeframe}</span>}
                </div>
                {p.goals?.length > 0 && (<ul className="pe-redesign-phase-goals">{p.goals.map((g, gi) => <li key={gi}>{g}</li>)}</ul>)}
              </div>
            ))}
          </div>
        </section>
      )}

      {adoption.length > 0 && (
        <section className="pe-section">
          <h3 className="pe-section-title">Adoption notes</h3>
          <ul className="pe-systems-list">{adoption.map((note, i) => <li key={i} className="pe-systems-item">{note}</li>)}</ul>
        </section>
      )}

      {risks.length > 0 && (
        <section className="pe-section">
          <h3 className="pe-section-title">Integration risks</h3>
          <div className="pe-risks-list">
            {risks.map((r, i) => (
              <div key={i} className={`pe-risk-row pe-risk-row--${r.severity || 'medium'}`}>
                <div className="pe-risk-top"><span className="pe-risk-sev">{r.severity || 'medium'}</span><span className="pe-risk-desc">{r.risk}</span></div>
                {r.mitigation && <p className="pe-risk-mit">Mitigation: {r.mitigation}</p>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ComparisonResults({ analysis, onRerun }) {
  const { result } = analysis;
  const companies = analysis.companiesAnalysed || [];
  const runDate = analysis.runAt ? new Date(analysis.runAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  return (
    <div className="pe-results">
      <div className="pe-results-header">
        <div>
          <h2 className="pe-results-title">Cross-company analysis</h2>
          <p className="pe-results-meta">{companies.length} companies · {runDate}</p>
        </div>
        <button type="button" className="deal-btn pe-rerun-btn" onClick={onRerun}>Re-run analysis</button>
      </div>

      <div className="pe-results-summary"><p>{result.summary}</p></div>

      <div className="pe-stats-row">
        <div className="pe-stat"><span className="pe-stat-val">{result.commonSteps?.length ?? 0}</span><span className="pe-stat-lbl">Common steps</span></div>
        <div className="pe-stat"><span className="pe-stat-val">{result.uniqueSteps?.length ?? 0}</span><span className="pe-stat-lbl">Unique steps</span></div>
        <div className="pe-stat"><span className="pe-stat-val">{result.mergeRecommendations?.length ?? 0}</span><span className="pe-stat-lbl">Recommendations</span></div>
        <div className="pe-stat"><span className="pe-stat-val">{result.proposedProcess?.length ?? 0}</span><span className="pe-stat-lbl">Proposed steps</span></div>
      </div>

      {result.mergeRecommendations?.length > 0 && (
        <section className="pe-section">
          <h3 className="pe-section-title">Recommendations</h3>
          <div className="pe-recs-list">
            {result.mergeRecommendations.map((rec, i) => (
              <div key={i} className="pe-rec-card">
                <div className="pe-rec-finding">{rec.finding}</div>
                <div className="pe-rec-action">{rec.action}</div>
                <div className="pe-rec-footer">
                  {rec.affectedSteps?.length > 0 && (<span className="pe-rec-steps">{rec.affectedSteps.join(' · ')}</span>)}
                  {rec.estimatedSavingPct > 0 && (<span className="pe-rec-saving">~{rec.estimatedSavingPct}% saving</span>)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {result.commonSteps?.length > 0 && (
        <section className="pe-section">
          <h3 className="pe-section-title">Common steps - standardise these</h3>
          <div className="pe-steps-table">
            <div className="pe-steps-table-head">
              <span>Step</span><span>Present at</span><span>Departments</span><span>Variance</span>
            </div>
            {result.commonSteps.map((s, i) => (
              <div key={i} className={`pe-steps-row ${s.presentAtAll ? 'pe-steps-row--all' : ''}`}>
                <span className="pe-steps-name">{s.name}{s.presentAtAll && <span className="pe-steps-badge">All</span>}</span>
                <span className="pe-steps-companies">{s.presentAt?.join(', ') || '-'}</span>
                <span className="pe-steps-depts">{s.departments?.join(', ') || '-'}</span>
                <span className="pe-steps-variance">{s.varianceNote || '-'}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {result.uniqueSteps?.length > 0 && (
        <section className="pe-section">
          <h3 className="pe-section-title">Unique steps - review for necessity</h3>
          <div className="pe-unique-list">
            {result.uniqueSteps.map((s, i) => (
              <div key={i} className={`pe-unique-item pe-unique-item--${s.recommendation}`}>
                <div className="pe-unique-left">
                  <span className="pe-unique-name">{s.name}</span>
                  <span className="pe-unique-company">{s.companyName}</span>
                </div>
                <div className="pe-unique-right">
                  <span className={`pe-unique-rec pe-unique-rec--${s.recommendation}`}>{s.recommendation}</span>
                  <span className="pe-unique-reason">{s.reason}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {result.proposedProcess?.length > 0 && (
        <section className="pe-section">
          <h3 className="pe-section-title">Proposed standard process</h3>
          <p className="pe-section-sub">The recommended process for all participating companies to adopt.</p>
          <div className="pe-proposed-list">
            {result.proposedProcess.map((step, i) => (
              <div key={i} className="pe-proposed-step">
                <div className="pe-proposed-num">{step.stepNumber || i + 1}</div>
                <div className="pe-proposed-body">
                  <div className="pe-proposed-name">{step.name}</div>
                  <div className="pe-proposed-meta">
                    {step.department && <span className="pe-proposed-dept">{step.department}</span>}
                    {step.source && step.source !== 'common' && (<span className="pe-proposed-source">from {step.source}</span>)}
                    {step.source === 'common' && (<span className="pe-proposed-source pe-proposed-source--common">common</span>)}
                  </div>
                  {step.notes && <div className="pe-proposed-notes">{step.notes}</div>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function AnalysisHistory({ history, selectedId, onSelect, onDelete, canEdit }) {
  if (!history || history.length === 0) return null;
  return (
    <div className="pe-history">
      <div className="pe-history-header">
        <h3 className="pe-history-title">Previous runs</h3>
        <span className="pe-history-count">{history.length}</span>
      </div>
      <ul className="pe-history-list">
        {history.map((h) => {
          const date = h.completedAt || h.createdAt;
          const dateStr = date ? new Date(date).toLocaleString('en-GB', {
            day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
          }) : '';
          const active = h.id === selectedId;
          const statusLabel = h.status === 'complete' ? '' : h.status;
          const modeLabel = h.mode === 'synergy' ? 'Synergy' : h.mode === 'redesign' ? 'Redesign' : 'Comparison';
          return (
            <li key={h.id} className={`pe-history-item ${active ? 'pe-history-item--active' : ''}`}>
              <button type="button" className="pe-history-btn" onClick={() => onSelect(h.id)} aria-current={active ? 'true' : undefined}>
                <div className="pe-history-main">
                  <span className={`pe-history-mode pe-history-mode--${h.mode || 'comparison'}`}>{modeLabel}</span>
                  <span className="pe-history-date">{dateStr}</span>
                  {statusLabel && <span className={`pe-history-status pe-history-status--${h.status}`}>{statusLabel}</span>}
                </div>
                {h.summary && <span className="pe-history-summary">{h.summary}</span>}
                <span className="pe-history-meta">
                  {h.sourceReportCount} companies
                  {h.createdByEmail ? ` · ${h.createdByEmail}` : ''}
                </span>
              </button>
              {canEdit && (
                <button type="button" className="pe-history-delete" onClick={() => onDelete(h.id)} title="Delete this run from history" aria-label="Delete run">×</button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function adaptHistoryRow(row, participants) {
  if (!row || !row.result) return null;
  const reportIds = row.sourceReportIds || [];
  const companiesAnalysed = reportIds
    .map((rid) => participants.find((p) => p.report?.id === rid)?.companyName)
    .filter(Boolean);
  return {
    runAt: row.completedAt || row.createdAt,
    mode: row.mode || 'comparison',
    companiesAnalysed,
    result: row.result,
  };
}

/* ── Main exported component ──────────────────────────────────── */

export default function DealAnalysisSection({
  deal,
  participants,
  summary,
  accessToken,
  modes = ['comparison', 'synergy', 'redesign'],
  ctaTitle = 'All companies have completed their process maps',
  ctaText = 'Run the AI analysis to compare processes across all companies and identify standardisation, consolidation, and integration upside.',
  notReadyMessage,
}) {
  const allComplete = summary.completedCount === summary.totalCount && summary.totalCount > 0;
  const storedAnalysis = deal.settings?.analysis || null;
  const canEditAnalyses = !!(deal.canEdit ?? deal.isOwner ?? false);

  const [analysisState, setAnalysisState] = useState(
    storedAnalysis ? 'done' : allComplete ? 'ready' : 'collecting'
  );
  const [analysis, setAnalysis] = useState(storedAnalysis);
  const [progressMsg, setProgressMsg] = useState('Starting analysis…');
  const [analysisError, setAnalysisError] = useState(null);
  const [history, setHistory] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  const loadHistory = async () => {
    if (!accessToken) return;
    try {
      const resp = await apiFetch(`/api/deals/${deal.id}/analyses`, {}, accessToken);
      if (!resp.ok) return;
      const data = await resp.json();
      setHistory(Array.isArray(data.analyses) ? data.analyses : []);
    } catch { /* non-fatal */ }
  };

  useEffect(() => { loadHistory(); }, [deal.id, accessToken]);

  useEffect(() => {
    const stored = deal.settings?.analysis || null;
    if (stored) {
      setAnalysis(stored);
      setAnalysisState('done');
    } else if (summary.completedCount === summary.totalCount && summary.totalCount > 0) {
      if (analysisState === 'collecting') setAnalysisState('ready');
    }
  }, [deal, summary]);

  const handleSelectHistory = async (analysisId) => {
    if (!analysisId || analysisId === selectedId) return;
    setSelectedId(analysisId);
    try {
      const resp = await apiFetch(`/api/deals/${deal.id}/analyses/${analysisId}`, {}, accessToken);
      if (!resp.ok) return;
      const data = await resp.json();
      const adapted = adaptHistoryRow(data.analysis, participants);
      if (adapted) {
        setAnalysis(adapted);
        setAnalysisState('done');
      }
    } catch { /* non-fatal */ }
  };

  const handleDeleteHistory = async (analysisId) => {
    if (!analysisId) return;
    if (!window.confirm('Delete this analysis run from history?')) return;
    try {
      const resp = await apiFetch(`/api/deals/${deal.id}/analyses/${analysisId}`, { method: 'DELETE' }, accessToken);
      if (!resp.ok) return;
      setHistory((prev) => prev.filter((h) => h.id !== analysisId));
      if (selectedId === analysisId) setSelectedId(null);
    } catch { /* non-fatal */ }
  };

  const runAnalysis = async (mode = 'comparison') => {
    setAnalysisState('streaming');
    setAnalysisError(null);
    setProgressMsg('Starting analysis…');

    const resp = await apiFetch(
      `/api/deals/${deal.id}/analyse`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) },
      accessToken
    );

    if (!resp.ok) {
      let msg = 'Analysis failed.';
      try { const d = await resp.json(); msg = d.error || msg; } catch { /* */ }
      setAnalysisError(msg);
      setAnalysisState(allComplete ? 'ready' : 'collecting');
      return;
    }

    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream')) {
      setAnalysisError('Unexpected response from server.');
      setAnalysisState('ready');
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let eventName = 'message';
          let dataStr = '';
          for (const line of chunk.split('\n')) {
            if (line.startsWith('event: ')) eventName = line.slice(7).trim();
            else if (line.startsWith('data: ')) dataStr = line.slice(6).trim();
          }
          if (!dataStr) continue;
          let parsed;
          try { parsed = JSON.parse(dataStr); } catch { continue; }
          if (eventName === 'progress') {
            setProgressMsg(parsed.message || '');
          } else if (eventName === 'done') {
            setAnalysis(parsed.analysis);
            setAnalysisState('done');
            setSelectedId(null);
            loadHistory();
          } else if (eventName === 'error') {
            setAnalysisError(parsed.error || 'Analysis failed.');
            setAnalysisState(allComplete ? 'ready' : 'collecting');
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setAnalysisError('Connection interrupted. Please try again.');
        setAnalysisState(allComplete ? 'ready' : 'collecting');
      }
    }
  };

  return (
    <>
      {analysisError && (
        <div className="pe-analysis-error"><p>{analysisError}</p></div>
      )}

      {analysisState === 'collecting' && (
        <div className="pe-collecting-note">
          <p>
            {notReadyMessage || `${summary.totalCount - summary.completedCount} of ${summary.totalCount} companies still need to complete their process map. Once all companies have submitted, you can run the cross-company analysis.`}
          </p>
        </div>
      )}

      {analysisState === 'ready' && (
        <AnalysisCTA
          onRunAnalysis={runAnalysis}
          modes={modes}
          ctaTitle={ctaTitle}
          ctaText={ctaText}
        />
      )}

      {analysisState === 'streaming' && (
        <AnalysisProgress message={progressMsg} />
      )}

      {analysisState === 'done' && analysis && (
        analysis.mode === 'synergy' ? (
          <SynergyResults analysis={analysis} onRerun={() => setAnalysisState('ready')} />
        ) : analysis.mode === 'redesign' ? (
          <RedesignResults analysis={analysis} onRerun={() => setAnalysisState('ready')} />
        ) : (
          <ComparisonResults analysis={analysis} onRerun={() => setAnalysisState('ready')} />
        )
      )}

      {history.length > 0 && (
        <AnalysisHistory
          history={history}
          selectedId={selectedId}
          onSelect={handleSelectHistory}
          onDelete={handleDeleteHistory}
          canEdit={canEditAnalyses}
        />
      )}
    </>
  );
}
