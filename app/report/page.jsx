'use client';
// Reports are intentionally public (accessible by ID) to support sharing via email links and handovers.

import { useState, useEffect, useMemo, Suspense, useCallback, useRef, forwardRef } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { buildMapObservations } from '@/lib/diagnostic/buildMapObservations';
import { calculateAutomationScore } from '@/lib/diagnostic/buildLocalResults';
import { getAutomationReadinessColor } from '@/lib/diagnostic/automationReadiness';
import { useAuth } from '@/lib/useAuth';
import { useTheme } from '@/components/ThemeProvider';
import ThemeToggle from '@/components/ThemeToggle';
import { apiFetch } from '@/lib/api-fetch';
import InteractiveFlowCanvas from '@/components/flow/InteractiveFlowCanvas';
import FloatingFlowViewer from '@/components/diagnostic/FloatingFlowViewer';
import AuditTrailPanel from '@/components/diagnostic/AuditTrailPanel';
import StepInsightPanel from '@/components/report/StepInsightPanel';
import MetricDrillModal from '@/components/report/MetricDrillModal';

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
  })).filter((r) => r.text);
}

function ObservationsContent({ recs, isMapOnly, rawProcesses }) {
  const items = isMapOnly && rawProcesses?.length
    ? buildMapObservations(rawProcesses)
    : normalizeRecommendations(recs);
  if (items.length === 0) {
    return <p className="report-obs-empty">Review your process map and share with your team to validate the steps.</p>;
  }
  return (
    <>
    <div className="report-obs-list">
      {items.map((r, i) => (
        <div key={i} className="report-obs-item" style={r.color ? { borderLeftColor: r.color } : undefined}>
          <div className="report-obs-header">
            {r.icon && <span className="report-obs-icon" style={{ color: r.color }}>{r.icon}</span>}
            <span className="report-obs-num">{i + 1}</span>
            <span className={`report-obs-badge report-obs-badge-${(r.type || 'general').toLowerCase()}`}>
              {(r.type || 'general').replace(/-/g, ' ')}
            </span>
            {r.severity && (
              <span className={`report-obs-badge report-obs-badge-severity-${r.severity}`}>{r.severity}</span>
            )}
            {r.process && <span className="report-obs-process">{r.process}</span>}
            {r.effortLevel && <span className="report-obs-effort">{r.effortLevel.replace(/-/g, ' ')}</span>}
          </div>
          {r.finding ? (
            <>
              <p className="report-obs-finding"><strong>Finding:</strong> {r.finding}</p>
              <p className="report-obs-action"><strong>Action:</strong> {r.action || r.text}</p>
              {r.estimatedTimeSavedMinutes > 0 && (
                <p className="report-obs-saving">~{r.estimatedTimeSavedMinutes} min saved per run</p>
              )}
            </>
          ) : (
            <p className="report-obs-text">{r.text || ''}</p>
          )}
        </div>
      ))}
    </div>
    </>
  );
}

function CostAnalysisShareCard({ costUrl, reportId, contactName, company }) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState('');

  const handleSend = async () => {
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErr('Please enter a valid email address.');
      return;
    }
    setSending(true);
    setErr('');
    try {
      const res = await fetch('/api/share-cost-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId, managerEmail: email.trim(), costUrl, contactName, company }),
      });
      if (res.ok) { setSent(true); } else { setErr('Failed to send. Please copy the link instead.'); }
    } catch { setErr('Failed to send. Please copy the link instead.'); }
    setSending(false);
  };

  const handleCopy = () => {
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(costUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); });
  };

  return (
    <div className="report-gate-card" style={{ background: 'linear-gradient(135deg, rgba(13,148,136,0.08), rgba(13,148,136,0.04))', border: '1px solid rgba(13,148,136,0.2)' }}>
      <div className="report-gate-icon">&#128200;</div>
      <h3 className="report-gate-title">Assign to manager for cost analysis</h3>
      <p className="report-gate-text">Send a secure link to a senior manager to complete the cost analysis (labour rates, savings). They will add the £ values and the report will then show the full cost summary.</p>
      {sent ? (
        <p style={{ marginTop: 12, color: '#059669', fontWeight: 600, fontSize: '0.9rem' }}>&#10003; Email sent to {email}.</p>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap', marginTop: 12 }}>
          <input
            type="email"
            placeholder="Manager's email address"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setErr(''); }}
            style={{ flex: 1, minWidth: 200, padding: '10px 14px', borderRadius: 8, border: `1px solid ${err ? '#dc2626' : 'var(--border)'}`, fontSize: '0.9rem' }}
          />
          <button type="button" className="button button-primary" onClick={handleSend} disabled={sending} style={{ whiteSpace: 'nowrap', minWidth: 120 }}>
            {sending ? 'Sending…' : 'Send link'}
          </button>
          <button type="button" className="button button-secondary" onClick={handleCopy} style={{ whiteSpace: 'nowrap', minWidth: 120 }}>
            {copied ? '\u2713 Copied' : 'Copy link'}
          </button>
        </div>
      )}
      {err && <p style={{ marginTop: 6, color: '#dc2626', fontSize: '0.82rem' }}>{err}</p>}
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

const FlowDiagramCard = forwardRef(function FlowDiagramCard({ proc, processIndex, viewMode, darkTheme, hideProcessName, hideBuiltInToolbar, onFloat, floatOpen: floatOpenProp, onFloatClose }, ref) {
  const [insightStepIndex, setInsightStepIndex] = useState(null);
  const [localFloatOpen, setLocalFloatOpen] = useState(false);
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
        />
      )}
    </>
  );
});

function FlowDiagramsSection({ rawProcesses, processes, darkTheme }) {
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
          className={`flow-reset-btn report-flow-reset-btn${isWrapped ? ' flow-wrap-btn-active' : ''}`}
          onClick={handleWrapToggle}
          title={isWrapped ? 'Switch to linear' : 'Wrap flow'}
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
                  {(ch.estimatedTimeSavedMinutes > 0 || ch.estimatedCostSavedPercent > 0) && (
                    <div className="report-redesign-change-savings">
                      {ch.estimatedTimeSavedMinutes > 0 && <span>{ch.estimatedTimeSavedMinutes} min saved</span>}
                      {ch.estimatedCostSavedPercent > 0 && <span>{ch.estimatedCostSavedPercent}% cost reduction</span>}
                    </div>
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

function RedesignSection({ redesign, rawProcesses, processes, totalAnnualCost, reportId, redesignId, contactEmail, automationScore, accessToken, darkTheme }) {
  const [viewMode, setViewMode] = useState('grid');
  const [redesignTab, setRedesignTab] = useState('metrics');
  const [decisions, setDecisions] = useState(() => redesign.decisions || {});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [finalising, setFinalising] = useState(false);
  const [finalised, setFinalised] = useState(!!redesign.acceptedAt);
  const [actionError, setActionError] = useState(null);
  const [showRejectPrompt, setShowRejectPrompt] = useState(false);
  const [implementationCost, setImplementationCost] = useState('');

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
    if (!costSummary || !hasNewFormat) return costSummary;
    let stepsRemoved = 0, stepsAutomated = 0, timeSavedPerYear = 0, costSavedPct = 0;
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
      costSavedPct += ch.estimatedCostSavedPercent || 0;
    }
    const origCount = costSummary.originalStepsCount ?? 0;
    let totalBaselineMinutesPerYear = 0;
    for (const rp of rawProcesses || []) {
      const hours = rp.costs?.hoursPerInstance ?? 0;
      const annual = rp.frequency?.annual ?? rp.costs?.annual ?? 12;
      const teamSize = rp.costs?.teamSize ?? 1;
      totalBaselineMinutesPerYear += hours * 60 * annual * teamSize;
    }
    const timeSavedPercent = totalBaselineMinutesPerYear > 0
      ? Math.min(100, Math.round((timeSavedPerYear / totalBaselineMinutesPerYear) * 100))
      : (origCount > 0 ? Math.min(100, Math.round((timeSavedPerYear / (origCount * 60 * 12)) * 100)) : (costSummary.estimatedTimeSavedPercent || 0));
    const costFromChanges = Math.min(100, Math.round(costSavedPct) || 0);
    const costSavedPercent = costFromChanges > 0 ? costFromChanges : (timeSavedPercent > 0 ? timeSavedPercent : 0);
    return {
      ...costSummary,
      stepsRemoved,
      stepsAutomated,
      optimisedStepsCount: Math.max(0, origCount - stepsRemoved),
      estimatedTimeSavedPercent: timeSavedPercent,
      estimatedCostSavedPercent: costSavedPercent,
    };
  }, [costSummary, hasNewFormat, indexedChanges, decisions, rawProcesses]);

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
            {(effectiveMetrics.estimatedCostSavedPercent > 0) && (
              <div className="redesign-tile accent">
                <div className="redesign-tile-value">
                  {effectiveMetrics.estimatedCostSavedPercent}%
                  {totalAnnualCost > 0 && (
                    <span className="redesign-tile-sub">{formatCurrency(Math.round(totalAnnualCost * effectiveMetrics.estimatedCostSavedPercent / 100))}/yr</span>
                  )}
                </div>
                <div className="redesign-tile-label">Cost saved</div>
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
            {effectiveMetrics.estimatedCostSavedPercent > 0 && totalAnnualCost > 0 && (
              <div className="redesign-roi-section">
                <label className="redesign-roi-label">Implementation cost (optional):</label>
                <div className="redesign-roi-input-wrap">
                  <span className="redesign-roi-currency">&pound;</span>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    placeholder="e.g. 5000"
                    value={implementationCost}
                    onChange={(e) => setImplementationCost(e.target.value.replace(/[^0-9.]/g, ''))}
                    className="redesign-roi-input"
                  />
                </div>
                {implementationCost && parseFloat(implementationCost) > 0 && (() => {
                  const implCost = parseFloat(implementationCost) || 0;
                  const annualSavings = Math.round(totalAnnualCost * effectiveMetrics.estimatedCostSavedPercent / 100);
                  const roi = annualSavings > 0 && implCost > 0
                    ? Math.round(((annualSavings - implCost) / implCost) * 100)
                    : null;
                  const paybackMonths = annualSavings > 0 && implCost > 0
                    ? (implCost / annualSavings * 12).toFixed(1)
                    : null;
                  return (
                    <div className="redesign-roi-results">
                      {roi != null && <span>ROI (year 1): <strong>{roi >= 0 ? roi + '%' : ' - '}</strong></span>}
                      {paybackMonths != null && <span>Payback: <strong>{parseFloat(paybackMonths) < 120 ? paybackMonths + ' months' : (parseFloat(paybackMonths) / 12).toFixed(1) + ' years'}</strong></span>}
                    </div>
                  );
                })()}
              </div>
            )}
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

  const activeRedesignTab = redesignTabs.find(t => t.id === redesignTab) ? redesignTab : (redesignTabs[0]?.id ?? 'metrics');

  return (
    <div className="report-redesign-section">
        {finalised && (
          <div className="report-redesign-finalised-banner">
            <span className="redesign-finalised-icon">&#10003;</span>
            <span>Redesign accepted{redesign.acceptedAt ? ` on ${new Date(redesign.acceptedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}. View both flows in your <Link href="/portal">Client Portal</Link>. <Link href={`/build?id=${reportId}`}>Build this</Link>  -  generate workflow definitions for N8N, Unqork, Make, Zapier, and more.</span>
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
  const { theme } = useTheme();
  const darkTheme = theme === 'dark';
  const searchParams = useSearchParams();
  const id = searchParams.get('id') || searchParams.get('edit');
  const redesignId = searchParams.get('redesignId');
  const fromPortal = searchParams.get('portal') === '1';
  const tokenFromUrl = searchParams.get('token');
  const { user: sessionUser, accessToken, signOut: sessionSignOut } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [report, setReport] = useState(null);
  const [showAuditTrail, setShowAuditTrail] = useState(false);
  const [metricDrill, setMetricDrill] = useState(null);

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
  }, [id, redesignId, accessToken]);

  const contactEmail = report?.contactEmail || report?.diagnosticData?.contact?.email || '';

  if (loading) return <div className="loading-state" style={{ padding: 48, textAlign: 'center' }}><div className="loading-spinner" /><p>Retrieving your report...</p></div>;

  if (error) return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <p style={{ color: 'var(--red)' }}>{error}</p>
      <Link href="/diagnostic" style={{ color: 'var(--accent)', marginTop: 16, display: 'inline-block' }}>Start a New Diagnostic</Link><br />
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
  const showCostData = !isMapOnly && !costAnalysisPending && (hasNoCostData === false || (s.totalAnnualCost ?? 0) > 0);

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
  const processSections = (processes || []).map((proc, i) => {
    const raw = rawProcesses[i] || proc;
    const steps = raw.steps || proc.steps || [];
    const handoffs = raw.handoffs || proc.handoffs || [];
    const depts = [...new Set(steps.map((s) => s.department).filter(Boolean))];
    const deptCount = depts.length;
    const deptLabel = deptCount > 0 ? depts.slice(0, 3).join(', ') + (deptCount > 3 ? ` +${deptCount - 3}` : '') : ' - ';
    const systems = [...new Set(steps.flatMap((s) => s.systems || []))];
    const sysCount = systems.length;
    const handoffCount = handoffs.length;
    const allChecks = steps.flatMap(s => s.checklist || []);
    const checksDone = allChecks.filter(c => c.checked).length;
    const checksTotal = allChecks.length;

    const procAuto = calculateAutomationScore([raw]);

    /* Summary metrics: exclude Annual cost (shown in Cost Summary tab) to avoid duplication */
    const summaryMetrics = (isMapOnly || costAnalysisPending) ? (
      <div className="report-metric-grid">
        <MetricCard metricKey="stepsMapped" value={(steps.length || proc.stepsCount) ?? ' - '} label="Steps mapped" onClick={setMetricDrill} />
        <MetricCard metricKey="handoffs" value={handoffCount} label="Handoffs" title="Transfers of work between steps (e.g. from one team to the next)" onClick={setMetricDrill} />
        <MetricCard metricKey="teamsInvolved" value={deptCount > 0 ? deptCount : ' - '} label="Teams involved" onClick={setMetricDrill} />
        <MetricCard metricKey="automationReadiness" value={`${procAuto.percentage ?? 0}%`} drillValue={`${procAuto.percentage ?? 0}% (${procAuto.grade || 'N/A'})`} label="Automation readiness" title={procAuto.insight} onClick={setMetricDrill} valueStyle={{ color: getAutomationReadinessColor(procAuto.percentage ?? 0) }} />
        {checksTotal > 0 && (
          <MetricCard metricKey="checklistItems" value={`${checksDone}/${checksTotal}`} label="Checklist items" title="Checklist completion across all steps" onClick={setMetricDrill} />
        )}
      </div>
    ) : (
      <div className="report-metric-grid">
        <MetricCard metricKey="averageCycle" value={proc.elapsedDays > 0 ? `${proc.elapsedDays} days` : ' - '} label="Average cycle" onClick={setMetricDrill} />
        <MetricCard metricKey="steps" value={proc.stepsCount ?? (proc.steps || []).length ?? ' - '} label="Steps" onClick={setMetricDrill} />
        <MetricCard metricKey="automationReadiness" value={`${procAuto.percentage ?? 0}%`} drillValue={`${procAuto.percentage ?? 0}% (${procAuto.grade || 'N/A'})`} label="Automation readiness" title={procAuto.insight} onClick={setMetricDrill} valueStyle={{ color: getAutomationReadinessColor(procAuto.percentage ?? 0) }} />
        <MetricCard
          metricKey="confidence"
          value={<span className={`confidence-badge confidence-${(proc.quality?.grade || 'medium').toLowerCase()}`}>{proc.quality?.grade || 'MEDIUM'}</span>}
          drillValue={`${proc.quality?.grade || 'MEDIUM'} (${proc.quality?.score ?? ' - '}/100)`}
          label={`Confidence (${(proc.quality?.score ?? ' - ')}/100)`}
          onClick={setMetricDrill}
        />
        {checksTotal > 0 && (
          <MetricCard metricKey="checklistItems" value={`${checksDone}/${checksTotal}`} label="Checklist items" title="Checklist completion across all steps" onClick={setMetricDrill} />
        )}
      </div>
    );

    return (
      <div key={i} className="report-process-summary-block">
        {summaryMetrics}
        {deptCount > 0 && <div className="report-meta-row">Teams: <strong>{deptLabel}</strong></div>}
        {sysCount > 0 && <div className="report-meta-row">Systems: <strong>{systems.slice(0, 5).join(', ')}{sysCount > 5 ? ` +${sysCount - 5} more` : ''}</strong></div>}
      </div>
    );
  });

  return (
    <div className="report-page">
      {/* Top bar */}
      <div className="top-bar">
        <div className="top-bar-inner">
          <div className="top-bar-left">
            <a href="/">Sharpin<span className="top-bar-brand-dot">.</span></a>
            <div className="top-bar-divider" />
            <span className="top-bar-title">Report</span>
          </div>
          <div className="top-bar-nav">
            <ThemeToggle className="top-bar-theme-btn" />
            {id && <Link href={`/diagnostic?edit=${id}`} className="top-bar-link">Edit</Link>}
            {sessionUser?.email ? (
              <>
                <Link href="/portal" className="top-bar-link">Portal</Link>
                <span className="top-bar-email">{sessionUser.email}</span>
                <button type="button" className="top-bar-btn" onClick={sessionSignOut}>Sign Out</button>
              </>
            ) : (
              <Link href="/portal" className="top-bar-link">Client Login</Link>
            )}
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
          <div className="report-hero">
            <div className="report-hero-icon" style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 700, fontSize: '1.6rem', color: 'var(--text)' }}>Sharpin<span style={{ color: 'var(--gold, #b45309)' }}>.</span></div>
            <h1 className="report-title">{redesign ? redesignTitle : `${(processes[0]?.name || rawProcesses[0]?.processName || 'Process')} Diagnostics`}</h1>
          </div>

          {costAnalysisPending && (() => {
            const costUrl = (typeof window !== 'undefined' && sessionStorage.getItem('costAnalysisUrl_' + id)) || (d.costAnalysisToken ? `${typeof window !== 'undefined' ? window.location.origin : ''}/cost-analysis?id=${id}&token=${d.costAnalysisToken}` : null);
            if (!costUrl) return null;
            return <CostAnalysisShareCard costUrl={costUrl} reportId={id} contactName={d.contact?.name} company={d.contact?.company} />;
          })()}

          {report?.costDataHiddenToOwner && (
            <div className="report-cost-hidden-notice" style={{ background: 'rgba(100,116,139,0.08)', border: '1px solid rgba(100,116,139,0.2)', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: '0.9rem', color: 'var(--text-mid)' }}>
              Cost analysis has been completed by your manager. Cost data is only visible to managers and those they share the report with.
            </div>
          )}

          <div className="report-ai-disclaimer">
            <span className="report-ai-disclaimer-icon">&#9888;</span>
            <span>This report is AI-generated based solely on the information you provided and may contain errors or oversimplifications. It is a starting point, not a final recommendation. <a href="mailto:hello@sharpin.co.uk?subject=Redesign%20consultation">Book a free consultation</a> to validate these findings with our team.</span>
          </div>

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
            if (!redesign && showCostData && (s.totalAnnualCost > 0 || s.potentialSavings > 0)) {
              reportTabs.push({
                id: 'cost',
                label: 'Cost Summary',
                content: (
                  <div className="report-cost-summary">
                    {costEditUrl && (
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
            if (!redesign) {
              reportTabs.push({
                id: 'flows',
                label: 'Process Flow Diagrams',
                content: <FlowDiagramsSection rawProcesses={d.rawProcesses} processes={processes} darkTheme={darkTheme} />,
              });
            }
            if (!redesign) {
              reportTabs.push({
                id: 'observations',
                label: isMapOnly ? 'Process Map Observations' : 'Analysis & Recommendations',
                content: <ObservationsContent recs={recs} isMapOnly={isMapOnly} rawProcesses={d.rawProcesses} />,
              });
            }
            if (redesign) {
              reportTabs.push({
                id: 'redesign',
                label: 'Operating Model Redesign',
                content: <RedesignSection redesign={redesign} rawProcesses={rawProcesses} processes={processes} totalAnnualCost={s.totalAnnualCost} reportId={id} redesignId={redesignId} contactEmail={contactEmail} automationScore={auto} accessToken={accessToken} darkTheme={darkTheme} />,
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

          {/* Create Account card */}
          <div className="report-gate-card">
            <div className="report-gate-icon">&#128274;</div>
            <h3 className="report-gate-title">Want to view this report again or edit it?</h3>
            <p className="report-gate-text">Create a free client portal account to save your report and access it any time. Also unlocks the full cost analysis, and process redesign.</p>
            <Link href={`/portal?mode=signup&source=map-only&email=${encodeURIComponent(contactEmail)}`} className="report-gate-btn">
              Create Free Account &rarr;
            </Link>
            <p className="report-gate-signin">Already have an account? <Link href="/portal">Sign in &rarr;</Link></p>
          </div>

          {/* Green banner */}
          {isMapOnly && (
            <div className="report-upgrade-banner">
              <span className="report-upgrade-icon">&#128202;</span>
              <span>Want cost analysis &amp; 90-day transformation roadmap? </span>
              <Link href={`/diagnostic?upgrade=${id}&email=${encodeURIComponent(contactEmail)}`} className="report-upgrade-link">Run full analysis &rarr;</Link>
            </div>
          )}

        </div>
      </div>

      <p style={{ padding: '30px 20px', textAlign: 'center', fontSize: '0.9rem', color: 'var(--text-mid)' }}>
        Sharpin &middot; <Link href="/">Home</Link> &middot; <Link href="/diagnostic">New Diagnostic</Link>
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
