'use client';

import { useState } from 'react';
import Link from 'next/link';
import DealAnalysisSection from './DealAnalysisSection';

const ROLE_LABEL = {
  platform_company: 'Platform Co.',
  portfolio_company: 'Portfolio Co.',
};

function fmt(val) {
  if (val == null || val === 0) return '-';
  if (val >= 1_000_000) return '£' + (val / 1_000_000).toFixed(1) + 'M';
  if (val >= 1_000) return '£' + (val / 1_000).toFixed(0) + 'K';
  return '£' + Math.round(val);
}

function CompletionTracker({ participants, summary, currentUserEmail }) {
  const [copiedId, setCopiedId] = useState(null);
  const me = (currentUserEmail || '').toLowerCase();

  const copyInvite = async (p) => {
    try { await navigator.clipboard?.writeText(p.inviteUrl); } catch { /* ignore */ }
    setCopiedId(p.id);
    setTimeout(() => setCopiedId((v) => (v === p.id ? null : v)), 1600);
  };

  return (
    <div className="pe-tracker">
      <div className="pe-tracker-header">
        <h2 className="pe-tracker-title">Process Mapping Progress</h2>
        <span className="pe-tracker-count">
          {summary.completedCount}/{summary.totalCount} companies complete
        </span>
      </div>
      <div className="pe-tracker-grid">
        {participants.map((p) => {
          const isMe = !!me && !!p.participantEmail && p.participantEmail.toLowerCase() === me;
          return (
            <div
              key={p.id}
              className={`pe-tracker-card pe-tracker-card--${p.status === 'complete' ? 'done' : 'pending'}${isMe ? ' pe-tracker-card--me' : ''}`}
            >
              <div className="pe-tracker-card-top">
                <span className="pe-tracker-company">
                  {p.companyName}
                  {isMe && <span className="pe-tracker-you-badge">You</span>}
                </span>
                <span className={`pe-tracker-dot pe-tracker-dot--${p.status === 'complete' ? 'done' : 'pending'}`} />
              </div>
              <span className="pe-tracker-role">{ROLE_LABEL[p.role] || p.role}</span>
              {p.status === 'complete' && p.report ? (
                <div className="pe-tracker-metrics">
                  <span>{p.report.automationPercentage != null ? p.report.automationPercentage + '% automation' : '-'}</span>
                  <span>{fmt(p.report.totalAnnualCost)}/yr</span>
                  <span>{p.report.rawSteps?.length || '-'} steps</span>
                </div>
              ) : (
                <div className="pe-tracker-pending">
                  {p.inviteUrl ? (
                    isMe ? (
                      <Link href={p.inviteUrl} className="pe-tracker-start">
                        Start your mapping →
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className="pe-tracker-copy"
                        onClick={() => copyInvite(p)}
                      >
                        {copiedId === p.id ? 'Copied ✓' : 'Copy invite link'}
                      </button>
                    )
                  ) : (
                    <span className="pe-tracker-waiting">Awaiting submission</span>
                  )}
                </div>
              )}
              {p.report?.reportUrl && (
                <Link href={p.report.reportUrl} className="pe-tracker-report-link" target="_blank" rel="noopener noreferrer">
                  View report →
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DealPagePE({ deal, participants, summary, accessToken, currentUserEmail = '' }) {
  return (
    <div className="pe-page">
      <CompletionTracker participants={participants} summary={summary} currentUserEmail={currentUserEmail} />

      {summary.completedCount > 0 && (
        <div className="pe-summary-strip">
          <div className="pe-summary-tile">
            <span className="pe-summary-val">{fmt(summary.totalAnnualCost)}</span>
            <span className="pe-summary-lbl">Combined annual cost</span>
          </div>
          <div className="pe-summary-tile">
            <span className="pe-summary-val">
              {summary.avgAutomationPercentage != null ? summary.avgAutomationPercentage + '%' : '-'}
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

      <DealAnalysisSection
        deal={deal}
        participants={participants}
        summary={summary}
        accessToken={accessToken}
        ctaTitle="All companies have completed their process maps"
        ctaText="Run the AI analysis to compare processes across all portfolio companies and identify where it makes sense to standardise, consolidate, or quantify the integration upside."
      />
    </div>
  );
}
