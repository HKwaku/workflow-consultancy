'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { formatCurrency } from '@/lib/diagnostic/utils';

function formatRelative(iso) {
  if (!iso) return '';
  const sec = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function PortalAnalyticsPanel({
  reportList = [],
  teamSessions = [],
  loading,
  activeSection,
  onSectionChange,
  metrics = {},
  onMetricDrill,
}) {
  const [chartType, setChartType] = useState('pie'); // 'pie' | 'bar'
  const [showAllQuickWins, setShowAllQuickWins] = useState(false);
  const [showAllHighRisk, setShowAllHighRisk] = useState(false);
  const [showAllActivity, setShowAllActivity] = useState(false);
  const { totalProcs, avgAuto, autoColor, redesignedCount, totalCost } = metrics;

  const statusCounts = useMemo(() => {
    const counts = { automationReady: 0, redesigned: 0, requiresRedesign: 0 };
    reportList.forEach((r) => {
      const pct = r.metrics?.automationPercentage ?? 0;
      const hasRedesign = r.redesignStatus === 'accepted' || r.redesignStatus === 'pending';
      if (pct >= 70) counts.automationReady++;
      else if (hasRedesign) counts.redesigned++;
      else counts.requiresRedesign++;
    });
    return counts;
  }, [reportList]);

  const total = reportList.length || 1;
  const automationReadyPct = Math.round((statusCounts.automationReady / total) * 100);
  const redesignedPct = Math.round((statusCounts.redesigned / total) * 100);
  const requiresRedesignPct = Math.round((statusCounts.requiresRedesign / total) * 100);

  // ── Redesign funnel ───────────────────────────────────────────
  const funnelData = useMemo(() => {
    const diagnosed  = reportList.length;
    const redesigned = reportList.filter(r => (r.redesignVersions || []).length > 0 || r.redesignStatus === 'pending' || r.redesignStatus === 'accepted').length;
    const accepted   = reportList.filter(r => r.redesignStatus === 'accepted').length;
    const buildReady = reportList.filter(r => r.redesignStatus === 'accepted' && (r.redesignVersions || []).some(v => v.status === 'accepted')).length;
    return [
      { label: 'Diagnosed',     n: diagnosed,  color: '#0d9488' },
      { label: 'Redesigned',    n: redesigned, color: '#3b82f6' },
      { label: 'Accepted',      n: accepted,   color: '#8b5cf6' },
      { label: 'Build ready',   n: buildReady, color: '#f59e0b' },
    ];
  }, [reportList]);

  // ── Recent activity (sorted by updatedAt) ────────────────────
  const recentActivity = useMemo(() => {
    return reportList
      .map(r => ({
        id: r.id,
        label: (r.processes || []).map(p => p.name).join(', ') || r.displayCode || r.id?.slice(0, 8) || 'Process',
        what: r.redesignStatus === 'accepted' ? 'Redesign accepted'
            : r.redesignStatus === 'pending'  ? 'AI redesign generated'
            : 'Diagnostic updated',
        at: r.updatedAt || r.createdAt,
      }))
      .sort((a, b) => new Date(b.at) - new Date(a.at));
  }, [reportList]);

  // ── High risk processes (auto < 30, no accepted redesign) ────
  const highRisk = useMemo(() => {
    return reportList
      .filter(r => (r.metrics?.automationPercentage ?? 0) < 30 && r.redesignStatus !== 'accepted')
      .sort((a, b) => (a.metrics?.automationPercentage ?? 0) - (b.metrics?.automationPercentage ?? 0))
      .map(r => ({
        id: r.id,
        label: (r.processes || []).map(p => p.name).join(', ') || r.displayCode || r.id?.slice(0, 8),
        auto: r.metrics?.automationPercentage ?? 0,
        cost: r.metrics?.totalAnnualCost ?? 0,
      }));
  }, [reportList]);

  // ── Quick wins: real quick-win recommendations + close-to-optimised processes ──
  const quickWins = useMemo(() => {
    const items = [];
    // 1. Collect quick-win recommendations from all reports
    reportList.forEach(r => {
      const recs = r.recommendations || r.results?.recommendations || [];
      recs
        .filter(rec => rec.effortLevel === 'quick-win' || rec.effort === 'quick-win')
        .slice(0, 2)
        .forEach(rec => {
          items.push({
            id: r.id,
            label: (r.processes || []).map(p => p.name).join(', ') || r.displayCode || r.id?.slice(0, 8),
            action: rec.action || rec.text || rec.finding,
            type: 'recommendation',
            badge: 'Quick win',
            badgeColor: '#0d9488',
          });
        });
    });
    // 2. Fall back to close-to-optimised processes if no real recommendations
    if (items.length === 0) {
      reportList
        .filter(r => {
          const pct = r.metrics?.automationPercentage ?? 0;
          return pct >= 30 && pct < 70 && r.redesignStatus !== 'accepted';
        })
        .sort((a, b) => (b.metrics?.automationPercentage ?? 0) - (a.metrics?.automationPercentage ?? 0))
        .slice(0, 5)
        .forEach(r => {
          const pct = r.metrics?.automationPercentage ?? 0;
          items.push({
            id: r.id,
            label: (r.processes || []).map(p => p.name).join(', ') || r.displayCode || r.id?.slice(0, 8),
            action: `${pct}% automation readiness — ${70 - pct}% from optimised threshold`,
            type: 'process',
            badge: `${pct}%`,
            badgeColor: '#3b82f6',
          });
        });
    }
    return items;
  }, [reportList]);

  const handleMetricClick = (metricKey, value, label) => {
    if (onMetricDrill) onMetricDrill({ metricKey, value, label });
  };

  if (loading) {
    return (
      <div className="portal-analytics-panel">
        <div className="portal-analytics-loading">
          <div className="spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="portal-analytics-panel">
      <h2 className="portal-analytics-title">Analytics</h2>
      <div className="portal-analytics-body">
        <div className="portal-analytics-scroll">
          <div className="portal-analytics-overview-cards">
            <button
              type="button"
              className="portal-analytics-metric"
              onClick={() => handleMetricClick('processesAnalysed', totalProcs ?? reportList.length, 'Processes Analysed')}
            >
              <span className="portal-analytics-metric-val">{totalProcs ?? reportList.length}</span>
              <span className="portal-analytics-metric-lbl">Processes Analysed</span>
            </button>
            <button
              type="button"
              className="portal-analytics-metric"
              onClick={() => handleMetricClick('automationReadiness', `${avgAuto ?? 0}%`, 'Automation Readiness')}
            >
              <span className="portal-analytics-metric-val" style={{ color: autoColor }}>
                {avgAuto ?? 0}%
              </span>
              <span className="portal-analytics-metric-lbl">Automation Readiness</span>
            </button>
            <button
              type="button"
              className="portal-analytics-metric"
              onClick={() => handleMetricClick('redesigned', redesignedCount ?? 0, 'Redesigned')}
            >
              <span className="portal-analytics-metric-val">{redesignedCount ?? 0}</span>
              <span className="portal-analytics-metric-lbl">Redesigned</span>
            </button>
            <button
              type="button"
              className="portal-analytics-metric"
              onClick={() => handleMetricClick('annualProcessCost', formatCurrency(totalCost ?? 0), 'Annual Process Cost')}
            >
              <span className="portal-analytics-metric-val">{formatCurrency(totalCost ?? 0)}</span>
              <span className="portal-analytics-metric-lbl">Annual Process Cost</span>
            </button>
          </div>

          <div className="portal-status-funnel-row">
          <section className="portal-analytics-section portal-status-funnel-left">
            <div className="portal-process-status-header">
              <span className="portal-analytics-section-title">Process Status</span>
              <div className="portal-chart-type-toggle">
                <button
                  type="button"
                  className={chartType === 'pie' ? 'active' : ''}
                  onClick={() => setChartType('pie')}
                >
                  Pie
                </button>
                <button
                  type="button"
                  className={chartType === 'bar' ? 'active' : ''}
                  onClick={() => setChartType('bar')}
                >
                  Bar
                </button>
              </div>
            </div>

            {reportList.length === 0 ? (
              <p className="portal-analytics-empty">No processes yet. Run a diagnostic to see analytics.</p>
            ) : chartType === 'pie' ? (
              <div className="portal-donut-row">
                <div className="portal-donut-wrap">
                  <svg className="portal-donut" viewBox="0 0 36 36">
                    <circle
                      cx="18"
                      cy="18"
                      r="15.9"
                      fill="none"
                      stroke="#0d9488"
                      strokeWidth="3"
                      strokeDasharray={`${automationReadyPct} ${100 - automationReadyPct}`}
                      strokeDashoffset="25"
                    />
                    <circle
                      cx="18"
                      cy="18"
                      r="15.9"
                      fill="none"
                      stroke="#ea580c"
                      strokeWidth="3"
                      strokeDasharray={`${redesignedPct} ${100 - redesignedPct}`}
                      strokeDashoffset={25 - automationReadyPct}
                    />
                    <circle
                      cx="18"
                      cy="18"
                      r="15.9"
                      fill="none"
                      stroke="#7c3aed"
                      strokeWidth="3"
                      strokeDasharray={`${requiresRedesignPct} ${100 - requiresRedesignPct}`}
                      strokeDashoffset={25 - automationReadyPct - redesignedPct}
                    />
                  </svg>
                  <div className="portal-donut-center">
                    <span className="portal-donut-val">{reportList.length}</span>
                    <span className="portal-donut-lbl">processes</span>
                  </div>
                </div>
                <ul className="portal-donut-legend">
                  <li>
                    <span className="portal-donut-dot" style={{ background: '#0d9488' }} />
                    Automation Ready: {statusCounts.automationReady} ({automationReadyPct}%)
                  </li>
                  <li>
                    <span className="portal-donut-dot" style={{ background: '#ea580c' }} />
                    Redesigned: {statusCounts.redesigned} ({redesignedPct}%)
                  </li>
                  <li>
                    <span className="portal-donut-dot" style={{ background: '#7c3aed' }} />
                    Requires Redesign: {statusCounts.requiresRedesign} ({requiresRedesignPct}%)
                  </li>
                </ul>
              </div>
            ) : (
              <div className="portal-status-bar-chart-horizontal">
                <div className="portal-status-bar-row-h">
                  <span className="portal-status-bar-label-h">Automation Ready</span>
                  <div className="portal-status-bar-track-h">
                    <div
                      className="portal-status-bar-fill-h"
                      style={{ width: `${automationReadyPct}%`, background: '#0d9488' }}
                    />
                  </div>
                  <span className="portal-status-bar-val-h">{statusCounts.automationReady} ({automationReadyPct}%)</span>
                </div>
                <div className="portal-status-bar-row-h">
                  <span className="portal-status-bar-label-h">Redesigned</span>
                  <div className="portal-status-bar-track-h">
                    <div
                      className="portal-status-bar-fill-h"
                      style={{ width: `${redesignedPct}%`, background: '#ea580c' }}
                    />
                  </div>
                  <span className="portal-status-bar-val-h">{statusCounts.redesigned} ({redesignedPct}%)</span>
                </div>
                <div className="portal-status-bar-row-h">
                  <span className="portal-status-bar-label-h">Requires Redesign</span>
                  <div className="portal-status-bar-track-h">
                    <div
                      className="portal-status-bar-fill-h"
                      style={{ width: `${requiresRedesignPct}%`, background: '#7c3aed' }}
                    />
                  </div>
                  <span className="portal-status-bar-val-h">{statusCounts.requiresRedesign} ({requiresRedesignPct}%)</span>
                </div>
              </div>
            )}
          </section>

          {/* ── Redesign Funnel (right of Process Status) ────── */}
          {reportList.length > 0 && (() => {
            const n = funnelData.length;
            // Fixed shape: top stage = full width, bottom stage narrows to ~20%
            // Each boundary between segments steps evenly from 100 → 20
            const W = 100;
            const gap = 3;
            const segH = 26;
            const totalH = n * segH + (n - 1) * gap;
            // Width at each boundary (n+1 values): 100 at top, 20 at bottom
            const widthAt = (boundary) => W - (boundary / n) * (W - 20);

            return (
              <section className="portal-analytics-section portal-status-funnel-right">
                <span className="portal-analytics-section-title">Redesign Funnel</span>
                <div className="portal-funnel-wrap">
                  <svg
                    className="portal-funnel-svg"
                    viewBox={`0 0 ${W} ${totalH}`}
                    preserveAspectRatio="xMidYMid meet"
                    style={{ overflow: 'visible' }}
                  >
                    {funnelData.map((stage, i) => {
                      const topW  = widthAt(i);
                      const botW  = widthAt(i + 1);
                      const topX1 = (W - topW) / 2;
                      const topX2 = topX1 + topW;
                      const botX1 = (W - botW) / 2;
                      const botX2 = botX1 + botW;
                      const y1 = i * (segH + gap);
                      const y2 = y1 + segH;
                      return (
                        <polygon
                          key={i}
                          points={`${topX1},${y1} ${topX2},${y1} ${botX2},${y2} ${botX1},${y2}`}
                          fill={stage.color}
                          opacity={0.88}
                        />
                      );
                    })}
                  </svg>
                  <ul className="portal-donut-legend">
                    {funnelData.map((stage, i) => (
                      <li key={i}>
                        <span className="portal-donut-dot" style={{ background: stage.color }} />
                        {stage.label}: {stage.n}
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            );
          })()}
          </div>

          {reportList.length > 0 && totalCost > 0 && (
            <section className="portal-analytics-section">
              <span className="portal-analytics-section-title">Cost by process</span>
              <div className="portal-cost-bar-chart">
                {reportList
                  .filter((r) => (r.metrics?.totalAnnualCost || 0) > 0)
                  .slice(0, 8)
                  .map((r) => {
                    const cost = r.metrics?.totalAnnualCost || 0;
                    const pct = totalCost > 0 ? Math.round((cost / totalCost) * 100) : 0;
                    const label = (r.processes || []).map((p) => p.name).join(', ') || r.displayCode || r.id?.slice(0, 8) || 'Process';
                    return (
                      <div key={r.id} className="portal-bar-row">
                        <span className="portal-bar-label">{label.length > 30 ? label.slice(0, 30) + '…' : label}</span>
                        <div className="portal-bar-track">
                          <div className="portal-bar-fill" style={{ width: `${Math.max(2, pct)}%` }} />
                        </div>
                        <span className="portal-bar-val">{formatCurrency(cost)}</span>
                      </div>
                    );
                  })}
              </div>
            </section>
          )}

          {/* ── Quick Wins · High Risk · Recent Activity (3 columns) ── */}
          <div className="portal-three-col-row">

            <section className="portal-analytics-section portal-three-col-section">
              <span className="portal-analytics-section-title">Quick Wins</span>
              {quickWins.length === 0 ? (
                <p className="portal-analytics-empty">
                  {reportList.length === 0 ? 'Run a diagnostic to surface quick wins.' : 'No quick wins identified yet.'}
                </p>
              ) : (
                <>
                  <ul className="portal-quick-list">
                    {(showAllQuickWins ? quickWins : quickWins.slice(0, 3)).map((item, i) => (
                      <li key={`${item.id}-${i}`}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{
                            fontSize: '0.6rem', fontWeight: 700, padding: '1px 6px',
                            borderRadius: 10, background: item.badgeColor,
                            color: '#fff', flexShrink: 0,
                          }}>{item.badge}</span>
                          <Link href={`/report?id=${item.id}&portal=1`} className="portal-quick-link">
                            {item.label}
                          </Link>
                        </div>
                        {item.action && <span className="portal-quick-why">{item.action}</span>}
                      </li>
                    ))}
                  </ul>
                  {quickWins.length > 3 && (
                    <button type="button" className="portal-col-more-link" onClick={() => setShowAllQuickWins(v => !v)}>
                      {showAllQuickWins ? 'Show less' : `+${quickWins.length - 3} more`}
                    </button>
                  )}
                </>
              )}
            </section>

            <section className="portal-analytics-section portal-three-col-section">
              <span className="portal-analytics-section-title">High Risk Processes</span>
              {highRisk.length === 0 ? (
                <p className="portal-analytics-empty">No high risk processes.</p>
              ) : (
                <>
                  <ul className="portal-risk-list">
                    {(showAllHighRisk ? highRisk : highRisk.slice(0, 3)).map((item) => (
                      <li key={item.id}>
                        <Link href={`/report?id=${item.id}&portal=1`} className="portal-risk-link">
                          {item.label}
                        </Link>
                        <span className="portal-risk-why">
                          {item.auto}% readiness{item.cost > 0 ? ` · ${formatCurrency(item.cost)}/yr` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {highRisk.length > 3 && (
                    <button type="button" className="portal-col-more-link" onClick={() => setShowAllHighRisk(v => !v)}>
                      {showAllHighRisk ? 'Show less' : `+${highRisk.length - 3} more`}
                    </button>
                  )}
                </>
              )}
            </section>

            <section className="portal-analytics-section portal-three-col-section">
              <span className="portal-analytics-section-title">Recent Activity</span>
              {recentActivity.length === 0 ? (
                <p className="portal-analytics-empty">No activity yet.</p>
              ) : (
                <>
                  <ul className="portal-recent-list">
                    {(showAllActivity ? recentActivity : recentActivity.slice(0, 3)).map((item) => (
                      <li key={item.id}>
                        <Link href={`/report?id=${item.id}&portal=1`} className="portal-recent-link">
                          {item.label}
                        </Link>
                        <span className="portal-recent-what">{item.what}</span>
                        <span className="portal-recent-date">{formatRelative(item.at)}</span>
                      </li>
                    ))}
                  </ul>
                  {recentActivity.length > 3 && (
                    <button type="button" className="portal-col-more-link" onClick={() => setShowAllActivity(v => !v)}>
                      {showAllActivity ? 'Show less' : `+${recentActivity.length - 3} more`}
                    </button>
                  )}
                </>
              )}
            </section>

          </div>

        </div>
      </div>
    </div>
  );
}
