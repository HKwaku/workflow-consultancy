'use client';

import { useState } from 'react';
import { detectBottlenecks } from '@/lib/diagnostic/detectBottlenecks';

/**
 * Cross-process synthesis of material findings. Rendered inside its own
 * report tab, with three sub-tabs covering the operational-DD concerns:
 *   1. Operational bottlenecks    (wait-driven step risk + key-person risk)
 *   2. Control & documentation    (SOP / documentation / evidence gaps)
 *   3. Handoff & integration      (cross-team transitions with clarity issues)
 *
 * Findings that reference a specific step render as links that open the
 * step-edit dialogue in a new tab (`/process-audit?edit=<id>&step=<i>`),
 * so a reader can jump from finding -> source data without losing the report.
 */

const WAIT_TYPE_LABEL = {
  dependency: 'Dependency wait',
  blocked: 'Blocked',
  capacity: 'Capacity constraint',
  wip: 'WIP / context-switching',
};

function fmtMinutes(m) {
  if (!m || m <= 0) return '\u2014';
  if (m >= 1440) return `${(m / 1440).toFixed(1)}d`;
  if (m >= 60) return `${Math.round(m / 60)}h`;
  return `${Math.round(m)}m`;
}

function buildStepEditHref(reportId, email, stepIndex) {
  if (!reportId || stepIndex == null || stepIndex < 0) return null;
  const parts = [`edit=${encodeURIComponent(reportId)}`, `step=${encodeURIComponent(stepIndex)}`];
  if (email) parts.push(`email=${encodeURIComponent(email)}`);
  return `/process-audit?${parts.join('&')}`;
}

export default function KeyFindings({
  rawProcesses = [],
  processes = [],
  segment = null,
  isMapOnly = false,
  inlineInTab = false,
  editReportId = null,
  editEmail = null,
}) {
  const findings = buildCrossProcessFindings(rawProcesses, processes, segment);

  // Roll related findings into the three category tabs the user asked for.
  // Bottlenecks + knowledge risk both live under "Operational bottlenecks";
  // SOP/doc gaps + data-quality flags live under "Control & documentation".
  const bottleneckCount = findings.topBottlenecks.length + findings.knowledgeRisks.length;
  const controlCount = findings.controlGaps.length + findings.dataQualityFlags.length;
  const handoffCount = findings.handoffConcerns.length;
  const total = bottleneckCount + controlCount + handoffCount;

  if (total === 0) return null;

  const tabs = [];
  if (bottleneckCount > 0) {
    tabs.push({
      id: 'bottlenecks',
      label: 'Operational bottlenecks',
      count: bottleneckCount,
      render: () => (
        <div className="report-findings-tab-body">
          {findings.topBottlenecks.length > 0 && (
            <FindingCard
              tone="bottleneck"
              title="Operational bottlenecks"
              count={findings.topBottlenecks.length}
              note="Ranked by wait time. Click a step to open it in the diagnostic."
            >
              <ul className="report-finding-list">
                {findings.topBottlenecks.slice(0, 8).map((b, i) => (
                  <FindingItem
                    key={i}
                    risk={b.risk}
                    title={b.stepName}
                    meta={`${b.processName} \u00B7 ${WAIT_TYPE_LABEL[b.waitType] || 'Wait'} \u00B7 ${fmtMinutes(b.waitMinutes)}`}
                    href={buildStepEditHref(editReportId, editEmail, b.stepIndex)}
                  />
                ))}
              </ul>
            </FindingCard>
          )}
          {findings.knowledgeRisks.length > 0 && (
            <FindingCard
              tone="risk"
              title="Key-person / knowledge risk"
              count={findings.knowledgeRisks.length}
              note="Processes exposed if the named operator is unavailable."
            >
              <ul className="report-finding-list">
                {findings.knowledgeRisks.map((k, i) => (
                  <FindingItem
                    key={i}
                    risk={k.severity}
                    title={k.processName}
                    meta={k.impact === 'stops' ? 'Process stops when key operator unavailable' : 'Process slows down when key operator unavailable'}
                  />
                ))}
              </ul>
            </FindingCard>
          )}
        </div>
      ),
    });
  }

  if (controlCount > 0) {
    tabs.push({
      id: 'control',
      label: 'Control & documentation gaps',
      count: controlCount,
      render: () => (
        <div className="report-findings-tab-body">
          {findings.controlGaps.length > 0 && (
            <FindingCard
              tone="control"
              title={segment === 'pe' ? 'Control & data-room gaps' : 'Control & documentation gaps'}
              count={findings.controlGaps.length}
              note={segment === 'pe'
                ? 'Items buy-side diligence will question.'
                : 'Gaps that complicate scale-up or handover.'}
            >
              <ul className="report-finding-list">
                {findings.controlGaps.map((g, i) => (
                  <FindingItem
                    key={i}
                    risk={g.severity}
                    title={g.title}
                    meta={`${g.process} \u00B7 ${g.detail}`}
                  />
                ))}
              </ul>
            </FindingCard>
          )}
          {findings.dataQualityFlags.length > 0 && (
            <FindingCard
              tone="quality"
              title="Data-quality flags"
              count={findings.dataQualityFlags.length}
              note="Reduces confidence in headline estimates."
            >
              <ul className="report-finding-list">
                {findings.dataQualityFlags.map((q, i) => (
                  <FindingItem
                    key={i}
                    risk={q.severity}
                    title={q.processName}
                    meta={q.flag}
                  />
                ))}
              </ul>
            </FindingCard>
          )}
        </div>
      ),
    });
  }

  if (handoffCount > 0) {
    tabs.push({
      id: 'handoff',
      label: 'Handoff & integration issues',
      count: handoffCount,
      render: () => (
        <div className="report-findings-tab-body">
          <FindingCard
            tone="handoff"
            title="Handoff & integration issues"
            count={findings.handoffConcerns.length}
            note="Cross-team transitions where clarity / method is weak. Click a step-level issue to open it in the diagnostic."
          >
            <ul className="report-finding-list">
              {findings.handoffConcerns.map((h, i) => (
                <FindingItem
                  key={i}
                  risk={h.severity}
                  title={`${h.from} \u2192 ${h.to}`}
                  meta={`${h.processName} \u00B7 ${h.reason}`}
                  href={buildStepEditHref(editReportId, editEmail, h.stepIndex)}
                />
              ))}
            </ul>
          </FindingCard>
        </div>
      ),
    });
  }

  return (
    <section
      className={`report-key-findings${inlineInTab ? ' report-key-findings--inline' : ''}`}
      aria-labelledby={inlineInTab ? undefined : 'key-findings-heading'}
    >
      {!inlineInTab && (
        <header className="report-section-header">
          <h2 id="key-findings-heading" className="report-section-title">
            Material findings across the operating model
          </h2>
          <p className="report-section-sub">
            Cross-process synthesis. Per-process drill-downs follow below.
          </p>
        </header>
      )}

      <FindingsSubTabs tabs={tabs} />
    </section>
  );
}

function FindingsSubTabs({ tabs }) {
  const [active, setActive] = useState(tabs[0]?.id);
  const activeTab = tabs.find((t) => t.id === active) || tabs[0];
  return (
    <div className="report-findings-subtabs">
      <nav className="report-findings-subtabs-nav" role="tablist">
        {tabs.map((t) => {
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`report-findings-subtab${isActive ? ' active' : ''}`}
              onClick={() => setActive(t.id)}
            >
              <span className="report-findings-subtab-label">{t.label}</span>
              <span className="report-findings-subtab-count">{t.count}</span>
            </button>
          );
        })}
      </nav>
      <div className="report-findings-subtabs-content">
        {activeTab?.render()}
      </div>
    </div>
  );
}

function FindingCard({ tone, title, count, note, children }) {
  return (
    <article className={`report-finding-card report-finding-card--${tone}`}>
      <header className="report-finding-card-head">
        <h3 className="report-finding-card-title">{title}</h3>
        <span className="report-finding-card-count">{count}</span>
      </header>
      {note && <p className="report-finding-card-note">{note}</p>}
      {children}
    </article>
  );
}

function FindingItem({ risk, title, meta, href }) {
  const cls = `report-finding-item risk-${risk}`;
  if (href) {
    return (
      <li className={`${cls} report-finding-item--link`}>
        <a href={href} target="_blank" rel="noopener noreferrer" className="report-finding-item-anchor">
          <span className="report-finding-item-title">
            {title}
            <span className="report-finding-item-ext" aria-hidden>{'\u2197'}</span>
          </span>
          <span className="report-finding-item-meta">{meta}</span>
        </a>
      </li>
    );
  }
  return (
    <li className={cls}>
      <span className="report-finding-item-title">{title}</span>
      <span className="report-finding-item-meta">{meta}</span>
    </li>
  );
}

function buildCrossProcessFindings(rawProcesses, processes, segment) {
  const topBottlenecks = [];
  const knowledgeRisks = [];
  const controlGaps = [];
  const dataQualityFlags = [];
  const handoffConcerns = [];

  rawProcesses.forEach((raw, idx) => {
    const proc = processes[idx] || raw;
    const name = raw.processName || proc.name || `Process ${idx + 1}`;

    const bottlenecks = detectBottlenecks(raw) || [];
    bottlenecks
      .filter((b) => b.risk === 'high' || b.risk === 'medium')
      .forEach((b) => topBottlenecks.push({ ...b, processName: name, processIndex: idx }));

    const vac = raw.knowledge?.vacationImpact;
    if (vac && vac !== 'no-impact' && vac !== 'none') {
      knowledgeRisks.push({
        processName: name,
        processIndex: idx,
        impact: vac,
        severity: vac === 'stops' ? 'high' : 'medium',
      });
    }

    if (segment === 'pe') {
      if (raw.peSopStatus && raw.peSopStatus !== 'documented') {
        controlGaps.push({
          process: name,
          processIndex: idx,
          title: raw.peSopStatus === 'partial' ? 'Partial SOP coverage' : 'No documented SOP',
          detail: 'Buyer diligence expects documented SOPs for revenue/reporting-critical processes.',
          severity: raw.peSopStatus === 'partial' ? 'medium' : 'high',
        });
      }
      if (raw.peKeyPerson === 'yes') {
        controlGaps.push({
          process: name,
          processIndex: idx,
          title: 'Key-person dependency',
          detail: 'Self-reported as single point of failure.',
          severity: 'high',
        });
      }
      if (raw.peReportingImpact === 'yes-direct') {
        controlGaps.push({
          process: name,
          processIndex: idx,
          title: 'Feeds management reporting',
          detail: 'Any error here flows through to monthly accounts \u2014 auditability required.',
          severity: 'medium',
        });
      }
    } else {
      const stepCount = (raw.steps || []).length;
      const undocumentedChecklists = (raw.steps || []).filter((s) => !(s.checklist || []).length).length;
      if (stepCount > 0 && stepCount < 4) {
        controlGaps.push({
          process: name,
          processIndex: idx,
          title: 'Thinly documented process',
          detail: `Only ${stepCount} steps mapped \u2014 likely more tacit steps exist.`,
          severity: 'medium',
        });
      }
      if (stepCount >= 4 && undocumentedChecklists === stepCount) {
        controlGaps.push({
          process: name,
          processIndex: idx,
          title: 'No step-level checklists',
          detail: 'None of the steps carry a checklist \u2014 limits runbook/handover utility.',
          severity: 'low',
        });
      }
    }

    const q = raw.quality || proc.quality;
    if (q?.grade === 'LOW') {
      dataQualityFlags.push({
        processName: name,
        flag: `Low data-quality score (${q.score ?? '\u2014'}/100) \u2014 treat headline estimates as directional.`,
        severity: 'medium',
      });
    }
    if (Array.isArray(q?.flags)) {
      q.flags.forEach((f) => {
        const label = typeof f === 'string' ? f : f?.message || f?.flag || JSON.stringify(f);
        if (label) dataQualityFlags.push({ processName: name, flag: label, severity: 'low' });
      });
    }

    const handoffs = raw.handoffs || [];
    handoffs.forEach((h) => {
      const clarity = (h.clarity || '').toLowerCase();
      if (clarity === 'unclear' || clarity === 'poor') {
        handoffConcerns.push({
          processName: name,
          processIndex: idx,
          from: h.from || h.fromDept || 'Upstream',
          to: h.to || h.toDept || 'Downstream',
          reason: h.method ? `${h.method} \u2014 clarity flagged as ${clarity}` : `Clarity flagged as ${clarity}`,
          severity: clarity === 'poor' ? 'high' : 'medium',
        });
      }
    });

    const steps = raw.steps || [];
    for (let i = 1; i < steps.length; i++) {
      const prev = steps[i - 1]?.department;
      const curr = steps[i]?.department;
      if (prev && curr && prev !== curr && (steps[i].waitMinutes || 0) > 240) {
        handoffConcerns.push({
          processName: name,
          processIndex: idx,
          stepIndex: i,
          from: prev,
          to: curr,
          reason: `Long wait at handoff (${fmtMinutes(steps[i].waitMinutes)}).`,
          severity: 'medium',
        });
      }
    }
  });

  topBottlenecks.sort((a, b) => (b.waitMinutes || 0) - (a.waitMinutes || 0));
  return { topBottlenecks, knowledgeRisks, controlGaps, dataQualityFlags, handoffConcerns };
}
