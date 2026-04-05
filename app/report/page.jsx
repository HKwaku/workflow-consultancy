'use client';
// Reports are intentionally public (accessible by ID) to support sharing via email links and handovers.

import { useState, useEffect, useMemo, Suspense, useCallback, useRef, forwardRef } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { buildMapObservations } from '@/lib/diagnostic/buildMapObservations';
import { calculateAutomationScore } from '@/lib/diagnostic/buildLocalResults';
import { getAutomationReadinessColor } from '@/lib/diagnostic/automationReadiness';
import { detectBottlenecks, getSignificantBottlenecks } from '@/lib/diagnostic/detectBottlenecks';
import { classifyAutomation } from '@/lib/flows';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/components/ThemeProvider';
import ThemeToggle from '@/components/ThemeToggle';
import { apiFetch } from '@/lib/api-fetch';
import InteractiveFlowCanvas from '@/components/flow/InteractiveFlowCanvas';
import FloatingFlowViewer from '@/components/diagnostic/FloatingFlowViewer';
import { useFlowLayoutSave } from '@/lib/useFlowLayoutSave';
import AuditTrailPanel from '@/components/diagnostic/AuditTrailPanel';
import StepInsightPanel from '@/components/report/StepInsightPanel';
import MetricDrillModal from '@/components/report/MetricDrillModal';
import ImplementationTracker from '@/components/report/ImplementationTracker';

function formatCurrency(val) {
  if (val >= 1000000) return '\u00A3' + (val / 1000000).toFixed(1) + 'M';
  if (val >= 1000) return '\u00A3' + (val / 1000).toFixed(0) + 'K';
  return '\u00A3' + (val ?? 0);
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function Collapsible({ title, children, defaultOpen = false, nested = false, headerAction }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`report-collapsible ${nested ? 'report-collapsible-nested' : ''} ${open ? '' : 'collapsed'}`}>
      <div className="report-collapsible-header" onClick={() => setOpen(!open)}>
        <h3>{title}</h3>
        {headerAction && <span className="report-collapsible-header-action" onClick={(e) => e.stopPropagation()}>{headerAction}</span>}
        <span className={`report-collapse-btn ${nested ? 'report-collapse-btn-nested' : ''}`}>{open ? '\u2212' : '+'}</span>
      </div>
      <div className="report-collapsible-body">{children}</div>
    </div>
  );
}

function ReportSectionTabs({ tabs, defaultTab }) {
  const [activeTab, setActiveTab] = useState(defaultTab);
  const activeContent = tabs.find((t) => t.id === activeTab)?.content ?? tabs[0]?.content;
  return (
    <div className="report-section-tabs-wrap">
      <nav className="report-section-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTab === t.id}
            className={`report-section-tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="report-section-tab-content">{activeContent}</div>
    </div>
  );
}

function extractJsonFromText(str) {
  if (!str || typeof str !== 'string') return null;
  let s = str.trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/g, '').trim();
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    const objects = [];
    const objRegex = /\{\s*"process"\s*:\s*"([^"]*)"\s*,\s*"type"\s*:\s*"([^"]*)"\s*,\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = objRegex.exec(s)) !== null) {
      objects.push({ process: m[1], type: m[2], text: m[3].replace(/\\"/g, '"') });
    }
    return objects.length > 0 ? objects : null;
  }
}

function normalizeRecommendations(recs) {
  if (!recs || (Array.isArray(recs) && recs.length === 0)) return [];
  if (typeof recs === 'string') {
    const extracted = extractJsonFromText(recs);
    if (extracted) return extracted.map((r) => ({ type: r.type || 'general', process: r.process, text: r.text || '', severity: r.severity, finding: r.finding, action: r.action, estimatedTimeSavedMinutes: r.estimatedTimeSavedMinutes, effortLevel: r.effortLevel })).filter((r) => r.text?.trim());
    const cleaned = recs.replace(/^```[\s\S]*?```/gm, '').trim();
    if (!cleaned) return [];
    return [{ type: 'general', text: cleaned.slice(0, 500) }].filter((r) => r.text?.trim());
  }
  if (!Array.isArray(recs)) return [];
  const out = [];
  for (const r of recs) {
    if (typeof r === 'string') {
      const extracted = extractJsonFromText(r);
      if (extracted) out.push(...extracted);
      else if (r.trim()) out.push({ type: 'general', text: r });
    } else {
      const text = (r.text || '').trim();
      if (text && (text.startsWith('[') || text.startsWith('{') || text.includes('"process"') || text.includes('```json'))) {
        const extracted = extractJsonFromText(text);
        if (extracted) out.push(...extracted);
        else out.push({ type: r.type || 'general', process: r.process, text, severity: r.severity, finding: r.finding, action: r.action, estimatedTimeSavedMinutes: r.estimatedTimeSavedMinutes, effortLevel: r.effortLevel });
      } else if (text) {
        out.push({ type: r.type || 'general', process: r.process, text, severity: r.severity, finding: r.finding, action: r.action, estimatedTimeSavedMinutes: r.estimatedTimeSavedMinutes, effortLevel: r.effortLevel });
      }
    }
  }
  return out.map((r) => ({
    type: r.type || 'general',
    process: r.process,
    text: (r.text || '').trim(),
    severity: r.severity,
    finding: r.finding,
    action: r.action,
    estimatedTimeSavedMinutes: r.estimatedTimeSavedMinutes,
    effortLevel: r.effortLevel,
    industryContext: r.industryContext,
    frameworkRef: r.frameworkRef,
    benchmarkSource: r.benchmarkSource,
  })).filter((r) => r.text);
}

const OBS_EFFORT_GROUPS = [
  { key: 'quick-win', label: 'Quick Wins',   icon: '⚡', desc: 'Low effort, high impact — do these first.', defaultOpen: true  },
  { key: 'medium',    label: 'Medium-term',  icon: '🎯', desc: 'Worth planning into the next cycle.',      defaultOpen: false },
  { key: 'project',   label: 'Longer-term',  icon: '🔧', desc: 'Require more planning or investment.',     defaultOpen: false },
  { key: 'other',     label: 'Other',        icon: '📋', desc: '',                                         defaultOpen: false },
];

function ObservationsContent({ recs, isMapOnly, rawProcesses }) {
  const items = isMapOnly && rawProcesses?.length
    ? buildMapObservations(rawProcesses)
    : normalizeRecommendations(recs);

  if (items.length === 0) {
    return <p className="report-obs-empty">Review your process map and share with your team to validate the steps.</p>;
  }

  // Map-only mode: observations don't have effort levels — show flat list
  if (isMapOnly) {
    return (
      <div className="report-obs-list">
        {items.map((r, i) => (
          <div key={i} className="report-obs-item" style={r.color ? { borderLeftColor: r.color } : undefined}>
            <div className="report-obs-header">
              {r.icon && <span className="report-obs-icon" style={{ color: r.color }}>{r.icon}</span>}
              <span className="report-obs-num">{i + 1}</span>
              {r.process && <span className="report-obs-process">{r.process}</span>}
            </div>
            <p className="report-obs-text">{r.text || ''}</p>
          </div>
        ))}
      </div>
    );
  }

  // Full mode: group by effort level
  const byEffort = {};
  items.forEach(r => {
    const key = ['quick-win', 'medium', 'project'].includes(r.effortLevel) ? r.effortLevel : 'other';
    if (!byEffort[key]) byEffort[key] = [];
    byEffort[key].push(r);
  });

  return (
    <div className="report-rec-groups">
      {OBS_EFFORT_GROUPS.filter(g => byEffort[g.key]?.length).map(g => (
        <details key={g.key} className="report-rec-group" open={g.defaultOpen}>
          <summary className="report-rec-group-summary">
            <span className="report-rec-group-icon">{g.icon}</span>
            <span className="report-rec-group-label">{g.label}</span>
            <span className="report-rec-group-count">{byEffort[g.key].length}</span>
            {g.desc && <span className="report-rec-group-desc">{g.desc}</span>}
            <span className="report-auto-group-chevron">›</span>
          </summary>
          <div className="report-rec-list">
            {byEffort[g.key].map((r, ri) => (
              <div key={ri} className="report-rec-card report-rec-card-full">
                <div className="report-rec-card-top">
                  {r.severity && <span className={`report-severity-pill sev-${r.severity}`}>{r.severity}</span>}
                  {r.process && <span className="report-obs-process">{r.process}</span>}
                </div>
                {r.finding && <p className="report-obs-finding"><strong>Finding:</strong> {r.finding}</p>}
                <p className="report-obs-action">{r.action || r.text}</p>
                {(r.estimatedTimeSavedMinutes > 0 || r.frameworkRef || r.benchmarkSource || r.industryContext) && (
                  <div className="report-obs-meta">
                    {r.estimatedTimeSavedMinutes > 0 && <span className="report-obs-saving">~{r.estimatedTimeSavedMinutes} min saved per run</span>}
                    {r.frameworkRef && <span className="report-obs-framework">{r.frameworkRef}</span>}
                    {r.benchmarkSource && <span className="report-obs-source">Source: {r.benchmarkSource}</span>}
                    {r.industryContext && <span className="report-obs-industry-ctx">{r.industryContext}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </details>
      ))}
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

const FLOW_VIEWS = [
  { id: 'grid', label: 'Linear', icon: '\u2192' },
  { id: 'swimlane', label: 'Swimlane', icon: '\u23F8' },
];

const DEPT_PALETTE = ['#0d9488','#3b82f6','#8b5cf6','#f59e0b','#10b981','#ef4444','#ec4899','#06b6d4','#84cc16','#f97316'];

const BENCHMARK_DATA = {
  'Technology & Software':          { cycleDays: { best: 1,  median: 5,  worst: 21  }, optimalHandoffs: 3 },
  'Financial Services & Banking':   { cycleDays: { best: 1,  median: 7,  worst: 30  }, optimalHandoffs: 4 },
  'Healthcare & Life Sciences':     { cycleDays: { best: 2,  median: 10, worst: 45  }, optimalHandoffs: 5 },
  'Manufacturing & Engineering':    { cycleDays: { best: 3,  median: 14, worst: 60  }, optimalHandoffs: 6 },
  'Retail & E-commerce':            { cycleDays: { best: 1,  median: 5,  worst: 21  }, optimalHandoffs: 4 },
  'Professional Services':          { cycleDays: { best: 2,  median: 8,  worst: 28  }, optimalHandoffs: 4 },
  'Government & Public Sector':     { cycleDays: { best: 5,  median: 21, worst: 90  }, optimalHandoffs: 6 },
  'Non-profit & Charities':         { cycleDays: { best: 3,  median: 10, worst: 35  }, optimalHandoffs: 4 },
  'Construction & Real Estate':     { cycleDays: { best: 5,  median: 21, worst: 90  }, optimalHandoffs: 5 },
  'Logistics & Supply Chain':       { cycleDays: { best: 1,  median: 7,  worst: 21  }, optimalHandoffs: 5 },
  'Education & Training':           { cycleDays: { best: 2,  median: 10, worst: 30  }, optimalHandoffs: 4 },
  'Legal & Compliance':             { cycleDays: { best: 3,  median: 14, worst: 45  }, optimalHandoffs: 5 },
  'Insurance':                      { cycleDays: { best: 2,  median: 10, worst: 40  }, optimalHandoffs: 5 },
};

function MetricCard({ metricKey, value, drillValue, label, title, onClick, valueStyle }) {
  const v = drillValue ?? value;
  return (
    <div
      className="report-metric-card"
      role="button"
      tabIndex={0}
      title={title || 'Click for explanation'}
      onClick={() => onClick?.({ metricKey, value: v, label })}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.({ metricKey, value: v, label })}
    >
      <div className="report-metric-value" style={valueStyle}>{value}</div>
      <div className="report-metric-label">{label}</div>
    </div>
  );
}

const FloatIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="15 3 21 3 21 9"/>
    <line x1="21" y1="3" x2="14" y2="10"/>
    <path d="M10 5H5a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-5"/>
  </svg>
);

const FlowLegend = ({ darkTheme }) => (
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

const FlowResetBtn = ({ onClick, darkTheme }) => (
  <button type="button" className="flow-reset-btn report-flow-reset-btn" onClick={onClick} title="Reset positions">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />
    </svg>
    <span className="flow-reset-label">Reset positions</span>
  </button>
);

const FlowFloatBtn = ({ onClick }) => (
  <button type="button" className="flow-reset-btn report-flow-float-btn" onClick={onClick} title="Open in floating window">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 3 21 3 21 9"/><line x1="21" y1="3" x2="14" y2="10"/>
      <path d="M10 5H5a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-5"/>
    </svg>
    <span className="flow-reset-label">Open fullscreen</span>
  </button>
);

const FlowDiagramCard = forwardRef(function FlowDiagramCard({ proc, processIndex, viewMode, darkTheme, hideProcessName, hideBuiltInToolbar, onFloat, floatOpen: floatOpenProp, onFloatClose, reportId, accessToken }, ref) {
  const [insightStepIndex, setInsightStepIndex] = useState(null);
  const [localFloatOpen, setLocalFloatOpen] = useState(false);
  const { flowNodePositions, setFlowNodePositions, customEdges, setCustomEdges, deletedEdges, setDeletedEdges } = useFlowLayoutSave({
    reportId,
    processIndex,
    accessToken,
    initialPositions: proc.flowNodePositions || {},
    initialCustomEdges: proc.flowCustomEdges || [],
    initialDeletedEdges: proc.flowDeletedEdges || [],
  });

  const floatOpen = floatOpenProp ?? localFloatOpen;
  const handleFloatClose = onFloatClose ?? (() => setLocalFloatOpen(false));
  const handleFloat = onFloat ?? (() => setLocalFloatOpen(true));

  const steps = proc.steps || [];
  if (!steps.length) return null;

  const processForFlow = {
    ...proc,
    steps,
    handoffs: ensureHandoffs(steps, proc.handoffs),
    definition: proc.definition || { startsWhen: 'Start', completesWhen: 'Complete' },
    bottleneck: proc.bottleneck || {},
  };

  const procName = proc.processName || proc.name || `Process ${processIndex + 1}`;
  const showFloatInHeader = !hideProcessName;
  const handlePositionsChange = (positions, layout) => setFlowNodePositions(prev => ({ ...prev, [`${steps.length}-${layout}`]: positions }));

  return (
    <>
      <div className="report-flow-diagram-item">
        {!hideProcessName && (
          <div className="report-flow-diagram-header">
            <h4 style={{ margin: 0, fontSize: '1rem', color: 'var(--primary)' }}>{procName}</h4>
            {showFloatInHeader && <FlowFloatBtn onClick={handleFloat} />}
          </div>
        )}
        <div className="report-flow-canvas-wrap">
          <InteractiveFlowCanvas
            ref={ref}
            process={processForFlow}
            customEdges={customEdges}
            deletedEdges={deletedEdges}
            storedPositions={flowNodePositions[`${steps.length}-${viewMode}`] || flowNodePositions[`${steps.length}`] || null}
            onPositionsChange={handlePositionsChange}
            onCustomEdgesChange={setCustomEdges}
            onDeletedEdgesChange={setDeletedEdges}
            layout={viewMode}
            darkTheme={darkTheme}
            onStepClick={(idx) => setInsightStepIndex(idx)}
            onFloat={hideBuiltInToolbar ? undefined : handleFloat}
            hideBuiltInToolbar={hideBuiltInToolbar}
          />
        </div>
      </div>

      {insightStepIndex != null && (
        <StepInsightPanel
          stepIndex={insightStepIndex}
          process={processForFlow}
          onClose={() => setInsightStepIndex(null)}
        />
      )}

      {floatOpen && (
        <FloatingFlowViewer
          proc={processForFlow}
          onClose={handleFloatClose}
          initialViewMode={viewMode}
          onStepClick={(idx) => setInsightStepIndex(idx)}
          darkTheme={darkTheme}
          customEdges={customEdges}
          onCustomEdgesChange={setCustomEdges}
          deletedEdges={deletedEdges}
          onDeletedEdgesChange={setDeletedEdges}
          flowNodePositions={flowNodePositions}
          onPositionsChange={handlePositionsChange}
        />
      )}
    </>
  );
});

function FlowDiagramsSection({ rawProcesses, processes, darkTheme, reportId, accessToken }) {
  const [viewMode, setViewMode] = useState('grid');
  const [floatOpen, setFloatOpen] = useState(false);
  const canvasRefs = useRef([]);
  const sources = rawProcesses?.length ? rawProcesses : processes || [];
  const singleProcess = sources.length === 1;
  const isWrapped = viewMode === 'wrap';

  if (!sources.length) {
    return <p style={{ color: 'var(--text-mid)', fontSize: '0.9rem' }}>No process data available for flow diagrams.</p>;
  }

  const handleReset = () => {
    canvasRefs.current.forEach((r) => r?.resetView?.());
  };
  const handleWrapToggle = () => setViewMode((v) => v === 'wrap' ? 'grid' : 'wrap');

  return (
    <div className="report-flow-diagrams">
      <div className="report-flow-toolbar">
        <div className="report-flow-view-toggle">
          {FLOW_VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`report-flow-view-btn ${(viewMode === v.id || (v.id === 'grid' && isWrapped)) ? 'active' : ''}`}
              onClick={() => setViewMode(v.id)}
              title={v.title || v.label}
            >
              <span className="report-flow-view-icon">{v.icon}</span>
              {v.label}
            </button>
          ))}
        </div>
        <FlowLegend darkTheme={darkTheme} />
        <FlowResetBtn onClick={handleReset} darkTheme={darkTheme} />
        <button
          type="button"
          className="flow-reset-btn report-flow-reset-btn"
          disabled
          title="Wrap functionality coming soon"
          style={{ opacity: 0.4, cursor: 'not-allowed' }}
        >↩</button>
        {singleProcess && <FlowFloatBtn onClick={() => setFloatOpen(true)} />}
      </div>
      {sources.map((proc, i) => (
        <FlowDiagramCard
          key={i}
          ref={(el) => { canvasRefs.current[i] = el; }}
          proc={proc}
          processIndex={i}
          viewMode={viewMode}
          darkTheme={darkTheme}
          hideProcessName={singleProcess}
          hideBuiltInToolbar
          reportId={reportId}
          accessToken={accessToken}
          onFloat={singleProcess ? () => setFloatOpen(true) : undefined}
          floatOpen={singleProcess && floatOpen}
          onFloatClose={() => setFloatOpen(false)}
        />
      ))}
    </div>
  );
}

const CHANGE_TYPE_META = {
  removed:   { label: 'Removed',   cls: 'removed',   icon: '\u2715' },
  automated: { label: 'Automated', cls: 'automated', icon: '\u2699' },
  merged:    { label: 'Merged',    cls: 'merged',    icon: '\u2B82' },
  added:     { label: 'Added',     cls: 'added',     icon: '+' },
  reordered: { label: 'Reordered', cls: 'reordered', icon: '\u21C5' },
  modified:  { label: 'Modified',  cls: 'modified',  icon: '\u270E' },
};

const PRINCIPLE_LABELS = {
  'consolidate':        'Combined related steps into one to reduce hand-offs',
  'preserve-decisions': 'Kept this decision point intact  -  routing logic matters',
  'automate-handoffs':  'Automated the mechanical work, kept human judgment',
  'realistic-estimates': 'Savings estimate grounded in your actual data',
  'structural-integrity': 'Ensured the flow stays connected and executable',
  'checklists':         'Preserved detail as a checklist inside a simpler step',
  'cross-department':   'Maintained visibility between teams during hand-over',
  'common-case':        'Designed the main flow for the typical scenario',
  'parallel':           'These steps can run at the same time  -  no dependency between them',
  'early-rejection':    'Moved this check earlier to avoid wasted effort if it fails',
  'minimise-teams':     'Reduced the number of teams involved to cut waiting time',
  'process-owner':      'Clarified who owns this process end-to-end',
  'cut-no-value':       'Removed a step that didn\u2019t add value to the outcome',
  'fix-before-automate': 'Fixed the process logic before considering automation',
};

function RedesignProcessBlock({ procName, beforeSvgProc, afterProc, op, viewMode, processChanges, hasNewFormat, decisions, handleDecision, finalised, showOnly, darkTheme, showProcessName }) {
  const [floatBefore, setFloatBefore] = useState(false);
  const [floatAfter, setFloatAfter] = useState(false);
  const [insightState, setInsightState] = useState(null);

  const parallelSteps = (op.steps || []).filter(s => s.parallel && s.status !== 'removed');
  const showFlows = showOnly !== 'changes';
  const showChanges = showOnly !== 'flows';

  return (
    <div className="report-redesign-process-block">
      {showProcessName && (
        <div className="report-redesign-process-header">
          <h4 className="report-redesign-process-title">{procName}</h4>
        </div>
      )}
      {showFlows && (
        <>
          {parallelSteps.length > 0 && (
            <div className="report-redesign-parallel-callout">
              <span className="report-redesign-parallel-icon">&#9889;</span>
              <div>
                <strong>Time-saving opportunity:</strong> {parallelSteps.length} step{parallelSteps.length !== 1 ? 's' : ''} can run at the same time instead of one after another:
                <span className="report-redesign-parallel-list">
                  {parallelSteps.map(s => s.name).join(' \u2022 ')}
                </span>
              </div>
            </div>
          )}

          <div className="report-redesign-compare">
        <div className="report-redesign-before">
          <div className="report-redesign-compare-label">Current</div>
          {beforeSvgProc ? (
            <div className="report-flow-canvas-wrap report-flow-canvas-compare">
              <InteractiveFlowCanvas
                process={beforeSvgProc}
                layout={viewMode}
                darkTheme={darkTheme}
                onStepClick={(idx) => setInsightState({ stepIndex: idx, process: beforeSvgProc })}
                onFloat={beforeSvgProc ? () => setFloatBefore(true) : undefined}
                customEdges={beforeSvgProc.flowCustomEdges || []}
                deletedEdges={beforeSvgProc.flowDeletedEdges || []}
                storedPositions={beforeSvgProc.flowNodePositions?.[(beforeSvgProc.steps || []).length + '-' + viewMode] || beforeSvgProc.flowNodePositions?.[(beforeSvgProc.steps || []).length] || null}
              />
            </div>
          ) : (
            <p className="report-redesign-no-data">Original process data not available</p>
          )}
        </div>
        <div className="report-redesign-after">
          <div className="report-redesign-compare-label">Optimised</div>
          <div className="report-flow-canvas-wrap report-flow-canvas-compare">
            <InteractiveFlowCanvas
              process={afterProc}
              layout={viewMode}
              darkTheme={darkTheme}
              onStepClick={(idx) => setInsightState({ stepIndex: idx, process: afterProc })}
              onFloat={() => setFloatAfter(true)}
            />
          </div>
        </div>
      </div>
        </>
      )}

      {insightState && (
        <StepInsightPanel
          stepIndex={insightState.stepIndex}
          process={insightState.process}
          onClose={() => setInsightState(null)}
        />
      )}

      {floatBefore && beforeSvgProc && (
        <FloatingFlowViewer
          proc={beforeSvgProc}
          onClose={() => setFloatBefore(false)}
          initialViewMode={viewMode}
          onStepClick={(idx) => setInsightState({ stepIndex: idx, process: beforeSvgProc })}
          darkTheme={darkTheme}
          customEdges={beforeSvgProc.flowCustomEdges || []}
          deletedEdges={beforeSvgProc.flowDeletedEdges || []}
          flowNodePositions={beforeSvgProc.flowNodePositions || {}}
        />
      )}
      {floatAfter && afterProc && (
        <FloatingFlowViewer
          proc={afterProc}
          onClose={() => setFloatAfter(false)}
          initialViewMode={viewMode}
          onStepClick={(idx) => setInsightState({ stepIndex: idx, process: afterProc })}
          darkTheme={darkTheme}
        />
      )}

      {showChanges && hasNewFormat && processChanges.length > 0 && (
        <div className="report-redesign-changes">
          {processChanges.map((ch) => {
            const meta = CHANGE_TYPE_META[ch.type] || CHANGE_TYPE_META.modified;
            const verdict = decisions[ch._idx];
            const cardCls = [
              'report-redesign-change-card',
              `change-${meta.cls}`,
              verdict === 'accepted' ? 'decision-accepted' : '',
              verdict === 'rejected' ? 'decision-rejected' : '',
            ].filter(Boolean).join(' ');

            const matchedStep = (op.steps || []).find(s => s.name === ch.stepName && s.status !== 'removed');
            const checklist = matchedStep?.checklist?.length ? matchedStep.checklist : [];

            return (
              <div key={ch._idx} className={cardCls}>
                <div className="report-redesign-change-icon">{meta.icon}</div>
                <div className="report-redesign-change-body">
                  <div className="report-redesign-change-header">
                    <span className={`report-redesign-change-badge change-${meta.cls}`}>{meta.label}</span>
                    <span className={`report-redesign-change-step ${ch.type === 'removed' ? 'strikethrough' : ''}`}>{ch.stepName}</span>
                  </div>
                  <p className="report-redesign-change-desc">{ch.description}</p>
                  {ch.principle && PRINCIPLE_LABELS[ch.principle] && (
                    <div className="report-redesign-change-principle">
                      <span className="report-redesign-principle-icon">&#128161;</span>
                      {PRINCIPLE_LABELS[ch.principle]}
                    </div>
                  )}
                  {checklist.length > 0 && (
                    <ul className="report-redesign-change-checklist">
                      {checklist.map((item, ci) => (
                        <li key={ci}>{typeof item === 'string' ? item : item.text || item}</li>
                      ))}
                    </ul>
                  )}
                </div>
                {!finalised && (
                  <div className="report-redesign-change-verdict">
                    <button type="button" className={`verdict-btn accept ${verdict === 'accepted' ? 'active' : ''}`} onClick={() => handleDecision(ch._idx, 'accepted')} title="Accept">&#10003;</button>
                    <button type="button" className={`verdict-btn reject ${verdict === 'rejected' ? 'active' : ''}`} onClick={() => handleDecision(ch._idx, 'rejected')} title="Reject">&#10005;</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showChanges && !hasNewFormat && (
        <div className="report-redesign-steps-fallback">
          <h5>Optimised Steps</h5>
          <ol className="report-redesign-steps">
            {(op.steps || []).map((st, sti) => (
              <li key={sti} className={st.removed ? 'report-redesign-removed' : ''}>
                <span className="report-redesign-step-name">{st.name || st.stepName}</span>
                {st.department && <span className="report-redesign-step-dept">{st.department}</span>}
                {st.removed && <span className="report-redesign-removed-badge">Removed</span>}
                {st.isDecision && <span className="report-redesign-decision-badge">Decision</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function RedesignSection({ redesign, rawProcesses, processes, reportId, redesignId, contactEmail, automationScore, accessToken, darkTheme, onRefresh, onEffectiveMetrics }) {
  const [viewMode, setViewMode] = useState('grid');
  const [redesignTab, setRedesignTab] = useState('metrics');
  const [decisions, setDecisions] = useState(() => redesign.decisions || {});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [finalising, setFinalising] = useState(false);
  const [finalised, setFinalised] = useState(!!redesign.acceptedAt);
  const [actionError, setActionError] = useState(null);
  const [showRejectPrompt, setShowRejectPrompt] = useState(false);

  const hasNewFormat = Array.isArray(redesign.changes);
  const costSummary = redesign.costSummary || null;

  const indexedChanges = useMemo(() => {
    if (!hasNewFormat) return [];
    return (redesign.changes || []).map((c, i) => ({ ...c, _idx: i }));
  }, [redesign.changes, hasNewFormat]);

  const changesForProcess = useCallback((processName) => {
    return indexedChanges.filter(c => c.process?.toLowerCase() === processName?.toLowerCase());
  }, [indexedChanges]);

  const handleDecision = useCallback((idx, verdict) => {
    setDecisions(prev => {
      const next = { ...prev };
      if (next[idx] === verdict) { delete next[idx]; }
      else { next[idx] = verdict; }
      return next;
    });
    setDirty(true);
  }, []);

  const handleAcceptAll = useCallback(() => {
    const next = {};
    indexedChanges.forEach(ch => { next[ch._idx] = 'accepted'; });
    setDecisions(next);
    setDirty(true);
  }, [indexedChanges]);

  const handleRejectAll = useCallback(() => {
    const next = {};
    indexedChanges.forEach(ch => { next[ch._idx] = 'rejected'; });
    setDecisions(next);
    setDirty(true);
  }, [indexedChanges]);

  const handleSave = useCallback(async () => {
    if (!reportId || !contactEmail) return;
    setSaving(true);
    setActionError(null);
    try {
      const resp = await apiFetch('/api/update-diagnostic', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId, updates: { redesign: { decisions } } }),
      }, accessToken);
      if (!resp.ok) {
        const data = await resp.json().catch((parseErr) => { console.warn('Error response not JSON', parseErr); return {}; });
        throw new Error(data.error || 'Failed to save');
      }
      setDirty(false);
    } catch (e) {
      console.error('Failed to save decisions', e);
      setActionError(e.message || 'Failed to save decisions. Please try again.');
    }
    setSaving(false);
  }, [reportId, contactEmail, decisions, accessToken]);

  const handleRejectAccepted = useCallback(async () => {
    if (!reportId || !accessToken) return;
    setActionError(null);
    try {
      const resp = await apiFetch('/api/update-diagnostic', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId, updates: { redesign: { rejectAccepted: true } } }),
      }, accessToken);
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to reject');
      }
      setShowRejectPrompt(false);
      setActionError(null);
      // User can now click Accept Redesign again
    } catch (e) {
      setActionError(e.message || 'Failed to reject accepted redesign.');
    }
  }, [reportId, accessToken]);

  const handleFinalise = useCallback(async () => {
    if (!reportId || !contactEmail) return;
    setFinalising(true);
    setActionError(null);
    setShowRejectPrompt(false);
    try {
      const acceptedProcesses = (redesign.optimisedProcesses || []).map(op => {
        const pName = op.processName || op.name;
        const pChanges = (indexedChanges || []).filter(c => c.process?.toLowerCase() === pName?.toLowerCase());
        const rejectedByStep = {};
        for (const ch of pChanges) {
          if (decisions[ch._idx] === 'rejected') {
            rejectedByStep[(ch.stepName || '').toLowerCase()] = ch.type;
          }
        }
        const effective = (op.steps || []).map(s => {
          const key = (s.name || '').toLowerCase();
          const rejType = rejectedByStep[key];
          if (!rejType) return s;
          if (rejType === 'added') return null;
          return { ...s, status: 'unchanged' };
        }).filter(Boolean);
        const active = effective.filter(s => s.status !== 'removed');
        return { processName: pName, steps: active, handoffs: ensureHandoffs(active, op.handoffs) };
      });
      const resp = await apiFetch('/api/update-diagnostic', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId,
          updates: {
            redesign: {
              redesignId: redesignId || undefined,
              decisions,
              acceptedAt: new Date().toISOString(),
              acceptedProcesses,
            },
          },
        }),
      }, accessToken);
      if (!resp.ok) {
        const data = await resp.json().catch((parseErr) => { console.warn('Error response not JSON', parseErr); return {}; });
        if (data.code === 'REDESIGN_ALREADY_ACCEPTED') {
          setShowRejectPrompt(true);
          setActionError(data.error || 'Another redesign is already accepted. Refer to the accepted redesign above, or reject it first to accept a different one.');
          setFinalising(false);
          return;
        }
        throw new Error(data.error || 'Failed to finalise');
      }
      setFinalised(true);
      setDirty(false);
    } catch (e) {
      console.error('Failed to accept redesign', e);
      setActionError(e.message || 'Failed to accept redesign. Please try again.');
    }
    setFinalising(false);
  }, [reportId, contactEmail, redesign.optimisedProcesses, indexedChanges, decisions, accessToken]);

  // Warn before navigating away with unsaved decisions
  useEffect(() => {
    if (!dirty) return;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const getEffectiveSteps = useCallback((opProcess) => {
    const pName = opProcess.processName || opProcess.name;
    const pChanges = changesForProcess(pName);
    const rejectedByStep = {};
    for (const ch of pChanges) {
      if (decisions[ch._idx] === 'rejected') {
        rejectedByStep[(ch.stepName || '').toLowerCase()] = ch.type;
      }
    }
    return (opProcess.steps || []).map(s => {
      const key = (s.name || '').toLowerCase();
      const rejType = rejectedByStep[key];
      if (!rejType) return s;
      if (rejType === 'added') return null;
      return { ...s, status: 'unchanged' };
    }).filter(Boolean);
  }, [changesForProcess, decisions]);

  const buildBeforeSvgProc = useCallback((proc) => {
    const steps = (proc.steps || []).filter(s => s.status !== 'removed');
    return {
      ...proc,
      steps,
      handoffs: ensureHandoffs(steps, proc.handoffs),
      definition: proc.definition || { startsWhen: 'Start', completesWhen: 'Complete' },
      bottleneck: proc.bottleneck || {},
    };
  }, []);

  const buildAfterSvgProc = useCallback((op) => {
    const effective = getEffectiveSteps(op);
    const active = effective.filter(s => s.status !== 'removed');
    return {
      ...op,
      steps: active,
      handoffs: ensureHandoffs(active, op.handoffs),
      definition: op.definition || { startsWhen: 'Start', completesWhen: 'Complete' },
      bottleneck: op.bottleneck || {},
    };
  }, [getEffectiveSteps]);

  const effectiveMetrics = useMemo(() => {
    if (!hasNewFormat) {
      // No changes array — derive step counts directly from processes
      const origCount = rawProcesses?.reduce((s, p) => s + (p.steps?.length ?? 0), 0) ?? 0;
      const optCount = redesign.optimisedProcesses?.reduce((s, p) => s + (p.steps?.filter(st => st.status !== 'removed').length ?? 0), 0) ?? 0;
      if (origCount === 0 && optCount === 0) return null;
      return { originalStepsCount: origCount, optimisedStepsCount: optCount, stepsRemoved: origCount - optCount, stepsAutomated: 0, estimatedTimeSavedPercent: 0 };
    }
    let stepsRemoved = 0, stepsAutomated = 0, timeSavedPerYear = 0;
    const processByName = new Map((rawProcesses || []).map(rp => [rp.processName?.toLowerCase?.(), rp]));
    for (const ch of indexedChanges) {
      const d = decisions[ch._idx];
      if (d === 'rejected') continue;
      if (ch.type === 'removed') stepsRemoved++;
      if (ch.type === 'automated') stepsAutomated++;
      const mins = ch.estimatedTimeSavedMinutes || 0;
      const rp = processByName.get((ch.process || '').toLowerCase());
      const annual = rp?.frequency?.annual ?? rp?.costs?.annual ?? 12;
      timeSavedPerYear += mins * annual;
    }
    const origCount = costSummary?.originalStepsCount
      ?? (rawProcesses?.reduce((s, p) => s + (p.steps?.length ?? 0), 0) ?? 0);
    let totalBaselineMinutesPerYear = 0;
    for (const rp of rawProcesses || []) {
      const hours = rp.costs?.hoursPerInstance ?? 0;
      const annual = rp.frequency?.annual ?? rp.costs?.annual ?? 12;
      const teamSize = rp.costs?.teamSize ?? 1;
      totalBaselineMinutesPerYear += hours * 60 * annual * teamSize;
    }
    const timeSavedPercent = totalBaselineMinutesPerYear > 0
      ? Math.min(100, Math.round((timeSavedPerYear / totalBaselineMinutesPerYear) * 100))
      : (origCount > 0 ? Math.min(100, Math.round((timeSavedPerYear / (origCount * 60 * 12)) * 100)) : (costSummary?.estimatedTimeSavedPercent || 0));
    return {
      originalStepsCount: origCount,
      stepsRemoved,
      stepsAutomated,
      optimisedStepsCount: Math.max(0, origCount - stepsRemoved),
      estimatedTimeSavedPercent: timeSavedPercent,
    };
  }, [costSummary, hasNewFormat, indexedChanges, decisions, rawProcesses, redesign.optimisedProcesses]);

  useEffect(() => { onEffectiveMetrics?.(effectiveMetrics); }, [effectiveMetrics, onEffectiveMetrics]);

  const acceptedCount = Object.values(decisions).filter(v => v === 'accepted').length;
  const rejectedCount = Object.values(decisions).filter(v => v === 'rejected').length;
  const totalChanges = indexedChanges.length;
  const pendingCount = totalChanges - acceptedCount - rejectedCount;

  const beforeSources = rawProcesses?.length ? rawProcesses : processes || [];

  const redesignTabs = [];
  if (effectiveMetrics) {
    redesignTabs.push({
      id: 'metrics',
      label: 'Summary & Metrics',
      content: (
        <>
            <div className="redesign-tiles">
            <div className="redesign-tile primary">
              <div className="redesign-tile-value">
                {effectiveMetrics.originalStepsCount ?? ' - '} <span className="redesign-tile-arrow">&rarr;</span> {effectiveMetrics.optimisedStepsCount ?? ' - '}
              </div>
              <div className="redesign-tile-label">Steps</div>
            </div>
            {(effectiveMetrics.estimatedTimeSavedPercent > 0) && (
              <div className="redesign-tile">
                <div className="redesign-tile-value">{effectiveMetrics.estimatedTimeSavedPercent}%</div>
                <div className="redesign-tile-label">Faster</div>
              </div>
            )}
            {(effectiveMetrics.stepsAutomated > 0) && (
              <div className="redesign-tile">
                <div className="redesign-tile-value">{effectiveMetrics.stepsAutomated}</div>
                <div className="redesign-tile-label">Automated</div>
              </div>
            )}
            {automationScore && (
              <div className="redesign-tile">
                <div className="redesign-tile-value" style={{ color: getAutomationReadinessColor(automationScore.percentage ?? 0) }}>{automationScore.percentage ?? 0}%</div>
                <div className="redesign-tile-label">Automation ready</div>
              </div>
            )}
            </div>
            {redesign.executiveSummary && (
              <p className="redesign-summary-line">{redesign.executiveSummary}</p>
            )}
            {hasNewFormat && pendingCount > 0 && (
              <p className="redesign-savings-breakdown-line redesign-savings-breakdown-pending" style={{ marginTop: 12 }}>
                {pendingCount} change{pendingCount !== 1 ? 's' : ''} still pending — review in the Proposed changes tab.
              </p>
            )}
        </>
      ),
    });
  }
  if (hasNewFormat && totalChanges > 0 && redesign.optimisedProcesses?.length > 0) {
    redesignTabs.push({
      id: 'changes',
      label: 'Proposed changes',
      content: (
        <>
          {actionError && (
            <div className="report-redesign-error-banner" role="alert" style={{ background: showRejectPrompt ? 'var(--amber)' : 'var(--red)', color: 'white', padding: '12px 16px', borderRadius: 'var(--radius-sm)', marginBottom: 16, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span>{actionError}</span>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {showRejectPrompt && (
                  <button type="button" onClick={handleRejectAccepted} style={{ background: 'rgba(255,255,255,0.9)', color: 'var(--dark)', border: 'none', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600 }}>
                    Reject accepted redesign
                  </button>
                )}
                <button type="button" onClick={() => { setActionError(null); setShowRejectPrompt(false); }} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: '0.88rem' }}>Dismiss</button>
              </span>
            </div>
          )}
          {!finalised && (
            <div className="report-redesign-decision-bar">
              <div className="report-redesign-decision-stats">
                <span className="redesign-stat accepted">{acceptedCount} accepted</span>
                <span className="redesign-stat rejected">{rejectedCount} rejected</span>
                <span className="redesign-stat pending">{pendingCount} pending</span>
              </div>
              <div className="report-redesign-decision-actions">
                <button type="button" className="redesign-bulk-btn accept" onClick={handleAcceptAll}>Accept All</button>
                <button type="button" className="redesign-bulk-btn reject" onClick={handleRejectAll}>Reject All</button>
                {reportId && contactEmail && (
                  <>
                    <button type="button" className="redesign-save-btn" onClick={handleSave} disabled={saving || !dirty}>
                      {saving ? 'Saving...' : dirty ? 'Save Decisions' : 'Saved'}
                    </button>
                    <button
                      type="button"
                      className="redesign-finalise-btn"
                      onClick={handleFinalise}
                      disabled={finalising || pendingCount > 0}
                      title={pendingCount > 0 ? 'Review all suggestions before accepting' : 'Accept the redesign and save it to your portal'}
                    >
                      {finalising ? 'Saving...' : 'Accept Redesign'}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
          <div className="report-redesign-section-block report-redesign-changes-section">
            {redesign.optimisedProcesses.map((op, opi) => {
              const procName = op.processName || op.name || `Process ${opi + 1}`;
              const beforeProc = beforeSources[opi];
              const afterProc = buildAfterSvgProc(op);
              const beforeSvgProc = beforeProc ? buildBeforeSvgProc(beforeProc) : null;
              const processChanges = changesForProcess(procName);
              if (processChanges.length === 0) return null;
              return (
                <RedesignProcessBlock
                  key={opi}
                  procName={procName}
                  beforeSvgProc={beforeSvgProc}
                  afterProc={afterProc}
                  op={op}
                  viewMode={viewMode}
                  processChanges={processChanges}
                  hasNewFormat={hasNewFormat}
                  decisions={decisions}
                  handleDecision={handleDecision}
                  finalised={finalised}
                  showOnly="changes"
                  darkTheme={darkTheme}
                  showProcessName={redesign.optimisedProcesses.length > 1}
                />
              );
            })}
          </div>
        </>
      ),
    });
  }
  if (redesign.optimisedProcesses?.length > 0) {
    redesignTabs.push({
      id: 'flows',
      label: 'Flow charts',
      content: (
        <div className="report-redesign-section-block report-redesign-flows">
          <div className="report-flow-view-toggle" style={{ marginBottom: 16 }}>
            {FLOW_VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                className={`report-flow-view-btn ${viewMode === v.id ? 'active' : ''}`}
                onClick={() => setViewMode(v.id)}
              >
                <span className="report-flow-view-icon">{v.icon}</span>
                {v.label}
              </button>
            ))}
          </div>
          {redesign.optimisedProcesses.map((op, opi) => {
            const procName = op.processName || op.name || `Process ${opi + 1}`;
            const beforeProc = beforeSources[opi];
            const afterProc = buildAfterSvgProc(op);
            const beforeSvgProc = beforeProc ? buildBeforeSvgProc(beforeProc) : null;
            const processChanges = changesForProcess(procName);
            return (
              <RedesignProcessBlock
                key={opi}
                procName={procName}
                beforeSvgProc={beforeSvgProc}
                afterProc={afterProc}
                op={op}
                viewMode={viewMode}
                processChanges={processChanges}
                hasNewFormat={hasNewFormat}
                decisions={decisions}
                handleDecision={handleDecision}
                finalised={finalised}
                showOnly="flows"
                darkTheme={darkTheme}
                showProcessName={redesign.optimisedProcesses.length > 1}
              />
            );
          })}
        </div>
      ),
    });
  }
  const activeRedesignTab = redesignTabs.find(t => t.id === redesignTab) ? redesignTab : (redesignTabs[0]?.id ?? 'metrics');

  return (
    <div className="report-redesign-section">
        {finalised && (
          <div className="report-redesign-finalised-banner">
            <span className="redesign-finalised-icon">&#10003;</span>
            <span>Redesign accepted{redesign.acceptedAt ? ` on ${new Date(redesign.acceptedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}. View both flows in your <Link href="/portal">Client Portal</Link>. <Link href={`/build?id=${reportId}`}>Build this</Link>  -  generate workflow definitions for N8N, Unqork, Make, Zapier, and more.</span>
          </div>
        )}

        {reportId && contactEmail && (
          <div className="report-redesign-regenerate-bar">
            <Link
              href={`/process-audit?edit=${encodeURIComponent(reportId)}&email=${encodeURIComponent(contactEmail)}&aiRedesign=1`}
              className="button button-secondary report-redesign-regenerate-btn"
              title="Generate a new AI redesign for this process"
            >
              New redesign
            </Link>
          </div>
        )}

      {redesignTabs.length > 0 && (
        <>
          <div className="report-section-tabs report-redesign-tabs">
            {redesignTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`report-section-tab ${activeRedesignTab === t.id ? 'active' : ''}`}
                onClick={() => setRedesignTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="report-section-tab-panel">
            {redesignTabs.find(t => t.id === activeRedesignTab)?.content}
          </div>
        </>
      )}

        {!hasNewFormat && redesign.changeLog?.length > 0 && (
          <div className="report-redesign-changelog">
            <h4 className="report-redesign-heading">Change Log</h4>
            <ul>
              {redesign.changeLog.map((cl, cli) => (
                <li key={cli}>{typeof cl === 'string' ? cl : cl.description || cl.change || JSON.stringify(cl)}</li>
              ))}
            </ul>
          </div>
        )}

        {!hasNewFormat && redesign.efficiencyGains?.length > 0 && (
          <div className="report-redesign-gains">
            <h4 className="report-redesign-heading">Efficiency Gains</h4>
            <ul>
              {redesign.efficiencyGains.map((eg, egi) => (
                <li key={egi}>{typeof eg === 'string' ? eg : eg.description || eg.gain || JSON.stringify(eg)}</li>
              ))}
            </ul>
          </div>
        )}
    </div>
  );
}

function ReportContent() {
  useTheme(); // keep context subscription for ThemeToggle
  const darkTheme = true;
  const searchParams = useSearchParams();
  const id = searchParams.get('id') || searchParams.get('edit');
  const redesignId = searchParams.get('redesignId');
  const fromPortal = searchParams.get('portal') === '1';
  const tokenFromUrl = searchParams.get('token');
  const isClientView = searchParams.get('view') === 'client';
  const { user: sessionUser, accessToken, signOut: sessionSignOut } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [report, setReport] = useState(null);
  const [showAuditTrail, setShowAuditTrail] = useState(false);
  const [metricDrill, setMetricDrill] = useState(null);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [syncedRedesignMetrics, setSyncedRedesignMetrics] = useState(null);
  const [parentReport, setParentReport] = useState(null);
  const refreshReport = useCallback(() => setRefreshCounter(c => c + 1), []);

  // Fetch parent report for re-audit delta comparison
  useEffect(() => {
    const pid = report?.parentReportId;
    if (!pid) return;
    fetch(`/api/get-diagnostic?id=${encodeURIComponent(pid)}`)
      .then((r) => r.json())
      .then((data) => { if (data.success && data.report) setParentReport(data.report); })
      .catch(() => {});
  }, [report?.parentReportId]);

  useEffect(() => {
    if (tokenFromUrl && id && typeof window !== 'undefined') {
      try {
        const costUrl = `${window.location.origin}/cost-analysis?id=${id}&token=${encodeURIComponent(tokenFromUrl)}`;
        sessionStorage.setItem('costAnalysisUrl_' + id, costUrl);
      } catch { /* ignore */ }
    }
  }, [id, tokenFromUrl]);

  useEffect(() => {
    if (!id) { setError('No report ID provided'); setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const url = `/api/get-diagnostic?id=${encodeURIComponent(id)}${redesignId ? '&redesignId=' + encodeURIComponent(redesignId) : ''}`;
        const headers = {};
        if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
        const resp = await fetch(url, { headers, credentials: 'include' });
        let data;
        try { data = await resp.json(); } catch (e) { throw new Error('Invalid response'); }
        if (cancelled) return;
        if (!resp.ok || !data.success) { setError(data.error || 'Report not found.'); setLoading(false); return; }
        setReport(data.report);
      } catch (err) {
        if (cancelled) return;
        setError('Unable to reach the server. Please try again later.');
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id, redesignId, accessToken, refreshCounter]);

  const contactEmail = report?.contactEmail || report?.diagnosticData?.contact?.email || '';
  const parentReportId = report?.parentReportId || null;

  if (loading) return <div className="loading-state" style={{ padding: 48, textAlign: 'center' }}><div className="loading-spinner" /><p>Retrieving your report...</p></div>;

  if (error) return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <p style={{ color: 'var(--red)' }}>{error}</p>
      <Link href="/process-audit" style={{ color: 'var(--accent)', marginTop: 16, display: 'inline-block' }}>Start a New Process Audit</Link><br />
      <Link href="/portal" style={{ color: 'var(--accent)', marginTop: 8, display: 'inline-block' }}>&larr; Back to Client Login</Link>
    </div>
  );

  const d = report?.diagnosticData || {};
  const s = d.summary || {};
  const auto = d.automationScore || {};
  const c = d.contact || {};
  const recs = d.recommendations || [];
  const processes = d.processes || [];
  const storedMode = d.diagnosticMode;
  const costAnalysisPending = d.costAnalysisStatus === 'pending';
  const hasNoCostData = (s.totalAnnualCost ?? 0) === 0 && (processes || []).every((p) => (p.annualCost ?? 0) === 0);
  const isMapOnly = storedMode === 'map-only' || (storedMode == null && hasNoCostData);
  const isManagerTokenView = !!tokenFromUrl;
  const showCostData = !isMapOnly && !costAnalysisPending && (hasNoCostData === false || (s.totalAnnualCost ?? 0) > 0) && (isManagerTokenView || d.costSharedWithOwner === true);

  const costEditToken = tokenFromUrl || d.costAnalysisToken;
  const costEditUrl = id
    ? (costEditToken
      ? `/cost-analysis?id=${id}&token=${encodeURIComponent(costEditToken)}`
      : (typeof window !== 'undefined' ? sessionStorage.getItem('costAnalysisUrl_' + id) : null) || `/cost-analysis?id=${id}`)
    : null;

  const redesign = d.redesign || null;
  const p0 = redesign?.optimisedProcesses?.[0];
  const redesignTitle = (p0?.processName || p0?.name)
    ? `${p0.processName || p0.name} - Operating Model Redesign`
    : 'Operating Model Redesign';
  const rawProcesses = d.rawProcesses || [];
  const industry = rawProcesses[0]?.industry || processes[0]?.industry || c.industry || d.industry || null;
  const segment = c.segment || null;
  const SEGMENT_REPORT_META = {
    scaling: { label: 'Scaling Business', color: '#0d9488' },
    ma: { label: 'M&A Integration', color: '#6366f1' },
    pe: { label: 'Private Equity', color: '#8b5cf6' },
    highstakes: { label: 'High-stakes Event', color: '#d97706' },
  };
  const segmentMeta = segment ? SEGMENT_REPORT_META[segment] : null;
  const benchmark = BENCHMARK_DATA[industry] || null;
  const processSections = (processes || []).map((proc, i) => {
    const raw = rawProcesses[i] || proc;
    const steps = raw.steps || proc.steps || [];
    const handoffs = raw.handoffs || proc.handoffs || [];
    const depts = [...new Set(steps.map((s) => s.department).filter(Boolean))];
    const deptCount = depts.length;
    const deptLabel = deptCount > 0 ? depts.slice(0, 3).join(', ') + (deptCount > 3 ? ` +${deptCount - 3}` : '') : ' - ';
    const systems = [...new Set(steps.flatMap((s) => s.systems || []))];
    const sysCount = systems.length;
    const handoffCount = steps.reduce((count, step, i) => {
      if (i === 0) return count;
      const prevDept = steps[i - 1]?.department;
      const currDept = step?.department;
      return (prevDept && currDept && prevDept !== currDept) ? count + 1 : count;
    }, 0);
    const allChecks = steps.flatMap(s => s.checklist || []);
    const checksDone = allChecks.filter(c => c.checked).length;
    const checksTotal = allChecks.length;

    const decisionCount = steps.filter(s => s.isDecision && (s.branches || []).length > 0).length;
    const approvalCount = steps.filter(s => s.isApproval).length;
    const externalCount = steps.filter(s => s.isExternal).length;
    const significantBottlenecks = getSignificantBottlenecks(raw);
    const bottleneckCount = significantBottlenecks.length;

    const totalWork = steps.reduce((sum, s) => sum + (s.workMinutes ?? 0), 0);
    const totalWait = steps.reduce((sum, s) => sum + (s.waitMinutes ?? 0), 0);
    const workPct = (totalWork > 0 || totalWait > 0)
      ? Math.round((totalWork / (totalWork + totalWait)) * 100)
      : null;
    const workWaitRatio = workPct !== null ? `${workPct}%` : 'N/A';
    const workWaitDrill = workPct !== null
      ? `${workPct}% touch time — ${Math.round(totalWork)}m touch, ${Math.round(totalWait)}m dwell (item age)`
      : 'N/A';

    const procAuto = calculateAutomationScore([raw]);

    // ── Feature 6: Complexity score ──
    const complexityRaw = (decisionCount * 2) + (bottleneckCount * 2) + deptCount + Math.round(handoffCount * 0.5) + externalCount;
    const complexityLabel = complexityRaw <= 3 ? 'Low' : complexityRaw <= 7 ? 'Medium' : complexityRaw <= 12 ? 'High' : 'Very High';
    const complexityColor = complexityRaw <= 3 ? '#059669' : complexityRaw <= 7 ? '#d97706' : complexityRaw <= 12 ? '#ea580c' : '#dc2626';

    // ── Feature 7: Timeline estimate ──
    const totalMinutes = totalWork + totalWait;
    const timelineStr = totalMinutes > 0
      ? (totalMinutes >= 1440
        ? `${(totalMinutes / 1440).toFixed(1)} days`
        : totalMinutes >= 60
        ? `${Math.round(totalMinutes / 60)}h`
        : `${Math.round(totalMinutes)}m`)
      : null;

    /* Summary metrics — grouped by theme */
    const summaryMetrics = (
      <div className="report-metric-groups">
        {/* Group 1: Process Structure */}
        <div className="report-metric-group">
          <p className="report-metric-group-label">Process Structure</p>
          <div className="report-metric-grid report-metric-grid-4">
            <MetricCard metricKey="stepsMapped" value={(steps.length || proc.stepsCount) ?? ' - '} label="Steps" onClick={setMetricDrill} />
            <MetricCard metricKey="teamsInvolved" value={deptCount > 0 ? deptCount : ' - '} drillValue={depts.length > 0 ? depts : undefined} label="Teams involved" onClick={setMetricDrill} />
            <MetricCard metricKey="handoffs" value={handoffCount} label="Handoffs" onClick={setMetricDrill} />
            {decisionCount > 0 && <MetricCard metricKey="decisionPoints" value={decisionCount} label="Decision points" onClick={setMetricDrill} />}
            {approvalCount > 0 && <MetricCard metricKey="approvals" value={approvalCount} label="Approvals" onClick={setMetricDrill} />}
            {sysCount > 0 && <MetricCard metricKey="systems" value={sysCount} label="Systems" onClick={setMetricDrill} />}
            {externalCount > 0 && <MetricCard metricKey="externalDependencies" value={externalCount} label="External dependencies" onClick={setMetricDrill} />}
          </div>
        </div>

        {/* Group 2: Time & Efficiency */}
        <div className="report-metric-group">
          <p className="report-metric-group-label">Time &amp; Efficiency</p>
          <div className="report-metric-grid report-metric-grid-4">
            {(!isMapOnly && !costAnalysisPending) && <MetricCard metricKey="averageCycle" value={proc.elapsedDays > 0 ? `${proc.elapsedDays} days` : ' - '} label="Actual cycle time" onClick={setMetricDrill} />}
            {timelineStr && <MetricCard metricKey="timelineEstimate" value={timelineStr} drillValue={`${timelineStr} estimated end-to-end${proc.elapsedDays > 0 ? ` · actual: ${proc.elapsedDays} days` : ''}`} label="Est. end-to-end" onClick={setMetricDrill} />}
            <MetricCard metricKey="workWaitRatio" value={workWaitRatio} drillValue={workWaitDrill} label="Touch / Dwell" onClick={setMetricDrill} />
            {bottleneckCount > 0 && <MetricCard metricKey="bottlenecks" value={bottleneckCount} label="Bottlenecks flagged" onClick={setMetricDrill} />}
          </div>
        </div>

        {/* Group 3: Assessment */}
        <div className="report-metric-group">
          <p className="report-metric-group-label">Assessment</p>
          <div className="report-metric-grid">
            <MetricCard metricKey="automationReadiness" value={`${procAuto.percentage ?? 0}%`} drillValue={`${procAuto.percentage ?? 0}% (${procAuto.grade || 'N/A'})`} label="Automation readiness" title={procAuto.insight} onClick={setMetricDrill} valueStyle={{ color: getAutomationReadinessColor(procAuto.percentage ?? 0) }} />
            <MetricCard metricKey="complexity" value={complexityLabel} drillValue={`${complexityLabel} (score: ${complexityRaw})`} label="Complexity" title={`Score: ${complexityRaw} — decisions×2 + bottlenecks×2 + teams + handoffs×0.5 + external steps`} onClick={setMetricDrill} valueStyle={{ color: complexityColor }} />
            {(!isMapOnly && !costAnalysisPending) && (
              <MetricCard
                metricKey="confidence"
                value={<span className={`confidence-badge confidence-${(proc.quality?.grade || 'medium').toLowerCase()}`}>{proc.quality?.grade || 'MEDIUM'}</span>}
                drillValue={`${proc.quality?.grade || 'MEDIUM'} (${proc.quality?.score ?? ' - '}/100)`}
                label={`Confidence (${(proc.quality?.score ?? ' - ')}/100)`}
                onClick={setMetricDrill}
              />
            )}
            {checksTotal > 0 && <MetricCard metricKey="checklistItems" value={`${checksDone}/${checksTotal}`} label="Checklist items" onClick={setMetricDrill} />}
          </div>
        </div>
      </div>
    );

    // ── Feature 1: Process Health Indicator ──
    let healthStatus, healthReason;
    if (bottleneckCount > 0 && (procAuto.percentage < 30 || (totalWork > 0 && totalWait > totalWork * 2))) {
      healthStatus = 'red';
      healthReason = bottleneckCount > 0 && procAuto.percentage < 30
        ? 'bottlenecks detected with low automation coverage'
        : 'bottlenecks detected with high wait-to-work ratio';
    } else if (bottleneckCount > 0 || procAuto.percentage < 50 || approvalCount >= 3) {
      healthStatus = 'amber';
      healthReason = bottleneckCount > 0
        ? `${bottleneckCount} bottleneck${bottleneckCount > 1 ? 's' : ''} identified`
        : approvalCount >= 3
        ? `${approvalCount} approval steps may slow throughput`
        : `automation readiness at ${procAuto.percentage ?? 0}%`;
    } else {
      healthStatus = 'green';
      healthReason = 'no critical issues detected';
    }
    const healthLabel = healthStatus === 'red' ? 'At Risk' : healthStatus === 'amber' ? 'Needs Attention' : 'Healthy';
    const healthIndicator = (
      <div className={`report-health-indicator health-${healthStatus}`}>
        <span className="report-health-dot" />
        <span className="report-health-label">{healthLabel}</span>
        <span className="report-health-reason">— {healthReason}</span>
      </div>
    );

    // ── Bottleneck analysis ──
    const detectedBottlenecks = detectBottlenecks(raw);
    const highBottlenecks     = detectedBottlenecks.filter(b => b.risk === 'high');
    const medBottlenecks      = detectedBottlenecks.filter(b => b.risk === 'medium');

    const RISK_META = {
      high:   { label: 'High risk',   color: '#dc2626', bg: '#fee2e2', darkBg: 'rgba(220,38,38,0.12)', darkColor: '#fca5a5' },
      medium: { label: 'Medium risk', color: '#d97706', bg: '#fef3c7', darkBg: 'rgba(217,119,6,0.12)',  darkColor: '#fcd34d' },
      low:    { label: 'Low risk',    color: '#6b7280', bg: '#f3f4f6', darkBg: 'rgba(107,114,128,0.12)', darkColor: '#d1d5db' },
    };

    const bottleneckAnalysis = detectedBottlenecks.length > 0 ? (
      <div className="report-process-extra-section report-bottleneck-section">
        <details className="report-bottleneck-collapsible" open={detectedBottlenecks.length <= 8}>
          <summary className="report-bottleneck-summary">
            <span className="report-bottleneck-summary-title">Bottleneck Analysis</span>
            <span className="report-bottleneck-summary-count">
              {highBottlenecks.length > 0 && <span className="report-bottleneck-summary-high">{highBottlenecks.length} high</span>}
              {highBottlenecks.length > 0 && medBottlenecks.length > 0 && ' · '}
              {medBottlenecks.length > 0 && <span className="report-bottleneck-summary-med">{medBottlenecks.length} medium</span>}
              {highBottlenecks.length === 0 && medBottlenecks.length === 0 && `${detectedBottlenecks.length} identified`}
            </span>
            <span className="report-bottleneck-summary-chevron" aria-hidden>▼</span>
          </summary>
          <div className="report-bottleneck-content">
            {(() => {
              const sorted = [...detectedBottlenecks].sort((a, b) => b.waitMinutes - a.waitMinutes);
              const totalWait = sorted.reduce((s, b) => s + b.waitMinutes, 0);
              const maxWait = sorted[0]?.waitMinutes || 1;
              return (
                <div className="report-bottleneck-list">
                  {sorted.map((b, bi) => {
                    const meta = RISK_META[b.risk];
                    if (!meta) return null;
                    const barPct = Math.round(b.waitMinutes / maxWait * 100);
                    const sharePct = totalWait > 0 ? Math.round(b.waitMinutes / totalWait * 100) : 0;
                    return (
                      <details key={bi} className="report-bottleneck-item">
                        <summary className="report-bottleneck-header">
                          <span className="report-bottleneck-num">{b.stepIndex + 1}</span>
                          <div className="report-bn-chart-row">
                            <div className="report-bn-chart-name-row">
                              <span className="report-bottleneck-name">{b.stepName}</span>
                              {b.isSelfReported && (
                                <span className="report-bottleneck-self-flag" title="Also flagged by team">★ flagged</span>
                              )}
                              {b.waitType && (
                                <span className={`report-bn-dwell-type report-bn-dwell-${b.waitType}`} title={
                                  b.waitType === 'dependency' ? 'Dependency — item is with another person/team; cannot proceed until they finish' :
                                  b.waitType === 'blocked'    ? 'Blocked — item cannot proceed (missing info, unclear input, process issue)' :
                                  b.waitType === 'capacity'   ? 'Capacity — right person identifiable but unavailable' :
                                  'WIP — person available but context-switched to other concurrent work'
                                }>{b.waitType === 'wip' ? 'WIP' : b.waitType.charAt(0).toUpperCase() + b.waitType.slice(1)}</span>
                              )}
                              <span className="report-bottleneck-risk" style={{ background: meta.bg, color: meta.color }}>
                                {meta.label}
                              </span>
                            </div>
                            <div className="report-bn-chart-bar-row">
                              <div className="report-bn-chart-bar-wrap">
                                <div
                                  className="report-bn-chart-bar"
                                  style={{ width: `${barPct}%`, background: meta.color }}
                                />
                              </div>
                              <span className="report-bn-chart-mins">{b.waitMinutes}m</span>
                              <span className="report-bn-chart-pct">{sharePct}%</span>
                            </div>
                          </div>
                          <span className="report-bottleneck-expand-icon" aria-hidden>›</span>
                        </summary>
                        <ul className="report-bottleneck-reasons">
                          {b.reasons.map((reason, ri) => (
                            <li key={ri}>{reason}</li>
                          ))}
                        </ul>
                      </details>
                    );
                  })}
                </div>
              );
            })()}

            {detectedBottlenecks.some(b => b.isSelfReported) && (
              <p className="report-bottleneck-note">
                ★ Steps also flagged by the team as a bottleneck.
              </p>
            )}
          </div>
        </details>
      </div>
    ) : (
      <div className="report-process-extra-section report-bottleneck-section">
        <details className="report-bottleneck-collapsible">
          <summary className="report-bottleneck-summary">
            <span className="report-bottleneck-summary-title">Bottleneck Analysis</span>
            <span className="report-bottleneck-summary-count report-bottleneck-summary-none">None detected</span>
            <span className="report-bottleneck-summary-chevron" aria-hidden>▼</span>
          </summary>
          <div className="report-bottleneck-content">
            <p className="report-bottleneck-none">No significant bottleneck signals detected in this process.</p>
          </div>
        </details>
      </div>
    );

    // ── Feature 2: Automation breakdown by step (grouped, collapsible) ──
    const AUTO_GROUP_ORDER = ['multi-agent', 'agent', 'human-loop', 'simple', null];
    const AUTO_GROUP_META = {
      'multi-agent': { label: 'Multi-Agent System',  badge: 'M', color: '#be185d', bg: '#fdf2f8', desc: 'Requires coordinated agents across multiple teams or systems.' },
      'agent':       { label: 'AI Agent',             badge: 'A', color: '#7c3aed', bg: '#f5f3ff', desc: 'An autonomous AI agent can handle this end-to-end.' },
      'human-loop':  { label: 'Agent + Human Review', badge: 'H', color: '#ea580c', bg: '#fff7ed', desc: 'Agent does the work; human reviews or approves.' },
      'simple':      { label: 'Simple Automation',    badge: 'S', color: '#0891b2', bg: '#ecfeff', desc: 'Rule-based or workflow automation — no AI needed.' },
      null:          { label: 'Manual',               badge: '—', color: '#94a3b8', bg: '#f8fafc', desc: 'No automation opportunity identified for these steps.' },
    };

    const autoGroups = {};
    steps.forEach((step, si) => {
      const cat = classifyAutomation(step, si, raw);
      const key = cat ? cat.key : null;
      if (!autoGroups[key]) autoGroups[key] = [];
      autoGroups[key].push({ step, si, cat });
    });

    const autoBreakdown = steps.length > 0 ? (
      <div className="report-process-extra-section">
        <p className="report-section-heading">Automation Opportunities</p>
        <div className="report-auto-groups">
          {AUTO_GROUP_ORDER.filter(k => autoGroups[k]?.length).map(groupKey => {
            const meta    = AUTO_GROUP_META[groupKey];
            const members = autoGroups[groupKey];
            const groupId = `auto-group-${i}-${groupKey ?? 'manual'}`;
            return (
              <details key={groupKey ?? 'manual'} className="report-auto-group">
                <summary className="report-auto-group-summary">
                  <span className="report-auto-group-badge" style={{ background: meta.color }}>{meta.badge}</span>
                  <span className="report-auto-group-label" style={{ color: meta.color }}>{meta.label}</span>
                  <span className="report-auto-group-count">{members.length} step{members.length !== 1 ? 's' : ''}</span>
                  <span className="report-auto-group-desc">{meta.desc}</span>
                  <span className="report-auto-group-chevron">›</span>
                </summary>
                <div className="report-auto-step-list">
                  {members.map(({ step, si, cat }) => (
                    <div key={si} className="report-auto-step-row">
                      <span className="report-auto-step-num">{si + 1}.</span>
                      <span className="report-auto-step-name">{step.name || `Step ${si + 1}`}</span>
                      {cat?.reason && <span className="report-auto-step-reason">{cat.reason}</span>}
                    </div>
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      </div>
    ) : null;

    // ── Feature 3: Recommendations grouped by theme ──
    const normRecs = normalizeRecommendations(recs);
    const procRecs = normRecs
      .filter(r => r.process === proc.name || r.process === raw.processName || r.process === 'Cross-process' || r.process === 'Overall')
      .sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 };
        return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
      });

    const REC_GROUP_META = {
      'quick-win': { label: 'Quick Wins',        icon: '⚡', desc: 'Low effort, high impact — do these first.' },
      'medium':    { label: 'Medium-term',        icon: '🎯', desc: 'Worth planning into the next cycle.' },
      'project':   { label: 'Longer-term',        icon: '🔧', desc: 'Require more planning or investment.' },
      'other':     { label: 'Other',              icon: '📋', desc: '' },
    };
    const recsByEffort = {};
    procRecs.forEach(r => {
      const key = ['quick-win', 'medium', 'project'].includes(r.effortLevel) ? r.effortLevel : 'other';
      if (!recsByEffort[key]) recsByEffort[key] = [];
      recsByEffort[key].push(r);
    });

    const recsBlock = procRecs.length > 0 ? (
      <div className="report-process-extra-section">
        <p className="report-section-heading">Recommendations</p>
        <div className="report-rec-groups">
          {['quick-win', 'medium', 'project', 'other'].filter(k => recsByEffort[k]?.length).map(effortKey => {
            const meta = REC_GROUP_META[effortKey];
            return (
              <details key={effortKey} className="report-rec-group" open={effortKey === 'quick-win'}>
                <summary className="report-rec-group-summary">
                  <span className="report-rec-group-icon">{meta.icon}</span>
                  <span className="report-rec-group-label">{meta.label}</span>
                  <span className="report-rec-group-count">{recsByEffort[effortKey].length}</span>
                  {meta.desc && <span className="report-rec-group-desc">{meta.desc}</span>}
                  <span className="report-auto-group-chevron">›</span>
                </summary>
                <div className="report-rec-list">
                  {recsByEffort[effortKey].map((r, ri) => (
                    <div key={ri} className="report-rec-card">
                      {r.severity && <span className={`report-severity-pill sev-${r.severity}`}>{r.severity}</span>}
                      <span className="report-rec-text">{r.action || r.text}</span>
                    </div>
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      </div>
    ) : null;

    // ── Feature 4: Department workload split ──
    const deptWorkload = deptCount > 1 ? (() => {
      const deptData = {};
      for (const step of steps) {
        const deptName = step.department || 'Unassigned';
        if (!deptData[deptName]) deptData[deptName] = { steps: 0, work: 0, wait: 0 };
        deptData[deptName].steps += 1;
        deptData[deptName].work  += step.workMinutes ?? 0;
        deptData[deptName].wait  += step.waitMinutes ?? 0;
      }
      const deptEntries = Object.entries(deptData).sort((a, b) => b[1].steps - a[1].steps);
      const totalSteps = steps.length || 1;
      const totalWork  = deptEntries.reduce((s, [, d]) => s + d.work, 0);
      const totalWait  = deptEntries.reduce((s, [, d]) => s + d.wait, 0);
      const hasWork    = totalWork > 0;
      const hasWait    = totalWait > 0;
      const fmtMin     = (m) => m >= 60 ? `${Math.round(m / 60)}h` : `${Math.round(m)}m`;

      const BarChart = ({ title, entries, getValue, getTotal, fmtValue, barColor }) => {
        const total = getTotal();
        const sorted = [...entries].sort((a, b) => getValue(b[1]) - getValue(a[1]));
        return (
          <div className="report-dept-chart">
            <p className="report-dept-chart-title">{title}</p>
            <div className="report-dept-bars">
              {sorted.map(([dept, data], di) => {
                const val  = getValue(data);
                const pct  = total > 0 ? Math.round((val / total) * 100) : 0;
                const color = typeof barColor === 'function' ? barColor(di) : barColor;
                return (
                  <div key={dept} className="report-dept-bar-row">
                    <span className="report-dept-bar-label" title={dept}>
                      <span className="report-dept-bar-dot" style={{ background: DEPT_PALETTE[di % DEPT_PALETTE.length] }} />
                      {dept}
                    </span>
                    <div className="report-dept-bar-track">
                      <div className="report-dept-bar-fill" style={{ width: `${pct}%`, background: color }} />
                    </div>
                    <span className="report-dept-bar-pct">
                      {fmtValue(val)} <span className="report-dept-bar-pct-sub">({pct}%)</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      };

      return (
        <div className="report-process-extra-section">
          <p className="report-section-heading">Team Workload Split</p>
          <div className="report-dept-charts-grid">
            <BarChart
              title="Steps owned"
              entries={deptEntries}
              getValue={(d) => d.steps}
              getTotal={() => totalSteps}
              fmtValue={(v) => `${v}`}
              barColor={(di) => DEPT_PALETTE[di % DEPT_PALETTE.length]}
            />
            {hasWork && (
              <BarChart
                title="Work time"
                entries={deptEntries}
                getValue={(d) => d.work}
                getTotal={() => totalWork}
                fmtValue={(v) => v > 0 ? fmtMin(v) : '—'}
                barColor={(di) => DEPT_PALETTE[di % DEPT_PALETTE.length]}
              />
            )}
            {hasWait && (
              <BarChart
                title="Wait time"
                entries={deptEntries}
                getValue={(d) => d.wait}
                getTotal={() => totalWait}
                fmtValue={(v) => v > 0 ? fmtMin(v) : '—'}
                barColor="#f59e0b"
              />
            )}
          </div>
        </div>
      );
    })() : null;

    // ── Feature 5: Benchmark callout ──
    const benchmarkBlock = (benchmark && proc.elapsedDays > 0) ? (() => {
      const cycleVsMedian = proc.elapsedDays <= benchmark.cycleDays.best
        ? { label: `${proc.elapsedDays}d (best-in-class)`, good: true }
        : proc.elapsedDays <= benchmark.cycleDays.median
        ? { label: `${proc.elapsedDays}d (below median)`, good: true }
        : proc.elapsedDays <= benchmark.cycleDays.worst
        ? { label: `${proc.elapsedDays}d (above median)`, good: false }
        : { label: `${proc.elapsedDays}d (outlier)`, good: false };
      const handoffVsOptimal = handoffCount <= benchmark.optimalHandoffs
        ? { label: `${handoffCount} (within optimal)`, good: true }
        : { label: `${handoffCount} (above optimal ${benchmark.optimalHandoffs})`, good: false };
      return (
        <div className="report-process-extra-section">
          <p className="report-section-heading">Industry Benchmark · {industry}</p>
          <div className="report-benchmark-row">
            <div className="report-benchmark-stat">
              <span className="report-benchmark-stat-label">Cycle time</span>
              <span className={`report-benchmark-stat-value ${cycleVsMedian.good ? 'report-benchmark-good' : 'report-benchmark-warn'}`}>
                {cycleVsMedian.label}
              </span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-mid)' }}>
                Median: {benchmark.cycleDays.median}d · Best: {benchmark.cycleDays.best}d
              </span>
            </div>
            <div className="report-benchmark-stat">
              <span className="report-benchmark-stat-label">Handoffs</span>
              <span className={`report-benchmark-stat-value ${handoffVsOptimal.good ? 'report-benchmark-good' : 'report-benchmark-warn'}`}>
                {handoffVsOptimal.label}
              </span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-mid)' }}>
                Optimal: ≤{benchmark.optimalHandoffs}
              </span>
            </div>
          </div>
        </div>
      );
    })() : null;

    const summaryInnerTabs = [
      {
        id: 'overview',
        label: 'Overview',
        content: (
          <div className="report-summary-inner-tab">
            {summaryMetrics}
          </div>
        ),
      },
      {
        id: 'bottlenecks',
        label: `Bottlenecks${detectedBottlenecks.length > 0 ? ` (${detectedBottlenecks.length})` : ''}`,
        content: <div className="report-summary-inner-tab">{bottleneckAnalysis}</div>,
      },
      ...(deptWorkload ? [{
        id: 'workload',
        label: 'Team Workload',
        content: <div className="report-summary-inner-tab">{deptWorkload}</div>,
      }] : []),
      ...(autoBreakdown ? [{
        id: 'automation',
        label: 'Automation',
        content: <div className="report-summary-inner-tab">{autoBreakdown}</div>,
      }] : []),
    ];

    return (
      <div key={i} className="report-process-summary-block">
        {healthIndicator}
        <ReportSectionTabs tabs={summaryInnerTabs} defaultTab="overview" />
      </div>
    );
  });

  return (
    <div className="report-page">
      {/* Top bar */}
      <div className="top-bar">
        <div className="top-bar-inner">
          <div className="top-bar-left">
            <a href="/">Vesno<span className="top-bar-brand-dot">.</span></a>
            <div className="top-bar-divider" />
            <span className="top-bar-title">Report</span>
          </div>
          <div className="top-bar-nav">
            <ThemeToggle className="top-bar-theme-btn" />
            {!isClientView && id && (
              <button type="button" className="top-bar-link" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} onClick={() => window.open(`/api/export-pdf?id=${encodeURIComponent(id)}`)}>Export PDF</button>
            )}
            {!isClientView && id && <Link href={`/process-audit?edit=${id}`} className="top-bar-link">Edit</Link>}
            {!isClientView && (sessionUser?.email ? (
              <>
                <Link href="/portal" className="top-bar-link">Portal</Link>
                <span className="top-bar-email">{sessionUser.email}</span>
                <button type="button" className="top-bar-btn" onClick={sessionSignOut}>Sign Out</button>
              </>
            ) : (
              <Link href="/portal" className="top-bar-link">Client Login</Link>
            ))}
          </div>
        </div>
      </div>

      <div className="report-container">
        {/* Progress bar */}
        <div className="report-progress-bar">
          <div className="report-progress-row">
            <div className="progress-track"><div className="progress-fill" style={{ width: '100%' }} /></div>
            <Link href={`/portal?mode=signup&email=${encodeURIComponent(contactEmail)}`} className="report-save-btn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
              Save & get link
            </Link>
          </div>
          <div className="progress-text">Complete!</div>
        </div>

        <div className="report-card">
          {/* Hero */}
          {(() => {
            const company = c.company || d.company || null;
            const industry = rawProcesses[0]?.industry || processes[0]?.industry || c.industry || d.industry || null;
            return (
              <div className="report-hero">
                <div className="report-hero-icon" style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 700, fontSize: '1.6rem', color: 'var(--text)' }}>Vesno<span style={{ color: 'var(--gold, #b45309)' }}>.</span></div>
                <h1 className="report-title">{redesign ? redesignTitle : `${(processes[0]?.name || rawProcesses[0]?.processName || 'Process')} Audit`}</h1>
                {(company || industry || segmentMeta) && (
                  <div className="report-hero-meta">
                    {segmentMeta && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 4, background: segmentMeta.color + '22', color: segmentMeta.color, letterSpacing: '0.05em', textTransform: 'uppercase', marginRight: 8 }}>
                        {segmentMeta.label}
                      </span>
                    )}
                    {company && <span className="report-hero-company">{company}</span>}
                    {company && industry && <span className="report-hero-meta-sep">·</span>}
                    {industry && <span className="report-hero-industry">{industry}</span>}
                  </div>
                )}
              </div>
            );
          })()}

{!isClientView && !redesign && report?.costDataHiddenToOwner && (
            <div className="report-cost-hidden-notice" style={{ background: 'rgba(100,116,139,0.08)', border: '1px solid rgba(100,116,139,0.2)', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: '0.9rem', color: 'var(--text-mid)' }}>
              Cost analysis has been completed by your manager. Cost data is only visible to managers and those they share the report with.
            </div>
          )}

          {!isClientView && (
            <div className="report-ai-disclaimer">
              AI-generated from the information you provided — a starting point, not a final recommendation. <a href="mailto:hope@vesno.ai?subject=Redesign%20consultation">Book a free consultation</a> to validate with our team.
            </div>
          )}

          {/* Segment-specific insight box */}
          {segmentMeta && (() => {
            const SEGMENT_INSIGHTS = {
              pe: {
                icon: '📊',
                heading: 'Private Equity Lens',
                items: [
                  'Review the redesign savings estimates for data-room readiness — each saving should be defensible with a clear formula.',
                  'Automation-ready steps (flagged above) represent the fastest path to EBITDA improvement within your investment horizon.',
                  'Cross-department handoffs are a common source of margin leakage — prioritise eliminating them before exit.',
                ],
              },
              ma: {
                icon: '🔗',
                heading: 'M&A Integration Lens',
                items: [
                  'Steps with undocumented ownership are integration risks — flag these for your Day 1 readiness checklist.',
                  'Manual handoffs between teams are the most common source of process failure during entity integration.',
                  'Use the handover feature to capture both entity perspectives on any shared process before integration.',
                ],
              },
              highstakes: {
                icon: '⏱',
                heading: 'Go-live Readiness Lens',
                items: [
                  'Prioritise eliminating single points of failure — any step with one responsible person and no documented backup.',
                  'Quick-win recommendations above can be actioned before the go-live deadline.',
                  'Document decision steps explicitly — unclear decision criteria are the most common cause of go-live delays.',
                ],
              },
              scaling: {
                icon: '📈',
                heading: 'Scaling Lens',
                items: [
                  'High-frequency steps with manual work will compound as volume grows — prioritise automating these first.',
                  'Steps with cross-department handoffs create bottlenecks at scale — consolidate or automate the handoff.',
                  'Processes where one person is responsible for multiple steps are delegation blockers as the team grows.',
                ],
              },
            };
            const insight = SEGMENT_INSIGHTS[segment];
            if (!insight) return null;
            return (
              <div style={{ background: segmentMeta.color + '11', border: `1px solid ${segmentMeta.color}33`, borderRadius: 8, padding: '14px 18px', marginBottom: 16 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: segmentMeta.color, marginBottom: 8 }}>{insight.icon} {insight.heading}</p>
                <ul style={{ margin: 0, padding: '0 0 0 16px', listStyle: 'disc' }}>
                  {insight.items.map((item, i) => (
                    <li key={i} style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 4 }}>{item}</li>
                  ))}
                </ul>
              </div>
            );
          })()}

          {/* Re-audit delta — compare this audit to the original */}
          {parentReport && (() => {
            const pd = parentReport.diagnosticData || {};
            const ps = pd.summary || {};
            const pa = pd.automationScore || {};
            const costDelta = (s.totalAnnualCost || 0) - (ps.totalAnnualCost || 0);
            const autoDelta = Math.round((auto.percentage || 0) - (pa.percentage || 0));
            const hasDelta = costDelta !== 0 || autoDelta !== 0;
            if (!hasDelta) return null;
            return (
              <div className="report-redesign-delta" style={{ marginBottom: 16 }}>
                <p className="report-redesign-delta-heading">Re-audit Comparison vs Original</p>
                <div className="report-delta-grid">
                  {costDelta !== 0 && (
                    <div className="report-delta-item">
                      <span className="report-delta-item-label">Cost change</span>
                      <span className="report-delta-item-value" style={{ color: costDelta < 0 ? '#16a34a' : '#dc2626' }}>
                        {costDelta < 0 ? '−' : '+'}{formatCurrency(Math.abs(costDelta))}
                      </span>
                    </div>
                  )}
                  {autoDelta !== 0 && (
                    <div className="report-delta-item">
                      <span className="report-delta-item-label">Automation change</span>
                      <span className="report-delta-item-value" style={{ color: autoDelta > 0 ? '#16a34a' : '#dc2626' }}>
                        {autoDelta > 0 ? '+' : ''}{autoDelta}%
                      </span>
                    </div>
                  )}
                  <div className="report-delta-item">
                    <span className="report-delta-item-label">Original audit</span>
                    <span className="report-delta-item-value" style={{ fontSize: 12 }}>
                      <a href={`/report?id=${parentReport.id}`} style={{ color: 'var(--accent)' }}>View →</a>
                    </span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Feature 8: Redesign Delta — before/after summary when redesign exists */}
          {redesign && (() => {
            // Use effectiveMetrics from RedesignSection (synced via onEffectiveMetrics callback)
            // so this stays consistent with the Summary & Metrics tab which respects decisions
            const em = syncedRedesignMetrics || {};
            const origSteps = em.originalStepsCount
              ?? (rawProcesses.reduce((sum, p) => sum + (p.steps?.length ?? 0), 0) || null);
            const optSteps = em.optimisedStepsCount
              ?? (redesign.optimisedProcesses?.reduce((sum, p) => sum + (p.steps?.length ?? 0), 0) || null);
            const stepsRemoved = em.stepsRemoved ?? (origSteps != null && optSteps != null ? origSteps - optSteps : null);
            const stepsAutomated = em.stepsAutomated ?? null;
            const timeSaved = em.estimatedTimeSavedPercent ?? null;
            const hasContent = origSteps != null || stepsRemoved != null || timeSaved != null;
            if (!hasContent) return null;
            return (
              <div className="report-redesign-delta">
                <p className="report-redesign-delta-heading">Redesign Impact Summary</p>
                <div className="report-delta-grid">
                  {origSteps != null && optSteps != null && (
                    <div className="report-delta-item">
                      <span className="report-delta-item-label">Steps</span>
                      <span className="report-delta-item-value">{origSteps} → {optSteps}</span>
                    </div>
                  )}
                  {stepsRemoved != null && stepsRemoved > 0 && (
                    <div className="report-delta-item">
                      <span className="report-delta-item-label">Steps removed</span>
                      <span className="report-delta-item-value">−{stepsRemoved}</span>
                    </div>
                  )}
                  {stepsAutomated != null && stepsAutomated > 0 && (
                    <div className="report-delta-item">
                      <span className="report-delta-item-label">Steps automated</span>
                      <span className="report-delta-item-value">{stepsAutomated}</span>
                    </div>
                  )}
                  {timeSaved != null && (
                    <div className="report-delta-item">
                      <span className="report-delta-item-label">Time saved</span>
                      <span className="report-delta-item-value">{timeSaved}%</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Main report sections as clickable tabs  -  Summary, Cost Summary, Process Flow Diagrams, etc. on one line */}
          {(() => {
            const reportTabs = [];
            if (!redesign) {
              reportTabs.push({
                id: 'summary',
                label: 'Summary',
                content: <div className="report-summary-tab-content">{processSections}</div>,
              });
            }
            if (!isClientView && !redesign && showCostData && (s.totalAnnualCost > 0 || s.potentialSavings > 0)) {
              reportTabs.push({
                id: 'cost',
                label: 'Cost Summary',
                content: (
                  <div className="report-cost-summary">
                    {costEditUrl && isManagerTokenView && (
                      <Link href={costEditUrl} className="button button-primary report-edit-costs-btn" style={{ marginBottom: 16, display: 'inline-block' }}>
                        Edit costs
                      </Link>
                    )}
                    <div className="report-cost-row">
                      <strong>Total Annual Cost:</strong>
                      <span className="report-cost-value">{formatCurrency(s.totalAnnualCost)}</span>
                    </div>
                    <div className="report-cost-row success">
                      <strong>Potential Annual Savings:</strong>
                      <span className="report-cost-value">{formatCurrency(s.potentialSavings)}</span>
                    </div>
                  </div>
                ),
              });
            }
            reportTabs.push({
              id: 'flows',
              label: 'Process Flow Diagrams',
              content: <FlowDiagramsSection rawProcesses={d.rawProcesses} processes={processes} darkTheme={darkTheme} reportId={id} accessToken={accessToken} />,
            });
            if (!redesign) {
              reportTabs.push({
                id: 'observations',
                label: isMapOnly ? 'Process Insights' : 'Analysis & Recommendations',
                content: <ObservationsContent recs={recs} isMapOnly={isMapOnly} rawProcesses={d.rawProcesses} />,
              });
            }
            if (redesign) {
              reportTabs.push({
                id: 'redesign',
                label: 'Operating Model Redesign',
                content: <RedesignSection redesign={redesign} rawProcesses={rawProcesses} processes={processes} reportId={id} redesignId={redesignId} contactEmail={contactEmail} automationScore={auto} accessToken={accessToken} darkTheme={darkTheme} onRefresh={refreshReport} onEffectiveMetrics={setSyncedRedesignMetrics} />,
              });
            }
            if (redesign?.implementationPriority?.length > 0) {
              reportTabs.push({
                id: 'roadmap',
                label: 'Implementation Roadmap',
                content: (
                  <div className="report-roadmap">
                    {redesign.implementationPriority.map((ip, ipi) => {
                      const isObj = typeof ip === 'object' && ip !== null;
                      const text = isObj
                        ? (ip.action || ip.description || JSON.stringify(ip)).replace(/^\d+\.\s*/, '')
                        : String(ip).replace(/^\d+\.\s*/, '');
                      const effortLabel = isObj && ip.effort
                        ? ip.effort.charAt(0).toUpperCase() + ip.effort.slice(1)
                        : (['Quick Win', 'Short Term', 'Medium Term', 'Long Term', 'Ongoing'])[ipi] || 'Action';
                      const owner = isObj ? ip.owner : null;
                      const icons  = ['⚡', '🎯', '🔧', '🔧', '📐', '🔄'];
                      const colors = ['#0d9488', '#0891b2', '#6366f1', '#8b5cf6', '#d946ef', '#64748b'];
                      const icon  = icons[ipi] || icons[icons.length - 1];
                      const color = colors[ipi % colors.length];
                      return (
                        <div key={ipi} className="report-roadmap-item" style={{ '--roadmap-color': color }}>
                          <div className="report-roadmap-marker">
                            <span className="report-roadmap-icon">{icon}</span>
                            {ipi < redesign.implementationPriority.length - 1 && <div className="report-roadmap-line" />}
                          </div>
                          <div className="report-roadmap-card">
                            <div className="report-roadmap-phase">
                              {effortLabel}
                              {owner && <span className="report-roadmap-owner"> · {owner}</span>}
                            </div>
                            <p className="report-roadmap-text">{text}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ),
              });
            }
            if (!isMapOnly && normalizeRecommendations(recs).length > 0) {
              reportTabs.push({
                id: 'tracker',
                label: 'Implementation Tracker',
                content: (
                  <ImplementationTracker
                    recs={normalizeRecommendations(recs)}
                    currentStatus={report?.implementationStatus || {}}
                    reportId={id}
                    accessToken={accessToken}
                  />
                ),
              });
            }
            // Dependencies tab — show if any process recorded cross-process links
            const allDeps = [...rawProcesses, ...processes].flatMap((p) => p.processDependencies || []);
            const uniqueDeps = allDeps.filter((d, i, arr) => arr.findIndex((x) => x.fromProcess === d.fromProcess && x.toProcess === d.toProcess && x.type === d.type) === i);
            if (uniqueDeps.length > 0) {
              const DEP_LABELS = { feeds_into: '→ Feeds into', receives_from: '← Receives from', triggers: '⚡ Triggers', triggered_by: '⚡ Triggered by', shares_data: '⇄ Shares data with', waits_for: '⏳ Waits for' };
              reportTabs.push({
                id: 'dependencies',
                label: 'Process Map',
                content: (
                  <div className="report-summary-inner-tab">
                    <p style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 16, lineHeight: 1.5 }}>
                      Cross-process connections identified during the audit. These show how this process fits into the broader operating model.
                    </p>
                    <div className="dep-graph">
                      {uniqueDeps.map((dep, i) => (
                        <div key={i} className="dep-graph-row">
                          <div className="dep-graph-node dep-graph-node--from">{dep.fromProcess || 'This process'}</div>
                          <div className="dep-graph-edge">
                            <span className="dep-graph-label">{DEP_LABELS[dep.type] || dep.type}</span>
                          </div>
                          <div className="dep-graph-node dep-graph-node--to">{dep.toProcess}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ),
              });
            }
            if (!isClientView && (sessionUser || fromPortal) && Object.keys(BENCHMARK_DATA).length > 0 && industry && BENCHMARK_DATA[industry]) {
              const bm = BENCHMARK_DATA[industry];
              reportTabs.push({
                id: 'benchmarks',
                label: 'Benchmarks',
                content: (
                  <div className="report-summary-inner-tab">
                    <p style={{ fontSize: 12, color: 'var(--text-mid)', marginBottom: 12, fontStyle: 'italic' }}>
                      Industry benchmarks for <strong>{industry}</strong> — internal reference only, not shown to clients.
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
                      {[
                        { label: 'Best cycle time', value: `${bm.cycleDays.best}d` },
                        { label: 'Median cycle time', value: `${bm.cycleDays.median}d` },
                        { label: 'Worst cycle time', value: `${bm.cycleDays.worst}d` },
                      ].map((m) => (
                        <div key={m.label} style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', textAlign: 'center' }}>
                          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--primary)' }}>{m.value}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-mid)', marginTop: 4 }}>{m.label}</div>
                        </div>
                      ))}
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--text-mid)', marginTop: 12 }}>
                      Optimal handoffs for this industry: <strong>{bm.optimalHandoffs}</strong>
                    </p>
                  </div>
                ),
              });
            }
            reportTabs.push({
              id: 'next',
              label: 'Next Steps',
              content: (
                <>
                  <div className="report-checklist">
                    <div className="report-checklist-item"><span className="report-checklist-icon">&#9744;</span> Review your {redesign ? 'redesign suggestions' : isMapOnly ? 'process map' : 'analysis'} above</div>
                    {redesign && <div className="report-checklist-item"><span className="report-checklist-icon">&#9744;</span> Accept or reject each proposed change</div>}
                    <div className="report-checklist-item"><span className="report-checklist-icon">&#9744;</span> Share with your team to validate</div>
                    {isMapOnly && <div className="report-checklist-item"><span className="report-checklist-icon">&#9744;</span> Run the full analysis to uncover cost & automation opportunities</div>}
                    <div className="report-checklist-item"><span className="report-checklist-icon">&#9744;</span> {redesign ? 'Book a free consultation to refine the redesign' : 'Book a discovery call to discuss your process'}</div>
                  </div>
                  <p style={{ color: 'var(--text-mid)', marginTop: 16, fontSize: '0.88rem' }}>Report emailed to: <strong>{contactEmail || ' - '}</strong></p>
                </>
              ),
            });
            return reportTabs.length > 0 ? (
              <ReportSectionTabs tabs={reportTabs} defaultTab={reportTabs[0].id} />
            ) : null;
          })()}

          {/* Create Account card — only shown to guests */}
          {!sessionUser && (
            <div className="report-gate-card">
              <div className="report-gate-icon">&#128274;</div>
              <h3 className="report-gate-title">Want to view this report again or edit it?</h3>
              <p className="report-gate-text">Create a free client portal account to save your report and access it any time. Also unlocks the full cost analysis, and process redesign.</p>
              <Link href={`/portal?mode=signup&source=map-only&email=${encodeURIComponent(contactEmail)}`} className="report-gate-btn">
                Create Free Account &rarr;
              </Link>
              <p className="report-gate-signin">Already have an account? <Link href="/portal">Sign in &rarr;</Link></p>
            </div>
          )}

          {/* Green banner */}
          {isMapOnly && (
            <div className="report-upgrade-banner">
              <span className="report-upgrade-icon">&#128202;</span>
              <span>Want cost analysis &amp; 90-day transformation roadmap? </span>
              <Link href={`/process-audit?upgrade=${id}&email=${encodeURIComponent(contactEmail)}`} className="report-upgrade-link">Run full analysis &rarr;</Link>
            </div>
          )}

        </div>
      </div>


      <p style={{ padding: '30px 20px', textAlign: 'center', fontSize: '0.9rem', color: 'var(--text-mid)' }}>
        Vesno &middot; <Link href="/">Home</Link> &middot; <Link href="/process-audit">New Process Audit</Link>
      </p>

      {sessionUser && (d.auditTrail || []).length > 0 && (
        <>
          <button type="button" className="audit-trail-toggle" onClick={() => setShowAuditTrail(v => !v)} title="Activity log">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </button>
          {showAuditTrail && <AuditTrailPanel auditTrail={d.auditTrail || []} onClose={() => setShowAuditTrail(false)} />}
        </>
      )}

      {metricDrill && (
        <MetricDrillModal
          metricKey={metricDrill.metricKey}
          value={metricDrill.value}
          label={metricDrill.label}
          onClose={() => setMetricDrill(null)}
        />
      )}
    </div>
  );
}

export default function ReportPage() {
  return (
    <Suspense fallback={<div className="loading-state" style={{ padding: 48, textAlign: 'center' }}><div className="loading-spinner" /><p>Loading...</p></div>}>
      <ReportContent />
    </Suspense>
  );
}
