'use client';

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import { getSupabaseClient, getSessionSafe } from '@/lib/supabase';
import { calculateProcessSavings } from '@/lib/costSavingsCalculator';
import CostAccessPanel from '@/components/CostAccessPanel';

const G10_CURRENCIES = {
  GBP: { symbol: '£', code: 'GBP', name: 'British Pound' },
  USD: { symbol: '$', code: 'USD', name: 'US Dollar' },
  EUR: { symbol: '€', code: 'EUR', name: 'Euro' },
  JPY: { symbol: '¥', code: 'JPY', name: 'Japanese Yen' },
  CHF: { symbol: 'CHF', code: 'CHF', name: 'Swiss Franc' },
  CAD: { symbol: 'C$', code: 'CAD', name: 'Canadian Dollar' },
  AUD: { symbol: 'A$', code: 'AUD', name: 'Australian Dollar' },
  NZD: { symbol: 'NZ$', code: 'NZD', name: 'New Zealand Dollar' },
  SEK: { symbol: 'kr', code: 'SEK', name: 'Swedish Krona' },
  NOK: { symbol: 'kr', code: 'NOK', name: 'Norwegian Krone' },
};

function formatDuration(mins) {
  if (!mins || mins <= 0) return '0m';
  const d = Math.floor(mins / (60 * 8)); // 8-hour working day
  const rem = mins % (60 * 8);
  const h = Math.floor(rem / 60);
  const m = Math.round(rem % 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}min`);
  return parts.join(' ') || '0min';
}

function formatCurrency(val, currencyCode = 'GBP') {
  const c = G10_CURRENCIES[currencyCode] || G10_CURRENCIES.GBP;
  const sym = c.symbol;
  if (!val && val !== 0) return sym + '0';
  const n = Number(val);
  if (n < 0) return '-' + formatCurrency(-n, currencyCode);
  if (n >= 1_000_000) return sym + (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 100_000) return sym + (n / 1_000).toFixed(0) + 'K';
  if (n >= 1_000) return sym + (n / 1_000).toFixed(1) + 'K';
  return sym + Math.round(n);
}

function Tip({ text }) {
  return <span className="cost-tooltip" title={text} aria-label={text}>?</span>;
}

const CHART_COLORS = ['#0d9488', '#6366f1', '#d97706', '#059669', '#dc2626', '#7c3aed', '#0891b2', '#ea580c'];

function CostBarChart({ title, entries, getValue, getTotal, formatValue, maxBars = 8 }) {
  const total = getTotal();
  const sorted = [...entries].sort((a, b) => getValue(b[1]) - getValue(a[1])).slice(0, maxBars);
  if (sorted.length === 0 || total <= 0) return null;
  return (
    <div className="cost-chart-block">
      <h4 className="cost-chart-title">{title}</h4>
      <div className="cost-chart-bars">
        {sorted.map(([label, data], i) => {
          const val = getValue(data);
          const pct = Math.round((val / total) * 100);
          return (
            <div key={label} className="cost-chart-bar-row">
              <span className="cost-chart-bar-label" title={label}>
                <span className="cost-chart-bar-dot" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                {label}
              </span>
              <div className="cost-chart-bar-track">
                <div className="cost-chart-bar-fill" style={{ width: `${pct}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
              </div>
              <span className="cost-chart-bar-val">{formatValue(val)} <span className="cost-chart-bar-pct">{pct}%</span></span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CostVerticalBarChart({ title, labels, values, formatValue, highlightIdx }) {
  const max = Math.max(...values.map(Math.abs), 1);
  return (
    <div className="cost-chart-block cost-chart-vertical">
      <h4 className="cost-chart-title">{title}</h4>
      <div className="cost-chart-vertical-bars">
        {labels.map((label, i) => {
          const val = values[i] ?? 0;
          const h = max > 0 ? Math.abs(val) / max * 100 : 0;
          const isNeg = val < 0;
          return (
            <div key={i} className="cost-chart-vertical-cell">
              <div className="cost-chart-vertical-bar-wrap">
                <div
                  className={`cost-chart-vertical-bar${highlightIdx === i ? ' highlight' : ''}${isNeg ? ' negative' : ''}`}
                  style={{ height: `${h}%`, background: isNeg ? '#dc2626' : CHART_COLORS[i % CHART_COLORS.length] }}
                />
              </div>
              <span className="cost-chart-vertical-label">{label}</span>
              <span className={`cost-chart-vertical-val${isNeg ? ' negative' : ''}`}>{formatValue(val)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RedesignCostChart({ processBreakdown, formatValue }) {
  const hasRedesign = processBreakdown.some(p => p.redesignSavingsPct > 0);
  if (!hasRedesign) return null;

  const totalCurrent = processBreakdown.reduce((s, p) => s + p.trueAnnualCost, 0);
  const totalRedesigned = processBreakdown.reduce((s, p) => s + p.redesignCost, 0);
  const totalSavings = totalCurrent - totalRedesigned;
  const overallPct = totalCurrent > 0 ? Math.round(totalSavings / totalCurrent * 100) : 0;
  const maxCost = Math.max(...processBreakdown.map(p => p.trueAnnualCost), 1);

  return (
    <div className="redesign-cost-chart">
      <div className="redesign-cost-chart-header">
        <div className="redesign-cost-chart-title">Redesign impact on costs</div>
        <div className="redesign-cost-chart-summary">
          <span className="redesign-cost-saving-amount">{formatValue(totalSavings)}/yr</span>
          <span className="redesign-cost-saving-pct">−{overallPct}%</span>
        </div>
      </div>

      <div className="redesign-cost-bars">
        {processBreakdown.map((p, i) => {
          const redesignedPct = p.trueAnnualCost > 0 ? p.redesignCost / maxCost * 100 : 0;
          const savingsPct = p.trueAnnualCost > 0 ? p.redesignSavings / maxCost * 100 : 0;
          return (
            <div key={i} className="redesign-cost-row">
              {processBreakdown.length > 1 && (
                <div className="redesign-cost-row-label" title={p.name}>{p.name}</div>
              )}
              <div className="redesign-cost-row-bars">
                <div className="redesign-cost-bar-track">
                  <div className="redesign-cost-bar-redesigned" style={{ width: `${redesignedPct}%` }} />
                  <div className="redesign-cost-bar-savings" style={{ width: `${savingsPct}%` }} />
                </div>
                <div className="redesign-cost-row-vals">
                  <span className="redesign-cost-val-redesigned">{formatValue(p.redesignCost)}</span>
                  <span className="redesign-cost-val-savings">−{formatValue(p.redesignSavings)} ({p.redesignSavingsPct}%)</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="redesign-cost-legend">
        <span className="redesign-legend-item redesign-legend-redesigned">Projected cost</span>
        <span className="redesign-legend-item redesign-legend-savings">Redesign savings</span>
      </div>
    </div>
  );
}

function CostDonutChart({ title, segments, formatValue }) {
  const total = segments.reduce((s, [, v]) => s + (v || 0), 0);
  if (total <= 0) return null;
  let acc = 0;
  const parts = segments.filter(([, v]) => (v || 0) > 0).map(([label, val], i) => {
    const pct = (val / total) * 100;
    const start = acc;
    acc += pct;
    return { label, val, start, pct, color: CHART_COLORS[i % CHART_COLORS.length] };
  });
  const r = 42;
  const pad = 10;
  const size = 100 + pad * 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  return (
    <div className="cost-chart-block cost-chart-donut">
      <h4 className="cost-chart-title">{title}</h4>
      <div className="cost-chart-donut-body">
        <div className="cost-chart-donut-wrap">
          <svg viewBox={`0 0 ${size} ${size}`} className="cost-chart-donut-svg" preserveAspectRatio="xMidYMid meet">
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth="10" />
            {parts.map(({ start, pct, color }, i) => (
              <circle
                key={i}
                cx={cx} cy={cy} r={r}
                fill="none"
                stroke={color}
                strokeWidth="10"
                strokeDasharray={`${(pct / 100) * circumference} ${circumference}`}
                strokeDashoffset={-((start / 100) * circumference)}
                transform={`rotate(-90 ${cx} ${cy})`}
              />
            ))}
          </svg>
          <div className="cost-chart-donut-center">
            <span className="cost-chart-donut-total">{formatValue(total)}</span>
          </div>
        </div>
        <div className="cost-chart-donut-legend">
        {parts.map(({ label, val, color }) => (
          <div key={label} className="cost-chart-donut-legend-item">
            <span className="cost-chart-donut-dot" style={{ background: color }} />
            <span className="cost-chart-donut-legend-label">{label}</span>
            <span className="cost-chart-donut-legend-val">{formatValue(val)}</span>
          </div>
        ))}
        </div>
      </div>
    </div>
  );
}

function CostTrajectoryChart({ points, formatValue }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const chartLayoutRef = useRef(null);
  const [chartHover, setChartHover] = useState(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || points.length < 1) return;

    const draw = () => {
      const rect = container.getBoundingClientRect();
      const chartW = Math.max(280, Math.floor(rect.width || 360));
      const chartH = 220;
      const dpr = window.devicePixelRatio || 1;
      const pad = { top: 20, right: 20, bottom: 36, left: 68 };
      const plotH = chartH - pad.top - pad.bottom;
      const plotW = chartW - pad.left - pad.right;

      canvas.width = chartW * dpr;
      canvas.height = chartH * dpr;
      canvas.style.width = chartW + 'px';
      canvas.style.height = chartH + 'px';
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, chartW, chartH);

      const costs = points.map(p => p.cost);
      const maxVal = Math.max(...costs) * 1.12;
      const minVal = Math.min(...costs) * 0.82;
      const range = maxVal - minVal || 1;
      const n = points.length;
      const toY = v => pad.top + plotH - ((v - minVal) / range) * plotH;
      const toX = i => pad.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
      const baseY = pad.top + plotH;
      const COLOR = '#0d9488';

      // Grid lines
      const gridSteps = 4;
      ctx.font = `10px system-ui, sans-serif`;
      ctx.textAlign = 'right';
      for (let g = 0; g <= gridSteps; g++) {
        const v = minVal + (range * g) / gridSteps;
        const y = toY(v);
        ctx.strokeStyle = 'rgba(148,163,184,0.12)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(pad.left + plotW, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(148,163,184,0.55)';
        ctx.fillText(formatValue(v), pad.left - 6, y + 4);
      }

      // Axes
      ctx.strokeStyle = 'rgba(148,163,184,0.2)';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(pad.left, pad.top);
      ctx.lineTo(pad.left, baseY);
      ctx.lineTo(pad.left + plotW, baseY);
      ctx.stroke();

      if (n >= 2) {
        // Area fill
        const [r, g2, b] = [13, 148, 136];
        ctx.fillStyle = `rgba(${r},${g2},${b},0.18)`;
        ctx.beginPath();
        ctx.moveTo(toX(0), baseY);
        for (let i = 0; i < n; i++) ctx.lineTo(toX(i), toY(costs[i]));
        ctx.lineTo(toX(n - 1), baseY);
        ctx.closePath();
        ctx.fill();

        // Line
        ctx.strokeStyle = COLOR;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(toX(0), toY(costs[0]));
        for (let i = 1; i < n; i++) ctx.lineTo(toX(i), toY(costs[i]));
        ctx.stroke();
      }

      // Dots
      ctx.fillStyle = COLOR;
      for (let i = 0; i < n; i++) {
        ctx.beginPath();
        ctx.arc(toX(i), toY(costs[i]), 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // X labels
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(148,163,184,0.7)';
      ctx.font = `10px system-ui, sans-serif`;
      for (let i = 0; i < n; i++) {
        ctx.fillText(points[i].label, toX(i), chartH - 8);
      }

      // Hover crosshair
      chartLayoutRef.current = { pad, plotW, plotH, chartW, chartH, n, toX, toY };
      if (chartHover !== null && chartHover >= 0 && chartHover < n) {
        const x = toX(chartHover);
        ctx.strokeStyle = 'rgba(148,163,184,0.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, baseY);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(container);
    return () => ro.disconnect();
  }, [points, chartHover, formatValue]);

  const handleMouseMove = useCallback((e) => {
    const container = containerRef.current;
    const layout = chartLayoutRef.current;
    if (!container || !layout) return;
    const rect = container.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const { pad, plotW, n, toX } = layout;
    if (mx < pad.left || mx > pad.left + plotW) { setChartHover(null); return; }
    let best = 0, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(toX(i) - mx);
      if (d < bestD) { bestD = d; best = i; }
    }
    setChartHover(best);
  }, []);

  const handleMouseLeave = useCallback(() => setChartHover(null), []);

  return (
    <div className="cost-trajectory-wrap">
      <div
        ref={containerRef}
        className="cost-trajectory-canvas-wrap"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <canvas ref={canvasRef} className="cost-trajectory-canvas" />
        {chartHover !== null && chartLayoutRef.current && (
          <div
            className="cost-trajectory-tooltip"
            style={{
              left: chartLayoutRef.current.toX(chartHover),
              top: chartLayoutRef.current.pad.top,
            }}
          >
            <div className="cost-trajectory-tooltip-title">{points[chartHover]?.label}</div>
            <div className="cost-trajectory-tooltip-cost">{formatValue(points[chartHover]?.cost)}<span>/yr</span></div>
          </div>
        )}
      </div>
    </div>
  );
}

function CollapsibleSection({ title, subtitle, defaultOpen = false, children, badge }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`cost-collapsible${open ? ' open' : ''}`}>
      <button type="button" className="cost-collapsible-header" onClick={() => setOpen(o => !o)}>
        <div className="cost-collapsible-title-row">
          <span className="cost-collapsible-title">{title}</span>
          {badge && <span className="cost-collapsible-badge">{badge}</span>}
        </div>
        {subtitle && <span className="cost-collapsible-subtitle">{subtitle}</span>}
        <svg className={`cost-collapsible-chevron${open ? ' rotated' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && <div className="cost-collapsible-body">{children}</div>}
    </div>
  );
}

function CostAnalysisHeader({ id, title, extra }) {
  return (
    <header className="dashboard-header cost-analysis-header">
      <div className="header-left">
        <Link href="/" className="header-logo">Vesno<span className="header-logo-dot">.</span></Link>
        <div className="header-divider" />
        <span className="header-title">{title || 'Cost analysis'}</span>
      </div>
      <div className="header-right">
        <ThemeToggle className="header-theme-btn" />
        {extra}
        {id && <Link href={`/report?id=${id}`} className="header-nav-link">View report</Link>}
        <Link href="/portal" className="header-nav-link">Portal</Link>
      </div>
    </header>
  );
}

const DRIVER_DEFS = [
  { key: 'automation',    label: 'Step automation',        desc: 'Automating manual, repetitive steps',                    minsKey: 'automationMins' },
  { key: 'bottleneck',    label: 'Bottleneck removal',     desc: 'Eliminating wait time at the highest-wait step',         minsKey: 'bottleneckMins' },
  { key: 'redundancy',    label: 'Redundant step removal', desc: 'Consolidating duplicate approvals and steps',            minsKey: 'redundancyMins' },
  { key: 'workReduction', label: 'Work time reduction',    desc: 'Faster execution with better tooling',                   minsKey: 'workReductionMins' },
];

function DriverDetailSection({ heading, items, emptyText }) {
  const hasValues = items.some(i => (i.value || 0) > 0);
  const sorted = hasValues ? [...items].sort((a, b) => (b.value || 0) - (a.value || 0)) : items;
  const maxVal = hasValues ? Math.max(...sorted.map(i => i.value || 0), 1) : 1;

  return (
    <div className="cost-driver-detail-section">
      <div className="cost-driver-detail-heading">{heading}</div>
      {sorted.length === 0 ? (
        <p className="cost-driver-detail-empty">{emptyText}</p>
      ) : (
        <div className="cost-driver-detail-list">
          {sorted.map(({ name, meta, value }, idx) => {
            const pct = hasValues && value > 0 ? Math.round((value / maxVal) * 100) : 0;
            return (
              <div key={idx} className="cost-driver-detail-item">
                <div className="cost-driver-detail-item-top">
                  <span className="cost-driver-detail-name">{name}</span>
                  {meta && <span className="cost-driver-detail-meta">{meta}</span>}
                </div>
                {pct > 0 && (
                  <div className="cost-driver-detail-bar-track">
                    <div className="cost-driver-detail-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DriverDetail({ driverKey, raw, breakdown }) {
  const steps = raw?.steps || [];
  const handoffs = raw?.handoffs || [];

  if (driverKey === 'automation') {
    const automatable = steps.filter(s => !s.isDecision && !s.isMerge && !s.isAutomated);
    const alreadyDone = steps.filter(s => s.isAutomated);
    return (
      <div className="cost-driver-detail">
        <DriverDetailSection
          heading={`Automatable steps (${automatable.length})`}
          emptyText="No automatable steps identified. Add step types and timings in the process audit to improve this estimate."
          items={automatable.map((s, idx) => ({
            name: s.label || s.name || `Step ${idx + 1}`,
            meta: [s.workMinutes > 0 ? `${s.workMinutes}min work` : 'no timing', ...(s.systems?.length > 0 ? [s.systems.join(', ')] : [])].join(' · '),
            value: s.workMinutes || 0,
          }))}
        />
        {(alreadyDone.length > 0 || breakdown?.automationMins > 0) && (
          <div className="cost-driver-detail-footer">
            {alreadyDone.length > 0 && <span>{alreadyDone.length} step{alreadyDone.length !== 1 ? 's' : ''} already automated — excluded from saving.</span>}
            {breakdown?.automationMins > 0 && <span>{breakdown.automationMins}min work time across automatable steps.</span>}
          </div>
        )}
      </div>
    );
  }

  if (driverKey === 'bottleneck') {
    const waitSteps = steps.filter(s => (s.waitMinutes || 0) > 0);
    const sorted = [...waitSteps].sort((a, b) => (b.waitMinutes || 0) - (a.waitMinutes || 0));
    const bottleneckStep = sorted[0];
    const waitRatio = breakdown?.totalWorkMins > 0
      ? Math.round((breakdown.totalWaitMins || 0) / breakdown.totalWorkMins * 100)
      : 0;
    return (
      <div className="cost-driver-detail">
        <DriverDetailSection
          heading="Steps with wait time"
          emptyText="No wait times recorded. Add wait/idle time to steps in the process audit to identify bottleneck savings."
          items={sorted.map((s, idx) => ({
            name: (s.label || s.name || `Step ${idx + 1}`) + (s === bottleneckStep ? ' ← bottleneck' : ''),
            meta: formatDuration(s.waitMinutes),
            value: s.waitMinutes || 0,
          }))}
        />
        {breakdown && (
          <div className="cost-driver-detail-metrics">
            <span>Total wait: <strong>{formatDuration(breakdown.totalWaitMins)}</strong></span>
            <span>Total work: <strong>{formatDuration(breakdown.totalWorkMins)}</strong></span>
            {waitRatio > 0 && <span>Wait ratio: <strong>{waitRatio}%</strong></span>}
          </div>
        )}
      </div>
    );
  }

  if (driverKey === 'redundancy') {
    const decisions = steps.filter(s => s.isDecision);
    const flags = [
      steps.length > 12 && 'Large step count — consolidation opportunity',
      decisions.length > 2 && `${decisions.length} approvals — consider rule-based consolidation`,
    ].filter(Boolean);
    return (
      <div className="cost-driver-detail">
        <DriverDetailSection
          heading={`Approval & decision steps (${decisions.length})`}
          emptyText="No decision or approval steps found. Mark steps as decisions in the process audit to surface redundancy opportunities."
          items={decisions.map((s, idx) => ({
            name: s.label || s.name || `Decision ${idx + 1}`,
            meta: s.workMinutes > 0 ? `${s.workMinutes}min` : null,
            value: s.workMinutes || 0,
          }))}
        />
        <div className="cost-driver-detail-metrics">
          <span>Total steps: <strong>{steps.length}</strong></span>
          {flags.map((f, i) => <span key={i} className="cost-driver-detail-flag">{f}</span>)}
        </div>
      </div>
    );
  }

  if (driverKey === 'workReduction') {
    const emailHandoffs = handoffs.filter(h => h.method === 'email');
    const multiSys = steps.filter(s => (s.systems || []).length >= 2);
    return (
      <div className="cost-driver-detail">
        {emailHandoffs.length > 0 && (
          <DriverDetailSection
            heading={`Email handoffs (${emailHandoffs.length})`}
            emptyText=""
            items={emailHandoffs.map((h, idx) => ({
              name: `${h.from || 'Unknown'} → ${h.to || 'Unknown'}`,
              meta: h.avgDelayMins > 0 ? `${h.avgDelayMins}min avg delay` : null,
              value: h.avgDelayMins || 0,
            }))}
          />
        )}
        {multiSys.length > 0 && (
          <DriverDetailSection
            heading={`Multi-system steps (${multiSys.length})`}
            emptyText=""
            items={multiSys.map((s, idx) => ({
              name: s.label || s.name || `Step ${idx + 1}`,
              meta: s.systems.join(' + '),
            }))}
          />
        )}
        {emailHandoffs.length === 0 && multiSys.length === 0 && (
          <p className="cost-driver-detail-empty">Based on general tooling improvement potential across all manual steps.</p>
        )}
        {breakdown?.workReductionMins > 0 && (
          <div className="cost-driver-detail-footer">
            <span>{breakdown.workReductionMins}min saving per run estimated from tooling improvements.</span>
          </div>
        )}
      </div>
    );
  }

  return null;
}

function ProcessCostCard({ p, i, aiSuggestionData, processCostDrivers, onSetDrivers, formatCurrency, nonLabourCost }) {
  const suggestion = aiSuggestionData[i];
  const drivers = processCostDrivers[i] || {};
  const [showDrivers, setShowDrivers] = useState(false);

  const complexityColour = { low: '#059669', medium: '#d97706', high: '#dc2626' };

  const nlTotal = nonLabourCost?.total || 0;
  const fullAnnualCost = p.trueAnnualCost + nlTotal;
  const annualInstances = p.annual ?? 12;
  const costPerInstance = annualInstances > 0 ? fullAnnualCost / annualInstances : 0;

  return (
    <div className="cost-process-card">
      <div className="cost-process-card-header">
        <div className="cost-process-card-info">
          <span className="cost-process-card-name">{p.name}</span>
          {suggestion?.automationApproach && (
            <span className="cost-automation-approach">{suggestion.automationApproach}</span>
          )}
          {suggestion?.implementationComplexity && (
            <span className="cost-complexity-badge" style={{ color: complexityColour[suggestion.implementationComplexity] }}>
              {suggestion.implementationComplexity} complexity
            </span>
          )}
        </div>
        <div className="cost-process-card-cost">
          <div className="cost-process-card-stat">
            <span className="cost-process-card-total">{formatCurrency(fullAnnualCost)}</span>
            <span className="cost-process-card-unit">per year</span>
          </div>
          <div className="cost-process-card-stat-divider" />
          <div className="cost-process-card-stat">
            <span className="cost-process-card-total">{formatCurrency(costPerInstance)}</span>
            <span className="cost-process-card-unit">per instance</span>
          </div>
          <div className="cost-process-card-stat-divider" />
          <div className="cost-process-card-stat">
            <span className="cost-process-card-total">{annualInstances}</span>
            <span className="cost-process-card-unit">instances/yr</span>
          </div>
        </div>
      </div>

      {suggestion?.hiddenCostFlags?.length > 0 && (
        <div className="cost-hidden-flags">
          {suggestion.hiddenCostFlags.map((f, fi) => (
            <span key={fi} className="cost-hidden-flag">{f}</span>
          ))}
        </div>
      )}

      {(() => {
        const bars = [
          ['Direct labour', p.annualLabour],
          p.errorCost > 0 ? ['Error / rework', p.errorCost] : null,
          p.waitCost > 0 ? ['Wait / idle time', p.waitCost] : null,
          nonLabourCost?.sysCost > 0 ? ['Systems', nonLabourCost.sysCost] : null,
          nonLabourCost?.extCost > 0 ? ['External costs', nonLabourCost.extCost] : null,
          nonLabourCost?.complianceCost > 0 ? ['Compliance', nonLabourCost.complianceCost] : null,
        ].filter(Boolean);
        return (
          <div className="cost-breakdown-grid">
            {fullAnnualCost > 0 && (
              <div className="cost-breakdown-bars">
                {bars.map(([label, val], bi) => {
                  const pct = Math.round((val / fullAnnualCost) * 100);
                  const isNonLabour = bi >= 3;
                  return (
                    <div key={label} className={`cost-chart-bar-row${bi > 0 ? ' cost-breakdown-hidden-row' : ''}`}>
                      <span className="cost-chart-bar-label" title={label}>
                        <span className="cost-chart-bar-dot" style={{ background: CHART_COLORS[bi % CHART_COLORS.length] }} />
                        {label}
                      </span>
                      <div className="cost-chart-bar-track">
                        <div className="cost-chart-bar-fill" style={{ width: `${pct}%`, background: CHART_COLORS[bi % CHART_COLORS.length] }} />
                      </div>
                      <span className={`cost-chart-bar-val${bi > 0 ? ' cost-breakdown-hidden-val' : ''}`}>{formatCurrency(val)}</span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="cost-breakdown-meta">
              {p.hours}h × {p.annual} runs/yr × {p.teamSize} person(s) @ {formatCurrency(p.avgRawRate)}/hr
              {nlTotal > 0 && ` + ${formatCurrency(nlTotal)} non-labour`}
              {' · total '}<strong>{formatCurrency(fullAnnualCost)}/yr</strong>
            </div>
          </div>
        );
      })()}

      <div className="cost-savings-summary-row">
        <span className="cost-savings-summary-label">Automation savings</span>
        <span className="cost-savings-summary-val">{formatCurrency(p.savings)}/yr</span>
        <span className="cost-savings-summary-pct">({p.savingsPct}% of true cost)</span>
      </div>

      {suggestion?.reasoning && (
        <div className={`cost-ai-reasoning cost-ai-reasoning-${suggestion.confidence}`}>
          <span className="cost-ai-reasoning-label">
            AI · {suggestion.confidence} confidence:
          </span>{' '}
          {suggestion.reasoning}
        </div>
      )}

      <button
        type="button"
        className="cost-drivers-toggle"
        onClick={() => setShowDrivers(o => !o)}
      >
        {showDrivers ? '▲ Hide' : '▼ Add hidden cost inputs'} (error rate, wait time)
      </button>

      {showDrivers && (
        <div className="cost-drivers-grid">
          <div className="cost-analysis-field">
            <label>
              Error / rework rate
              <Tip text="% of instances that require rework or correction. E.g. 0.08 = 8%. Each rework event adds ~50% of a normal instance's labour cost." />
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="number"
                className="cost-analysis-input"
                style={{ width: 90 }}
                min={0} max={0.5} step={0.01}
                value={drivers.errorRate ?? 0}
                onChange={e => onSetDrivers(i, 'errorRate', Math.min(0.5, Math.max(0, parseFloat(e.target.value) || 0)))}
                placeholder="0.05"
              />
              <span style={{ fontSize: '0.8rem', color: 'var(--text-light)' }}>
                {drivers.errorRate > 0 ? `→ ${formatCurrency(p.annualLabour * (drivers.errorRate || 0) * 0.5)}/yr hidden cost` : 'e.g. 0.08 = 8%'}
              </span>
            </div>
          </div>
          <div className="cost-analysis-field">
            <label>
              Wait / idle time %
              <Tip text="% of labour cost tied up in waiting — for approvals, data, or handoffs. E.g. 0.15 = 15% of cost is idle time." />
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="number"
                className="cost-analysis-input"
                style={{ width: 90 }}
                min={0} max={0.5} step={0.01}
                value={drivers.waitCostPct ?? 0}
                onChange={e => onSetDrivers(i, 'waitCostPct', Math.min(0.5, Math.max(0, parseFloat(e.target.value) || 0)))}
                placeholder="0.15"
              />
              <span style={{ fontSize: '0.8rem', color: 'var(--text-light)' }}>
                {drivers.waitCostPct > 0 ? `→ ${formatCurrency(p.annualLabour * (drivers.waitCostPct || 0))}/yr hidden cost` : 'e.g. 0.15 = 15%'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CostAnalysisContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get('id');
  const token = searchParams.get('token');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState('');
  const [shareError, setShareError] = useState('');
  const [redirectToReport, setRedirectToReport] = useState(false);
  const [data, setData] = useState(null);
  const [saveDone, setSaveDone] = useState(false);
  const [savedFinancials, setSavedFinancials] = useState(null);
  const [shared, setShared] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [validationWarnings, setValidationWarnings] = useState([]);

  // Inputs
  const [labourRates, setLabourRates] = useState([]);
  const [blendedRate, setBlendedRate] = useState(50);
  const [onCostMultiplier, setOnCostMultiplier] = useState(1.25);
  const [nonLabour, setNonLabour] = useState({ externalPerInstance: 0, complianceAnnual: 0 });
  const [systemCosts, setSystemCosts] = useState({});

  // Per-driver sliders: { [processIndex]: { automation, wait, bottleneck, redundancy, workReduction } }
  const [driverSliders, setDriverSliders] = useState({});
  // Separate sliders for Redesign Impact tab (auto-seeded from redesign coverage %)
  const [redesignSliders, setRedesignSliders] = useState({});
  const [expandedDrivers, setExpandedDrivers] = useState({});
  const [redesign, setRedesign] = useState(null);

  // Currency (G10)
  const [currency, setCurrency] = useState('GBP');

  // Implementation cost
  const [implementationCost, setImplementationCost] = useState({ platform: 0, setup: 0, training: 0, maintenanceAnnual: 0 });

  // Advanced
  const [processCostDrivers, setProcessCostDrivers] = useState({});
  const [growthRate, setGrowthRate] = useState(0.05);

  // AI
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiSuggestionData, setAiSuggestionData] = useState({});
  const autoAiFetchedRef = useRef(false);

  const draftKey = id ? `cost-draft-${id}` : null;

  useEffect(() => {
    if (!id) { setError('Report ID is required.'); setLoading(false); return; }
    const url = `/api/cost-analysis?id=${id}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
    const doFetch = async () => {
      const sb = getSupabaseClient();
      const { session } = await getSessionSafe(sb);
      const headers = {};
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      return fetch(url, { headers });
    };
    doFetch()
      .then(r => r.json())
      .then(res => {
        if (res.error) throw new Error(res.error);
        if (res.redirectToReport) { setRedirectToReport(true); return; }
        setData(res);
        if (res.redesign?.redesign_data) setRedesign(res.redesign.redesign_data);

        let draft = null;
        try { draft = draftKey ? JSON.parse(localStorage.getItem(draftKey) || 'null') : null; } catch {}

        const existing = res.existingCostAnalysis;
        const source = draft || existing;

        if (source) {
          setLabourRates((source.labourRates || []).map(r => {
            const rateType = r.rateType || 'hourly';
            const rateInput = r.rateInput ?? r.hourlyRate ?? 50;
            return { department: r.department, rateType, rateInput, utilisation: r.utilisation ?? 0.85 };
          }));
          setBlendedRate(source.blendedRate ?? 50);
          setOnCostMultiplier(source.onCostMultiplier ?? 1.25);
          setNonLabour({
            externalPerInstance: source.nonLabour?.externalPerInstance ?? 0,
            complianceAnnual: source.nonLabour?.complianceAnnual ?? 0,
          });
          if (source.nonLabour?.systemCosts) {
            setSystemCosts(source.nonLabour.systemCosts);
          } else if (source.nonLabour?.systemsAnnual > 0) {
            const sysList = res.allSystems || [];
            if (sysList.length > 0) {
              const perSystem = Math.round(source.nonLabour.systemsAnnual / sysList.length);
              const costs = {};
              sysList.forEach(s => { costs[s] = perSystem; });
              setSystemCosts(costs);
            }
          } else {
            const costs = {};
            (res.allSystems || []).forEach(s => { costs[s] = 0; });
            setSystemCosts(costs);
          }
          if (source.driverSliders) setDriverSliders(source.driverSliders);
          if (source.redesignSliders) setRedesignSliders(source.redesignSliders);
          if (source.implementationCost) setImplementationCost({ platform: 0, setup: 0, training: 0, maintenanceAnnual: 0, ...source.implementationCost });
          if (source.processCostDrivers) setProcessCostDrivers(source.processCostDrivers);
          if (typeof source.growthRate === 'number') setGrowthRate(source.growthRate);
          if (source.currency && G10_CURRENCIES[source.currency]) setCurrency(source.currency);
        } else {
          const depts = res.departments || ['Default'];
          setLabourRates(depts.map(d => ({ department: d, rateType: 'hourly', rateInput: 50, utilisation: 0.85 })));
          const costs = {};
          (res.allSystems || []).forEach(s => { costs[s] = 0; });
          setSystemCosts(costs);
          // driverSliders initialised when AI suggest runs on load
        }
        // Auto-fill waitCostPct from step timing data for processes where it hasn't been set
        const rawProcs = res.report?.diagnosticData?.rawProcesses || res.report?.diagnosticData?.processes || [];
        if (rawProcs.length > 0) {
          const baseDrivers = source?.processCostDrivers || {};
          const filled = { ...baseDrivers };
          let changed = false;
          rawProcs.forEach((raw, i) => {
            if (!filled[i]?.waitCostPct) {
              const steps = raw.steps || [];
              const totalWork = steps.reduce((s, st) => s + (st.workMinutes || 0), 0);
              const totalWait = steps.reduce((s, st) => s + (st.waitMinutes || 0), 0);
              if (totalWait > 0 && totalWork + totalWait > 0) {
                const derived = Math.round(totalWait / (totalWork + totalWait) * 100) / 100;
                filled[i] = { ...(filled[i] || {}), waitCostPct: Math.min(0.5, derived) };
                changed = true;
              }
            }
          });
          if (changed) setProcessCostDrivers(filled);
        }
      })
      .catch(e => setError(e.message || 'Failed to load report.'))
      .finally(() => setLoading(false));
  }, [id, token]);

  // Auto-save draft
  useEffect(() => {
    if (!draftKey || loading || !data) return;
    const draft = {
      labourRates, blendedRate, onCostMultiplier, nonLabour,
      driverSliders, redesignSliders, systemCosts,
      implementationCost, processCostDrivers, growthRate,
      currency,
      savedAt: Date.now(),
    };
    try { localStorage.setItem(draftKey, JSON.stringify(draft)); } catch {}
  }, [labourRates, blendedRate, onCostMultiplier, nonLabour, driverSliders, redesignSliders, systemCosts, implementationCost, processCostDrivers, growthRate, currency]);

  const processes = data?.processes || [];

  function toHourlyRate(rateInput, rateType) {
    const v = rateInput || 0;
    if (rateType === 'daily') return v / 8;
    if (rateType === 'annual') return v / 2080;
    return v;
  }

  const rateByDept = useMemo(() => {
    return (labourRates || []).reduce((acc, r) => {
      const hr = toHourlyRate(r.rateInput ?? r.hourlyRate, r.rateType);
      if (r.department && hr > 0) acc[r.department] = { raw: hr, effective: hr };
      return acc;
    }, {});
  }, [labourRates]);

  const defaultRate = useMemo(() => (blendedRate || 50) * (onCostMultiplier || 1.25), [blendedRate, onCostMultiplier]);

  const processBreakdown = useMemo(() => {
    return (processes || []).map((p, i) => {
      const hours = p.hoursPerInstance ?? 4;
      const teamSize = p.teamSize ?? 1;
      const annual = p.annual ?? 12;
      const depts = p.departments || [];
      const deptEntries = depts.map(d => rateByDept[d] ?? { raw: defaultRate, effective: defaultRate });
      const avgRawRate = deptEntries.length > 0
        ? deptEntries.reduce((s, e) => s + e.raw, 0) / deptEntries.length
        : defaultRate;
      const avgEffectiveRate = deptEntries.length > 0
        ? deptEntries.reduce((s, e) => s + e.effective, 0) / deptEntries.length
        : defaultRate;
      const annualLabour = hours * avgEffectiveRate * annual * teamSize;

      const drivers = processCostDrivers[i] || {};
      const errorRate = Math.min(0.5, Math.max(0, Number(drivers.errorRate) || 0));
      const waitCostPct = Math.min(0.5, Math.max(0, Number(drivers.waitCostPct) || 0));
      const errorCost = annualLabour * errorRate * 0.5;
      const waitCost = annualLabour * waitCostPct;
      const trueAnnualCost = annualLabour + errorCost + waitCost;

      // Compute savings from per-driver sliders anchored to trueAnnualCost
      const breakdown = aiSuggestionData[i]?.breakdown;
      const sliders = driverSliders[i] || {};
      const totalMins = (breakdown?.totalWorkMins || 0) + (breakdown?.totalWaitMins || 0);
      let savings;
      if (breakdown && totalMins > 0) {
        const DRIVER_MAP = [
          ['automationMins', 'automation'],
          ['bottleneckMins', 'bottleneck'],
          ['redundancyMins', 'redundancy'],
          ['workReductionMins', 'workReduction'],
        ];
        const rawMaxes = DRIVER_MAP.map(([mKey]) => (breakdown[mKey] || 0) / totalMins * trueAnnualCost);
        const rawMaxSum = rawMaxes.reduce((a, b) => a + b, 0);
        const normFactor = rawMaxSum > trueAnnualCost ? trueAnnualCost / rawMaxSum : 1;
        savings = DRIVER_MAP.reduce((sum, [, sKey], di) => {
          return sum + rawMaxes[di] * normFactor * ((sliders[sKey] ?? 100) / 100);
        }, 0);
      } else {
        savings = 0;
      }
      const savingsPct = trueAnnualCost > 0 ? Math.round(savings / trueAnnualCost * 100) : 0;

      // Redesign cost impact — driven by redesignSliders (auto-seeded from redesign coverage %)
      const processName = p.name || `Process ${i + 1}`;
      const rdSliders = redesignSliders[i] || {};
      let redesignSavings;
      if (breakdown && totalMins > 0) {
        const DRIVER_MAP_RD = [
          ['automationMins', 'automation'],
          ['bottleneckMins', 'bottleneck'],
          ['redundancyMins', 'redundancy'],
          ['workReductionMins', 'workReduction'],
        ];
        const rdRawMaxes = DRIVER_MAP_RD.map(([mKey]) => (breakdown[mKey] || 0) / totalMins * trueAnnualCost);
        const rdRawMaxSum = rdRawMaxes.reduce((a, b) => a + b, 0);
        const rdNormFactor = rdRawMaxSum > trueAnnualCost ? trueAnnualCost / rdRawMaxSum : 1;
        redesignSavings = Math.round(DRIVER_MAP_RD.reduce((sum, [, sKey], di) => {
          return sum + rdRawMaxes[di] * rdNormFactor * ((rdSliders[sKey] ?? 0) / 100);
        }, 0));
      } else {
        // Fallback: use raw redesign time-saved estimate when no AI breakdown available
        const redesignChanges = (redesign?.changes || []).filter(c => c.process === processName);
        const redesignTimeSaved = redesignChanges.reduce((sum, c) => sum + (c.estimatedTimeSavedMinutes || 0), 0);
        const fallbackPct = redesign?.costSummary?.estimatedCostSavedPercent || 0;
        redesignSavings = Math.round(trueAnnualCost * fallbackPct / 100);
      }
      const redesignSavingsPct = trueAnnualCost > 0 ? Math.round(redesignSavings / trueAnnualCost * 100) : 0;
      const redesignCost = trueAnnualCost - redesignSavings;

      return {
        name: processName,
        hours, teamSize, annual,
        avgRawRate, avgEffectiveRate,
        avgRate: avgEffectiveRate,
        annualLabour,
        errorCost, waitCost, trueAnnualCost,
        savingsPct,
        savings,
        depts,
        redesignSavingsPct,
        redesignSavings,
        redesignCost,
      };
    });
  }, [processes, rateByDept, defaultRate, processCostDrivers, driverSliders, redesignSliders, aiSuggestionData, redesign]);

  const totalSystemsCost = useMemo(
    () => Object.values(systemCosts).reduce((sum, v) => sum + (Number(v) || 0), 0),
    [systemCosts]
  );

  const financials = useMemo(() => {
    const totalLabour = processBreakdown.reduce((sum, p) => sum + p.annualLabour, 0);
    const totalHiddenCost = processBreakdown.reduce((sum, p) => sum + p.errorCost + p.waitCost, 0);
    const totalInstances = processes.reduce((sum, p) => sum + ((p.annual ?? 12) * (p.teamSize ?? 1)), 0);
    const externalAnnual = (nonLabour?.externalPerInstance ?? 0) * Math.max(totalInstances, 1);
    const complianceAnnual = nonLabour?.complianceAnnual ?? 0;
    const totalFixed = totalSystemsCost + externalAnnual + complianceAnnual;
    const totalAnnualCost = totalLabour + totalHiddenCost + totalFixed;

    // Allocate non-labour costs per process
    // 1. System costs: split each system's cost equally among processes that use it
    const systemUsageCount = {};
    processes.forEach(p => { (p.systems || []).forEach(s => { systemUsageCount[s] = (systemUsageCount[s] || 0) + 1; }); });
    const nonLabourPerProcess = processes.map((p, i) => {
      const pb = processBreakdown[i];
      // Systems: each system used by this process, allocated by usage share
      const sysCost = (p.systems || []).reduce((sum, s) => {
        const cost = Number(systemCosts[s]) || 0;
        const count = systemUsageCount[s] || 1;
        return sum + cost / count;
      }, 0);
      // External: per-instance cost × volume
      const extCost = (nonLabour?.externalPerInstance ?? 0) * (p.annual ?? 12) * (p.teamSize ?? 1);
      // Compliance: pro-rata by labour
      const complianceCost = totalLabour > 0 ? complianceAnnual * (pb.annualLabour / totalLabour) : complianceAnnual / Math.max(processes.length, 1);
      return { sysCost, extCost, complianceCost, total: sysCost + extCost + complianceCost };
    });
    const potentialSavings = processBreakdown.reduce((sum, p) => sum + p.savings, 0);
    const redesignSavings = processBreakdown.reduce((sum, p) => sum + (p.redesignSavings || 0), 0);
    const fteEquivalent = potentialSavings > 0 ? +(potentialSavings / (defaultRate * 2080)).toFixed(1) : 0;

    const implTotal = (Number(implementationCost.platform) || 0) + (Number(implementationCost.setup) || 0) + (Number(implementationCost.training) || 0);
    const implMaintenance = Number(implementationCost.maintenanceAnnual) || 0;
    const year1Savings = potentialSavings;
    const year2Savings = year1Savings * (1 + growthRate);
    const year3Savings = year2Savings * (1 + growthRate);
    const year1Net = year1Savings - implTotal - implMaintenance;
    const year2Net = year2Savings - implMaintenance;
    const year3Net = year3Savings - implMaintenance;
    const DISCOUNT = 0.08;
    const npv3yr = Math.round(
      year1Net / (1 + DISCOUNT) +
      year2Net / Math.pow(1 + DISCOUNT, 2) +
      year3Net / Math.pow(1 + DISCOUNT, 3)
    );
    const roi3yr = implTotal > 0 ? Math.round((year1Net + year2Net + year3Net) / implTotal * 100) : null;
    const monthlyNet = (potentialSavings - implMaintenance) / 12;
    const paybackMonths = implTotal > 0 && monthlyNet > 0 ? Math.ceil(implTotal / monthlyNet) : 0;
    const rdYear1Savings = redesignSavings;
    const rdYear2Savings = rdYear1Savings * (1 + growthRate);
    const rdYear3Savings = rdYear2Savings * (1 + growthRate);
    const rdYear1Net = rdYear1Savings - implTotal - implMaintenance;
    const rdYear2Net = rdYear2Savings - implMaintenance;
    const rdYear3Net = rdYear3Savings - implMaintenance;
    const rdNpv3yr = Math.round(
      rdYear1Net / (1 + DISCOUNT) +
      rdYear2Net / Math.pow(1 + DISCOUNT, 2) +
      rdYear3Net / Math.pow(1 + DISCOUNT, 3)
    );
    const rdRoi3yr = implTotal > 0 ? Math.round((rdYear1Net + rdYear2Net + rdYear3Net) / implTotal * 100) : null;
    const rdMonthlyNet = (redesignSavings - implMaintenance) / 12;
    const rdPaybackMonths = implTotal > 0 && rdMonthlyNet > 0 ? Math.ceil(implTotal / rdMonthlyNet) : 0;

    return {
      totalLabour, totalHiddenCost, totalFixed, totalAnnualCost,
      totalInstances,
      potentialSavings, redesignSavings, fteEquivalent,
      implTotal, implMaintenance,
      paybackMonths, npv3yr, roi3yr,
      rdPaybackMonths, rdNpv3yr, rdRoi3yr,
      year1Net, year2Net, year3Net,
      nonLabourPerProcess,
    };
  }, [processBreakdown, processes, nonLabour, totalSystemsCost, systemCosts, implementationCost, growthRate, defaultRate]);

  const handleSetDriverSlider = useCallback((i, key, val) => {
    setDriverSliders(prev => ({ ...prev, [i]: { ...(prev[i] || {}), [key]: val } }));
  }, []);

  const handleSetRedesignSlider = useCallback((i, key, val) => {
    setRedesignSliders(prev => ({ ...prev, [i]: { ...(prev[i] || {}), [key]: val } }));
  }, []);

  const handleSetDrivers = useCallback((i, field, val) => {
    setProcessCostDrivers(prev => ({ ...prev, [i]: { ...(prev[i] || {}), [field]: val } }));
  }, []);

  const handleAiSuggest = useCallback(() => {
    if (!data) return;
    setAiSuggesting(true);
    setAiError('');
    try {
      const rawProcesses =
        data?.report?.diagnosticData?.rawProcesses ||
        data?.report?.diagnosticData?.processes ||
        [];
      const DEFAULT_SLIDERS = { automation: 100, bottleneck: 100, redundancy: 100, workReduction: 100 };
      const newSuggestions = {};
      const newSliders = {};
      rawProcesses.forEach((raw, i) => {
        const { reasoning, confidence, breakdown } = calculateProcessSavings(raw);

        const steps = raw.steps || [];
        const automatableSteps = steps.filter(s => !s.isDecision && !s.isMerge && !s.isAutomated);
        const externalSteps = steps.filter(s => s.isExternal);
        const systems = [...new Set(steps.flatMap(s => s.systems || []).filter(Boolean))];
        const emailHandoffs = (raw.handoffs || []).filter(h => h.method === 'email').length;
        const approvalCount = steps.filter(s => s.isDecision).length;

        const approaches = [];
        if (automatableSteps.length > 0 && systems.length > 0)
          approaches.push(`Automate ${automatableSteps.length} manual step${automatableSteps.length !== 1 ? 's' : ''} using ${systems.slice(0, 2).join(' + ')}`);
        else if (automatableSteps.length > 0)
          approaches.push(`Automate ${automatableSteps.length} manual step${automatableSteps.length !== 1 ? 's' : ''}`);
        if (emailHandoffs >= 2)
          approaches.push(`replace ${emailHandoffs} email handoffs with structured notifications`);
        if (approvalCount > 2)
          approaches.push(`consolidate ${approvalCount} approval gates into a single rule-based decision`);
        if (externalSteps.length > 0)
          approaches.push(`reduce ${externalSteps.length} external step${externalSteps.length !== 1 ? 's' : ''} dependency via vendor SLAs, API integration, or self-service portals`);
        if (breakdown.totalWaitMins > breakdown.totalWorkMins * 0.2)
          approaches.push(`eliminate ${Math.round(breakdown.waitReductionMins || 0)}min of queue wait via automated status tracking`);

        const complexity = (steps.length > 15 || systems.length > 3 || approvalCount > 3 || externalSteps.length > 2) ? 'high'
          : (steps.length > 8 || systems.length > 1 || approvalCount > 1 || externalSteps.length > 0) ? 'medium'
          : 'low';

        const hiddenCostFlags = [];
        if (breakdown.totalWaitMins > breakdown.totalWorkMins * 0.3)
          hiddenCostFlags.push('high wait ratio — significant idle time per run');
        if (emailHandoffs >= 2)
          hiddenCostFlags.push('email handoffs — coordination overhead and delay');
        if (approvalCount > 2)
          hiddenCostFlags.push('multiple approval gates — SLA risk and exception overhead');
        if (externalSteps.length > 0)
          hiddenCostFlags.push(`${externalSteps.length} external step${externalSteps.length !== 1 ? 's' : ''} — vendor dependency, SLA risk, costs estimated from internal rates`);
        const multiSystemSteps = steps.filter(s => (s.systems || []).length >= 2).length;
        if (multiSystemSteps > 0)
          hiddenCostFlags.push(`${multiSystemSteps} multi-system step${multiSystemSteps !== 1 ? 's' : ''} — manual re-entry error cost`);

        newSuggestions[i] = {
          processIndex: i,
          reasoning,
          confidence,
          automationApproach: approaches.length > 0 ? approaches.join('; ') + '.' : 'Streamline manual steps and reduce handoff delays.',
          implementationComplexity: complexity,
          hiddenCostFlags: hiddenCostFlags.slice(0, 4),
          breakdown,
        };
        newSliders[i] = { ...DEFAULT_SLIDERS };
      });
      setAiSuggestionData(newSuggestions);
      setDriverSliders(newSliders);
    } catch (e) {
      setAiError(e.message || 'Calculation failed.');
    } finally {
      setAiSuggesting(false);
    }
  }, [data]);

  useEffect(() => {
    if (!data || autoAiFetchedRef.current) return;
    autoAiFetchedRef.current = true;
    handleAiSuggest();
  }, [data]);

  // Auto-update driver sliders when redesign data is loaded
  const REDESIGN_CHANGE_TO_DRIVER = {
    automated: 'automation',
    removed:   'redundancy',
    merged:    'redundancy',
    reordered: 'bottleneck',
    modified:  'workReduction',
  };
  const DRIVER_MINS_KEY = {
    automation:    'automationMins',
    bottleneck:    'bottleneckMins',
    redundancy:    'redundancyMins',
    workReduction: 'workReductionMins',
  };

  // Auto-seed redesign sliders from redesign change coverage (separate from automation sliders)
  useEffect(() => {
    if (!redesign || Object.keys(aiSuggestionData).length === 0) return;
    setRedesignSliders(() => {
      const updated = {};
      processes.forEach((p, i) => {
        const bd = aiSuggestionData[i]?.breakdown;
        if (!bd) return;
        const processChanges = (redesign.changes || []).filter(c => c.process === (p.name || `Process ${i + 1}`));
        const driverTimeSaved = {};
        for (const change of processChanges) {
          const driver = REDESIGN_CHANGE_TO_DRIVER[change.type];
          if (!driver) continue;
          driverTimeSaved[driver] = (driverTimeSaved[driver] || 0) + (change.estimatedTimeSavedMinutes || 0);
        }
        const newSliders = {};
        for (const [driver, minsKey] of Object.entries(DRIVER_MINS_KEY)) {
          const driverMins = bd[minsKey] || 0;
          const timeSaved = driverTimeSaved[driver] || 0;
          newSliders[driver] = driverMins > 0 && timeSaved > 0
            ? Math.min(100, Math.round(timeSaved / driverMins * 100))
            : 0;
        }
        updated[i] = newSliders;
      });
      return updated;
    });
  }, [redesign, aiSuggestionData]);

  function validate() {
    const sym = G10_CURRENCIES[currency]?.symbol || '£';
    const warnings = [];
    const hasAnyRate = labourRates.some(r => toHourlyRate(r.rateInput ?? r.hourlyRate, r.rateType) > 0) || blendedRate > 0;
    if (!hasAnyRate) warnings.push({ type: 'error', msg: `At least one rate must be greater than ${sym}0.` });
    labourRates.forEach(r => {
      const hr = toHourlyRate(r.rateInput ?? r.hourlyRate, r.rateType);
      if (hr > 0 && hr < 10) warnings.push({ type: 'warn', msg: `${r.department}: effective rate of ${sym}${hr.toFixed(0)}/hr seems very low.` });
      if (hr > 500) warnings.push({ type: 'warn', msg: `${r.department}: effective rate of ${sym}${hr.toFixed(0)}/hr is very high.` });
    });
    return warnings;
  }

  function handleReview() {
    const warnings = validate();
    setValidationWarnings(warnings);
    if (warnings.some(w => w.type === 'error')) return;
    setShowReview(true);
  }

  const handleSave = useCallback(async () => {
    if (!id || !data) return;
    setSaving(true);
    setError('');
    try {
      const sb = getSupabaseClient();
      const { session } = await getSessionSafe(sb);
      const headers = { 'Content-Type': 'application/json' };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      const res = await fetch('/api/cost-analysis', {
        method: 'POST', headers,
        body: JSON.stringify({
          reportId: id,
          token: token || undefined,
          costAnalysis: {
            labourRates, blendedRate, onCostMultiplier,
            nonLabour: { ...nonLabour, systemCosts, systemsAnnual: totalSystemsCost },
            processSavings: Object.fromEntries(processBreakdown.map((pb, i) => [i, pb.savingsPct])),
            driverSliders,
            redesignSliders,
            implementationCost, processCostDrivers, growthRate,
            currency,
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to save.');
      try { if (draftKey) localStorage.removeItem(draftKey); } catch {}
      setSavedFinancials(json.financialModel || financials);
      setSaveDone(true);
      setShowReview(false);
    } catch (e) {
      setError(e.message || 'Failed to save cost analysis.');
    } finally {
      setSaving(false);
    }
  }, [id, token, data, labourRates, blendedRate, onCostMultiplier, nonLabour, driverSliders, redesignSliders, processBreakdown, systemCosts, totalSystemsCost, implementationCost, processCostDrivers, growthRate, currency, financials]);

  const handleShare = useCallback(async () => {
    if (!id) return;
    setSharing(true);
    setShareError('');
    try {
      const sb = getSupabaseClient();
      const { session } = await getSessionSafe(sb);
      const headers = { 'Content-Type': 'application/json' };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      const res = await fetch('/api/cost-analysis', {
        method: 'PATCH', headers,
        body: JSON.stringify({ reportId: id, token: token || undefined, shareWithOwner: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to share.');
      setShared(true);
    } catch (e) {
      setShareError(e.message || 'Failed to share.');
    } finally {
      setSharing(false);
    }
  }, [id, token]);

  const hasAiData = Object.keys(aiSuggestionData).length > 0;
  const hasImpl = financials.implTotal > 0;
  const [activeTab, setActiveTab] = useState('overview');
  const [settingsSubTab, setSettingsSubTab] = useState('labour');
  const formatCurrencyFn = useCallback((v) => formatCurrency(v, currency), [currency]);
  const currencySymbol = G10_CURRENCIES[currency]?.symbol || '£';

  // ── Redirect / loading / error states ──────────────────────────────────
  if (redirectToReport) {
    return (
      <div className="report-page" style={{ padding: 40, textAlign: 'center' }}>
        <div className="report-card" style={{ maxWidth: 480, margin: '0 auto' }}>
          <h1 className="report-title">Cost analysis complete</h1>
          <p className="report-subtitle">This report already has a cost analysis. View the full report below.</p>
          <Link href={`/report?id=${id}`} className="button button-primary" style={{ marginTop: 16 }}>View report</Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="report-page" style={{ padding: 40, textAlign: 'center' }}>
        <div className="loading-state loading-fallback"><div className="loading-spinner" /></div>
        <p style={{ marginTop: 16 }}>Loading report...</p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="report-page" style={{ padding: 40, textAlign: 'center' }}>
        <div className="report-card" style={{ maxWidth: 480, margin: '0 auto' }}>
          <h1 className="report-title">Cost analysis</h1>
          <p className="report-subtitle" style={{ color: 'var(--danger)' }}>{error}</p>
          {!token && <p style={{ marginTop: 12, fontSize: '0.9rem' }}>Use the link provided by the report owner.</p>}
          <Link href="/portal?dashboard=1" style={{ color: 'var(--accent)', marginTop: 16, display: 'inline-block' }}>Back to dashboard</Link>
        </div>
      </div>
    );
  }

  // ── Save done screen ────────────────────────────────────────────────────
  if (saveDone) {
    const fm = savedFinancials || financials;
    return (
      <div className="portal-viewport cost-analysis-page">
        <CostAnalysisHeader id={id} title="Cost analysis — saved" />
        <div className="portal-wrap cost-analysis-wrap">
          <div className="portal-dashboard-layout cost-analysis-layout">
            <div className="dash-card portal-content-card cost-analysis-main-card" style={{ maxWidth: 720, margin: '0 auto' }}>
            <div className="cost-save-done-hero">
              <div className="cost-save-done-icon">✓</div>
              <h2>Cost analysis saved</h2>
              <p>Business case complete. Review the headline metrics below, then decide whether to share with the report owner.</p>
            </div>

            {/* Headline metrics */}
            <div className="cost-save-metrics">
              <div className="cost-save-metric">
                <div className="cost-save-metric-label">Annual process cost</div>
                <div className="cost-save-metric-value">{formatCurrencyFn(fm.totalAnnualCost)}</div>
              </div>
              <div className="cost-save-metric cost-save-metric-green">
                <div className="cost-save-metric-label">Automation savings potential</div>
                <div className="cost-save-metric-value">{formatCurrencyFn(fm.potentialSavings)}/yr</div>
              </div>
              <div className="cost-save-metric">
                <div className="cost-save-metric-label">
                  FTE equivalent
                  <span className="cost-tooltip" title="FTE equivalent = automation savings ÷ (default hourly rate × 2,080 hours/year). Represents the number of full-time employees whose time could be freed.">ⓘ</span>
                </div>
                <div className="cost-save-metric-value">{fm.fteEquivalent ?? financials.fteEquivalent}</div>
              </div>
              {fm.paybackMonths > 0 && (
                <div className="cost-save-metric">
                  <div className="cost-save-metric-label">Payback period</div>
                  <div className="cost-save-metric-value">{fm.paybackMonths} months</div>
                </div>
              )}
              {fm.roi3yr != null && (
                <div className="cost-save-metric cost-save-metric-green">
                  <div className="cost-save-metric-label">3-year ROI</div>
                  <div className="cost-save-metric-value">{fm.roi3yr}%</div>
                </div>
              )}
              {fm.npv3yr != null && (
                <div className="cost-save-metric">
                  <div className="cost-save-metric-label">3-year NPV (8%)</div>
                  <div className="cost-save-metric-value">{formatCurrencyFn(fm.npv3yr)}</div>
                </div>
              )}
            </div>

            <div className="cost-share-card">
              <h3>Share with report owner?</h3>
              <p className="cost-share-desc">
                Cost data includes salary rates and redundancy savings — <strong>confidential by default</strong>. Only share if the owner needs the full breakdown to make a decision.
              </p>
              {shareError && <div className="cost-analysis-error" style={{ marginBottom: 12 }}>{shareError}</div>}
              {shared ? (
                <div className="cost-share-success">Results have been shared with the report owner.</div>
              ) : (
                <div className="cost-share-actions">
                  <button type="button" className="button button-primary" onClick={handleShare} disabled={sharing}>
                    {sharing ? 'Sharing...' : 'Share with owner'}
                  </button>
                  <Link href={`/report?id=${id}`} className="button" style={{ background: 'transparent', color: 'var(--accent)', border: '1px solid var(--accent)' }}>
                    Keep confidential
                  </Link>
                </div>
              )}
            </div>
            {shared && (
              <div style={{ textAlign: 'center', marginTop: 24 }}>
                <Link href={`/report?id=${id}`} className="button button-primary">View report</Link>
              </div>
            )}

            {/* Email summary */}
            <div className="cost-email-summary-row">
              <button
                type="button"
                className="button cost-btn-outline"
                onClick={() => {
                  const emailBody = `Cost Analysis Summary\n\nAnnual process cost: ${formatCurrencyFn(fm.totalAnnualCost)}\nAutomation savings: ${formatCurrencyFn(fm.potentialSavings)}/yr\nPayback period: ${fm.paybackMonths > 0 ? fm.paybackMonths + ' months' : 'N/A'}\n\nView full analysis: ${window.location.href}`;
                  const mailtoLink = `mailto:?subject=Cost Analysis - ${data?.diagnosticData?.companyName || data?.report?.diagnosticData?.companyName || 'Process Analysis'}&body=${encodeURIComponent(emailBody)}`;
                  window.open(mailtoLink);
                }}
              >
                ✉ Email summary
              </button>
            </div>

            {/* What's next */}
            <div className="cost-next-steps">
              <div className="cost-next-steps-title">What's next?</div>
              <div className="cost-next-steps-cards">
                <Link href={`/report?id=${id}`} className="cost-next-step-card">
                  <span className="cost-next-step-icon">📄</span>
                  <span className="cost-next-step-label">View full report</span>
                  <span className="cost-next-step-desc">See the complete process audit and business case</span>
                </Link>
                <Link href={`/report?id=${id}`} className="cost-next-step-card">
                  <span className="cost-next-step-icon">✦</span>
                  <span className="cost-next-step-label">Generate a redesign</span>
                  <span className="cost-next-step-desc">Use the AI Redesign button on your report</span>
                </Link>
                {redesign && (
                  <Link href={`/build?id=${id}`} className="cost-next-step-card">
                    <span className="cost-next-step-icon">⚙</span>
                    <span className="cost-next-step-label">Export to automation platform</span>
                    <span className="cost-next-step-desc">Take your redesign into the build phase</span>
                  </Link>
                )}
              </div>
            </div>

            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Review / business case screen ───────────────────────────────────────
  if (showReview) {
    const hasHiddenCosts = processBreakdown.some(p => p.errorCost > 0 || p.waitCost > 0);
    return (
      <div className="portal-viewport cost-analysis-page">
        <CostAnalysisHeader id={id} title="Cost analysis — review" extra={
          <button type="button" className="cost-header-back-btn" onClick={() => setShowReview(false)}>← Back to edit</button>
        } />
        <div className="portal-wrap cost-analysis-wrap">
          <div className="portal-dashboard-layout cost-analysis-layout">
            <div className="dash-card portal-content-card cost-analysis-main-card">
            <div className="portal-content-header">
              <h2 className="portal-content-title">Business case</h2>
            </div>
            <p className="cost-overview-desc" style={{ marginBottom: 16 }}>
              Confirm figures before saving. This data is <strong>confidential by default</strong> and will not be visible to the report owner unless you explicitly share it.
            </p>

            {validationWarnings.filter(w => w.type === 'warn').length > 0 && (
              <div className="cost-analysis-warnings">
                {validationWarnings.filter(w => w.type === 'warn').map((w, i) => (
                  <div key={i} className="cost-analysis-warning">⚠ {w.msg}</div>
                ))}
              </div>
            )}
            {error && <div className="cost-analysis-error" style={{ marginBottom: 16 }}>{error}</div>}

            {/* Current state */}
            <div className="cost-bc-section">
              <div className="cost-bc-section-title">Current state — annual process cost</div>
              {processBreakdown.map((p, i) => (
                <div key={i} className="cost-bc-process-row">
                  <div className="cost-bc-process-name">{p.name}</div>
                  <div className="cost-bc-process-detail">
                    <span>{p.hours}h × {p.annual} runs × {p.teamSize} person(s) @ {formatCurrencyFn(p.avgRawRate)}/hr</span>
                    <span>Labour: {formatCurrencyFn(p.annualLabour)}</span>
                    {p.errorCost > 0 && <span>Error/rework: +{formatCurrencyFn(p.errorCost)}</span>}
                    {p.waitCost > 0 && <span>Wait time: +{formatCurrencyFn(p.waitCost)}</span>}
                    <span className="cost-bc-process-true">True cost: <strong>{formatCurrencyFn(p.trueAnnualCost)}/yr</strong></span>
                  </div>
                </div>
              ))}
              <div className="cost-bc-subtotal-rows">
                <div className="cost-bc-subtotal-row">
                  <span>Total direct labour</span>
                  <span>{formatCurrencyFn(financials.totalLabour)}/yr</span>
                </div>
                {financials.totalHiddenCost > 0 && (
                  <div className="cost-bc-subtotal-row cost-bc-subtotal-hidden">
                    <span>Hidden costs (error/rework + wait time)</span>
                    <span>+ {formatCurrencyFn(financials.totalHiddenCost)}/yr</span>
                  </div>
                )}
                {financials.totalFixed > 0 && (
                  <div className="cost-bc-subtotal-row">
                    <span>Non-labour (systems, external, compliance)</span>
                    <span>+ {formatCurrencyFn(financials.totalFixed)}/yr</span>
                  </div>
                )}
              </div>
              <div className="cost-bc-total-row">
                <span>Total annual cost</span>
                <span className="cost-bc-total-val">{formatCurrencyFn(financials.totalAnnualCost)}</span>
              </div>
            </div>

            {/* Automation case */}
            <div className="cost-bc-section">
              <div className="cost-bc-section-title">Automation case</div>
              {processBreakdown.map((p, i) => (
                <div key={i} className="cost-bc-savings-row">
                  <span className="cost-bc-savings-name">{p.name}</span>
                  <span className="cost-bc-savings-pct">{p.savingsPct}% savings</span>
                  <span className="cost-bc-savings-val">= {formatCurrencyFn(p.savings)}/yr</span>
                  {aiSuggestionData[i]?.automationApproach && (
                    <span className="cost-bc-approach">{aiSuggestionData[i].automationApproach}</span>
                  )}
                </div>
              ))}
              <div className="cost-bc-total-row cost-bc-total-green">
                <span>Total automation savings</span>
                <span className="cost-bc-total-val">{formatCurrencyFn(financials.potentialSavings)}/yr</span>
              </div>
              <div className="cost-bc-fte-row">
                FTE equivalent freed: <strong>{financials.fteEquivalent}</strong> FTE
                <span className="cost-tooltip" title="FTE equivalent = automation savings ÷ (default hourly rate × 2,080 hours/year). Represents the number of full-time employees whose time could be freed.">ⓘ</span>
                {financials.fteEquivalent > 0 && <span className="cost-bc-fte-note"> — capacity available for redeployment or growth</span>}
              </div>
              <div className="cost-bc-residual">
                Residual annual cost post-automation: {formatCurrencyFn(financials.totalAnnualCost - financials.potentialSavings)}
              </div>
            </div>

            {/* Investment & return */}
            {hasImpl && (
              <div className="cost-bc-section">
                <div className="cost-bc-section-title">Investment & return</div>
                <div className="cost-bc-impl-rows">
                  {implementationCost.platform > 0 && <div className="cost-bc-impl-row"><span>Platform / tooling</span><span>{formatCurrencyFn(implementationCost.platform)}</span></div>}
                  {implementationCost.setup > 0 && <div className="cost-bc-impl-row"><span>Setup & build</span><span>{formatCurrencyFn(implementationCost.setup)}</span></div>}
                  {implementationCost.training > 0 && <div className="cost-bc-impl-row"><span>Training</span><span>{formatCurrencyFn(implementationCost.training)}</span></div>}
                  <div className="cost-bc-impl-row cost-bc-impl-total"><span>Total one-time investment</span><span>{formatCurrencyFn(financials.implTotal)}</span></div>
                  {implementationCost.maintenanceAnnual > 0 && <div className="cost-bc-impl-row"><span>Annual maintenance</span><span>{formatCurrencyFn(implementationCost.maintenanceAnnual)}/yr</span></div>}
                </div>
                <div className="cost-bc-returns">
                  {financials.paybackMonths > 0 && (
                    <div className="cost-bc-return-metric">
                      <div className="cost-bc-return-label">Payback period</div>
                      <div className="cost-bc-return-val">{financials.paybackMonths} months</div>
                    </div>
                  )}
                  {financials.roi3yr != null && (
                    <div className="cost-bc-return-metric cost-bc-return-highlight">
                      <div className="cost-bc-return-label">3-year ROI</div>
                      <div className="cost-bc-return-val">{financials.roi3yr}%</div>
                    </div>
                  )}
                  <div className="cost-bc-return-metric">
                    <div className="cost-bc-return-label">3-year NPV (8% discount)</div>
                    <div className="cost-bc-return-val">{formatCurrencyFn(financials.npv3yr)}</div>
                  </div>
                </div>
                <div className="cost-bc-projection">
                  <div className="cost-bc-projection-title">3-year net benefit projection</div>
                  {[
                    { label: `Year 1 net${growthRate > 0 ? '' : ''}`, val: financials.year1Net },
                    { label: `Year 2 net (+${Math.round(growthRate * 100)}% volume growth)`, val: financials.year2Net },
                    { label: `Year 3 net (+${Math.round(growthRate * 100)}% volume growth)`, val: financials.year3Net },
                  ].map(({ label, val }, yi) => {
                    const maxAbs = Math.max(Math.abs(financials.year1Net), Math.abs(financials.year2Net), Math.abs(financials.year3Net), 1);
                    const pct = Math.abs(val) / maxAbs * 100;
                    return (
                      <div key={yi} className="cost-bc-bar-row">
                        <span className="cost-bc-bar-label">{label}</span>
                        <div className="cost-bc-bar-track">
                          <div
                            className={`cost-bc-bar-fill${val < 0 ? ' negative' : ''}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className={`cost-bc-bar-val${val < 0 ? ' negative' : ''}`}>{formatCurrencyFn(val)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="cost-analysis-actions">
              <button type="button" className="button button-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Confirm and save'}
              </button>
              <button type="button" className="button cost-btn-outline" onClick={() => setShowReview(false)}>
                Back to edit
              </button>
            </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Main form ───────────────────────────────────────────────────────────
  return (
    <div className="portal-viewport cost-analysis-page">
      <CostAnalysisHeader id={id} />
      <div className="portal-wrap cost-analysis-wrap">
        {error && <div className="cost-analysis-error cost-analysis-error-banner">{error}</div>}
        {validationWarnings.some(w => w.type === 'error') && (
          <div className="cost-analysis-errors">
            {validationWarnings.filter(w => w.type === 'error').map((w, i) => (
              <div key={i} className="cost-analysis-error">{w.msg}</div>
            ))}
          </div>
        )}

        <div className="portal-dashboard-layout cost-analysis-layout">
          <div className="portal-main-area">
            <div className="portal-grid-layout cost-analysis-grid">
              <nav className="portal-section-tabs cost-analysis-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'overview'}
                  className={`portal-section-tab ${activeTab === 'overview' ? 'active' : ''}`}
                  onClick={() => setActiveTab('overview')}
                >
                  Overview
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'processes'}
                  className={`portal-section-tab ${activeTab === 'processes' ? 'active' : ''}`}
                  onClick={() => setActiveTab('processes')}
                >
                  Process breakdown
                  {processBreakdown.length > 0 && <span className="portal-section-tab-badge">{processBreakdown.length}</span>}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'settings'}
                  className={`portal-section-tab ${activeTab === 'settings' ? 'active' : ''}`}
                  onClick={() => setActiveTab('settings')}
                >
                  Labour & costs
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'savings'}
                  className={`portal-section-tab ${activeTab === 'savings' ? 'active' : ''}`}
                  onClick={() => setActiveTab('savings')}
                >
                  Automation savings
                </button>
                {redesign && (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'redesign'}
                    className={`portal-section-tab ${activeTab === 'redesign' ? 'active' : ''}`}
                    onClick={() => setActiveTab('redesign')}
                  >
                    Redesign impact
                  </button>
                )}
              </nav>

              <div className="cost-scenario-bar-row">
                <div className="cost-currency-select-wrap">
                  <label htmlFor="cost-currency-select" className="cost-currency-label">Currency:</label>
                  <select
                    id="cost-currency-select"
                    className="cost-currency-select"
                    value={currency}
                    onChange={e => setCurrency(e.target.value)}
                  >
                    {Object.entries(G10_CURRENCIES).map(([code, c]) => (
                      <option key={code} value={code}>{c.symbol} {c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <main className="portal-content cost-analysis-content">
                <div className="dash-card portal-content-card cost-analysis-main-card">
                  {activeTab === 'overview' && (
                    <div className="cost-overview-tab">
                      <div className="portal-content-header cost-overview-header">
                        <h2 className="portal-content-title">Process cost analysis</h2>
                        <button type="button" className="dash-card-action" onClick={handleReview} disabled={saving}>
                          Review & submit
                        </button>
                      </div>
                      <p className="cost-overview-desc">
                        Build a complete financial case: true process cost, automation savings by scenario, FTE impact, and ROI.
                        Data entered here is <strong>confidential by default</strong> — not visible to the report owner unless you choose to share it.
                      </p>

                      {(() => {
                        const seg = data?.report?.diagnosticData?.contact?.segment || data?.report?.contact?.segment;
                        const COST_SEGMENT_CALLOUTS = {
                          pe: { color: '#8b5cf6', label: 'PE lens', text: 'Frame every cost and saving in terms of EBITDA impact and exit multiple. Use the 3-year ROI and NPV figures to build a data-room-ready business case.' },
                          ma: { color: '#6366f1', label: 'M&A lens', text: 'Integration costs typically run 3–5% of deal value. Use the hidden cost and rework figures to quantify integration risk for Day 1 readiness.' },
                          highstakes: { color: '#d97706', label: 'Go-live lens', text: 'Focus on implementation cost vs payback period. Prioritise quick-win automation savings achievable before the go-live deadline.' },
                          scaling: { color: '#0d9488', label: 'Scaling lens', text: 'Cost-per-instance and FTE equivalent are the key metrics as volume grows. Automation savings compound with each doubling of throughput.' },
                        };
                        const callout = seg && COST_SEGMENT_CALLOUTS[seg];
                        if (!callout) return null;
                        return (
                          <div style={{ background: callout.color + '11', border: `1px solid ${callout.color}33`, borderRadius: 6, padding: '10px 14px', marginBottom: 16, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: callout.color, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', paddingTop: 1 }}>{callout.label}</span>
                            <span style={{ fontSize: 13, color: 'var(--text-mid)' }}>{callout.text}</span>
                          </div>
                        );
                      })()}

                      {id && (
                        <div style={{ marginBottom: 20 }}>
                          <CostAccessPanel reportId={id} />
                        </div>
                      )}

                      {/* ── Group 1: Process costs ── */}
                      <div className="cost-metric-group">
                        <div className="cost-summary-header">
                          <span className="cost-summary-header-label">Process costs</span>
                        </div>
                        <div className="cost-metrics-grid cost-metrics-grid--3col">
                          <div className="portal-analytics-metric cost-metric-item">
                            <span className="portal-analytics-metric-val">{formatCurrencyFn(financials.totalAnnualCost)}</span>
                            <span className="portal-analytics-metric-lbl">Annual process cost</span>
                            {financials.totalHiddenCost > 0 && (
                              <span className="cost-metric-sub">incl. {formatCurrencyFn(financials.totalHiddenCost)} hidden</span>
                            )}
                          </div>
                          {financials.totalInstances > 0 && (
                            <div className="portal-analytics-metric cost-metric-item">
                              <span className="portal-analytics-metric-val">{formatCurrencyFn(Math.round(financials.totalAnnualCost / financials.totalInstances))}</span>
                              <span className="portal-analytics-metric-lbl">Cost per instance</span>
                              <span className="cost-metric-sub">per process run/year</span>
                            </div>
                          )}
                          {processBreakdown.length > 0 && (
                            <div className="portal-analytics-metric cost-metric-item">
                              <span className="portal-analytics-metric-val">{Math.round(Object.keys(aiSuggestionData).length / processBreakdown.length * 100)}%</span>
                              <span className="portal-analytics-metric-lbl">AI coverage</span>
                              <span className="cost-metric-sub">processes with AI estimates</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* ── Group 2: Automation scenario ── */}
                      <div className="cost-metric-group">
                        <div className="cost-summary-header">
                          <span className="cost-summary-header-label">Automation scenario</span>
                        </div>
                        <div className="cost-metrics-grid cost-metrics-grid--3col">
                          <div className="portal-analytics-metric cost-metric-item cost-metric-success">
                            <span className="portal-analytics-metric-val">{formatCurrencyFn(financials.potentialSavings)}/yr</span>
                            <span className="portal-analytics-metric-lbl">Automation savings</span>
                            {financials.totalAnnualCost > 0 && (
                              <span className="cost-metric-sub">{Math.round(financials.potentialSavings / financials.totalAnnualCost * 100)}% of total cost</span>
                            )}
                          </div>
                          <div className="portal-analytics-metric cost-metric-item">
                            <span className="portal-analytics-metric-val">{financials.fteEquivalent}</span>
                            <span className="portal-analytics-metric-lbl">
                              FTE equivalent
                              <span className="cost-tooltip" title="FTE equivalent = automation savings ÷ (default hourly rate × 2,080 hours/year). Represents the number of full-time employees whose time could be freed.">ⓘ</span>
                            </span>
                            <span className="cost-metric-sub">people freed</span>
                          </div>
                          {financials.potentialSavings > 0 && (
                            <div className="portal-analytics-metric cost-metric-item">
                              <span className="portal-analytics-metric-val">{formatCurrencyFn(financials.totalAnnualCost - financials.potentialSavings)}/yr</span>
                              <span className="portal-analytics-metric-lbl">Residual cost</span>
                              <span className="cost-metric-sub">after automation savings</span>
                            </div>
                          )}
                          {hasImpl ? (
                            <>
                              <div className="portal-analytics-metric cost-metric-item">
                                <span className="portal-analytics-metric-val">{financials.paybackMonths > 0 ? `${financials.paybackMonths} mo` : '—'}</span>
                                <span className="portal-analytics-metric-lbl">Payback period</span>
                              </div>
                              <div className="portal-analytics-metric cost-metric-item">
                                <span className="portal-analytics-metric-val">{formatCurrencyFn(financials.npv3yr)}</span>
                                <span className="portal-analytics-metric-lbl">3-year NPV</span>
                                <span className="cost-metric-sub">8% discount</span>
                              </div>
                              {financials.roi3yr != null && (
                                <div className="portal-analytics-metric cost-metric-item cost-metric-success">
                                  <span className="portal-analytics-metric-val">{financials.roi3yr}%</span>
                                  <span className="portal-analytics-metric-lbl">3-year ROI</span>
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="portal-analytics-metric cost-metric-item cost-metric-prompt">
                              <span className="portal-analytics-metric-lbl">Payback / ROI</span>
                              <span className="cost-metric-prompt-text">Add implementation cost to unlock</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* ── Group 3: Redesign scenario (conditional) ── */}
                      {redesign && (
                        <div className="cost-metric-group">
                          <div className="cost-summary-header">
                            <span className="cost-summary-header-label">Redesign scenario</span>
                            {redesign.costSummary && (
                              <span className="redesign-cost-meta">
                                {redesign.costSummary.stepsRemoved > 0 && `${redesign.costSummary.stepsRemoved} steps removed`}
                                {redesign.costSummary.stepsAutomated > 0 && ` · ${redesign.costSummary.stepsAutomated} automated`}
                              </span>
                            )}
                          </div>
                          {financials.redesignSavings > 0 && (
                            <div className="cost-metrics-grid">
                              <div className="portal-analytics-metric cost-metric-item cost-metric-success">
                                <span className="portal-analytics-metric-val">{formatCurrencyFn(financials.redesignSavings)}/yr</span>
                                <span className="portal-analytics-metric-lbl">Redesign savings</span>
                                {financials.totalAnnualCost > 0 && (
                                  <span className="cost-metric-sub">{Math.round(financials.redesignSavings / financials.totalAnnualCost * 100)}% of total cost</span>
                                )}
                              </div>
                              {hasImpl ? (
                                <>
                                  <div className="portal-analytics-metric cost-metric-item">
                                    <span className="portal-analytics-metric-val">{financials.rdPaybackMonths > 0 ? `${financials.rdPaybackMonths} mo` : '—'}</span>
                                    <span className="portal-analytics-metric-lbl">Payback period</span>
                                    <span className="cost-metric-sub">based on redesign savings</span>
                                  </div>
                                  <div className="portal-analytics-metric cost-metric-item">
                                    <span className="portal-analytics-metric-val">{formatCurrencyFn(financials.rdNpv3yr)}</span>
                                    <span className="portal-analytics-metric-lbl">3-year NPV</span>
                                    <span className="cost-metric-sub">8% discount</span>
                                  </div>
                                  {financials.rdRoi3yr != null && (
                                    <div className="portal-analytics-metric cost-metric-item cost-metric-success">
                                      <span className="portal-analytics-metric-val">{financials.rdRoi3yr}%</span>
                                      <span className="portal-analytics-metric-lbl">3-year ROI</span>
                                    </div>
                                  )}
                                </>
                              ) : (
                                <div className="portal-analytics-metric cost-metric-item cost-metric-prompt">
                                  <span className="portal-analytics-metric-lbl">Payback / ROI</span>
                                  <span className="cost-metric-prompt-text">Add implementation cost to unlock</span>
                                </div>
                              )}
                            </div>
                          )}
                          <RedesignCostChart processBreakdown={processBreakdown} formatValue={formatCurrencyFn} />
                        </div>
                      )}

                      {!hasAiData && (
                        <div className="cost-ai-callout">
                          <div className="cost-ai-callout-content">
                            <strong className="cost-ai-callout-title">Get AI-estimated savings</strong>
                            <span className="cost-ai-callout-desc">AI will analyse your processes and suggest realistic automation savings based on your actual step data.</span>
                          </div>
                          {aiSuggesting ? (
                            <span className="cost-ai-loading">⟳ Analysing processes…</span>
                          ) : (
                            <button type="button" className="button button-primary cost-ai-callout-btn" onClick={handleAiSuggest}>
                              ✦ AI estimates
                            </button>
                          )}
                          {aiError && <span className="cost-ai-error" style={{ display: 'block', marginTop: 6 }}>{aiError}</span>}
                        </div>
                      )}

                      <div className="cost-overview-actions">
                        <button type="button" className="button button-primary" onClick={handleReview} disabled={saving}>
                          Review & submit
                        </button>
                        <Link href={`/report?id=${id}`} className="button cost-btn-outline">Cancel</Link>
                      </div>
                    </div>
                  )}

                  {activeTab === 'processes' && (
                    <div className="cost-processes-tab">
                      <div className="portal-content-header">
                        <h2 className="portal-content-title">Process breakdown</h2>
                      </div>

                      <div className="cost-process-cards-list">
                        {processBreakdown.map((p, i) => (
                          <ProcessCostCard
                            key={i}
                            p={p}
                            i={i}
                            aiSuggestionData={aiSuggestionData}
                            processCostDrivers={processCostDrivers}
                            onSetDrivers={handleSetDrivers}
                            formatCurrency={formatCurrencyFn}
                            nonLabourCost={financials.nonLabourPerProcess?.[i]}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {activeTab === 'savings' && (() => {
                    const savingsGrandTotal = processBreakdown.reduce((total, p, pi) => {
                      const bd = aiSuggestionData[pi]?.breakdown;
                      const sl = driverSliders[pi] || {};
                      const tMins = (bd?.totalWorkMins || 0) + (bd?.totalWaitMins || 0);
                      if (!bd || tMins === 0) return total;
                      const mKeys = ['automationMins','bottleneckMins','redundancyMins','workReductionMins'];
                      const sKeys = ['automation','bottleneck','redundancy','workReduction'];
                      const rMaxes = mKeys.map(k => (bd[k] || 0) / tMins * p.trueAnnualCost);
                      const rSum = rMaxes.reduce((a, b) => a + b, 0);
                      const nf = rSum > p.trueAnnualCost ? p.trueAnnualCost / rSum : 1;
                      return total + rMaxes.reduce((s, m, di) => s + m * nf * ((sl[sKeys[di]] ?? 100) / 100), 0);
                    }, 0);
                    return (
                    <div className="cost-savings-tab">
                      <div className="portal-content-header">
                        <h2 className="portal-content-title">Automation savings</h2>
                        <div className="cost-ai-suggest-wrap">
                          {aiSuggesting ? (
                            <span className="cost-ai-loading">⟳ Analysing…</span>
                          ) : (
                            <button type="button" className="cost-ai-refresh-btn" onClick={handleAiSuggest}>
                              ↺ Recalculate
                            </button>
                          )}
                          {aiError && <span className="cost-ai-error">{aiError}</span>}
                        </div>
                      </div>
                      <p className="cost-overview-desc">
                        Theoretical maximum savings from automating this process. Each driver is calculated from your actual process data — use the sliders to adjust how much of each saving you expect to realise.
                      </p>

                      {processBreakdown.map((p, i) => {
                        const breakdown = aiSuggestionData[i]?.breakdown;
                        const sliders = driverSliders[i] || {};
                        const totalMins = (breakdown?.totalWorkMins || 0) + (breakdown?.totalWaitMins || 0);
                        const driverMKeys = ['automationMins', 'bottleneckMins', 'redundancyMins', 'workReductionMins'];
                        const rawMaxSum = totalMins > 0 ? driverMKeys.reduce((sum, k) => sum + (breakdown?.[k] || 0) / totalMins * p.trueAnnualCost, 0) : 0;
                        const normFactor = rawMaxSum > p.trueAnnualCost ? p.trueAnnualCost / rawMaxSum : 1;
                        const getMax = (mKey) => totalMins > 0 ? (breakdown?.[mKey] || 0) / totalMins * p.trueAnnualCost * normFactor : 0;
                        const rawProcess = data?.report?.diagnosticData?.rawProcesses?.[i] || data?.report?.diagnosticData?.processes?.[i] || {};
                        const processTotalSavings = DRIVER_DEFS.reduce((sum, d) => sum + getMax(d.minsKey) * (sliders[d.key] ?? 100) / 100, 0);
                        return (
                          <div key={i} className="cost-savings-process-section">
                            {processBreakdown.length > 1 && (
                              <div className="cost-savings-process-name">{p.name}</div>
                            )}
                            {!breakdown ? (
                              <div className="cost-driver-loading">Calculating saving drivers…</div>
                            ) : (
                              <>
                              {(() => {
                                const chartEntries = DRIVER_DEFS
                                  .map(d => [d.label, getMax(d.minsKey) * (sliders[d.key] ?? 100) / 100])
                                  .filter(([, v]) => v > 0);
                                return chartEntries.length > 0 && (
                                  <CostBarChart
                                    title="Savings by driver"
                                    entries={chartEntries}
                                    getValue={v => v}
                                    getTotal={() => chartEntries.reduce((s, [, v]) => s + v, 0)}
                                    formatValue={v => formatCurrencyFn(Math.round(v))}
                                  />
                                );
                              })()}
                              <div className="cost-driver-list">
                                {DRIVER_DEFS.filter(d => getMax(d.minsKey) > 0).map(d => {
                                  const max = getMax(d.minsKey);
                                  const sliderVal = sliders[d.key] ?? 100;
                                  const savings = max * sliderVal / 100;
                                  const expandKey = `${i}_${d.key}`;
                                  const isExpanded = !!expandedDrivers[expandKey];
                                  return (
                                    <div key={d.key} className={`cost-driver-row${isExpanded ? ' is-expanded' : ''}`}>
                                      <div className="cost-driver-row-top">
                                        <button
                                          type="button"
                                          className="cost-driver-info cost-driver-expand-btn"
                                          onClick={() => setExpandedDrivers(prev => ({ ...prev, [expandKey]: !prev[expandKey] }))}
                                          aria-expanded={isExpanded}
                                        >
                                          <span className="cost-driver-label">{d.label}</span>
                                          <span className="cost-driver-desc">{d.desc}</span>
                                          <span className="cost-driver-chevron">{isExpanded ? '▲' : '▼'}</span>
                                        </button>
                                        <span className="cost-driver-savings">{formatCurrencyFn(savings)}/yr</span>
                                      </div>
                                      {isExpanded && (
                                        <DriverDetail driverKey={d.key} raw={rawProcess} breakdown={breakdown} />
                                      )}
                                      <div className="cost-driver-slider-row">
                                        <input
                                          type="range" min={0} max={100} step={0.5}
                                          value={sliderVal}
                                          onChange={e => handleSetDriverSlider(i, d.key, Number(e.target.value))}
                                          className="cost-driver-slider"
                                        />
                                        <span className="cost-driver-slider-pct">{sliderVal}%</span>
                                      </div>
                                      <div className="cost-driver-range-labels">
                                        <span>None</span>
                                        <span>Full potential: {formatCurrencyFn(max)}/yr</span>
                                      </div>
                                    </div>
                                  );
                                })}
                                {DRIVER_DEFS.every(d => getMax(d.minsKey) === 0) && (
                                  <p className="cost-driver-empty">Add work and wait minutes to each step in the process audit for driver-level analysis.</p>
                                )}
                                <div className="cost-driver-total">
                                  <span>Total savings — {p.name}</span>
                                  <strong>{formatCurrencyFn(processTotalSavings)}/yr</strong>
                                </div>
                              </div>
                              </>
                            )}
                          </div>
                        );
                      })}

                      {processBreakdown.length > 1 && (
                        <div className="cost-driver-total cost-driver-grand-total">
                          <span>Total automation savings (all processes)</span>
                          <strong>{formatCurrencyFn(savingsGrandTotal)}/yr</strong>
                        </div>
                      )}
                    </div>
                    );
                  })()}

                  {activeTab === 'redesign' && redesign && (() => {
                    const totalLabourCost = processBreakdown.reduce((s, p) => s + p.trueAnnualCost, 0);
                    const totalCurrentCost = totalLabourCost + financials.totalFixed;
                    // Use processBreakdown.redesignCost for the latest redesign so it matches the driver breakdown below
                    const totalRedesignedCost = processBreakdown.reduce((s, p) => s + p.redesignCost, 0) + financials.totalFixed;
                    const totalRedesignSavings = processBreakdown.reduce((s, p) => s + p.redesignSavings, 0);
                    const allRd = data?.allRedesigns || (redesign ? [redesign] : []);
                    const latestRdId = data?.redesign?.id;
                    const trajPoints = [
                      { label: 'Current', cost: totalCurrentCost },
                      ...allRd.map(r => ({
                        label: r.name || r.redesign_data?.name || 'Redesign',
                        cost: r.id === latestRdId
                          ? totalRedesignedCost
                          : totalCurrentCost * (1 - (r.redesign_data?.costSummary?.estimatedCostSavedPercent ?? 0) / 100),
                      })),
                    ];
                    return (
                      <div className="cost-redesign-tab">
                        <div className="portal-content-header">
                          <h2 className="portal-content-title">Redesign impact</h2>
                          {redesign.costSummary && (
                            <div className="cost-redesign-meta">
                              {redesign.costSummary.stepsRemoved > 0 && <span>{redesign.costSummary.stepsRemoved} steps removed</span>}
                              {redesign.costSummary.stepsAutomated > 0 && <span>{redesign.costSummary.stepsAutomated} automated</span>}
                              {totalRedesignSavings > 0 && <span className="cost-redesign-meta-savings">{formatCurrencyFn(totalRedesignSavings)}/yr projected saving</span>}
                            </div>
                          )}
                        </div>

                        <CostTrajectoryChart
                          points={trajPoints}
                          formatValue={v => formatCurrencyFn(Math.round(v))}
                        />

                        {processBreakdown.map((p, i) => {
                          const bd = aiSuggestionData[i]?.breakdown;
                          const totalMins = bd ? (bd.totalWorkMins + bd.totalWaitMins) : 0;
                          const sliders = redesignSliders[i] || {};
                          const processChanges = (redesign.changes || []).filter(c => c.process === p.name);

                          const driverChanges = {};
                          for (const change of processChanges) {
                            const driver = REDESIGN_CHANGE_TO_DRIVER[change.type];
                            if (!driver) continue;
                            if (!driverChanges[driver]) driverChanges[driver] = [];
                            driverChanges[driver].push(change);
                          }

                          const getMax = (mKey) => totalMins > 0 && bd ? (bd[mKey] || 0) / totalMins * p.trueAnnualCost : 0;
                          const rawMaxSum = Object.values(DRIVER_MINS_KEY).reduce((s, k) => s + getMax(k), 0);
                          const normFactor = rawMaxSum > p.trueAnnualCost ? p.trueAnnualCost / rawMaxSum : 1;

                          // Only show drivers that are either addressed OR have cost potential
                          const visibleDrivers = DRIVER_DEFS.filter(d => {
                            const changes = driverChanges[d.key] || [];
                            const driverMaxCost = getMax(DRIVER_MINS_KEY[d.key]) * normFactor;
                            return changes.length > 0 || driverMaxCost > 0;
                          });

                          const rdChartEntries = visibleDrivers
                            .map(d => {
                              const driverMaxCost = getMax(DRIVER_MINS_KEY[d.key]) * normFactor;
                              return [d.label, driverMaxCost * (sliders[d.key] ?? 0) / 100];
                            })
                            .filter(([, v]) => v > 0);

                          return (
                            <div key={i} className="cost-redesign-process">
                              {processBreakdown.length > 1 && (
                                <div className="cost-redesign-process-name">{p.name}</div>
                              )}
                              {rdChartEntries.length > 0 && (
                                <CostBarChart
                                  title="Redesign savings by driver"
                                  entries={rdChartEntries}
                                  getValue={v => v}
                                  getTotal={() => rdChartEntries.reduce((s, [, v]) => s + v, 0)}
                                  formatValue={v => formatCurrencyFn(Math.round(v))}
                                />
                              )}
                              <div className="cost-redesign-drivers">
                                {visibleDrivers.map(d => {
                                  const changes = driverChanges[d.key] || [];
                                  const driverMins = bd?.[DRIVER_MINS_KEY[d.key]] || 0;
                                  const timeSavedByChanges = changes.reduce((s, c) => s + (c.estimatedTimeSavedMinutes || 0), 0);
                                  const coveragePct = driverMins > 0 ? Math.min(100, Math.round(timeSavedByChanges / driverMins * 100)) : 0;
                                  const driverMaxCost = getMax(DRIVER_MINS_KEY[d.key]) * normFactor;
                                  const sliderVal = sliders[d.key] ?? 0;
                                  const costAtSlider = driverMaxCost * sliderVal / 100;
                                  const isAddressed = changes.length > 0;

                                  const rdExpandKey = `rd_${i}_${d.key}`;
                                  const rdExpanded = expandedDrivers[rdExpandKey] ?? false;
                                  return (
                                    <div key={d.key} className={`cost-redesign-driver${isAddressed ? ' is-addressed' : ''}`}>
                                      <button
                                        type="button"
                                        className="cost-redesign-driver-header"
                                        onClick={() => setExpandedDrivers(prev => ({ ...prev, [rdExpandKey]: !rdExpanded }))}
                                        aria-expanded={rdExpanded}
                                      >
                                        <span className="cost-redesign-driver-label">{d.label}</span>
                                        <span className="cost-redesign-driver-coverage">
                                          {coveragePct > 0 ? `${coveragePct}% addressed` : 'Not addressed'}
                                        </span>
                                        {costAtSlider > 0 && (
                                          <span className="cost-redesign-driver-cost">{formatCurrencyFn(costAtSlider)}/yr</span>
                                        )}
                                        <span className="cost-redesign-driver-chevron">{rdExpanded ? '▲' : '▼'}</span>
                                      </button>
                                      {rdExpanded && isAddressed && (
                                        <>
                                          {coveragePct > 0 && (
                                            <div className="cost-redesign-driver-bar-wrap">
                                              <div className="cost-redesign-driver-bar" style={{ width: `${coveragePct}%` }} />
                                            </div>
                                          )}
                                          <div className="cost-redesign-changes">
                                            {changes.map((c, ci) => (
                                              <div key={ci} className="cost-redesign-change">
                                                <span className={`cost-redesign-change-type cost-redesign-type-${c.type}`}>{c.type}</span>
                                                <span className="cost-redesign-change-step">{c.stepName}</span>
                                                <span className="cost-redesign-change-time">{c.estimatedTimeSavedMinutes}m saved</span>
                                              </div>
                                            ))}
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                              {p.redesignSavings > 0 && (
                                <div className="cost-driver-total">
                                  <span>Total redesign savings{processBreakdown.length > 1 ? ` — ${p.name}` : ''}</span>
                                  <strong>{formatCurrencyFn(p.redesignSavings)}/yr</strong>
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {processBreakdown.length > 1 && (
                          <div className="cost-driver-total cost-driver-grand-total">
                            <span>Total redesign savings (all processes)</span>
                            <strong>{formatCurrencyFn(totalRedesignSavings)}/yr</strong>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {activeTab === 'settings' && (
                    <div className="cost-settings-tab">
                      <div className="portal-content-header">
                        <h2 className="portal-content-title">Labour & costs</h2>
                      </div>

                      <nav className="cost-settings-subtabs" role="tablist">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={settingsSubTab === 'labour'}
                          className={`cost-settings-subtab ${settingsSubTab === 'labour' ? 'active' : ''}`}
                          onClick={() => setSettingsSubTab('labour')}
                        >
                          Labour rates
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={settingsSubTab === 'nonlabour'}
                          className={`cost-settings-subtab ${settingsSubTab === 'nonlabour' ? 'active' : ''}`}
                          onClick={() => setSettingsSubTab('nonlabour')}
                        >
                          Non-labour
                          {financials.totalFixed > 0 && <span className="cost-settings-subtab-badge">{formatCurrencyFn(financials.totalFixed)}</span>}
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={settingsSubTab === 'implementation'}
                          className={`cost-settings-subtab ${settingsSubTab === 'implementation' ? 'active' : ''}`}
                          onClick={() => setSettingsSubTab('implementation')}
                        >
                          Implementation
                          {hasImpl && <span className="cost-settings-subtab-badge">{formatCurrencyFn(financials.implTotal)}</span>}
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={settingsSubTab === 'advanced'}
                          className={`cost-settings-subtab ${settingsSubTab === 'advanced' ? 'active' : ''}`}
                          onClick={() => setSettingsSubTab('advanced')}
                        >
                          Advanced
                        </button>
                      </nav>

                      {settingsSubTab === 'labour' && (
                        <div className="cost-settings-panel">

                          {/* ── Rates ── */}
                          <CollapsibleSection title="Team rates" subtitle="Fully loaded hourly cost per team including salary, NI, pension, and overhead">
                          <div className="cost-dept-cards">
                            {labourRates.map((r, i) => {
                              const rateType = r.rateType || 'hourly';
                              const rateInput = r.rateInput ?? r.hourlyRate ?? 0;
                              const effectiveHr = toHourlyRate(rateInput, rateType);
                              const RATE_LABELS = { hourly: '/hr', daily: '/day', annual: '/yr' };
                              const initial = r.department?.[0]?.toUpperCase() || '?';
                              return (
                                <div key={i} className="cost-dept-card">
                                  <div className="cost-dept-card-top">
                                    <div className="cost-dept-avatar">{initial}</div>
                                    <div className="cost-dept-info">
                                      <span className="cost-dept-name">{r.department}</span>
                                      {effectiveHr > 0 && (
                                        <span className="cost-dept-effective">{currencySymbol}{effectiveHr.toFixed(0)}/hr effective</span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="cost-dept-card-fields">
                                    <div className="cost-dept-field">
                                      <label className="cost-dept-field-label">Rate type</label>
                                      <select
                                        className="cost-dept-select"
                                        value={rateType}
                                        onChange={e => {
                                          const next = [...labourRates];
                                          next[i] = { ...next[i], rateType: e.target.value };
                                          setLabourRates(next);
                                        }}
                                      >
                                        <option value="hourly">Hourly</option>
                                        <option value="daily">Day rate</option>
                                        <option value="annual">Annual salary</option>
                                      </select>
                                    </div>
                                    <div className="cost-dept-field">
                                      <label className="cost-dept-field-label">Amount</label>
                                      <div className="cost-dept-input-wrap">
                                        <span className="cost-dept-prefix">{currencySymbol}</span>
                                        <input
                                          type="number"
                                          className={`cost-dept-input${effectiveHr > 0 && effectiveHr < 10 ? ' cost-input-warn' : ''}`}
                                          min={0} step={rateType === 'annual' ? 1000 : rateType === 'daily' ? 10 : 5}
                                          value={rateInput}
                                          onChange={e => {
                                            const next = [...labourRates];
                                            next[i] = { ...next[i], rateInput: parseFloat(e.target.value) || 0 };
                                            setLabourRates(next);
                                          }}
                                          placeholder="0"
                                        />
                                        <span className="cost-dept-suffix">{RATE_LABELS[rateType]}</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          </CollapsibleSection>

                          {/* ── Defaults ── */}
                          <CollapsibleSection title="Defaults" subtitle="Blended rate and on-cost multiplier used when team rates are not set">
                            <div className="cost-rates-defaults-grid">
                              <div className="cost-analysis-field">
                                <label>Blended rate ({currencySymbol}/hr)</label>
                                <div className="cost-rates-input-wrap">
                                  <span className="cost-rates-currency">{currencySymbol}</span>
                                  <input type="number" className="cost-analysis-input" min={10} step={5} value={blendedRate} onChange={e => setBlendedRate(parseFloat(e.target.value) || 50)} placeholder="50" />
                                </div>
                              </div>
                              <div className="cost-analysis-field">
                                <label>
                                  On-cost multiplier
                                  <Tip text="Multiplies the base rate to cover employer costs: NI, pension, benefits. 1.25 = 25% above the quoted hourly rate." />
                                </label>
                                <input type="number" className="cost-analysis-input" min={1} max={2} step={0.05} value={onCostMultiplier} onChange={e => setOnCostMultiplier(parseFloat(e.target.value) || 1.25)} placeholder="1.25" />
                              </div>
                            </div>
                          </CollapsibleSection>

                          {/* ── Cost by department ── */}
                          {labourRates.some(r => toHourlyRate(r.rateInput ?? r.hourlyRate, r.rateType) > 0) && (() => {
                            const deptWork = {};
                            const deptWait = {};
                            processBreakdown.forEach((pb, i) => {
                              const depts = processes[i]?.departments || pb.depts || [];
                              const waitCostPct = pb.annualLabour > 0 ? pb.waitCost / pb.annualLabour : 0;
                              if (depts.length === 0) {
                                deptWork['Unassigned'] = (deptWork['Unassigned'] || 0) + pb.annualLabour;
                                deptWait['Unassigned'] = (deptWait['Unassigned'] || 0) + pb.waitCost;
                              } else {
                                const n = depts.length;
                                depts.forEach(d => {
                                  const entry = rateByDept[d] ?? { effective: defaultRate };
                                  const deptLabour = (pb.hours * entry.effective * pb.annual * pb.teamSize) / n;
                                  deptWork[d] = (deptWork[d] || 0) + deptLabour;
                                  deptWait[d] = (deptWait[d] || 0) + deptLabour * waitCostPct;
                                });
                              }
                            });
                            const allDepts = new Set([...Object.keys(deptWork), ...Object.keys(deptWait)]);
                            const deptTotal = {};
                            allDepts.forEach(d => { deptTotal[d] = (deptWork[d] || 0) + (deptWait[d] || 0); });
                            const workEntries = Object.entries(deptWork).filter(([, v]) => v > 0);
                            const waitEntries = Object.entries(deptWait).filter(([, v]) => v > 0);
                            const totalEntries = Object.entries(deptTotal).filter(([, v]) => v > 0);
                            if (workEntries.length === 0) return null;
                            const workTotal = workEntries.reduce((s, [, v]) => s + v, 0);
                            const waitTotal = waitEntries.reduce((s, [, v]) => s + v, 0);
                            const grandTotal = totalEntries.reduce((s, [, v]) => s + v, 0);
                            return (
                              <CollapsibleSection
                                title="Cost by team"
                                subtitle="Annual labour cost split across teams"
                                badge={formatCurrencyFn(Math.round(grandTotal))}
                              >
                                <CostBarChart
                                  title="Total cost by team"
                                  entries={totalEntries}
                                  getValue={v => v}
                                  getTotal={() => grandTotal}
                                  formatValue={v => formatCurrencyFn(Math.round(v))}
                                  maxBars={10}
                                />
                                <div className="cost-dept-charts-row">
                                  <CostBarChart
                                    title="Work cost by team"
                                    entries={workEntries}
                                    getValue={v => v}
                                    getTotal={() => workTotal}
                                    formatValue={v => formatCurrencyFn(Math.round(v))}
                                    maxBars={10}
                                  />
                                  {waitEntries.length > 0 && (
                                    <CostBarChart
                                      title="Wait cost by team"
                                      entries={waitEntries}
                                      getValue={v => v}
                                      getTotal={() => waitTotal}
                                      formatValue={v => formatCurrencyFn(Math.round(v))}
                                      maxBars={10}
                                    />
                                  )}
                                </div>
                              </CollapsibleSection>
                            );
                          })()}

                          {/* ── Time by team ── */}
                          {(() => {
                            const rawProcs = data?.report?.diagnosticData?.rawProcesses || data?.report?.diagnosticData?.processes || [];
                            const deptWorkMins = {};
                            const deptWaitMins = {};
                            rawProcs.forEach((raw, pi) => {
                              const p = processes[pi] || {};
                              const annual = p.annual || 12;
                              const teamSize = p.teamSize || 1;
                              (raw.steps || []).forEach(s => {
                                const wk = s.workMinutes || 0;
                                const wt = s.waitMinutes || 0;
                                if (wk > 0 || wt > 0) {
                                  const dept = s.department || 'Unassigned';
                                  deptWorkMins[dept] = (deptWorkMins[dept] || 0) + wk * annual * teamSize;
                                  deptWaitMins[dept] = (deptWaitMins[dept] || 0) + wt * annual * teamSize;
                                }
                              });
                            });
                            const allDepts = [...new Set([...Object.keys(deptWorkMins), ...Object.keys(deptWaitMins)])].sort();
                            if (allDepts.length === 0) return null;
                            const totalWork = allDepts.reduce((s, d) => s + (deptWorkMins[d] || 0), 0);
                            const totalWait = allDepts.reduce((s, d) => s + (deptWaitMins[d] || 0), 0);
                            const fmtH = m => (m / 60).toFixed(1) + 'h';
                            const totalHours = (totalWork + totalWait) / 60;
                            const workEntries = allDepts.filter(d => deptWorkMins[d] > 0).map(d => [d, deptWorkMins[d]]);
                            const waitEntries = allDepts.filter(d => deptWaitMins[d] > 0).map(d => [d, deptWaitMins[d]]);
                            const totalEntries = allDepts.map(d => [d, (deptWorkMins[d] || 0) + (deptWaitMins[d] || 0)]).filter(([, v]) => v > 0);
                            return (
                              <CollapsibleSection
                                title="Time by team"
                                subtitle="Annual work and wait hours per team"
                                badge={totalHours > 0 ? totalHours.toFixed(0) + 'h/yr' : undefined}
                              >
                                <CostBarChart
                                  title="Total hours by team"
                                  entries={totalEntries}
                                  getValue={v => v}
                                  getTotal={() => totalWork + totalWait}
                                  formatValue={v => fmtH(v)}
                                  maxBars={10}
                                />
                                {waitEntries.length > 0 && (
                                  <div className="cost-dept-charts-row">
                                    <CostBarChart
                                      title="Work hours by team"
                                      entries={workEntries}
                                      getValue={v => v}
                                      getTotal={() => totalWork}
                                      formatValue={v => fmtH(v)}
                                      maxBars={10}
                                    />
                                    <CostBarChart
                                      title="Wait hours by team"
                                      entries={waitEntries}
                                      getValue={v => v}
                                      getTotal={() => totalWait}
                                      formatValue={v => fmtH(v)}
                                      maxBars={10}
                                    />
                                  </div>
                                )}
                              </CollapsibleSection>
                            );
                          })()}

                        </div>
                      )}

                      {settingsSubTab === 'nonlabour' && (
                        <div className="cost-settings-panel">
                          <p className="cost-analysis-section-desc">Annual licensing cost per system identified in the process steps.</p>
                          {financials.totalFixed > 0 && (
                            <div className="cost-nonlabour-charts">
                              <CostDonutChart
                                title="Non-labour cost mix"
                                segments={[
                                  ['Systems', totalSystemsCost],
                                  ['External (× volume)', (nonLabour.externalPerInstance || 0) * Math.max(processes.reduce((s, p) => s + ((p.annual ?? 12) * (p.teamSize ?? 1)), 0), 1)],
                                  ['Compliance & audit', nonLabour.complianceAnnual || 0],
                                ]}
                                formatValue={v => formatCurrencyFn(v)}
                              />
                              {totalSystemsCost > 0 && (
                                <CostDonutChart
                                  title="Systems breakdown"
                                  segments={Object.entries(systemCosts)
                                    .filter(([, v]) => (Number(v) || 0) > 0)
                                    .map(([name, val]) => [name, Number(val) || 0])}
                                  formatValue={v => formatCurrencyFn(v)}
                                />
                              )}
                            </div>
                          )}
                          {Object.keys(systemCosts).length > 0 ? (
                            <div className="cost-systems-table">
                              <div className="cost-systems-table-header">
                                <span className="cost-systems-col-name">System</span>
                                <span className="cost-systems-col-cost">Cost ({currencySymbol}/yr)</span>
                              </div>
                              {Object.keys(systemCosts).map(sys => (
                                <div key={sys} className="cost-systems-table-row">
                                  <span className="cost-systems-col-name cost-systems-name">{sys}</span>
                                  <div className="cost-systems-col-cost cost-rates-input-wrap">
                                    <span className="cost-rates-currency">{currencySymbol}</span>
                                    <input
                                      type="number"
                                      className="cost-analysis-input cost-input-system"
                                      min={0} step={100}
                                      value={systemCosts[sys] ?? 0}
                                      onChange={e => setSystemCosts(prev => ({ ...prev, [sys]: parseFloat(e.target.value) || 0 }))}
                                      placeholder="0"
                                    />
                                    <span className="cost-rates-unit">/yr</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="cost-analysis-section-desc" style={{ color: 'var(--text-mid)', marginBottom: 16 }}>No systems identified in the process steps.</p>
                          )}
                          <div className="cost-nonlabour-other-card">
                            <div className="cost-rates-defaults-title">External & compliance</div>
                            <p className="cost-rates-defaults-desc">Variable and fixed costs not captured in system licences.</p>
                            <div className="cost-rates-defaults-grid">
                              <div className="cost-analysis-field">
                                <label>
                                  External cost per instance ({currencySymbol})
                                  <Tip text="Variable cost per process run — e.g. courier fees, contractor rates, third-party API calls. Multiplied by annual volume." />
                                </label>
                                <div className="cost-rates-input-wrap">
                                  <span className="cost-rates-currency">{currencySymbol}</span>
                                  <input type="number" className="cost-analysis-input" min={0} step={0.5} value={nonLabour.externalPerInstance} onChange={e => setNonLabour({ ...nonLabour, externalPerInstance: parseFloat(e.target.value) || 0 })} placeholder="0" />
                                </div>
                              </div>
                              <div className="cost-analysis-field">
                                <label>Compliance & audit ({currencySymbol}/yr)</label>
                                <div className="cost-rates-input-wrap">
                                  <span className="cost-rates-currency">{currencySymbol}</span>
                                  <input type="number" className="cost-analysis-input" min={0} step={100} value={nonLabour.complianceAnnual} onChange={e => setNonLabour({ ...nonLabour, complianceAnnual: parseFloat(e.target.value) || 0 })} placeholder="0" />
                                  <span className="cost-rates-unit">/yr</span>
                                </div>
                              </div>
                            </div>
                            {financials.totalFixed > 0 && (
                              <div className="cost-systems-total">
                                Total non-labour: <strong>{formatCurrencyFn(financials.totalFixed)}/yr</strong>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {settingsSubTab === 'implementation' && (
                        <div className="cost-settings-panel">
                          <p className="cost-analysis-section-desc">
                            Enter expected automation investment costs to calculate payback period, 3-year NPV, and ROI. Leave at {currencySymbol}0 if not yet scoped.
                          </p>
                          {hasImpl && (
                            <>
                              <div className="cost-nonlabour-charts">
                                <CostDonutChart
                                  title="Investment breakdown"
                                  segments={[
                                    ['Platform / tooling', implementationCost.platform || 0],
                                    ['Setup & build', implementationCost.setup || 0],
                                    ['Training', implementationCost.training || 0],
                                    ['Maintenance (yr 1)', implementationCost.maintenanceAnnual || 0],
                                  ]}
                                  formatValue={v => formatCurrencyFn(v)}
                                />
                                <CostVerticalBarChart
                                  title="3-year net benefit"
                                  labels={['Year 1', 'Year 2', 'Year 3']}
                                  values={[financials.year1Net, financials.year2Net, financials.year3Net]}
                                  formatValue={v => formatCurrencyFn(v)}
                                />
                              </div>
                              <div className="cost-impl-metrics-card">
                                <div className="cost-rates-defaults-title">Returns</div>
                                <p className="cost-rates-defaults-desc">Payback period, 3-year ROI, and NPV based on projected savings.</p>
                                <div className="cost-impl-metrics">
                                  <div className="cost-impl-metric">
                                    <div className="cost-impl-metric-label">Payback</div>
                                    <div className="cost-impl-metric-val">{financials.paybackMonths > 0 ? `${financials.paybackMonths} mo` : '—'}</div>
                                  </div>
                                  <div className="cost-impl-metric cost-impl-metric-highlight">
                                    <div className="cost-impl-metric-label">3-year ROI</div>
                                    <div className="cost-impl-metric-val">{financials.roi3yr != null ? `${financials.roi3yr}%` : '—'}</div>
                                  </div>
                                  <div className="cost-impl-metric">
                                    <div className="cost-impl-metric-label">3-year NPV</div>
                                    <div className="cost-impl-metric-val">{formatCurrencyFn(financials.npv3yr)}</div>
                                  </div>
                                </div>
                              </div>
                            </>
                          )}
                          <div className="cost-impl-table">
                            <div className="cost-impl-table-header">
                              <span className="cost-impl-col-name">Category</span>
                              <span className="cost-impl-col-cost">Cost ({currencySymbol})</span>
                            </div>
                            {[
                              { key: 'platform', label: 'Platform / tooling', tip: 'Annual or one-time cost of the automation platform (e.g. Power Automate, Zapier, Make, Workato).' },
                              { key: 'setup', label: 'Setup & build', tip: 'One-time cost to design, build, and deploy the automation — includes developer or consultant time.' },
                              { key: 'training', label: 'Training & change management', tip: 'Cost to train staff and manage the transition to the automated process.' },
                              { key: 'maintenanceAnnual', label: `Maintenance (${currencySymbol}/yr)`, tip: 'Ongoing cost to maintain, update, and support the automation post-launch.' },
                            ].map(({ key, label, tip }) => (
                              <div key={key} className="cost-impl-table-row">
                                <span className="cost-impl-col-name cost-impl-name">
                                  {label}
                                  {' '}
                                  <Tip text={tip} />
                                </span>
                                <div className="cost-impl-col-cost cost-rates-input-wrap">
                                  <span className="cost-rates-currency">{currencySymbol}</span>
                                  <input
                                    type="number"
                                    className="cost-analysis-input"
                                    min={0} step={500}
                                    value={implementationCost[key] || 0}
                                    onChange={e => setImplementationCost(prev => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
                                    placeholder="0"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {settingsSubTab === 'advanced' && (
                        <div className="cost-settings-panel">
                          <p className="cost-analysis-section-desc">
                            These inputs refine the model but are optional. The growth rate affects multi-year projections; hidden cost inputs expose error and wait-time costs not captured in direct labour.
                          </p>
                          <div className="cost-analysis-field">
                            <label>
                              Annual volume growth rate
                              <Tip text="Expected annual increase in process volume. 0.05 = 5% growth per year. Used to project Year 2 and Year 3 savings." />
                            </label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <input
                                type="number"
                                className="cost-analysis-input"
                                style={{ width: 100 }}
                                min={0} max={0.5} step={0.01}
                                value={growthRate}
                                onChange={e => setGrowthRate(Math.min(0.5, Math.max(0, parseFloat(e.target.value) || 0)))}
                                placeholder="0.05"
                              />
                              <span style={{ fontSize: '0.85rem', color: 'var(--text-light)' }}>{Math.round(growthRate * 100)}% per year</span>
                            </div>
                          </div>
                          <p className="cost-analysis-section-desc" style={{ marginTop: 16 }}>
                            To add error/rework rate or wait-time % per process, expand the &quot;Add hidden cost inputs&quot; section within each process card in the Process breakdown tab.
                          </p>
                        </div>
                      )}

                      <div className="cost-analysis-actions">
                        <button type="button" className="button button-primary" onClick={handleReview} disabled={saving}>
                          Review & submit
                        </button>
                        <Link href={`/report?id=${id}`} className="button cost-btn-outline">Cancel</Link>
                      </div>
                    </div>
                  )}
                </div>
              </main>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CostAnalysisPage() {
  return (
    <Suspense fallback={
      <div className="report-page" style={{ padding: 40, textAlign: 'center' }}>
        <div className="loading-state loading-fallback"><div className="loading-spinner" /></div>
        <p style={{ marginTop: 16 }}>Loading...</p>
      </div>
    }>
      <CostAnalysisContent />
    </Suspense>
  );
}
