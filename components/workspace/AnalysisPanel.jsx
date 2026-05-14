'use client';

/**
 * Workspace Analysis tab — model-level rollup of process-report findings.
 *
 * Insights = facts about the model (heatmap, costs, systems).
 * Analysis = recommended actions and prioritised work.
 *
 * Visual-first: every panel leads with a chart or stat tile so the user
 * scans the shape of the model before any table. Drill-through opens the
 * source process via the canvas (?view=<reportId>).
 */

import { useEffect, useState, useMemo } from 'react';
import { apiFetch } from '@/lib/api-fetch';

// ------------------------------------------------------------------
// Formatters
// ------------------------------------------------------------------

function Money(n) {
  if (n == null || n === 0) return '—';
  if (Math.abs(n) >= 1_000_000) return `£${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000)     return `£${(n / 1_000).toFixed(0)}k`;
  return `£${Math.round(n)}`;
}

function Hours(minutes) {
  if (minutes == null || minutes === 0) return '—';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = minutes / 60;
  return h < 100 ? `${h.toFixed(h < 10 ? 1 : 0)}h` : `${Math.round(h)}h`;
}

function functionNameOf(functionId, functions) {
  if (!functionId) return null;
  const f = (functions || []).find((x) => x.id === functionId);
  return f?.name || null;
}

function openProcess(reportId) {
  if (!reportId) return;
  // Silent canvas swap when embedded under DiagnosticWorkspace; falls
  // back to a soft history.pushState so a direct refresh still resolves
  // the right report.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('vesno:open-process', {
      detail: { reportId, intent: 'view' },
    }));
  }
}

// ------------------------------------------------------------------
// Reusable visual primitives
// ------------------------------------------------------------------

const PALETTE = {
  teal:   '#0d9488',
  indigo: '#6366f1',
  amber:  '#d97706',
  red:    '#dc2626',
  slate:  '#94a3b8',
  green:  '#16a34a',
};

function StatTile({ label, value, sub, accent = 'teal' }) {
  return (
    <div style={{
      flex: '1 1 160px', minWidth: 160,
      padding: '12px 14px',
      background: 'var(--bg, #fff)',
      border: '1px solid var(--border, #e2e8f0)',
      borderRadius: 8,
      borderLeft: `3px solid ${PALETTE[accent] || PALETTE.teal}`,
    }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-mid, #64748b)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2, color: 'var(--text, #1e293b)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-mid, #64748b)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/**
 * Horizontal bar with a label on the left, the bar in the middle,
 * and a value on the right. Click handler optional.
 */
function HBar({ label, sub, value, max, format = (v) => v, accent = 'teal', onClick, active = false }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 60px',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        maxWidth: '100%',
        padding: '6px 0',
        background: 'transparent',
        border: 'none',
        textAlign: 'left',
        cursor: onClick ? 'pointer' : 'default',
        opacity: active ? 1 : 0.95,
        overflow: 'hidden',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4, color: 'var(--text, #1e293b)', minWidth: 0 }}>
          <span style={{
            fontWeight: active ? 600 : 500,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            minWidth: 0, display: 'block', maxWidth: '100%',
          }}>
            {label}
            {sub && <span style={{ color: 'var(--text-mid, #64748b)', fontWeight: 400, marginLeft: 6 }}>{sub}</span>}
          </span>
        </div>
        <div style={{ position: 'relative', height: 8, background: 'var(--bg-alt, #f1f5f9)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', inset: 0,
            width: `${pct}%`,
            background: PALETTE[accent] || PALETTE.teal,
            borderRadius: 4,
            transition: 'width 0.15s ease',
          }} />
        </div>
      </div>
      <div style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', textAlign: 'right', color: 'var(--text, #1e293b)', fontWeight: 500, whiteSpace: 'nowrap' }}>
        {format(value)}
      </div>
    </button>
  );
}

/**
 * Stacked horizontal bar — single bar split across multiple coloured
 * segments. Used for the automation-pipeline coverage at the top of
 * that card.
 */
function StackedBar({ segments, total }) {
  if (!total) return null;
  return (
    <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', background: 'var(--bg-alt, #f1f5f9)' }}>
      {segments.map((s, i) => {
        const w = (s.value / total) * 100;
        if (w <= 0) return null;
        return (
          <div
            key={i}
            title={`${s.label}: ${Money(s.value)}`}
            style={{ width: `${w}%`, background: PALETTE[s.accent] || PALETTE.teal }}
          />
        );
      })}
    </div>
  );
}

function Card({ children, title, badge }) {
  return (
    <div style={{
      background: 'var(--bg, #fff)',
      border: '1px solid var(--border, #e2e8f0)',
      borderRadius: 10,
      padding: '16px 18px',
      minWidth: 0,
      overflow: 'hidden',
    }}>
      {title && (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text, #1e293b)' }}>{title}</h3>
          {badge && <span style={{ fontSize: 11, color: 'var(--text-mid, #64748b)' }}>{badge}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

function Empty({ children }) {
  return <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-mid, #64748b)', fontSize: 13 }}>{children}</div>;
}

function ProcessLink({ reportId, label }) {
  if (!reportId) return <span>{label || '—'}</span>;
  return (
    <button
      type="button"
      onClick={() => openProcess(reportId)}
      title="Open this process in the canvas"
      style={{
        background: 'none', border: 'none', padding: 0,
        color: PALETTE.teal, cursor: 'pointer', font: 'inherit',
        textAlign: 'left', textDecoration: 'underline dotted', textUnderlineOffset: 2,
      }}
    >{label || 'Process'}</button>
  );
}

// ------------------------------------------------------------------
// Hero summary strip — four stat tiles
// ------------------------------------------------------------------

function HeroStrip({ data }) {
  const recs = data.topRecommendations || [];
  const recImpact = recs.reduce((acc, r) => acc + (r.impactDollars || 0), 0);
  const pipe = data.automationPipeline || [];
  const totalSavings = pipe.reduce((acc, r) => acc + r.savings, 0);
  const totalCost    = pipe.reduce((acc, r) => acc + r.annualCost, 0);
  const coverage     = totalCost > 0 ? Math.round((totalSavings / totalCost) * 100) : 0;
  const bot = data.bottlenecks || [];
  const flagged = bot.filter((b) => b.isSelfReported).length;
  const t = data.roadmap?.totals || {};
  const inFlight = (t.proposed || 0) + (t.accepted || 0) + (t.applied || 0);

  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <StatTile
        label="Recommendations"
        value={recs.length}
        sub={recImpact > 0 ? `${Money(recImpact)} estimated` : 'open across the model'}
        accent="indigo"
      />
      <StatTile
        label="Cost addressable"
        value={`${coverage}%`}
        sub={`${Money(totalSavings)} of ${Money(totalCost)}`}
        accent="teal"
      />
      <StatTile
        label="Bottleneck steps"
        value={bot.length}
        sub={flagged > 0 ? `${flagged} team-flagged` : 'detected from wait time'}
        accent="amber"
      />
      <StatTile
        label="Changes in flight"
        value={inFlight}
        sub={t.measured ? `${t.measured} measured` : (t.changes ? `${t.changes} total` : 'none yet')}
        accent="green"
      />
    </div>
  );
}

// ------------------------------------------------------------------
// Top recommendations — function bar chart + filtered list
// ------------------------------------------------------------------

function RecommendationsCard({ rows, functions }) {
  const [filter, setFilter] = useState(null); // null = all
  const grouped = useMemo(() => {
    const byFunc = new Map();
    for (const r of rows || []) {
      const key = r.functionId || '_';
      if (!byFunc.has(key)) byFunc.set(key, { functionId: r.functionId, items: [], dollars: 0 });
      const g = byFunc.get(key);
      g.items.push(r);
      g.dollars += r.impactDollars || 0;
    }
    return [...byFunc.values()].sort((a, b) => b.dollars - a.dollars);
  }, [rows]);

  if (!rows?.length) {
    return <Card title="Top recommendations"><Empty>No opportunities surfaced yet. Map some steps on any process — automation, bottlenecks, excess approvals, and handoff overhead populate this list live.</Empty></Card>;
  }

  const maxDollars = Math.max(...grouped.map((g) => g.dollars), 1);
  const visible = filter == null ? rows.slice(0, 12)
    : (grouped.find((g) => (g.functionId || '_') === filter)?.items || []).slice(0, 12);

  return (
    <Card title="Top recommendations" badge={`${rows.length} across ${grouped.length} function${grouped.length === 1 ? '' : 's'}`}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap: 18, minWidth: 0 }}>
        <div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-mid, #64748b)', marginBottom: 6 }}>
            Impact by function · click to filter
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <HBar
              label="All functions"
              value={grouped.reduce((a, g) => a + g.dollars, 0)}
              max={grouped.reduce((a, g) => a + g.dollars, 0) || 1}
              format={Money}
              accent="indigo"
              onClick={() => setFilter(null)}
              active={filter == null}
            />
            {grouped.slice(0, 8).map((g) => (
              <HBar
                key={g.functionId || '_'}
                label={functionNameOf(g.functionId, functions) || 'Unfiled'}
                sub={`${g.items.length}`}
                value={g.dollars}
                max={maxDollars}
                format={(v) => v > 0 ? Money(v) : `${g.items.length}`}
                accent={(filter === (g.functionId || '_')) ? 'indigo' : 'slate'}
                onClick={() => setFilter(g.functionId || '_')}
                active={filter === (g.functionId || '_')}
              />
            ))}
          </div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-mid, #64748b)', marginBottom: 6 }}>
            {filter == null ? 'All recommendations' : (functionNameOf(filter === '_' ? null : filter, functions) || 'Unfiled')}
            {' · '}{visible.length}
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {visible.map((r, i) => (
              <li key={i} style={{
                padding: 10,
                borderRadius: 6,
                background: 'var(--bg-alt, #f8fafc)',
                border: '1px solid var(--border, #e2e8f0)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                  <strong style={{ fontSize: 13, color: 'var(--text, #1e293b)' }}>{r.title}</strong>
                  <span style={{ fontSize: 12, fontWeight: 600, color: PALETTE.indigo, whiteSpace: 'nowrap' }}>
                    {r.impactDollars > 0 ? Money(r.impactDollars) : (r.impactLabel || '')}
                  </span>
                </div>
                {r.rationale && (
                  <div style={{ fontSize: 12, color: 'var(--text-mid, #64748b)', marginTop: 4, lineHeight: 1.4 }}>{r.rationale}</div>
                )}
                <div style={{ fontSize: 11, color: 'var(--text-mid, #64748b)', marginTop: 6 }}>
                  <ProcessLink reportId={r.sourceReportId} label={r.sourceProcess || r.sourceCompany || 'Process'} />
                  {r.sourceCompany && r.sourceProcess && <span> · {r.sourceCompany}</span>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------
// Automation pipeline — coverage gauge + per-bucket bar lists
// ------------------------------------------------------------------

function AutomationPipelineCard({ rows, functions }) {
  const buckets = useMemo(() => {
    const out = { 'quick-win': [], 'strategic': [], 'transformation': [] };
    for (const r of rows || []) (out[r.bucket] || out['transformation']).push(r);
    return out;
  }, [rows]);
  if (!rows?.length) {
    return <Card title="Automation pipeline"><Empty>No processes with cost or savings data yet.</Empty></Card>;
  }

  const totalSavings = rows.reduce((acc, r) => acc + r.savings, 0);
  const totalCost    = rows.reduce((acc, r) => acc + r.annualCost, 0);
  const remaining    = Math.max(0, totalCost - totalSavings);
  const coverage     = totalCost > 0 ? Math.round((totalSavings / totalCost) * 100) : 0;
  const maxRowSavings = Math.max(...rows.map((r) => r.savings), 1);

  const bucketMeta = [
    { key: 'quick-win',      label: 'Quick wins',      hint: '50%+ recoverable', accent: 'green'  },
    { key: 'strategic',      label: 'Strategic plays', hint: '20-50% recoverable', accent: 'teal'   },
    { key: 'transformation', label: 'Transformations', hint: '<20% — needs redesign', accent: 'indigo' },
  ];

  return (
    <Card title="Automation pipeline" badge={`${coverage}% of cost addressable`}>
      <div style={{ marginBottom: 16 }}>
        <StackedBar
          total={totalCost}
          segments={[
            { label: 'Addressable savings', value: totalSavings, accent: 'teal' },
            { label: 'Remaining cost',      value: remaining,    accent: 'slate' },
          ]}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: 'var(--text-mid, #64748b)' }}>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, background: PALETTE.teal, borderRadius: 2, marginRight: 6 }}/>Addressable {Money(totalSavings)}</span>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, background: PALETTE.slate, borderRadius: 2, marginRight: 6 }}/>Remaining {Money(remaining)}</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {bucketMeta.map((b) => (
          <div key={b.key} style={{
            flex: 1, padding: '10px 12px',
            background: 'var(--bg-alt, #f8fafc)',
            border: '1px solid var(--border, #e2e8f0)',
            borderTop: `3px solid ${PALETTE[b.accent]}`,
            borderRadius: 6,
          }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-mid, #64748b)' }}>{b.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>{buckets[b.key].length}</div>
            <div style={{ fontSize: 10, color: 'var(--text-mid, #64748b)', marginTop: 2 }}>{b.hint}</div>
          </div>
        ))}
      </div>

      {bucketMeta.map((b) => (
        buckets[b.key].length > 0 && (
          <div key={b.key} style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-mid, #64748b)', marginBottom: 4 }}>
              {b.label}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {buckets[b.key].slice(0, 6).map((r, i) => (
                <HBar
                  key={i}
                  label={r.processName || r.sourceCompany || 'Process'}
                  sub={functionNameOf(r.functionId, functions) || ''}
                  value={r.savings}
                  max={maxRowSavings}
                  format={Money}
                  accent={b.accent}
                  onClick={() => openProcess(r.sourceReportId)}
                />
              ))}
            </div>
          </div>
        )
      ))}
    </Card>
  );
}

// ------------------------------------------------------------------
// Bottlenecks — horizontal bars sorted by wait time
// ------------------------------------------------------------------

function BottlenecksCard({ rows, functions }) {
  if (!rows?.length) {
    return <Card title="Bottlenecks"><Empty>No bottleneck steps detected. Add wait times to your steps to surface delays.</Empty></Card>;
  }
  const top = rows.slice(0, 12);
  const max = Math.max(...top.map((b) => b.waitMinutes), 1);
  const flagged = rows.filter((b) => b.isSelfReported).length;
  return (
    <Card title="Bottlenecks" badge={`${rows.length} step${rows.length === 1 ? '' : 's'}${flagged ? ` · ${flagged} team-flagged` : ''}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {top.map((b, i) => (
          <HBar
            key={i}
            label={b.stepName}
            sub={`${b.processName || b.sourceCompany || ''}${b.isSelfReported ? ' · flagged' : ''}`}
            value={b.waitMinutes}
            max={max}
            format={Hours}
            accent={b.risk === 'high' ? 'red' : b.risk === 'medium' ? 'amber' : 'slate'}
            onClick={() => openProcess(b.sourceReportId)}
          />
        ))}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------
// Cost concentration — two columns of horizontal bars
// ------------------------------------------------------------------

function CostConcentrationCard({ data, functions }) {
  const { topProcesses = [], topSteps = [] } = data || {};
  if (!topProcesses.length && !topSteps.length) {
    return <Card title="Cost concentration"><Empty>No cost data yet. Add annual cost figures to your reports.</Empty></Card>;
  }
  const procMax = Math.max(...topProcesses.map((p) => p.annualCost), 1);
  const stepMax = Math.max(...topSteps.map((s) => s.stepCost), 1);
  return (
    <Card title="Cost concentration">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(0, 1fr))', gridAutoFlow: 'column', gap: 24, minWidth: 0 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-mid, #64748b)', marginBottom: 6 }}>
            Top 10 processes
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            {topProcesses.map((p, i) => (
              <HBar
                key={i}
                label={p.processName || p.sourceCompany || 'Process'}
                sub={functionNameOf(p.functionId, functions) || ''}
                value={p.annualCost}
                max={procMax}
                format={Money}
                accent="teal"
                onClick={() => openProcess(p.sourceReportId)}
              />
            ))}
          </div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-mid, #64748b)', marginBottom: 6 }}>
            Top 10 steps (attributed)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            {topSteps.map((s, i) => (
              <HBar
                key={i}
                label={s.stepName}
                sub={s.processName || ''}
                value={s.stepCost}
                max={stepMax}
                format={Money}
                accent="indigo"
                onClick={() => openProcess(s.sourceReportId)}
              />
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------
// Risk hotspots — three stat tiles + collapsible detail lists
// ------------------------------------------------------------------

function RiskHotspotsCard({ hotspots }) {
  const { manualNoSystem = [], sopFailures = [], shadowSteps = [] } = hotspots || {};
  const [open, setOpen] = useState(null); // 'manual' | 'sop' | 'shadow' | null
  const nothing = !manualNoSystem.length && !sopFailures.length && !shadowSteps.length;
  if (nothing) {
    return <Card title="Risk &amp; compliance hotspots"><Empty>No risk patterns detected. Add roles + systems to your steps to surface single-point-of-failure and shadow-process risk.</Empty></Card>;
  }
  const tiles = [
    { key: 'manual', label: 'Manual approvals',          rows: manualNoSystem, accent: 'red',    hint: 'no system of record' },
    { key: 'sop',    label: 'Single-point-of-failure',   rows: sopFailures,    accent: 'amber',  hint: 'one role owns >60% of steps' },
    { key: 'shadow', label: 'Shadow steps',              rows: shadowSteps,    accent: 'indigo', hint: 'no system attached' },
  ];
  return (
    <Card title="Risk &amp; compliance hotspots">
      <div style={{ display: 'flex', gap: 8 }}>
        {tiles.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setOpen(open === t.key ? null : t.key)}
            style={{
              flex: 1, padding: '12px 14px', textAlign: 'left',
              background: open === t.key ? 'var(--bg-alt, #f1f5f9)' : 'var(--bg, #fff)',
              border: '1px solid var(--border, #e2e8f0)',
              borderTop: `3px solid ${PALETTE[t.accent]}`,
              borderRadius: 6, cursor: 'pointer',
            }}
          >
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-mid, #64748b)' }}>{t.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>{t.rows.length}</div>
            <div style={{ fontSize: 11, color: 'var(--text-mid, #64748b)', marginTop: 2 }}>{t.hint}</div>
          </button>
        ))}
      </div>
      {open && (
        <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 12, background: 'var(--bg-alt, #f8fafc)', border: '1px solid var(--border, #e2e8f0)', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(tiles.find((t) => t.key === open)?.rows || []).slice(0, 12).map((r, i) => (
            <li key={i} style={{ fontSize: 12, color: 'var(--text, #1e293b)' }}>
              {open === 'sop'
                ? <><strong>{r.owner}</strong> owns {r.stepCount}/{r.totalSteps} in <ProcessLink reportId={r.sourceReportId} label={r.processName || r.sourceCompany} /></>
                : <><strong>{r.stepName}</strong> · <ProcessLink reportId={r.sourceReportId} label={r.processName || r.sourceCompany} /></>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------
// Roadmap — funnel diagram
// ------------------------------------------------------------------

function RoadmapCard({ roadmap }) {
  if (!roadmap || !roadmap.totals?.changes) {
    return <Card title="Implementation roadmap"><Empty>No redesigns proposed yet. Once changes are proposed, accepted, applied, the roadmap fills in here.</Empty></Card>;
  }
  const t = roadmap.totals || {};
  const p = roadmap.predicted || {};
  const stages = [
    { key: 'proposed', label: 'Proposed', accent: 'slate'  },
    { key: 'accepted', label: 'Accepted', accent: 'indigo' },
    { key: 'applied',  label: 'Applied',  accent: 'teal'   },
    { key: 'live',     label: 'Live',     accent: 'green'  },
    { key: 'measured', label: 'Measured', accent: 'green'  },
  ];
  const max = Math.max(...stages.map((s) => t[s.key] || 0), 1);
  return (
    <Card title="Implementation roadmap" badge={`${t.changes} change${t.changes === 1 ? '' : 's'}`}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, padding: '8px 0' }}>
        {stages.map((s) => {
          const v = t[s.key] || 0;
          const h = (v / max) * 80 + 12;
          return (
            <div key={s.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{v}</div>
              <div style={{
                width: '100%', height: h,
                background: PALETTE[s.accent],
                opacity: v ? 1 : 0.25,
                borderRadius: '4px 4px 0 0',
              }} />
              <div style={{ fontSize: 11, color: 'var(--text-mid, #64748b)', marginTop: 6 }}>{s.label}</div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--bg-alt, #f8fafc)', borderRadius: 6, fontSize: 12, color: 'var(--text-mid, #64748b)' }}>
        <strong style={{ color: 'var(--text, #1e293b)' }}>Predicted impact:</strong>
        {' '}{Hours(p.time_minutes)} saved · {p.fte != null ? `${p.fte} FTE` : '—'}
        {p.avgCostPct != null ? ` · ${p.avgCostPct}% avg cost reduction` : ''}
      </div>
      {roadmap.realised?.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-mid, #64748b)', marginBottom: 6 }}>
            Realised outcomes
          </div>
          {(() => {
            const realisedMax = Math.max(...roadmap.realised.map((x) => Math.abs(x.totalDelta)), 1);
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {roadmap.realised.slice(0, 6).map((r, i) => (
                  <HBar
                    key={i}
                    label={r.metric}
                    sub={`${r.samples} sample${r.samples === 1 ? '' : 's'}`}
                    value={Math.abs(r.totalDelta)}
                    max={realisedMax}
                    format={() => `${r.avgDelta}${r.unit ? ` ${r.unit}` : ''}`}
                    accent="teal"
                  />
                ))}
              </div>
            );
          })()}
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------
// Top-level
// ------------------------------------------------------------------

export default function AnalysisPanel({ modelId, accessToken, functions }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!modelId || !accessToken) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch(`/api/operating-models/${modelId}/analysis`, {}, accessToken)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`/api/operating-models/${modelId}/analysis -> ${r.status}`))))
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [modelId, accessToken]);

  if (loading) return <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-mid, #64748b)' }}>Loading analysis…</div>;
  if (error)   return <div style={{ padding: 24, color: PALETTE.red }}>Couldn&apos;t load analysis: {error}</div>;
  if (!data)   return null;

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0, maxWidth: '100%' }}>
      <HeroStrip data={data} />
      <RecommendationsCard rows={data.topRecommendations} functions={functions} />
      <AutomationPipelineCard rows={data.automationPipeline} functions={functions} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(360px, 100%), 1fr))', gap: 18, minWidth: 0 }}>
        <BottlenecksCard rows={data.bottlenecks} functions={functions} />
        <CostConcentrationCard data={data.costConcentration} functions={functions} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(360px, 100%), 1fr))', gap: 18, minWidth: 0 }}>
        <RiskHotspotsCard hotspots={data.riskHotspots} />
        <RoadmapCard roadmap={data.roadmap} />
      </div>
    </section>
  );
}
