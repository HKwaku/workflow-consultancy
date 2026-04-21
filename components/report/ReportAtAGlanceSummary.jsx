'use client';

const BOTTLENECK_LABELS = {
  waiting: 'Waiting time',
  approvals: 'Approval bottlenecks',
  'manual-work': 'Manual / repetitive work',
  handoffs: 'Handoff issues',
  systems: 'System switching',
  unclear: 'Unclear ownership',
  rework: 'Rework / errors',
  other: 'Other',
};

function fmtMinutes(mins) {
  if (!mins || mins <= 0) return null;
  if (mins >= 1440) return `${(mins / 1440).toFixed(1)} days`;
  if (mins >= 60) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins)}m`;
}

export function buildAtAGlanceProps(process, { steps = [], handoffs = [] } = {}) {
  const allSteps = steps.length > 0 ? steps : process.steps || [];
  const allHandoffs = handoffs.length > 0 ? handoffs : process.handoffs || [];

  const stepCount = allSteps.length || process.stepsCount || 0;
  const depts = [...new Set(allSteps.map((s) => s.department).filter(Boolean))];
  const deptCount = depts.length;

  const crossTeamHandoffs = allSteps.reduce((n, step, i) => {
    if (i === 0) return n;
    const prev = allSteps[i - 1]?.department;
    const curr = step.department;
    return prev && curr && prev !== curr ? n + 1 : n;
  }, 0);
  const handoffCount = crossTeamHandoffs || allHandoffs.length;

  const decisionCount = allSteps.filter((s) => s.isDecision && (s.branches || []).length > 0).length;
  const externalCount = allSteps.filter((s) => s.isExternal).length;

  const totalWork = allSteps.reduce((sum, s) => sum + (s.workMinutes || 0), 0);
  const totalWait = allSteps.reduce((sum, s) => sum + (s.waitMinutes || 0), 0);
  const workPct = totalWork + totalWait > 0 ? Math.round((totalWork / (totalWork + totalWait)) * 100) : null;
  const timelineStr = fmtMinutes(totalWork + totalWait);

  const bottleneck = process.bottleneck || {};
  const savings = process.savings || {};
  const savingsPercent = savings.estimatedSavingsPercent || 0;
  const elapsedDays = process.elapsedDays || process.lastExample?.elapsedDays || 0;
  const issues = process.issues || [];

  return {
    processName: process.processName || process.name || '',
    stepCount,
    deptCount,
    depts,
    handoffCount,
    decisionCount,
    externalCount,
    workPct,
    totalWorkMins: totalWork,
    totalWaitMins: totalWait,
    timelineStr,
    elapsedDays,
    bottleneck,
    savingsPercent,
    issues,
    quality: process.quality || null,
    frequency: process.frequency || null,
  };
}

function SummaryStat({ value, label, sub, tone }) {
  const toneClass = tone ? ` report-summary-stat--${tone}` : '';
  return (
    <div className={`report-summary-stat${toneClass}`}>
      <div className="report-summary-stat-value">{value ?? '—'}</div>
      <div className="report-summary-stat-label">{label}</div>
      {sub && <div className="report-summary-stat-sub">{sub}</div>}
    </div>
  );
}

function SubGroup({ eyebrow, title, sub, children }) {
  return (
    <section className="report-summary-subgroup">
      <header className="report-summary-subgroup-head">
        {eyebrow && <span className="report-summary-subgroup-eyebrow">{eyebrow}</span>}
        <h3 className="report-summary-subgroup-title">{title}</h3>
        {sub && <p className="report-summary-subgroup-sub">{sub}</p>}
      </header>
      <div className="report-summary-subgroup-body">{children}</div>
    </section>
  );
}

export default function ReportAtAGlanceBody({
  processName, stepCount, deptCount, depts, handoffCount, decisionCount, externalCount,
  workPct, totalWorkMins, totalWaitMins, timelineStr, elapsedDays,
  bottleneck, savingsPercent, issues, quality, frequency,
}) {
  const bottleneckLabel = bottleneck?.reason ? (BOTTLENECK_LABELS[bottleneck.reason] || bottleneck.reason) : null;
  const workWait = workPct != null ? `${workPct}% / ${100 - workPct}%` : null;
  const hasTime = workWait || timelineStr || elapsedDays > 0;
  const hasFindings = bottleneckLabel || savingsPercent > 0 || issues.length > 0;

  return (
    <section className="report-summary-section">
      <div className="report-summary-body">
        <SubGroup title="Process structure" sub="Shape of the work — steps, teams, and handoffs.">
          <div className="report-summary-grid">
            <SummaryStat value={stepCount || '—'} label="Steps mapped" />
            <SummaryStat value={deptCount > 0 ? deptCount : '—'} label="Teams involved" />
            <SummaryStat value={handoffCount > 0 ? handoffCount : '—'} label="Handoffs" />
            {decisionCount > 0 && <SummaryStat value={decisionCount} label="Decision points" />}
            {externalCount > 0 && <SummaryStat value={externalCount} label="External steps" />}
          </div>
          {deptCount > 0 && (
            <div className="report-summary-pills" aria-label="Teams involved">
              {depts.map((d) => (
                <span key={d} className="report-summary-pill">{d}</span>
              ))}
            </div>
          )}
        </SubGroup>

        {hasTime && (
          <SubGroup title="Time &amp; efficiency" sub="Touch time vs. wait time — where the clock goes.">
            <div className="report-summary-grid">
              {timelineStr && (
                <SummaryStat
                  value={timelineStr}
                  label="Est. end-to-end"
                  sub={totalWaitMins > 0 ? `${fmtMinutes(totalWaitMins)} waiting` : undefined}
                />
              )}
              {workWait && <SummaryStat value={workWait} label="Touch / wait" />}
              {elapsedDays > 0 && <SummaryStat value={`${elapsedDays}d`} label="Actual cycle time" />}
            </div>
          </SubGroup>
        )}

        {hasFindings && (
          <SubGroup title="Material findings" sub="Top issues surfaced by the diagnostic.">
            <div className="report-summary-grid">
              {bottleneckLabel && (
                <SummaryStat
                  value={bottleneckLabel}
                  label="Main bottleneck"
                  tone="warn"
                  sub={bottleneck.why || undefined}
                />
              )}
              {savingsPercent > 0 && (
                <SummaryStat value={`~${savingsPercent}%`} label="Estimated saving" tone="positive" />
              )}
              {issues.length > 0 && (
                <SummaryStat
                  value={issues.length}
                  label={`Issue${issues.length !== 1 ? 's' : ''} identified`}
                  tone="warn"
                />
              )}
            </div>
          </SubGroup>
        )}

        {quality && (
          <SubGroup title="Data confidence" sub="How much of this is evidence vs. inference.">
            <div className="report-summary-grid">
              <SummaryStat
                value={quality.grade || '—'}
                label="Confidence"
                tone={quality.grade === 'HIGH' ? 'positive' : quality.grade === 'LOW' ? 'danger' : 'warn'}
                sub={quality.score != null ? `Score: ${quality.score}/100` : undefined}
              />
            </div>
          </SubGroup>
        )}
      </div>
    </section>
  );
}
