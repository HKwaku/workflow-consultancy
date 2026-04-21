'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api-fetch';

const ROLE_LABEL = {
  platform_company: 'Platform Co.',
  portfolio_company: 'Portfolio Co.',
};

function fmt(val) {
  if (val == null || val === 0) return '—';
  if (val >= 1_000_000) return '£' + (val / 1_000_000).toFixed(1) + 'M';
  if (val >= 1_000) return '£' + (val / 1_000).toFixed(0) + 'K';
  return '£' + Math.round(val);
}

/* ── Completion tracker ───────────────────────────────────────── */

function CompletionTracker({ participants, summary }) {
  return (
    <div className="pe-tracker">
      <div className="pe-tracker-header">
        <h2 className="pe-tracker-title">Process Mapping Progress</h2>
        <span className="pe-tracker-count">
          {summary.completedCount}/{summary.totalCount} companies complete
        </span>
      </div>
      <div className="pe-tracker-grid">
        {participants.map((p) => (
          <div
            key={p.id}
            className={`pe-tracker-card pe-tracker-card--${p.status === 'complete' ? 'done' : 'pending'}`}
          >
            <div className="pe-tracker-card-top">
              <span className="pe-tracker-company">{p.companyName}</span>
              <span className={`pe-tracker-dot pe-tracker-dot--${p.status === 'complete' ? 'done' : 'pending'}`} />
            </div>
            <span className="pe-tracker-role">{ROLE_LABEL[p.role] || p.role}</span>
            {p.status === 'complete' && p.report ? (
              <div className="pe-tracker-metrics">
                <span>{p.report.automationPercentage != null ? p.report.automationPercentage + '% automation' : '—'}</span>
                <span>{fmt(p.report.totalAnnualCost)}/yr</span>
                <span>{p.report.rawSteps?.length || '—'} steps</span>
              </div>
            ) : (
              <div className="pe-tracker-pending">
                {p.inviteUrl ? (
                  <button
                    type="button"
                    className="pe-tracker-copy"
                    onClick={() => navigator.clipboard?.writeText(p.inviteUrl)}
                  >
                    Copy invite link
                  </button>
                ) : (
                  <span className="pe-tracker-waiting">Awaiting submission</span>
                )}
              </div>
            )}
            {p.report?.reportUrl && (
              <Link href={p.report.reportUrl} className="pe-tracker-report-link" target="_blank">
                View report →
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Analysis CTA ─────────────────────────────────────────────── */

function AnalysisCTA({ onRunAnalysis }) {
  return (
    <div className="pe-analysis-cta">
      <div className="pe-analysis-cta-icon">✓</div>
      <h3 className="pe-analysis-cta-title">All companies have completed their process maps</h3>
      <p className="pe-analysis-cta-text">
        Run the AI analysis to compare processes across all portfolio companies and identify
        where it makes sense to standardise or merge into a single process.
      </p>
      <button type="button" className="deal-btn deal-btn--primary pe-analysis-run-btn" onClick={onRunAnalysis}>
        Run cross-company analysis
      </button>
    </div>
  );
}

/* ── Analysis streaming panel ─────────────────────────────────── */

function AnalysisProgress({ message }) {
  return (
    <div className="pe-analysis-progress">
      <div className="pe-analysis-spinner" />
      <p className="pe-analysis-progress-msg">{message}</p>
    </div>
  );
}

/* ── Analysis results ─────────────────────────────────────────── */

function AnalysisResults({ analysis, participants, onRerun }) {
  const { result } = analysis;
  const companies = analysis.companiesAnalysed || [];
  const runDate = analysis.runAt ? new Date(analysis.runAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  return (
    <div className="pe-results">
      <div className="pe-results-header">
        <div>
          <h2 className="pe-results-title">Cross-company analysis</h2>
          <p className="pe-results-meta">
            {companies.length} companies · {runDate}
          </p>
        </div>
        <button type="button" className="deal-btn pe-rerun-btn" onClick={onRerun}>
          Re-run analysis
        </button>
      </div>

      {/* Summary */}
      <div className="pe-results-summary">
        <p>{result.summary}</p>
      </div>

      {/* Stats row */}
      <div className="pe-stats-row">
        <div className="pe-stat">
          <span className="pe-stat-val">{result.commonSteps?.length ?? 0}</span>
          <span className="pe-stat-lbl">Common steps</span>
        </div>
        <div className="pe-stat">
          <span className="pe-stat-val">{result.uniqueSteps?.length ?? 0}</span>
          <span className="pe-stat-lbl">Unique steps</span>
        </div>
        <div className="pe-stat">
          <span className="pe-stat-val">{result.mergeRecommendations?.length ?? 0}</span>
          <span className="pe-stat-lbl">Recommendations</span>
        </div>
        <div className="pe-stat">
          <span className="pe-stat-val">{result.proposedProcess?.length ?? 0}</span>
          <span className="pe-stat-lbl">Proposed steps</span>
        </div>
      </div>

      {/* Merge recommendations */}
      {result.mergeRecommendations?.length > 0 && (
        <section className="pe-section">
          <h3 className="pe-section-title">Recommendations</h3>
          <div className="pe-recs-list">
            {result.mergeRecommendations.map((rec, i) => (
              <div key={i} className="pe-rec-card">
                <div className="pe-rec-finding">{rec.finding}</div>
                <div className="pe-rec-action">{rec.action}</div>
                <div className="pe-rec-footer">
                  {rec.affectedSteps?.length > 0 && (
                    <span className="pe-rec-steps">
                      {rec.affectedSteps.join(' · ')}
                    </span>
                  )}
                  {rec.estimatedSavingPct > 0 && (
                    <span className="pe-rec-saving">~{rec.estimatedSavingPct}% saving</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Common steps */}
      {result.commonSteps?.length > 0 && (
        <section className="pe-section">
          <h3 className="pe-section-title">Common steps — standardise these</h3>
          <div className="pe-steps-table">
            <div className="pe-steps-table-head">
              <span>Step</span>
              <span>Present at</span>
              <span>Departments</span>
              <span>Variance</span>
            </div>
            {result.commonSteps.map((s, i) => (
              <div key={i} className={`pe-steps-row ${s.presentAtAll ? 'pe-steps-row--all' : ''}`}>
                <span className="pe-steps-name">
                  {s.name}
                  {s.presentAtAll && <span className="pe-steps-badge">All</span>}
                </span>
                <span className="pe-steps-companies">{s.presentAt?.join(', ') || '—'}</span>
                <span className="pe-steps-depts">{s.departments?.join(', ') || '—'}</span>
                <span className="pe-steps-variance">{s.varianceNote || '—'}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Unique steps */}
      {result.uniqueSteps?.length > 0 && (
        <section className="pe-section">
          <h3 className="pe-section-title">Unique steps — review for necessity</h3>
          <div className="pe-unique-list">
            {result.uniqueSteps.map((s, i) => (
              <div key={i} className={`pe-unique-item pe-unique-item--${s.recommendation}`}>
                <div className="pe-unique-left">
                  <span className="pe-unique-name">{s.name}</span>
                  <span className="pe-unique-company">{s.companyName}</span>
                </div>
                <div className="pe-unique-right">
                  <span className={`pe-unique-rec pe-unique-rec--${s.recommendation}`}>
                    {s.recommendation}
                  </span>
                  <span className="pe-unique-reason">{s.reason}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Proposed standard process */}
      {result.proposedProcess?.length > 0 && (
        <section className="pe-section">
          <h3 className="pe-section-title">Proposed standard process</h3>
          <p className="pe-section-sub">
            The recommended process for all portfolio companies to adopt.
          </p>
          <div className="pe-proposed-list">
            {result.proposedProcess.map((step, i) => (
              <div key={i} className="pe-proposed-step">
                <div className="pe-proposed-num">{step.stepNumber || i + 1}</div>
                <div className="pe-proposed-body">
                  <div className="pe-proposed-name">{step.name}</div>
                  <div className="pe-proposed-meta">
                    {step.department && <span className="pe-proposed-dept">{step.department}</span>}
                    {step.source && step.source !== 'common' && (
                      <span className="pe-proposed-source">from {step.source}</span>
                    )}
                    {step.source === 'common' && (
                      <span className="pe-proposed-source pe-proposed-source--common">common</span>
                    )}
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

/* ── Main component ───────────────────────────────────────────── */

export default function DealPagePE({ deal, participants, summary, accessToken, onRefresh }) {
  const allComplete = summary.completedCount === summary.totalCount && summary.totalCount > 0;
  const storedAnalysis = deal.settings?.analysis || null;

  const [analysisState, setAnalysisState] = useState(
    storedAnalysis ? 'done' : allComplete ? 'ready' : 'collecting'
  );
  const [analysis, setAnalysis] = useState(storedAnalysis);
  const [progressMsg, setProgressMsg] = useState('Starting analysis…');
  const [analysisError, setAnalysisError] = useState(null);
  const abortRef = useRef(null);

  // Re-sync when deal reloads (e.g. after onRefresh)
  useEffect(() => {
    const stored = deal.settings?.analysis || null;
    if (stored) {
      setAnalysis(stored);
      setAnalysisState('done');
    } else if (summary.completedCount === summary.totalCount && summary.totalCount > 0) {
      if (analysisState === 'collecting') setAnalysisState('ready');
    }
  }, [deal, summary]);

  const runAnalysis = async () => {
    setAnalysisState('streaming');
    setAnalysisError(null);
    setProgressMsg('Starting analysis…');

    const resp = await apiFetch(`/api/deals/${deal.id}/analyse`, { method: 'POST' }, accessToken);

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
    <div className="pe-page">
      {/* Participant completion tracker — always visible */}
      <CompletionTracker participants={participants} summary={summary} />

      {/* Summary strip */}
      {summary.completedCount > 0 && (
        <div className="pe-summary-strip">
          <div className="pe-summary-tile">
            <span className="pe-summary-val">{fmt(summary.totalAnnualCost)}</span>
            <span className="pe-summary-lbl">Combined annual cost</span>
          </div>
          <div className="pe-summary-tile">
            <span className="pe-summary-val">
              {summary.avgAutomationPercentage != null ? summary.avgAutomationPercentage + '%' : '—'}
            </span>
            <span className="pe-summary-lbl">Avg automation</span>
          </div>
          <div className="pe-summary-tile">
            <span className="pe-summary-val">{fmt(summary.totalPotentialSavings)}</span>
            <span className="pe-summary-lbl">Combined potential savings</span>
          </div>
          {summary.benchmarkCompany && (
            <div className="pe-summary-tile pe-summary-tile--highlight">
              <span className="pe-summary-val pe-summary-val--sm">
                {summary.benchmarkCompany.companyName}
              </span>
              <span className="pe-summary-lbl">Benchmark company</span>
            </div>
          )}
        </div>
      )}

      {/* Analysis area */}
      {analysisError && (
        <div className="pe-analysis-error">
          <p>{analysisError}</p>
        </div>
      )}

      {analysisState === 'collecting' && (
        <div className="pe-collecting-note">
          <p>
            {summary.totalCount - summary.completedCount} of {summary.totalCount} companies still need to complete their process map.
            Once all companies have submitted, you can run the cross-company analysis.
          </p>
        </div>
      )}

      {analysisState === 'ready' && (
        <AnalysisCTA onRunAnalysis={runAnalysis} />
      )}

      {analysisState === 'streaming' && (
        <AnalysisProgress message={progressMsg} />
      )}

      {analysisState === 'done' && analysis && (
        <AnalysisResults
          analysis={analysis}
          participants={participants}
          onRerun={() => setAnalysisState('ready')}
        />
      )}
    </div>
  );
}
