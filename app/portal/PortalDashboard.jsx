'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useTheme } from '@/components/ThemeProvider';
import ThemeToggle from '@/components/ThemeToggle';
import { apiFetch } from '@/lib/api-fetch';
import { useFlowLayoutSave } from '@/lib/useFlowLayoutSave';
import { calculateAutomationScore } from '@/lib/diagnostic/buildLocalResults';
import { getAutomationReadinessColor, getAutomationReadinessClass } from '@/lib/diagnostic/automationReadiness';
import InteractiveFlowCanvas from '@/components/flow/InteractiveFlowCanvas';
import { resolveStoredPositions } from '@/lib/flows';
import FloatingFlowViewer from '@/components/diagnostic/FloatingFlowViewer';
import AuditTrailPanel from '@/components/diagnostic/AuditTrailPanel';
import StepInsightPanel from '@/components/report/StepInsightPanel';
import MetricDrillModal from '@/components/report/MetricDrillModal';
import PortalAnalyticsPanel from '@/app/portal/PortalAnalyticsPanel';
import DealsPanel from '@/app/portal/DealsPanel';

function formatCurrency(val) {
  if (val >= 1000000) return '\u00A3' + (val / 1000000).toFixed(1) + 'M';
  if (val >= 1000) return '\u00A3' + (val / 1000).toFixed(0) + 'K';
  return '\u00A3' + Math.round(val ?? 0);
}

function formatPortalDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  const opts = d.getFullYear() === today.getFullYear()
    ? { day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', year: 'numeric' };
  return d.toLocaleDateString('en-GB', opts);
}

function formatRelativeTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sec = Math.floor((now - d) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} hours ago`;
  if (sec < 604800) return `${Math.floor(sec / 86400)} days ago`;
  if (sec < 2592000) return `${Math.floor(sec / 604800)} weeks ago`;
  return formatPortalDate(iso);
}

function getStatusInfo(r) {
  const pct = r.metrics?.automationPercentage ?? 0;
  const hasRedesign = r.redesignStatus === 'accepted' || r.redesignStatus === 'pending';
  if (pct >= 70) return { dot: 'green', tag: 'optimised', tagText: 'Automation Ready' };
  if (pct >= 40) return { dot: 'amber', tag: 'progress', tagText: 'Improvements Required' };
  if (hasRedesign) return { dot: 'amber', tag: 'progress', tagText: 'Low Automation' };
  if (pct < 40) return { dot: 'red', tag: 'review', tagText: 'Requires Process Redesign' };
  return { dot: 'amber', tag: 'progress', tagText: 'Improvements Required' };
}

function PortalComparisonTab({ processes, redesignVersions = [], totalAnnualCost }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const chartLayoutRef = useRef(null);
  const [chartHover, setChartHover] = useState(null); // { xIndex, label, values: [{ label, value, suffix }] }

  const versions = redesignVersions || [];
  const n = versions.length;
  const avgCurrentAuto = processes.length > 0 ? Math.round(processes.reduce((s, p) => s + p.currentAuto, 0) / processes.length) : 0;
  const avgAutoPerVersion = versions.map((v, vi) => {
    if (processes.length === 0) return 0;
    const sum = processes.reduce((s, p) => s + (p.versionAutos?.[vi] ?? p.currentAuto), 0);
    return Math.round(sum / processes.length);
  });
  const costPerVersion = versions.map(v => v.costSummary?.estimatedCostSavedPercent ?? 0);
  const timePerVersion = versions.map(v => v.costSummary?.estimatedTimeSavedPercent ?? 0);
  const stepsRemovedPerVersion = versions.map(v => v.costSummary?.stepsRemoved ?? 0);
  const stepsAutomatedPerVersion = versions.map(v => v.costSummary?.stepsAutomated ?? 0);

  const automationValues = [avgCurrentAuto, ...avgAutoPerVersion];
  const costValues = [0, ...costPerVersion];
  const timeValues = [0, ...timePerVersion];
  const stepsRemovedValues = [0, ...stepsRemovedPerVersion];
  const stepsAutomatedValues = [0, ...stepsAutomatedPerVersion];

  const costSavedPct = costValues[costValues.length - 1] ?? 0;
  const costSavedAmount = totalAnnualCost > 0 && costSavedPct > 0 ? Math.round(totalAnnualCost * costSavedPct / 100) : 0;
  const latestVersion = versions[versions.length - 1];

  const metrics = [
    { key: 'automation', label: 'Automation readiness', values: automationValues, color: '#0d9488', suffix: '%', desc: 'Share of process steps that can be automated' },
    { key: 'stepsRemoved', label: 'Steps removed', values: stepsRemovedValues, color: '#d97706', suffix: '', desc: 'Steps eliminated from the process' },
    { key: 'stepsAutomated', label: 'Steps automated', values: stepsAutomatedValues, color: '#a78bfa', suffix: '', desc: 'Steps converted to automated execution' },
  ].filter(m => m.values.some(v => v > 0));

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || metrics.length === 0) return;

    const draw = () => {
      const rect = container.getBoundingClientRect();
      const chartW = Math.max(280, Math.floor(rect.width || 360));
      const chartH = 220;
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const pad = { top: 20, right: 20, bottom: 36, left: 48 };
      const plotH = chartH - pad.top - pad.bottom;
      const plotW = chartW - pad.left - pad.right;
      const maxVal = Math.max(1, ...metrics.flatMap(m => m.values));

      canvas.width = chartW * dpr;
      canvas.height = chartH * dpr;
      canvas.style.width = chartW + 'px';
      canvas.style.height = chartH + 'px';
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, chartW, chartH);

      const toY = (v) => pad.top + plotH - (v / maxVal) * plotH;
      const numPoints = Math.max(2, metrics[0]?.values?.length || 2);
      const labels = ['Current', ...Array.from({ length: numPoints - 1 }, (_, i) => versions[i]?.name || `Redesign ${i + 1}`)];
      const baselineY = pad.top + plotH;
      const toX = (i) => pad.left + (numPoints === 1 ? 0.5 : i / (numPoints - 1)) * plotW;

      // Grid lines (dashed, dark-mode)
      const gridSteps = 4;
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'right';
      for (let g = 0; g <= gridSteps; g++) {
        const v = maxVal * g / gridSteps;
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
        const hasPct = metrics.some(m => m.suffix === '%');
        ctx.fillText(hasPct ? v.toFixed(0) + '%' : v.toFixed(0), pad.left - 6, y + 4);
      }

      // Axes
      ctx.strokeStyle = 'rgba(148,163,184,0.2)';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(pad.left, pad.top);
      ctx.lineTo(pad.left, baselineY);
      ctx.lineTo(pad.left + plotW, baselineY);
      ctx.stroke();

      // X labels
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(148,163,184,0.7)';
      ctx.font = '10px system-ui, sans-serif';
      for (let i = 0; i < numPoints; i++) {
        const t = numPoints === 1 ? 0.5 : i / (numPoints - 1);
        ctx.fillText(labels[i] || `R${i}`, pad.left + t * plotW, chartH - 8);
      }

      metrics.forEach((m) => {
        const vals = m.values || [];
        if (vals.length < 2) return;
        const r = parseInt(m.color.slice(1, 3), 16);
        const g = parseInt(m.color.slice(3, 5), 16);
        const b = parseInt(m.color.slice(5, 7), 16);
        ctx.fillStyle = `rgba(${r},${g},${b},0.18)`;
        ctx.beginPath();
        ctx.moveTo(toX(0), baselineY);
        for (let i = 0; i < vals.length; i++) ctx.lineTo(toX(i), toY(vals[i]));
        ctx.lineTo(toX(vals.length - 1), baselineY);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = m.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(toX(0), toY(vals[0]));
        for (let i = 1; i < vals.length; i++) ctx.lineTo(toX(i), toY(vals[i]));
        ctx.stroke();

        ctx.fillStyle = m.color;
        vals.forEach((v, i) => {
          ctx.beginPath();
          ctx.arc(toX(i), toY(v), 4, 0, Math.PI * 2);
          ctx.fill();
        });
      });

      chartLayoutRef.current = { pad, plotW, plotH, chartW, chartH, numPoints, toX, toY };

      if (chartHover != null && chartHover.xIndex >= 0 && chartHover.xIndex < numPoints) {
        const x = toX(chartHover.xIndex);
        ctx.strokeStyle = 'rgba(148,163,184,0.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, baselineY);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    };

    draw();
    const ro = new ResizeObserver(() => draw());
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [metrics, chartHover, versions]);

  const handleChartMouseMove = useCallback((e) => {
    const container = containerRef.current;
    const layout = chartLayoutRef.current;
    if (!container || !layout) return;
    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const { pad, plotW, numPoints, toX } = layout;
    if (mouseX < pad.left || mouseX > pad.left + plotW) {
      setChartHover(null);
      return;
    }
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < numPoints; i++) {
      const d = Math.abs(toX(i) - mouseX);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const labels = ['Current', ...Array.from({ length: numPoints - 1 }, (_, i) => versions[i]?.name || `Redesign ${i + 1}`)];
    const values = metrics.map(m => {
      const v = m.values?.[bestIdx] ?? 0;
      return { label: m.label, value: v, suffix: m.suffix || '' };
    });
    setChartHover({ xIndex: bestIdx, label: labels[bestIdx], values });
  }, [metrics]);

  const handleChartMouseLeave = useCallback(() => setChartHover(null), []);

  return (
    <div className="portal-comparison-tab">
      {processes.length === 0 && metrics.length === 0 ? (
        <p className="portal-flow-empty">No process data available for comparison. View the Report tab for redesign flows.</p>
      ) : (
      <div className="portal-comparison-charts">
        <div className="portal-chart-block">
          <h4 className="portal-chart-title">Metric progression: current design → redesigned</h4>
          <div className="portal-area-chart-legend portal-legend-tiles portal-legend-above">
            {metrics.map((m) => {
              const vals = m.values || [];
              const last = vals[vals.length - 1] ?? 0;
              const first = vals[0] ?? 0;
              const delta = last - first;
              const suf = m.suffix || '';
              const range = vals.length > 1 ? `${first}${suf} → ${last}${suf}` : `${first}${suf}`;
              const deltaVal = delta !== 0 ? `${delta}${suf}` : null;
              const isGood = delta > 0;
              const isBad = delta < 0;
              const arrow = delta > 0 ? '\u2191' : delta < 0 ? '\u2193' : '';
              return (
                <div key={m.key} className="portal-legend-tile" style={{ borderLeftColor: m.color }} title={m.desc}>
                  <span className="portal-legend-tile-value">{range}</span>
                  {deltaVal != null && (
                    <span className="portal-legend-tile-delta">
                      {deltaVal}
                      <span className={`portal-legend-arrow-small ${isGood ? 'arrow-up' : 'arrow-down'}`} aria-hidden>{arrow}</span>
                    </span>
                  )}
                  <span className="portal-legend-tile-label">{m.label}</span>
                </div>
              );
            })}
          </div>
          <div
            ref={containerRef}
            className="portal-area-chart-wrap portal-chart-interactive"
            onMouseMove={handleChartMouseMove}
            onMouseLeave={handleChartMouseLeave}
          >
            <canvas ref={canvasRef} className="portal-area-chart" />
            {chartHover && chartLayoutRef.current && (
              <div
                className="portal-chart-tooltip"
                style={{
                  left: chartLayoutRef.current.toX(chartHover.xIndex),
                  top: chartLayoutRef.current.pad.top,
                }}
              >
                <div className="portal-chart-tooltip-title">{chartHover.label}</div>
                {chartHover.values.map((v, i) => (
                  <div key={i} className="portal-chart-tooltip-row">
                    <div className="portal-chart-tooltip-row-main">
                      <span className="portal-chart-tooltip-label">{v.label}:</span>
                      <span className="portal-chart-tooltip-value">{v.value}{v.suffix}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {costSavedAmount > 0 && (
          <div className="portal-chart-block">
            <p className="portal-savings-summary">
              Estimated annual savings: <strong>&pound;{costSavedAmount >= 1000 ? (costSavedAmount / 1000).toFixed(0) + 'K' : costSavedAmount}/yr</strong>
            </p>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

function ensureHandoffs(steps, handoffs) {
  const n = steps?.length || 0;
  const needed = Math.max(0, n - 1);
  const out = [...(handoffs || [])];
  while (out.length < needed) out.push({ method: '', clarity: '' });
  return out.slice(0, needed);
}

function PortalCollapsible({ title, children, defaultOpen = false, level = 0, badge, headerActions, headerBelow, white }) {
  const [open, setOpen] = useState(defaultOpen);
  const cls = level === 0 ? 'portal-collapse' : level === 1 ? 'portal-collapse portal-collapse-child' : 'portal-collapse portal-collapse-grandchild';
  const sectionCls = white ? ' portal-collapse-section' : '';
  return (
    <div className={`${cls}${sectionCls} ${open ? '' : 'collapsed'}`}>
      <div className="portal-collapse-header" onClick={() => setOpen(!open)}>
        <span className="portal-collapse-title">{title}</span>
        {badge && <span className="portal-collapse-badge">{badge}</span>}
        {headerActions && <span className="portal-collapse-actions" onClick={e => e.stopPropagation()}>{headerActions}</span>}
        <span className="portal-collapse-toggle">›</span>
      </div>
      {headerBelow && <div className="portal-collapse-header-below">{headerBelow}</div>}
      {open && <div className="portal-collapse-body">{children}</div>}
    </div>
  );
}

function ProcessDetailTabs({ tabs, defaultTab, onTabChange }) {
  const [activeTab, setActiveTab] = useState(defaultTab);
  const activeContent = tabs.find((t) => t.id === activeTab)?.content ?? tabs[0]?.content;
  const handleTabClick = (id) => {
    setActiveTab(id);
    if (onTabChange) onTabChange(id);
  };
  return (
    <div className="portal-process-tabs-wrap">
      <nav className="portal-process-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTab === t.id}
            className={`portal-process-tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => handleTabClick(t.id)}
          >
            {t.label}
            {t.badge != null && t.badge !== '' && <span className="portal-process-tab-badge">{t.badge}</span>}
          </button>
        ))}
      </nav>
      <div className="portal-process-tab-content">
        {activeContent}
      </div>
    </div>
  );
}

function ProcessFlowPanel({ proc, label, actions, automationPct, darkTheme, reportId, processIndex, accessToken, redesignId }) {
  const [viewMode, setViewMode] = useState('grid');
  const isWrapped = viewMode === 'wrap';
  const handleWrapToggle = () => setViewMode((v) => v === 'wrap' ? 'grid' : 'wrap');
  const [floatingOpen, setFloatingOpen] = useState(false);
  const [insightStepIndex, setInsightStepIndex] = useState(null);
  const { flowNodePositions, setFlowNodePositions, customEdges, setCustomEdges, deletedEdges, setDeletedEdges } = useFlowLayoutSave({
    reportId,
    processIndex,
    accessToken,
    redesignId,
    initialPositions: proc.flowNodePositions || {},
    initialCustomEdges: proc.flowCustomEdges || [],
    initialDeletedEdges: proc.flowDeletedEdges || [],
  });
  const steps = proc.steps || [];
  const autoClass = automationPct != null ? getAutomationReadinessClass(automationPct) : null;
  const processForFlow = {
    ...proc,
    steps,
    handoffs: ensureHandoffs(steps, proc.handoffs),
    definition: proc.definition || { startsWhen: 'Start', completesWhen: 'Complete' },
    bottleneck: proc.bottleneck || {},
  };

  if (!steps.length) return <p className="portal-flow-empty">No flow data available</p>;

  return (
    <div className="portal-flow-panel">
      {actions && <div className="portal-flow-actions">{actions}</div>}
      <div className="portal-flow-toggle">
        {[{ id: 'grid', label: 'Linear' }, { id: 'swimlane', label: 'Swimlane' }].map(v => (
          <button key={v.id} type="button" className={`portal-flow-toggle-btn ${(viewMode === v.id || (v.id === 'grid' && isWrapped)) ? 'active' : ''}`} onClick={() => setViewMode(v.id)} title={v.label}>
            {v.label}
          </button>
        ))}
        <button type="button" className="portal-flow-float-btn" onClick={() => setFloatingOpen(true)} title="Open in floating window">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 3 21 3 21 9"/><line x1="21" y1="3" x2="14" y2="10"/><path d="M10 5H5a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-5"/></svg>
        </button>
      </div>
      <div className="portal-flow-canvas-wrap">
        <InteractiveFlowCanvas
          process={processForFlow}
          layout={viewMode}
          darkTheme={darkTheme}
          onStepClick={(idx) => setInsightStepIndex(idx)}
          onWrapToggle={handleWrapToggle}
          isWrapped={isWrapped}
          customEdges={customEdges}
          deletedEdges={deletedEdges}
          storedPositions={resolveStoredPositions(flowNodePositions, steps.length, viewMode)}
          onPositionsChange={(positions, layout) => setFlowNodePositions((prev) => ({ ...prev, [`${steps.length}-${layout}`]: positions }))}
          onCustomEdgesChange={setCustomEdges}
          onDeletedEdgesChange={setDeletedEdges}
        />
      </div>
      <div className="portal-flow-meta">
        {automationPct != null && (
          <span className={`portal-flow-auto portal-flow-auto-${autoClass}`} title="Automation readiness">
            {automationPct}% automation ready
          </span>
        )}
        <span>{steps.length} steps</span>
        <span>{ensureHandoffs(steps, proc.handoffs).length} handoffs</span>
        <span>{[...new Set(steps.map(s => s.department).filter(Boolean))].length} teams</span>
      </div>
      {insightStepIndex != null && (
        <StepInsightPanel
          stepIndex={insightStepIndex}
          process={processForFlow}
          onClose={() => setInsightStepIndex(null)}
        />
      )}
      {floatingOpen && (
        <FloatingFlowViewer
          proc={processForFlow}
          onClose={() => setFloatingOpen(false)}
          initialViewMode={viewMode}
          onStepClick={(idx) => setInsightStepIndex(idx)}
          darkTheme={darkTheme}
          customEdges={customEdges}
          onCustomEdgesChange={setCustomEdges}
          deletedEdges={deletedEdges}
          onDeletedEdgesChange={setDeletedEdges}
          flowNodePositions={flowNodePositions}
          onPositionsChange={(positions, layout) => setFlowNodePositions((prev) => ({ ...prev, [`${steps.length}-${layout}`]: positions }))}
          stepsLength={steps.length}
        />
      )}
    </div>
  );
}

export default function PortalDashboard({ user, accessToken, onSignOut, initialSection = 'processes' }) {
  const { theme } = useTheme();
  const darkTheme = theme === 'dark';
  const [reports, setReports] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [redesigningId, setRedesigningId] = useState(null);
  const [redesignProgress, setRedesignProgress] = useState('');
  const [redesignDone, setRedesignDone] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [redesignError, setRedesignError] = useState(null); // { reportId, message }
  const [instanceData, setInstanceData] = useState(null);
  const [instancesLoading, setInstancesLoading] = useState(false);
  const [auditTrailOpenId, setAuditTrailOpenId] = useState(null);
  const [metricDrill, setMetricDrill] = useState(null);
  const [redesignSaveModal, setRedesignSaveModal] = useState(null); // { reportId, redesign }
  const [saveModalName, setSaveModalName] = useState('');
  const [reportVersionDropdownId, setReportVersionDropdownId] = useState(null);
  const [buildDropdownId, setBuildDropdownId] = useState(null);
  const [renameEditing, setRenameEditing] = useState(null); // { reportId, redesignId }
  const [renameEditName, setRenameEditName] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState(null);
  const [costLinkCopiedId, setCostLinkCopiedId] = useState(null);
  const [activeSection, setActiveSection] = useState(initialSection); // 'processes' | 'analytics' | 'deals'
  const [deals, setDeals] = useState(null);
  const [dealsLoading, setDealsLoading] = useState(false);
  const [processTypeFilter, setProcessTypeFilter] = useState('all'); // 'all' | 'process-only' | 'comprehensive'
  const [segmentFilter, setSegmentFilter] = useState('all'); // 'all' | 'scaling' | 'ma' | 'pe' | 'highstakes'
  const [settingsOpenId, setSettingsOpenId] = useState(null);
  const [processPage, setProcessPage] = useState(1);
  const [showOrgAdminLink, setShowOrgAdminLink] = useState(false);
  const settingsOpenRef = useRef(null);

  const PROCESSES_PER_PAGE = 8;
  const email = user?.email || '';

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await apiFetch('/api/organizations', {}, accessToken);
        const text = await resp.text();
        const trimmed = text.trim();
        if (!trimmed.startsWith('{')) return;
        const data = JSON.parse(trimmed);
        if (cancelled) return;
        const orgAdmins = (data.memberships || []).filter((m) => m.is_org_admin);
        setShowOrgAdminLink(!!data.platformAdmin || orgAdmins.length > 0);
      } catch {
        /* API missing or not JSON — hide link */
      }
    })();
    return () => { cancelled = true; };
  }, [accessToken]);

  useEffect(() => {
    if (!settingsOpenId) return;
    const handler = (e) => {
      if (settingsOpenRef.current && !settingsOpenRef.current.contains(e.target)) {
        setSettingsOpenId(null);
      }
    };
    const t = setTimeout(() => document.addEventListener('click', handler), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('click', handler);
    };
  }, [settingsOpenId]);

  const refreshReports = useCallback(async (opts = {}) => {
    if (!email) return;
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    try {
      const resp = await apiFetch('/api/get-dashboard?email=' + encodeURIComponent(email), {}, accessToken);
      let data;
      try { data = await resp.json(); } catch { data = {}; }
      if (resp.ok && data.success) {
        setReports({
          reports: Array.isArray(data.reports) ? data.reports : [],
          teamSessions: Array.isArray(data.teamSessions) ? data.teamSessions : [],
        });
      } else {
        setReports({ reports: [], teamSessions: [] });
      }
    } catch {
      setReports({ reports: [] });
    } finally {
      setLoading(false);
    }
  }, [email, accessToken]);

  useEffect(() => {
    if (!email) return;
    refreshReports();
  }, [email, refreshReports]);

  const refreshDeals = useCallback(async () => {
    if (!email) return;
    setDealsLoading(true);
    try {
      const resp = await apiFetch('/api/deals', {}, accessToken);
      const data = await resp.json();
      setDeals(resp.ok ? (data.deals || []) : []);
    } catch {
      setDeals([]);
    } finally {
      setDealsLoading(false);
    }
  }, [email, accessToken]);

  useEffect(() => {
    if (activeSection === 'deals' && deals === null) {
      refreshDeals();
    }
  }, [activeSection, deals, refreshDeals]);

  useEffect(() => {
    if (redesignSaveModal) setSaveModalName('');
  }, [redesignSaveModal]);

  const SEGMENT_META = {
    scaling: { label: 'Scaling', color: '#0d9488' },
    ma: { label: 'M&A', color: '#6366f1' },
    pe: { label: 'PE', color: '#8b5cf6' },
    highstakes: { label: 'High-stakes', color: '#d97706' },
  };

  const reportList = reports?.reports || [];
  const filteredReportList = reportList.filter((r) => {
    const mode = (r.diagnosticMode || 'comprehensive').toLowerCase();
    if (processTypeFilter === 'process-only' && mode !== 'map-only') return false;
    if (processTypeFilter === 'comprehensive' && mode !== 'comprehensive') return false;
    if (segmentFilter !== 'all' && r.segment !== segmentFilter) return false;
    return true;
  });
  const teamSessions = reports?.teamSessions || [];
  const totalProcessPages = Math.max(1, Math.ceil(filteredReportList.length / PROCESSES_PER_PAGE));
  const paginatedReports = filteredReportList.slice((processPage - 1) * PROCESSES_PER_PAGE, processPage * PROCESSES_PER_PAGE);

  const processOnlyCount = reportList.filter((r) => (r.diagnosticMode || 'comprehensive').toLowerCase() === 'map-only').length;
  const comprehensiveCount = reportList.filter((r) => (r.diagnosticMode || 'comprehensive').toLowerCase() === 'comprehensive').length;

  useEffect(() => {
    setProcessPage(1);
  }, [processTypeFilter, segmentFilter]);

  useEffect(() => {
    if (processPage > totalProcessPages && totalProcessPages > 0) {
      setProcessPage(totalProcessPages);
    }
  }, [processPage, totalProcessPages]);

  const totalProcs = reportList.reduce((s, r) => s + (r.metrics?.totalProcesses || 0), 0);
  const avgAuto = reportList.length ? Math.round(reportList.reduce((s, r) => s + (r.metrics?.automationPercentage || 0), 0) / reportList.length) : 0;
  const redesignedCount = reportList.filter(r => r.redesignStatus === 'accepted' || r.redesignStatus === 'pending').length;
  const totalCost = reportList.reduce((s, r) => s + (r.metrics?.totalAnnualCost || 0), 0);

  const handleDeleteClick = (reportId) => {
    setConfirmDeleteId(confirmDeleteId === reportId ? null : reportId);
  };

  const handleRenameStart = useCallback((reportId, v) => {
    setRenameEditing({ reportId, redesignId: v.id });
    setRenameEditName(v.name || `Redesign ${v.version}`);
    setRenameError(null);
  }, []);
  const handleRenameCancel = useCallback(() => {
    setRenameEditing(null);
    setRenameEditName('');
    setRenameError(null);
  }, []);
  const handleRenameSave = useCallback(async () => {
    if (!renameEditing || !accessToken) return;
    const { reportId, redesignId } = renameEditing;
    setRenameSaving(true);
    setRenameError(null);
    try {
      const resp = await apiFetch('/api/rename-redesign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId, redesignId, name: renameEditName.trim() || null }),
      }, accessToken);
      const data = await resp.json();
      if (resp.ok && data.success) {
        setRenameEditing(null);
        setRenameEditName('');
        await refreshReports({ silent: true });
      } else {
        setRenameError(data.error || 'Failed to save name.');
      }
    } catch (e) {
      setRenameError(e?.message || 'Network error.');
    }
    setRenameSaving(false);
  }, [renameEditing, renameEditName, accessToken, refreshReports]);

  const handleSaveRedesignChoice = async (reportId, redesign, mode, name) => {
    setRedesignSaveModal(null);
    setSaveModalName('');
    try {
      const resp = await apiFetch('/api/save-redesign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId, redesign, mode, name: name?.trim() || null, source: 'ai' }),
      }, accessToken);
      const data = await resp.json();
      if (resp.ok && data.success) {
        setRedesignDone(reportId);
        setTimeout(() => setRedesignDone(null), 8000);
        await refreshReports();
      } else {
        setErrorMsg(data.error || 'Failed to save redesign.');
        setTimeout(() => setErrorMsg(null), 6000);
      }
    } catch {
      setErrorMsg('Failed to save redesign.');
      setTimeout(() => setErrorMsg(null), 6000);
    }
  };

  const fetchInstances = async (reportId) => {
    setInstancesLoading(true);
    try {
      const resp = await apiFetch(`/api/process-instances?reportId=${reportId}`, {}, accessToken);
      if (resp.ok) {
        const data = await resp.json();
        setInstanceData(data);
      }
    } catch { /* ignore */ } finally {
      setInstancesLoading(false);
    }
  };

  const handleRedesign = async (reportId, { regenerate = false } = {}) => {
    setRedesigningId(reportId);
    setRedesignProgress('Starting redesign…');
    setRedesignError(null);
    try {
      const resp = await apiFetch('/api/generate-redesign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, reportId, regenerate }),
      }, accessToken);

      const contentType = resp.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream')) {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let success = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          let idx;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            let event = 'message', data = '';
            for (const line of chunk.split('\n')) {
              if (line.startsWith('event: ')) event = line.slice(7).trim();
              else if (line.startsWith('data: ')) data = line.slice(6);
            }
            if (!data) continue;
            try {
              const parsed = JSON.parse(data);
              if (event === 'started') {
                setRedesignProgress('Analysing your process…');
              } else if (event === 'timeout') {
                setRedesignError({ reportId, message: parsed.message || 'Redesign timed out. Please try again.' });
              } else if (event === 'progress') {
                setRedesignProgress(parsed.message || '');
              } else if (event === 'done') {
                success = true;
                if (parsed.needsSaveChoice && parsed.redesign) {
                  setRedesignSaveModal({ reportId, redesign: parsed.redesign });
                } else {
                  setRedesignDone(reportId);
                  setTimeout(() => setRedesignDone(null), 8000);
                  await refreshReports();
                }
              } else if (event === 'error') {
                setRedesignError({ reportId, message: parsed.error || 'Redesign failed.' });
              }
            } catch { /* skip malformed events */ }
          }
        }

        if (success && !redesignSaveModal) await refreshReports();
      } else {
        let data;
        try { data = await resp.json(); } catch { data = {}; }
        if (resp.ok && data.success) {
          setRedesignDone(reportId);
          setTimeout(() => setRedesignDone(null), 8000);
          await refreshReports();
        } else {
          setRedesignError({ reportId, message: data.error || 'Failed to generate redesign.' });
        }
      }
    } catch {
      setRedesignError({ reportId, message: 'Failed to generate redesign. Please try again.' });
    } finally {
      setRedesigningId(null);
      setRedesignProgress('');
    }
  };

  const handleDeleteConfirm = async (reportId) => {
    setDeletingId(reportId);
    try {
      const resp = await apiFetch('/api/get-dashboard', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId })
      }, accessToken);
      let data;
      try { data = await resp.json(); } catch { data = {}; }
      if (resp.ok && data.success) {
        setConfirmDeleteId(null);
        setSettingsOpenId(null);
        await refreshReports();
      } else {
        setErrorMsg(data.error || 'Failed to delete report.');
        setTimeout(() => setErrorMsg(null), 6000);
      }
    } catch {
      setErrorMsg('Failed to delete report. Please try again.');
      setTimeout(() => setErrorMsg(null), 6000);
    } finally {
      setDeletingId(null);
    }
  };

  const renderReportRow = (r) => {
    const createdDate = formatPortalDate(r.createdAt);
    const lastUpdated = formatRelativeTime(r.updatedAt || r.createdAt);
    const procs = (r.processes || []).map(p => p.name).join(', ') || 'Process Audit';
    const s = getStatusInfo(r);
    const showConfirm = confirmDeleteId === r.id;
    const isDeleting = deletingId === r.id;
    const redesignSource = r.acceptedRedesign || r.pendingRedesign;
    const hasRedesign = !!(redesignSource?.processes?.length);
    const isAccepted = r.redesignStatus === 'accepted';
    const rawProcs = r.rawProcesses || [];
    const activeRedesignId = (() => {
      const versions = r.redesignVersions || [];
      const accepted = versions.find(v => v.status === 'accepted');
      return (accepted || versions[versions.length - 1])?.id || null;
    })();

    const costAnalysisPending = r.costAnalysisStatus === 'pending';
    const costAnalysisComplete = r.costAnalysisStatus === 'complete';
    const hasCostToken = !!(r.costAnalysisToken);
    // isCostAuthorized: get-dashboard nulls the token and zeros costs for unauthorized users
    const isCostAuthorized = hasCostToken || (r.metrics?.totalAnnualCost || 0) > 0;
    const costEditUrl = r.id ? `/process-audit?edit=${encodeURIComponent(r.id)}&email=${encodeURIComponent(email)}&view=cost` : null;

    const displayLabel = r.displayCode || (r.id?.length > 8 ? r.id.slice(0, 8) + '…' : r.id);
    const segMeta = r.segment ? SEGMENT_META[r.segment] : null;
    const parentTitle = (
      <span className="portal-report-title-block">
        <span className="portal-report-title-row">
          <span className={'process-dot ' + s.dot} />
          <strong>{procs}</strong>
          {segMeta && (
            <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: segMeta.color + '22', color: segMeta.color, letterSpacing: '0.03em', marginLeft: 6 }}>
              {segMeta.label}
            </span>
          )}
        </span>
        <span className="portal-report-meta">
          #{displayLabel} · Created {createdDate} · Last updated {lastUpdated}
          {' · '}
          <Link
            href={`/process-audit?edit=${encodeURIComponent(r.id)}&email=${encodeURIComponent(email)}`}
            className="portal-report-chat-link"
            onClick={(e) => e.stopPropagation()}
          >
            Open in chat
          </Link>
        </span>
      </span>
    );

    const buildFlowActions = (reportId, variant) => {
      const versions = r.redesignVersions || [];
      const acceptedVersion = versions.find((v) => v.status === 'accepted');
      const displayVersion = acceptedVersion || versions[versions.length - 1] || versions[0];
      return (
      <div className="portal-flow-actions-row">
        {variant === 'current' ? (
          <Link href={'/report?id=' + reportId + '&portal=1'} className="portal-flow-btn portal-flow-btn-primary">View Full Report</Link>
        ) : variant === 'redesigned' && displayVersion ? (
          <span className="portal-redesign-version-inline">
            <Link href={`/report?id=${reportId}&redesignId=${displayVersion.id}&portal=1`} className="portal-flow-btn portal-flow-btn-primary">View Full Report</Link>
            <span className="portal-redesign-version-label">
              <span className="portal-redesign-version-name">{displayVersion.name || `Redesign ${displayVersion.version || ''}`}</span>
              {displayVersion.status === 'accepted' && <span className="portal-redesign-accepted-badge">Accepted</span>}
            </span>
          </span>
        ) : (
          <Link href={'/report?id=' + reportId + '&portal=1'} className="portal-flow-btn portal-flow-btn-primary">View Full Report</Link>
        )}
        <Link href={`/process-audit?edit=${encodeURIComponent(reportId)}&email=${encodeURIComponent(email)}`} className="portal-flow-btn">Edit</Link>
        <Link href={`/process-audit?reaudit=${encodeURIComponent(reportId)}`} className="portal-flow-btn" title="Run a new audit and compare results to this one">Re-audit</Link>
        <Link href={`/process-audit?edit=${encodeURIComponent(reportId)}&email=${encodeURIComponent(email)}${variant === 'redesigned' ? '&editRedesign=1' : ''}&aiRedesign=1`} className="portal-flow-btn portal-flow-btn-primary">
          {variant === 'redesigned' ? 'Redesign with AI' : 'AI redesign'}
        </Link>
        {variant === 'redesigned' && isAccepted && (() => {
          const acceptedV = (r.redesignVersions || []).find((v) => v.status === 'accepted');
          return acceptedV ? (
            <Link href={`/build?id=${reportId}&redesignId=${acceptedV.id}`} className="portal-flow-btn portal-build-btn">Build this</Link>
          ) : null;
        })()}
      </div>
    );
    };

    const handleCopyCostLink = (e) => {
      e.stopPropagation();
      if (hasCostToken && typeof window !== 'undefined' && navigator.clipboard) {
        const url = `${window.location.origin}/cost-analysis?id=${r.id}&token=${r.costAnalysisToken}`;
        navigator.clipboard.writeText(url).then(() => {
          setCostLinkCopiedId(r.id);
          setTimeout(() => setCostLinkCopiedId(null), 2500);
        });
      }
    };

    const parentActions = (
      <span className="portal-header-right">
        <span className="portal-report-labels">
          <span className={'process-tag ' + s.tag}>{s.tagText}</span>
          {hasRedesign && <span className={`process-redesign-tag ${isAccepted ? '' : 'pending'}`}>{isAccepted ? 'Redesigned' : 'Redesign Pending'}</span>}
          {hasRedesign && r.redesignVersions?.length > 0 && <span className="portal-version-badge">{r.redesignVersions.length} version{r.redesignVersions.length > 1 ? 's' : ''}</span>}
          {costAnalysisPending && <span className="process-tag cost-analysis-pending-tag" title="A consultant is working on the cost model for this report">Pending cost analysis</span>}
        </span>
        {costAnalysisComplete && costEditUrl && isCostAuthorized && (
          <Link
            href={costEditUrl}
            className="portal-flow-btn portal-cost-edit-btn"
            onClick={e => e.stopPropagation()}
          >
            View/Edit Costs
          </Link>
        )}
        <span className="portal-report-settings-wrap" ref={settingsOpenId === r.id ? settingsOpenRef : null}>
          <button
            type="button"
            className="portal-settings-icon-btn"
            onClick={(e) => { e.stopPropagation(); setSettingsOpenId(settingsOpenId === r.id ? null : r.id); }}
            title="More options"
            aria-label="More options"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="1.5"/>
              <circle cx="12" cy="12" r="1.5"/>
              <circle cx="12" cy="19" r="1.5"/>
            </svg>
          </button>
          {settingsOpenId === r.id && (
            <span className="portal-settings-dropdown">
              {costAnalysisPending && hasCostToken && (
                <button
                  type="button"
                  className="portal-flow-btn portal-cost-link-btn"
                  onClick={handleCopyCostLink}
                  title="Copy cost analysis link to send to manager"
                >
                  {costLinkCopiedId === r.id ? 'Copied!' : 'Setup Costs'}
                </button>
              )}
              <button type="button" className="portal-flow-btn danger compact" onClick={() => handleDeleteClick(r.id)} disabled={isDeleting}>
                  {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </span>
          )}
        </span>
      </span>
    );

    const redesignVersions = r.redesignVersions || [];
    const comparisonData = hasRedesign && rawProcs.length > 0 ? rawProcs.map((rp, rpi) => {
      const procName = rp.processName || r.processes?.[rpi]?.name || `Process ${rpi + 1}`;
      const currentAuto = calculateAutomationScore([{ ...rp, processName: procName }]).percentage;
      const versionAutos = redesignVersions.map(v => {
        const proc = v.processes.find(ap => (ap.processName || '').toLowerCase() === procName.toLowerCase()) || v.processes[rpi];
        return proc ? calculateAutomationScore([{ ...proc, processName: procName }]).percentage : null;
      });
      return { procName, processId: `P${rpi + 1}`, currentAuto, versionAutos };
    }) : [];

    return (
      <div key={r.id}>
        <PortalCollapsible
          title={parentTitle}
          level={0}
          headerActions={parentActions}
          headerBelow={showConfirm ? (
            <span className="portal-delete-confirm-inline">
              <span className="portal-delete-confirm-label">Are you sure you want to delete this report?</span>
              <button type="button" className="portal-flow-btn danger compact" onClick={() => handleDeleteConfirm(r.id)} disabled={isDeleting}>
                {isDeleting ? 'Deleting...' : 'Yes, delete'}
              </button>
              <button type="button" className="portal-flow-btn compact" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
            </span>
          ) : null}
        >
          {isAccepted && (() => {
            const acceptedVersion = redesignVersions.find((v) => v.status === 'accepted');
            return acceptedVersion ? (
              <div className="portal-build-bar">
                <Link href={`/build?id=${r.id}&redesignId=${acceptedVersion.id}`} className="portal-build-btn-main">
                  Build this →
                </Link>
                <span className="portal-build-hint">Generate workflow definitions for N8N, Unqork, Make, Zapier, and more</span>
              </div>
            ) : null;
          })()}
          {redesignDone === r.id && (
            <div className="redesign-success-bar">
              <span>Redesign generated successfully.</span>
              <Link href={'/report?id=' + r.id} className="redesign-view-btn">View Report &rarr;</Link>
            </div>
          )}

          {rawProcs.length === 0 && !hasRedesign && (
            <p className="portal-flow-empty">No detailed process data available. <Link href={'/report?id=' + r.id + '&portal=1'}>View the full report</Link> for more detail.</p>
          )}

          {rawProcs.map((rp, rpi) => {
            const procName = rp.processName || r.processes?.[rpi]?.name || `Process ${rpi + 1}`;
            const multiProc = rawProcs.length > 1;
            const processId = `P${rpi + 1}`;
            const currentLabel = multiProc ? `${processId} Current Flow \u2014 ${procName}` : `Current Flow`;
            const redesignedProc = hasRedesign ? redesignSource.processes.find(
              ap => (ap.processName || '').toLowerCase() === procName.toLowerCase()
            ) || redesignSource.processes[rpi] : null;
            const redesignLabel = multiProc ? `${processId} Redesigned Flow \u2014 ${procName}` : 'Redesigned Flow';
            const stepCount = (rp.steps || []).length;
            const redesignStepCount = redesignedProc ? (redesignedProc.steps || []).length : 0;
            const currentAuto = calculateAutomationScore([{ ...rp, processName: procName }]).percentage;
            const redesignAuto = redesignedProc ? calculateAutomationScore([{ ...redesignedProc, processName: procName }]).percentage : null;

            const procAnnualCost = r.processes?.[rpi]?.annualCost ?? 0;
            const procPotentialSavings = procAnnualCost * 0.3;
            const showCostData = !costAnalysisPending && (r.metrics?.totalAnnualCost || 0) > 0;
            const costEditUrl = r.id ? (hasCostToken ? `/cost-analysis?id=${r.id}&token=${encodeURIComponent(r.costAnalysisToken)}` : `/cost-analysis?id=${r.id}`) : null;

            const tabs = [];
            tabs.push({
              id: 'current',
              label: currentLabel,
              badge: `${stepCount} steps`,
              content: <ProcessFlowPanel proc={rp} actions={buildFlowActions(r.id, 'current')} automationPct={currentAuto} darkTheme={darkTheme} reportId={r.id} processIndex={rpi} accessToken={accessToken} />,
            });
            if (redesignedProc) {
              tabs.push({
                id: 'redesigned',
                label: redesignLabel,
                badge: `${redesignStepCount} steps`,
                content: <ProcessFlowPanel proc={redesignedProc} actions={buildFlowActions(r.id, 'redesigned')} automationPct={redesignAuto} darkTheme={darkTheme} reportId={r.id} processIndex={rpi} redesignId={activeRedesignId} accessToken={accessToken} />,
              });
            }
            if (hasRedesign) {
              tabs.push({
                id: 'comparison',
                label: 'Redesign Comparison',
                badge: null,
                content: (
                  <div className="portal-redesign-comparison-content">
                    <p className="portal-comparison-hint">Metric progression: current design → redesigned</p>
                    <PortalComparisonTab
                      processes={comparisonData}
                      redesignVersions={redesignVersions}
                      totalAnnualCost={r.metrics?.totalAnnualCost}
                    />
                  </div>
                ),
              });
            }
            tabs.push({
              id: 'instances',
              label: 'Instances',
              badge: null,
              content: (
                <div className="portal-instances-tab">
                  {instancesLoading ? (
                    <div className="portal-loading-sm">Loading instance data…</div>
                  ) : !instanceData || Object.keys(instanceData.processes || {}).length === 0 ? (
                    <div className="portal-instances-empty">
                      <p>No process instances logged yet.</p>
                      <p className="portal-instances-hint">Use the tracking API to log process runs and measure real-world performance after implementation.</p>
                    </div>
                  ) : (
                    <div className="portal-instances-grid">
                      {Object.entries(instanceData.processes).map(([name, stats]) => (
                        <div key={name} className="portal-instance-card">
                          <div className="portal-instance-name">{name}</div>
                          <div className="portal-instance-stats">
                            <span className="portal-instance-stat"><strong>{stats.totalInstances}</strong> runs</span>
                            <span className="portal-instance-stat portal-instance-stat--success"><strong>{stats.completed}</strong> done</span>
                            {stats.stuck > 0 && <span className="portal-instance-stat portal-instance-stat--warn"><strong>{stats.stuck}</strong> stuck</span>}
                            {instanceData.avgCompletionDays > 0 && <span className="portal-instance-stat"><strong>{instanceData.avgCompletionDays}d</strong> avg</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ),
            });

            return (
              <div key={rpi} className="portal-process-detail-block">
                {tabs.length > 0 ? (
                  <ProcessDetailTabs
                    tabs={tabs}
                    defaultTab={tabs[0].id}
                    onTabChange={(tabId) => { if (tabId === 'instances') fetchInstances(r.id); }}
                  />
                ) : null}
                {!redesignedProc && !hasRedesign && (
                  <div className="portal-no-redesign-hint">
                    No redesigned flow yet.{' '}
                    <button type="button" className="portal-flow-btn portal-flow-btn-primary inline" onClick={() => handleRedesign(r.id)} disabled={redesigningId === r.id}>
                      {redesigningId === r.id ? 'Generating…' : 'AI redesign'}
                    </button>
                    {redesigningId === r.id && (
                      <div className="portal-redesign-progress">
                        <div className="portal-redesign-progress-bar"><div className="portal-redesign-progress-fill" /></div>
                        {redesignProgress && <span className="portal-redesign-progress-msg">{redesignProgress}</span>}
                      </div>
                    )}
                  </div>
                )}
                {redesignError?.reportId === r.id && (
                  <div className="portal-redesign-error">
                    <span>{redesignError.message}</span>
                    <button type="button" onClick={() => { setRedesignError(null); handleRedesign(r.id); }}>Retry</button>
                    <button type="button" onClick={() => setRedesignError(null)}>✕</button>
                  </div>
                )}
              </div>
            );
          })}

          {hasRedesign && rawProcs.length === 0 && redesignSource.processes.map((ap, api) => {
            const label = redesignSource.processes.length > 1 ? `P${api + 1} Redesigned Flow \u2014 ${ap.processName || `Process ${api + 1}`}` : 'Redesigned Flow';
            const tabs = [
              { id: 'redesigned', label, badge: `${(ap.steps || []).length} steps`, content: <ProcessFlowPanel proc={ap} actions={buildFlowActions(r.id, 'redesigned')} darkTheme={darkTheme} reportId={r.id} processIndex={api} redesignId={activeRedesignId} accessToken={accessToken} /> },
              { id: 'comparison', label: 'Redesign Comparison', badge: null, content: (
                <div className="portal-redesign-comparison-content">
                  <p className="portal-comparison-hint">Metric progression: current design → redesigned</p>
                  <PortalComparisonTab processes={comparisonData} redesignVersions={redesignVersions} totalAnnualCost={r.metrics?.totalAnnualCost} />
                </div>
              ) },
              { id: 'instances', label: 'Instances', badge: null, content: (
                <div className="portal-instances-tab">
                  {instancesLoading ? (
                    <div className="portal-loading-sm">Loading instance data…</div>
                  ) : !instanceData || Object.keys(instanceData.processes || {}).length === 0 ? (
                    <div className="portal-instances-empty">
                      <p>No process instances logged yet.</p>
                      <p className="portal-instances-hint">Use the tracking API to log process runs and measure real-world performance after implementation.</p>
                    </div>
                  ) : (
                    <div className="portal-instances-grid">
                      {Object.entries(instanceData.processes).map(([name, stats]) => (
                        <div key={name} className="portal-instance-card">
                          <div className="portal-instance-name">{name}</div>
                          <div className="portal-instance-stats">
                            <span className="portal-instance-stat"><strong>{stats.totalInstances}</strong> runs</span>
                            <span className="portal-instance-stat portal-instance-stat--success"><strong>{stats.completed}</strong> done</span>
                            {stats.stuck > 0 && <span className="portal-instance-stat portal-instance-stat--warn"><strong>{stats.stuck}</strong> stuck</span>}
                            {instanceData.avgCompletionDays > 0 && <span className="portal-instance-stat"><strong>{instanceData.avgCompletionDays}d</strong> avg</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) },
            ];
            return (
              <div key={api} className="portal-process-detail-block">
                <ProcessDetailTabs
                  tabs={tabs}
                  defaultTab="redesigned"
                  onTabChange={(tabId) => { if (tabId === 'instances') fetchInstances(r.id); }}
                />
              </div>
            );
          })}

          {(r.auditTrail || []).length > 0 && (
            <div className="portal-audit-trail-section">
              <button type="button" className="portal-audit-trail-btn" onClick={() => setAuditTrailOpenId(auditTrailOpenId === r.id ? null : r.id)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                {auditTrailOpenId === r.id ? 'Hide Activity Log' : 'Activity Log'}
                <span className="portal-audit-trail-count">{r.auditTrail.length}</span>
              </button>
              {auditTrailOpenId === r.id && <AuditTrailPanel auditTrail={r.auditTrail} onClose={() => setAuditTrailOpenId(null)} />}
            </div>
          )}
        </PortalCollapsible>
      </div>
    );
  };

  const autoColor = getAutomationReadinessColor(avgAuto);

  return (
    <div className="portal-viewport">
      <header className="dashboard-header">
        <div className="header-left">
          <Link href="/" className="header-logo">Vesno<span className="header-logo-dot">.</span></Link>
          <div className="header-divider" />
          <span className="header-title">Dashboard</span>
        </div>
        <div className="header-right">
          {showOrgAdminLink && (
            <Link href="/portal/org-admin" className="header-org-admin-link">
              Organisation admin
            </Link>
          )}
          <ThemeToggle className="header-theme-btn" />

          <span className="header-email">{email}</span>
          <button onClick={onSignOut} className="header-btn">Sign Out</button>
        </div>
      </header>

      <div className="portal-wrap">
        {errorMsg && (
          <div className="portal-error-banner">
            <span>{errorMsg}</span>
            <button type="button" onClick={() => setErrorMsg(null)} className="portal-error-close">&times;</button>
          </div>
        )}

        <div className="portal-dashboard-layout">
          <div className="portal-main-area">
        <div className="portal-grid-layout">

          <nav className="portal-section-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeSection === 'processes'}
              className={`portal-section-tab ${activeSection === 'processes' ? 'active' : ''}`}
              onClick={() => setActiveSection('processes')}
            >
              Your Processes
              {reportList.length > 0 && <span className="portal-section-tab-badge">{reportList.length}</span>}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeSection === 'analytics'}
              className={`portal-section-tab portal-analytics-tab ${activeSection === 'analytics' ? 'active' : ''}`}
              onClick={() => setActiveSection('analytics')}
            >
              Analytics
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeSection === 'deals'}
              className={`portal-section-tab ${activeSection === 'deals' ? 'active' : ''}`}
              onClick={() => setActiveSection('deals')}
            >
              Deals
              {deals && deals.length > 0 && <span className="portal-section-tab-badge">{deals.length}</span>}
            </button>
          </nav>

          <main className="portal-content">
            {activeSection === 'processes' && (
              <div className="dash-card portal-content-card">
                <div className="portal-content-header">
                  <h2 className="portal-content-title">Your Processes</h2>
                  <Link href="/process-audit" className="dash-card-action">+ New Process Audit</Link>
                </div>
                <nav className="portal-process-type-tabs" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={processTypeFilter === 'all'}
                    className={`portal-process-type-tab ${processTypeFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setProcessTypeFilter('all')}
                  >
                    All ({reportList.length})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={processTypeFilter === 'process-only'}
                    className={`portal-process-type-tab ${processTypeFilter === 'process-only' ? 'active' : ''}`}
                    onClick={() => setProcessTypeFilter('process-only')}
                  >
                    Process only ({processOnlyCount})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={processTypeFilter === 'comprehensive'}
                    className={`portal-process-type-tab ${processTypeFilter === 'comprehensive' ? 'active' : ''}`}
                    onClick={() => setProcessTypeFilter('comprehensive')}
                  >
                    Comprehensive ({comprehensiveCount})
                  </button>
                </nav>
                {reportList.some(r => r.segment) && (
                  <nav className="portal-process-type-tabs" role="tablist" style={{ marginTop: 8 }}>
                    {[
                      { id: 'all', label: 'All contexts' },
                      { id: 'scaling', label: 'Scaling', color: SEGMENT_META.scaling.color },
                      { id: 'ma', label: 'M&A', color: SEGMENT_META.ma.color },
                      { id: 'pe', label: 'PE', color: SEGMENT_META.pe.color },
                      { id: 'highstakes', label: 'High-stakes', color: SEGMENT_META.highstakes.color },
                    ].filter(t => t.id === 'all' || reportList.some(r => r.segment === t.id)).map(t => (
                      <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={segmentFilter === t.id}
                        className={`portal-process-type-tab ${segmentFilter === t.id ? 'active' : ''}`}
                        onClick={() => setSegmentFilter(t.id)}
                        style={t.color && segmentFilter === t.id ? { borderColor: t.color, color: t.color } : t.color ? { color: t.color } : {}}
                      >
                        {t.label}
                      </button>
                    ))}
                  </nav>
                )}
                <div className="portal-process-list-scroll">
                  {loading ? (
                    <div className="portal-loading"><div className="spinner" /><p>Loading your reports...</p></div>
                  ) : reportList.length === 0 ? (
                    <div className="portal-empty">
                      <p>No process audits yet.</p>
                      <Link href="/process-audit" className="portal-empty-cta">Start your first process audit &rarr;</Link>
                    </div>
                  ) : filteredReportList.length === 0 ? (
                    <div className="portal-empty">
                      <p>
                        {processTypeFilter === 'process-only' && 'No process-only audits.'}
                        {processTypeFilter === 'comprehensive' && 'No comprehensive audits.'}
                        {segmentFilter !== 'all' && ` No ${SEGMENT_META[segmentFilter]?.label || segmentFilter} audits.`}
                      </p>
                      <Link href="/process-audit" className="portal-empty-cta">Start a process audit &rarr;</Link>
                    </div>
                  ) : (
                    <>
                      {paginatedReports.map(renderReportRow)}
                    </>
                  )}
                </div>
                {filteredReportList.length > 0 && totalProcessPages > 1 && (
                  <nav className="portal-process-pagination" aria-label="Process list pagination">
                    <button
                      type="button"
                      className="portal-pagination-btn"
                      onClick={() => setProcessPage((p) => Math.max(1, p - 1))}
                      disabled={processPage <= 1}
                      aria-label="Previous page"
                    >
                      Previous
                    </button>
                    <span className="portal-pagination-info">
                      Page {processPage} of {totalProcessPages}
                    </span>
                    <button
                      type="button"
                      className="portal-pagination-btn"
                      onClick={() => setProcessPage((p) => Math.min(totalProcessPages, p + 1))}
                      disabled={processPage >= totalProcessPages}
                      aria-label="Next page"
                    >
                      Next
                    </button>
                  </nav>
                )}
              </div>
            )}
            {activeSection === 'analytics' && (
              <div className="portal-analytics-tab-panel">
                <PortalAnalyticsPanel reportList={reportList} teamSessions={teamSessions} loading={loading} activeSection={activeSection} onSectionChange={setActiveSection} metrics={{ totalProcs, avgAuto, autoColor, redesignedCount, totalCost }} onMetricDrill={setMetricDrill} />
              </div>
            )}
            {activeSection === 'deals' && (
              <DealsPanel
                deals={deals}
                loading={dealsLoading}
                onRefresh={refreshDeals}
                accessToken={accessToken}
              />
            )}
          </main>
        </div>
          </div>
        </div>
      </div>

        {metricDrill && (
          <MetricDrillModal
            metricKey={metricDrill.metricKey}
            value={metricDrill.value}
            label={metricDrill.label}
            onClose={() => setMetricDrill(null)}
          />
        )}

        {redesignSaveModal && (
          <div className="portal-modal-overlay" onClick={() => { setRedesignSaveModal(null); setSaveModalName(''); }}>
            <div className="portal-save-modal" onClick={e => e.stopPropagation()}>
              <h3 className="portal-save-modal-title">Save redesign</h3>
              <p className="portal-save-modal-desc">How would you like to save this redesign?</p>
              <div className="portal-save-modal-name">
                <label htmlFor="portal-save-name">Name (optional)</label>
                <input
                  id="portal-save-name"
                  type="text"
                  className="portal-save-name-input"
                  placeholder="e.g. Human Redesign 1"
                  value={saveModalName}
                  onChange={(e) => setSaveModalName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveRedesignChoice(redesignSaveModal.reportId, redesignSaveModal.redesign, 'save_new', saveModalName)}
                />
              </div>
              <div className="portal-save-modal-actions">
                <button type="button" className="portal-flow-btn" onClick={() => handleSaveRedesignChoice(redesignSaveModal.reportId, redesignSaveModal.redesign, 'overwrite', saveModalName)}>
                  Overwrite existing
                </button>
                <button type="button" className="portal-flow-btn portal-build-btn" onClick={() => handleSaveRedesignChoice(redesignSaveModal.reportId, redesignSaveModal.redesign, 'save_new', saveModalName)}>
                  Save as new version
                </button>
                <button type="button" className="portal-flow-btn compact" onClick={() => { setRedesignSaveModal(null); setSaveModalName(''); }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      <footer className="portal-footer">
        <Link href="/">Vesno</Link> &middot; Technology-agnostic process optimisation
      </footer>
    </div>
  );
}
