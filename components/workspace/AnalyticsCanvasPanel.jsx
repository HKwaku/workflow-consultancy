'use client';

/**
 * Canvas-native analytics. Replaces the old iframe embed of /portal/analytics
 * — auth + data fetch + chart render all happen here, mounted directly in
 * whichever surface needs it (workspace tab, chat rail overlay, mobile canvas
 * overlay).
 *
 * Side-effect imports of portal.css / report.css / cost.css join the cascade
 * of whichever page hosts this. If those styles start fighting diagnostic.css
 * again, scope new rules to the .analytics-canvas-root wrapper below — that's
 * the hook intended for it.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getSupabaseClient, getSessionSafe } from '@/lib/supabase';
import { apiFetch } from '@/lib/api-fetch';
import { formatCurrency } from '@/lib/diagnostic/utils';
import SignInForm from '@/components/auth/SignInForm';
import '@/components/org-admin/org-admin.css';
import '@/public/styles/diagnostic.css';
import '@/lib/modules/report/report.css';
import '@/lib/modules/cost/cost.css';

function formatRelative(iso) {
  if (!iso) return '';
  const sec = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function AnalyticsBody({ reportList, metrics, onMetricDrill }) {
  const [chartType, setChartType] = useState('pie');
  const [showAllQuickWins, setShowAllQuickWins] = useState(false);
  const [showAllHighRisk, setShowAllHighRisk] = useState(false);
  const [showAllActivity, setShowAllActivity] = useState(false);
  const { totalProcs, avgAuto, autoColor, totalCost } = metrics;

  const costByDept = useMemo(() => {
    const deptMap = {};
    let hasDeptData = false;
    reportList.forEach((r) => {
      if (r.metrics?.costByDept && typeof r.metrics.costByDept === 'object') {
        hasDeptData = true;
        Object.entries(r.metrics.costByDept).forEach(([dept, cost]) => {
          if (dept && typeof cost === 'number' && cost > 0) {
            deptMap[dept] = (deptMap[dept] || 0) + cost;
          }
        });
      } else if (Array.isArray(r.metrics?.processes)) {
        r.metrics.processes.forEach((proc) => {
          const dept = proc.department;
          const cost = proc.annualCost ?? proc.totalCost ?? proc.cost ?? 0;
          if (dept && typeof cost === 'number' && cost > 0) {
            hasDeptData = true;
            deptMap[dept] = (deptMap[dept] || 0) + cost;
          }
        });
      }
    });
    if (!hasDeptData) return null;
    return Object.entries(deptMap)
      .map(([dept, cost]) => ({ dept, cost }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 6);
  }, [reportList]);

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

  const segmentBreakdown = useMemo(() => {
    const SEGMENT_META = {
      scaling: { label: 'Scaling', color: '#0d9488' },
      ma: { label: 'M&A', color: '#6366f1' },
      pe: { label: 'PE', color: '#8b5cf6' },
      highstakes: { label: 'High-stakes', color: '#d97706' },
    };
    const counts = {};
    reportList.forEach((r) => {
      if (r.segment) counts[r.segment] = (counts[r.segment] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([seg, n]) => ({ seg, n, ...SEGMENT_META[seg] }))
      .sort((a, b) => b.n - a.n);
  }, [reportList]);

  const funnelData = useMemo(() => {
    const diagnosed = reportList.length;
    const redesigned = reportList.filter((r) => (r.redesignVersions || []).length > 0 || r.redesignStatus === 'pending' || r.redesignStatus === 'accepted').length;
    const accepted = reportList.filter((r) => r.redesignStatus === 'accepted').length;
    const buildReady = reportList.filter((r) => r.redesignStatus === 'accepted' && (r.redesignVersions || []).some((v) => v.status === 'accepted')).length;
    return [
      { label: 'Diagnosed', n: diagnosed, color: '#0d9488' },
      { label: 'Redesigned', n: redesigned, color: '#3b82f6' },
      { label: 'Accepted', n: accepted, color: '#8b5cf6' },
      { label: 'Build ready', n: buildReady, color: '#f59e0b' },
    ];
  }, [reportList]);

  const recentActivity = useMemo(() => reportList
    .map((r) => ({
      id: r.id,
      label: (r.processes || []).map((p) => p.name).join(', ') || r.displayCode || r.id?.slice(0, 8) || 'Process',
      what: r.redesignStatus === 'accepted' ? 'Redesign accepted'
        : r.redesignStatus === 'pending' ? 'AI redesign generated'
        : 'Process updated',
      at: r.updatedAt || r.createdAt,
    }))
    .sort((a, b) => new Date(b.at) - new Date(a.at)), [reportList]);

  const highRisk = useMemo(() => reportList
    .filter((r) => (r.metrics?.automationPercentage ?? 0) < 30 && r.redesignStatus !== 'accepted')
    .sort((a, b) => (a.metrics?.automationPercentage ?? 0) - (b.metrics?.automationPercentage ?? 0))
    .map((r) => ({
      id: r.id,
      label: (r.processes || []).map((p) => p.name).join(', ') || r.displayCode || r.id?.slice(0, 8),
      auto: r.metrics?.automationPercentage ?? 0,
      cost: r.metrics?.totalAnnualCost ?? 0,
    })), [reportList]);

  const quickWins = useMemo(() => {
    const items = [];
    reportList.forEach((r) => {
      const recs = r.recommendations || r.results?.recommendations || [];
      const hasRedesign = (r.redesignVersions || []).length > 0 || r.redesignStatus === 'pending' || r.redesignStatus === 'accepted';
      recs
        .filter((rec) => rec.effortLevel === 'quick-win' || rec.effort === 'quick-win')
        .slice(0, 2)
        .forEach((rec) => {
          items.push({
            id: r.id,
            label: (r.processes || []).map((p) => p.name).join(', ') || r.displayCode || r.id?.slice(0, 8),
            action: rec.action || rec.text || rec.finding,
            type: 'recommendation',
            badge: 'Quick win',
            badgeColor: '#0d9488',
            hasRedesign,
          });
        });
    });
    if (items.length === 0) {
      reportList
        .filter((r) => {
          const pct = r.metrics?.automationPercentage ?? 0;
          return pct >= 30 && pct < 70 && r.redesignStatus !== 'accepted';
        })
        .sort((a, b) => (b.metrics?.automationPercentage ?? 0) - (a.metrics?.automationPercentage ?? 0))
        .slice(0, 5)
        .forEach((r) => {
          const pct = r.metrics?.automationPercentage ?? 0;
          const hasRedesign = (r.redesignVersions || []).length > 0 || r.redesignStatus === 'pending' || r.redesignStatus === 'accepted';
          items.push({
            id: r.id,
            label: (r.processes || []).map((p) => p.name).join(', ') || r.displayCode || r.id?.slice(0, 8),
            action: `${pct}% automation readiness - ${70 - pct}% from optimised threshold`,
            type: 'process',
            badge: 'Automation-ready',
            badgeColor: '#3b82f6',
            hasRedesign,
          });
        });
    }
    return items;
  }, [reportList]);

  const handleMetricClick = (metricKey, value, label) => {
    if (onMetricDrill) onMetricDrill({ metricKey, value, label });
  };

  if (reportList.length === 0) {
    return (
      <div className="portal-analytics-panel">
        <h2 className="portal-analytics-title">Analytics</h2>
        <div className="portal-analytics-empty-state">
          <p className="portal-analytics-empty-state-msg">
            Map your first process to see analytics here.
          </p>
          <Link href="/workspace/map" className="portal-analytics-empty-cta">
            Map a process &rarr;
          </Link>
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
                  <button type="button" className={chartType === 'pie' ? 'active' : ''} onClick={() => setChartType('pie')}>Pie</button>
                  <button type="button" className={chartType === 'bar' ? 'active' : ''} onClick={() => setChartType('bar')}>Bar</button>
                </div>
              </div>

              {chartType === 'pie' ? (
                <div className="portal-donut-row">
                  <div className="portal-donut-wrap">
                    <svg className="portal-donut" viewBox="0 0 36 36">
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke="#0d9488" strokeWidth="3" strokeDasharray={`${automationReadyPct} ${100 - automationReadyPct}`} strokeDashoffset="25" />
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke="#ea580c" strokeWidth="3" strokeDasharray={`${redesignedPct} ${100 - redesignedPct}`} strokeDashoffset={25 - automationReadyPct} />
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke="#7c3aed" strokeWidth="3" strokeDasharray={`${requiresRedesignPct} ${100 - requiresRedesignPct}`} strokeDashoffset={25 - automationReadyPct - redesignedPct} />
                    </svg>
                    <div className="portal-donut-center">
                      <span className="portal-donut-val">{reportList.length}</span>
                      <span className="portal-donut-lbl">processes</span>
                    </div>
                  </div>
                  <ul className="portal-donut-legend">
                    <li><span className="portal-donut-dot" style={{ background: '#0d9488' }} />Automation Ready: {statusCounts.automationReady} ({automationReadyPct}%)</li>
                    <li><span className="portal-donut-dot" style={{ background: '#ea580c' }} />Redesigned: {statusCounts.redesigned} ({redesignedPct}%)</li>
                    <li><span className="portal-donut-dot" style={{ background: '#7c3aed' }} />Requires Redesign: {statusCounts.requiresRedesign} ({requiresRedesignPct}%)</li>
                  </ul>
                </div>
              ) : (
                <div className="portal-status-bar-chart-horizontal">
                  <div className="portal-status-bar-row-h">
                    <span className="portal-status-bar-label-h">Automation Ready</span>
                    <div className="portal-status-bar-track-h"><div className="portal-status-bar-fill-h" style={{ width: `${automationReadyPct}%`, background: '#0d9488' }} /></div>
                    <span className="portal-status-bar-val-h">{statusCounts.automationReady} ({automationReadyPct}%)</span>
                  </div>
                  <div className="portal-status-bar-row-h">
                    <span className="portal-status-bar-label-h">Redesigned</span>
                    <div className="portal-status-bar-track-h"><div className="portal-status-bar-fill-h" style={{ width: `${redesignedPct}%`, background: '#ea580c' }} /></div>
                    <span className="portal-status-bar-val-h">{statusCounts.redesigned} ({redesignedPct}%)</span>
                  </div>
                  <div className="portal-status-bar-row-h">
                    <span className="portal-status-bar-label-h">Requires Redesign</span>
                    <div className="portal-status-bar-track-h"><div className="portal-status-bar-fill-h" style={{ width: `${requiresRedesignPct}%`, background: '#7c3aed' }} /></div>
                    <span className="portal-status-bar-val-h">{statusCounts.requiresRedesign} ({requiresRedesignPct}%)</span>
                  </div>
                </div>
              )}
            </section>

            {(() => {
              const n = funnelData.length;
              const W = 100;
              const gap = 3;
              const segH = 22;
              const totalH = n * segH + (n - 1) * gap;
              const widthAt = (boundary) => W - (boundary / n) * (W - 20);
              return (
                <section className="portal-analytics-section portal-status-funnel-right">
                  <span className="portal-analytics-section-title">Redesign Funnel</span>
                  <div className="portal-funnel-wrap">
                    <svg className="portal-funnel-svg" viewBox={`0 0 ${W} ${totalH}`} preserveAspectRatio="xMidYMid meet" style={{ overflow: 'visible' }}>
                      {funnelData.map((stage, i) => {
                        const topW = widthAt(i);
                        const botW = widthAt(i + 1);
                        const topX1 = (W - topW) / 2;
                        const topX2 = topX1 + topW;
                        const botX1 = (W - botW) / 2;
                        const botX2 = botX1 + botW;
                        const y1 = i * (segH + gap);
                        const y2 = y1 + segH;
                        return (
                          <polygon key={i} points={`${topX1},${y1} ${topX2},${y1} ${botX2},${y2} ${botX1},${y2}`} fill={stage.color} opacity={0.88} />
                        );
                      })}
                    </svg>
                    <ul className="portal-donut-legend">
                      {funnelData.map((stage, i) => (
                        <li key={i}><span className="portal-donut-dot" style={{ background: stage.color }} />{stage.label}: {stage.n}</li>
                      ))}
                    </ul>
                  </div>
                </section>
              );
            })()}
          </div>

          {segmentBreakdown.length > 0 && (
            <section className="portal-analytics-section">
              <span className="portal-analytics-section-title">Processes by segment</span>
              <div className="portal-cost-bar-chart">
                {segmentBreakdown.map(({ seg, n, label, color }) => {
                  const pct = Math.round((n / reportList.length) * 100);
                  return (
                    <div key={seg} className="portal-bar-row">
                      <span className="portal-bar-label" style={{ color }}>{label || seg}</span>
                      <div className="portal-bar-track"><div className="portal-bar-fill" style={{ width: `${Math.max(2, pct)}%`, background: color }} /></div>
                      <span className="portal-bar-val">{n} ({pct}%)</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {totalCost > 0 && (
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
                        <span className="portal-bar-label">{label}</span>
                        <div className="portal-bar-track"><div className="portal-bar-fill" style={{ width: `${Math.max(2, pct)}%` }} /></div>
                        <span className="portal-bar-val">{formatCurrency(cost)}</span>
                      </div>
                    );
                  })}
              </div>
            </section>
          )}

          <section className="portal-analytics-section">
            <span className="portal-analytics-section-title">Cost by team</span>
            {costByDept === null ? (
              <p className="portal-analytics-empty">Add team rates in Cost Analysis to see team-level breakdown.</p>
            ) : costByDept.length === 0 ? (
              <p className="portal-analytics-empty">No team cost data available yet.</p>
            ) : (() => {
              const deptTotal = costByDept.reduce((sum, d) => sum + d.cost, 0);
              return (
                <div className="portal-cost-bar-chart portal-dept-bar-chart">
                  {costByDept.map(({ dept, cost }) => {
                    const pct = deptTotal > 0 ? Math.round((cost / deptTotal) * 100) : 0;
                    return (
                      <div key={dept} className="portal-bar-row">
                        <span className="portal-bar-label">{dept}</span>
                        <div className="portal-bar-track"><div className="portal-bar-fill portal-dept-bar-fill" style={{ width: `${Math.max(2, pct)}%` }} /></div>
                        <span className="portal-bar-val">{formatCurrency(cost)}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </section>

          <div className="portal-three-col-row">
            <section className="portal-analytics-section portal-three-col-section">
              <span className="portal-analytics-section-title">Quick Wins</span>
              {quickWins.length === 0 ? (
                <p className="portal-analytics-empty">No quick wins identified yet.</p>
              ) : (
                <>
                  <ul className="portal-quick-list">
                    {(showAllQuickWins ? quickWins : quickWins.slice(0, 3)).map((item, i) => (
                      <li key={`${item.id}-${i}`} className="portal-quick-list-item">
                        <div className="portal-quick-item-header">
                          <span className={`portal-quick-badge${item.type === 'process' ? ' portal-quick-badge--auto' : ''}`} style={{ background: item.badgeColor }}>{item.badge}</span>
                          <span className="portal-quick-label">{item.label}</span>
                        </div>
                        {item.action && <span className="portal-quick-why">{item.action}</span>}
                        <div className="portal-quick-actions">
                          <Link href={`/workspace/map?view=${item.id}`} className="portal-quick-action-link" target="_blank" rel="noopener noreferrer">Open canvas &rarr;</Link>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {quickWins.length > 3 && (
                    <button type="button" className="portal-col-more-link" onClick={() => setShowAllQuickWins((v) => !v)}>
                      {showAllQuickWins ? 'Show less' : `+${quickWins.length - 3} more`}
                    </button>
                  )}
                </>
              )}
            </section>

            <section className="portal-analytics-section portal-three-col-section">
              <span className="portal-analytics-section-title">High Risk Processes</span>
              {highRisk.length === 0 ? (
                <p className="portal-analytics-empty">No high-risk processes - all processes are on track.</p>
              ) : (
                <>
                  <ul className="portal-risk-list">
                    {(showAllHighRisk ? highRisk : highRisk.slice(0, 3)).map((item) => (
                      <li key={item.id}>
                        <Link href={`/workspace/map?view=${item.id}`} className="portal-risk-link" target="_blank" rel="noopener noreferrer">{item.label}</Link>
                        <span className="portal-risk-why">{item.auto}% readiness{item.cost > 0 ? ` · ${formatCurrency(item.cost)}/yr` : ''}</span>
                      </li>
                    ))}
                  </ul>
                  {highRisk.length > 3 && (
                    <button type="button" className="portal-col-more-link" onClick={() => setShowAllHighRisk((v) => !v)}>
                      {showAllHighRisk ? 'Show less' : `+${highRisk.length - 3} more`}
                    </button>
                  )}
                </>
              )}
            </section>

            <section className="portal-analytics-section portal-three-col-section">
              <span className="portal-analytics-section-title">Recent Activity</span>
              {recentActivity.length === 0 ? (
                <p className="portal-analytics-empty">No activity yet. Updates will appear here as you map and refine processes.</p>
              ) : (
                <>
                  <ul className="portal-recent-list">
                    {(showAllActivity ? recentActivity : recentActivity.slice(0, 3)).map((item) => (
                      <li key={item.id}>
                        <Link href={`/workspace/map?view=${item.id}`} className="portal-recent-link" target="_blank" rel="noopener noreferrer">{item.label}</Link>
                        <span className="portal-recent-what">{item.what}</span>
                        <span className="portal-recent-date">{formatRelative(item.at)}</span>
                      </li>
                    ))}
                  </ul>
                  {recentActivity.length > 3 && (
                    <button type="button" className="portal-col-more-link" onClick={() => setShowAllActivity((v) => !v)}>
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

export default function AnalyticsCanvasPanel({ onMetricDrill }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [supabase, setSupabase] = useState(null);
  const [data, setData] = useState({ reports: [], teamSessions: [] });
  const [dataLoading, setDataLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const sb = getSupabaseClient();
        if (!mounted) return;
        setSupabase(sb);
        const { session: s } = await getSessionSafe(sb);
        if (mounted) { setSession(s); setUser(s?.user ?? null); }
        sb.auth.onAuthStateChange((_event, s2) => {
          if (mounted) { setSession(s2 ?? null); setUser(s2?.user ?? null); }
        });
      } catch (e) {
        console.warn('Supabase init failed:', e.message);
      } finally {
        if (mounted) setAuthLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!user?.email || !session?.access_token) return;
    let cancelled = false;
    setDataLoading(true);
    setError(null);
    apiFetch(`/api/get-dashboard?email=${encodeURIComponent(user.email)}`, {}, session.access_token)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.error) throw new Error(d.error);
        setData({ reports: d?.reports || [], teamSessions: d?.teamSessions || [] });
      })
      .catch((e) => !cancelled && setError(e?.message || 'Failed to load analytics.'))
      .finally(() => !cancelled && setDataLoading(false));
    return () => { cancelled = true; };
  }, [user?.email, session?.access_token]);

  const metrics = useMemo(() => {
    const reports = data.reports || [];
    if (!reports.length) return { totalProcs: 0, avgAuto: 0, autoColor: 'var(--text-mid)', totalCost: 0 };
    const totalProcs = reports.length;
    const automations = reports.map((r) => r.metrics?.automationPercentage || 0).filter((n) => n > 0);
    const avgAuto = automations.length ? Math.round(automations.reduce((a, b) => a + b, 0) / automations.length) : 0;
    const autoColor = avgAuto >= 60 ? '#0d9488' : avgAuto >= 30 ? '#d97706' : '#dc2626';
    const totalCost = reports.reduce((sum, r) => sum + (r.metrics?.totalAnnualCost || 0), 0);
    return { totalProcs, avgAuto, autoColor, totalCost };
  }, [data.reports]);

  if (authLoading) {
    return (
      <div className="analytics-canvas-root">
        <div className="loading-state" style={{ padding: 60 }}><div className="spinner" /><p>Loading…</p></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="analytics-canvas-root">
        <div className="portal-wrap" style={{ maxWidth: 480, margin: '40px auto', padding: '24px' }}>
          <SignInForm supabase={supabase} onAuthenticated={setUser} />
        </div>
      </div>
    );
  }

  return (
    <div className="analytics-canvas-root" style={{ padding: '16px 22px' }}>
      {dataLoading && <div className="loading-state" style={{ padding: 24 }}><div className="spinner" /><p>Loading analytics…</p></div>}
      {error && <p style={{ color: '#dc2626', padding: 16 }}>{error}</p>}
      {!dataLoading && !error && (
        <AnalyticsBody reportList={data.reports} metrics={metrics} onMetricDrill={onMetricDrill} />
      )}
    </div>
  );
}
