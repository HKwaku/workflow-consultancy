'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api-fetch';

const ROLE_LABEL = { acquirer: 'Acquirer', target: 'Target' };

const DECISION_OPTIONS = [
  { key: 'acquirer', label: 'Keep Acquirer', short: 'A', color: '#6366f1' },
  { key: 'target',   label: 'Keep Target',   short: 'T', color: '#0d9488' },
  { key: 'merge',    label: 'Merge Both',    short: 'M', color: '#d97706' },
  { key: 'remove',   label: 'Remove',        short: 'R', color: '#ef4444' },
];

function fmt(val) {
  if (val == null || val === 0) return '—';
  if (val >= 1_000_000) return '£' + (val / 1_000_000).toFixed(1) + 'M';
  if (val >= 1_000) return '£' + (val / 1_000).toFixed(0) + 'K';
  return '£' + Math.round(val);
}

function ParticipantCard({ p }) {
  if (!p) {
    return (
      <div className="ma-side-card ma-side-card--empty">
        <p className="ma-side-empty">Not yet linked</p>
      </div>
    );
  }

  const statusLabel = p.status === 'complete' ? 'Complete' : p.status === 'in_progress' ? 'In progress' : 'Invited';
  const statusColor = p.status === 'complete' ? 'var(--green)' : p.status === 'in_progress' ? 'var(--amber)' : 'var(--text-light)';

  return (
    <div className={`ma-side-card ma-side-card--${p.role}`}>
      <div className="ma-side-header">
        <span className="ma-side-role">{ROLE_LABEL[p.role] || p.role}</span>
        <span className="ma-side-status" style={{ color: statusColor }}>● {statusLabel}</span>
      </div>
      <div className="ma-side-company">{p.companyName}</div>
      {p.report ? (
        <div className="ma-side-metrics">
          <div className="ma-side-metric">
            <span className="ma-side-metric-val">{fmt(p.report.totalAnnualCost)}</span>
            <span className="ma-side-metric-lbl">Annual cost</span>
          </div>
          <div className="ma-side-metric">
            <span className="ma-side-metric-val">
              {p.report.automationPercentage != null ? p.report.automationPercentage + '%' : '—'}
            </span>
            <span className="ma-side-metric-lbl">Automation</span>
          </div>
          <div className="ma-side-metric">
            <span className="ma-side-metric-val">{p.report.rawSteps?.length ?? '—'}</span>
            <span className="ma-side-metric-lbl">Steps</span>
          </div>
          <div className="ma-side-metric">
            <span className="ma-side-metric-val">{fmt(p.report.potentialSavings)}</span>
            <span className="ma-side-metric-lbl">Savings potential</span>
          </div>
        </div>
      ) : (
        <p className="ma-side-no-report">Process map not yet submitted.</p>
      )}
      {p.report?.reportUrl && (
        <Link href={p.report.reportUrl} className="deal-btn deal-btn--sm ma-report-link" target="_blank">
          View full report →
        </Link>
      )}
      {!p.report && p.inviteUrl && (
        <button
          type="button"
          className="deal-btn deal-btn--sm"
          onClick={() => navigator.clipboard?.writeText(p.inviteUrl)}
        >
          Copy invite link
        </button>
      )}
    </div>
  );
}

function StepDecisionLayer({ acquirerSteps, targetSteps, stepDecisions, onDecision, savingKey, combinedBaseline }) {
  const maxLen = Math.max(acquirerSteps.length, targetSteps.length);

  // Synergy estimate
  const counts = Object.values(stepDecisions).reduce((acc, d) => { acc[d] = (acc[d] || 0) + 1; return acc; }, {});
  const avgStepCost = combinedBaseline > 0 && maxLen > 0 ? combinedBaseline / maxLen : 0;
  const synergyRemove = (counts.remove || 0) * avgStepCost;
  const synergyMerge = (counts.merge || 0) * avgStepCost * 0.5;
  const synergyKeep = ((counts.acquirer || 0) + (counts.target || 0)) * avgStepCost * 0.5;
  const totalSynergy = synergyRemove + synergyMerge + synergyKeep;
  const decidedCount = Object.keys(stepDecisions).length;

  return (
    <div className="ma-decisions-section">
      <div className="ma-decisions-header">
        <div>
          <h2 className="ma-decisions-title">Step-by-step integration decisions</h2>
          <p className="ma-decisions-subtitle">
            For each step, choose which version to carry into the merged process.
          </p>
        </div>
        <span className="ma-decisions-progress">{decidedCount}/{maxLen} decided</span>
      </div>

      <div className="ma-decisions-legend">
        {DECISION_OPTIONS.map((d) => (
          <span key={d.key} className="ma-legend-item" style={{ color: d.color }}>
            <span className="ma-legend-dot" style={{ background: d.color }} />
            {d.label}
          </span>
        ))}
      </div>

      <div className="ma-col-labels">
        <span className="ma-col-label ma-col-label--acquirer">Acquirer</span>
        <span className="ma-col-label ma-col-label--target">Target</span>
      </div>

      <div className="ma-steps-list">
        {Array.from({ length: maxLen }, (_, i) => {
          const aStep = acquirerSteps[i];
          const tStep = targetSteps[i];
          const key = `step_${i}`;
          const decided = stepDecisions[key];
          const saving = savingKey === key;

          return (
            <div key={key} className={`ma-step-row ${decided ? 'ma-step-row--decided' : ''}`}>
              <div className="ma-step-num">{i + 1}</div>
              <div className="ma-step-sides">
                <div
                  className={`ma-step-side ma-step-side--acquirer ${
                    decided === 'acquirer' || decided === 'merge' ? 'ma-step-side--kept' :
                    decided ? 'ma-step-side--dropped' : ''
                  }`}
                >
                  {aStep ? (
                    <>
                      <span className="ma-step-name">{aStep.name || `Step ${i + 1}`}</span>
                      {aStep.department && <span className="ma-step-dept">{aStep.department}</span>}
                    </>
                  ) : (
                    <span className="ma-step-none">—</span>
                  )}
                </div>
                <div className="ma-step-decisions">
                  {DECISION_OPTIONS.map((d) => (
                    <button
                      key={d.key}
                      type="button"
                      className={`ma-decision-btn ${decided === d.key ? 'ma-decision-btn--active' : ''}`}
                      style={decided === d.key
                        ? { background: d.color, borderColor: d.color, color: '#fff' }
                        : { borderColor: d.color + '55', color: d.color }
                      }
                      onClick={() => onDecision(key, d.key)}
                      disabled={saving}
                      title={d.label}
                    >
                      {d.short}
                    </button>
                  ))}
                  {saving && <span className="ma-step-saving">…</span>}
                </div>
                <div
                  className={`ma-step-side ma-step-side--target ${
                    decided === 'target' || decided === 'merge' ? 'ma-step-side--kept' :
                    decided ? 'ma-step-side--dropped' : ''
                  }`}
                >
                  {tStep ? (
                    <>
                      <span className="ma-step-name">{tStep.name || `Step ${i + 1}`}</span>
                      {tStep.department && <span className="ma-step-dept">{tStep.department}</span>}
                    </>
                  ) : (
                    <span className="ma-step-none">—</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {decidedCount > 0 && combinedBaseline > 0 && (
        <div className="ma-synergy-panel">
          <h3 className="ma-synergy-title">Estimated integration synergy</h3>
          <div className="ma-synergy-grid">
            {[
              { label: 'Removed steps', count: counts.remove || 0, saving: synergyRemove },
              { label: 'Merged steps', count: counts.merge || 0, saving: synergyMerge },
              { label: 'Kept (one side)', count: (counts.acquirer || 0) + (counts.target || 0), saving: synergyKeep },
            ].filter((r) => r.count > 0).map((r) => (
              <div key={r.label} className="ma-synergy-row">
                <span>{r.label}: <strong>{r.count}</strong></span>
                <span className="ma-synergy-saving">{fmt(r.saving)}/yr</span>
              </div>
            ))}
            <div className="ma-synergy-total">
              <span>Total estimated synergy</span>
              <span className="ma-synergy-total-val">{fmt(totalSynergy)}/yr</span>
            </div>
          </div>
          <p className="ma-synergy-note">
            {decidedCount} of {maxLen} steps decided.
            Estimate based on average step cost of {fmt(avgStepCost)}/yr.
          </p>
        </div>
      )}
    </div>
  );
}

export default function DealPageMA({ deal, participants, summary, accessToken, onRefresh }) {
  const [stepDecisions, setStepDecisions] = useState(deal.stepDecisions || {});
  const [savingKey, setSavingKey] = useState(null);

  const acquirerP = participants.find((p) => p.role === 'acquirer');
  const targetP = participants.find((p) => p.role === 'target');

  const acquirerSteps = acquirerP?.report?.rawSteps || [];
  const targetSteps = targetP?.report?.rawSteps || [];
  const hasSteps = acquirerSteps.length > 0 || targetSteps.length > 0;
  const bothComplete = acquirerP?.status === 'complete' && targetP?.status === 'complete';

  const handleDecision = useCallback(async (stepKey, decision) => {
    const newDecisions = { ...stepDecisions, [stepKey]: decision };
    setStepDecisions(newDecisions);
    setSavingKey(stepKey);
    try {
      await apiFetch(`/api/deals/${deal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { stepDecisions: newDecisions } }),
      }, accessToken);
    } catch { /* non-fatal */ } finally {
      setSavingKey(null);
    }
  }, [stepDecisions, deal.id, accessToken]);

  return (
    <div className="ma-page">
      {/* Summary strip */}
      <div className="ma-summary-strip">
        <div className="ma-summary-tile">
          <span className="ma-summary-val">{fmt(summary?.acquirerCost)}</span>
          <span className="ma-summary-lbl">Acquirer annual cost</span>
        </div>
        <div className="ma-summary-tile">
          <span className="ma-summary-val">{fmt(summary?.targetCost)}</span>
          <span className="ma-summary-lbl">Target annual cost</span>
        </div>
        <div className="ma-summary-tile">
          <span className="ma-summary-val">{fmt(summary?.combinedBaseline)}</span>
          <span className="ma-summary-lbl">Combined baseline</span>
        </div>
      </div>

      {/* Side-by-side participant cards */}
      <div className="ma-compare-grid">
        <ParticipantCard p={acquirerP} />
        <ParticipantCard p={targetP} />
      </div>

      {/* Step decision layer */}
      {bothComplete && hasSteps ? (
        <StepDecisionLayer
          acquirerSteps={acquirerSteps}
          targetSteps={targetSteps}
          stepDecisions={stepDecisions}
          onDecision={handleDecision}
          savingKey={savingKey}
          combinedBaseline={summary?.combinedBaseline || 0}
        />
      ) : bothComplete && !hasSteps ? (
        <p className="ma-pending-note">
          Step data not available. Both reports must include detailed process steps for the decision layer.
        </p>
      ) : (
        <p className="ma-pending-note">
          Both acquirer and target must complete their process maps before step-level decisions can be made.
        </p>
      )}
    </div>
  );
}
