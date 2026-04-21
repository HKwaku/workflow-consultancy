'use client';

/**
 * Appendices for an ODD-style report: methodology, confidence & data sources,
 * benchmark references, inline audit trail digest. Sits at the bottom of the
 * Full report. A floating button elsewhere opens the full AuditTrailPanel.
 */

const EVENT_LABEL = {
  handover: 'Handover',
  save: 'Save',
  resume: 'Resume',
  edit: 'Edit',
  submit: 'Submit',
  step_add: 'Step added',
  step_remove: 'Step removed',
  step_edit: 'Step change',
  checklist: 'Checklist update',
  navigate: 'Navigation',
  created: 'Session started',
  redesign_ai: 'AI redesign run',
  redesign_save: 'Redesign saved',
  redesign_rename: 'Redesign renamed',
};

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function ReportAppendices({
  auditTrail = [],
  benchmark = null,
  industry = null,
  diagnosticMode = null,
  processCount = 0,
  showAuditTrail = true,
}) {
  const hasAudit = showAuditTrail && auditTrail.length > 0;
  const trailPreview = hasAudit ? auditTrail.slice(-8).reverse() : [];
  const firstEvent = auditTrail[0];
  const lastEvent = auditTrail[auditTrail.length - 1];

  return (
    <section className="report-appendices" aria-labelledby="appendices-heading">
      <header className="report-section-header">
        <h2 id="appendices-heading" className="report-section-title">Methodology, sources &amp; audit</h2>
        <p className="report-section-sub">
          Reference material supporting the analysis above. Treat headline numbers as directional until validated against primary records.
        </p>
      </header>

      <div className="report-appendix-grid">
        <article className="report-appendix-card">
          <h3 className="report-appendix-card-title">A.1 Methodology</h3>
          <ul className="report-appendix-list">
            <li>
              Scope: {processCount} process{processCount === 1 ? '' : 'es'} captured via guided operator interview.
              {diagnosticMode === 'map-only' ? ' Map-only mode \u2014 no labour-cost or automation-readiness scoring.' : ' Comprehensive mode \u2014 full quantitative analysis.'}
            </li>
            <li>
              Bottlenecks are scored on wait-to-work ratio, handoff count, system switches, late-stage decisions and
              self-reported dwell; risk level (High / Medium / Low) derives from the composite score, not any single
              signal.
            </li>
            <li>
              Automation readiness is computed per step using a rules-based classifier (multi-agent, agent,
              agent+human, simple, manual) then weighted by time impact.
            </li>
            <li>
              Cost figures are operator-entered (hourly rate, frequency, cycle days, team size) combined with
              model-estimated hidden cost. They are not audited and should be validated against payroll / GL before
              use in any Committee memo.
            </li>
          </ul>
        </article>

        <article className="report-appendix-card">
          <h3 className="report-appendix-card-title">A.2 Confidence &amp; limitations</h3>
          <ul className="report-appendix-list">
            <li>Findings reflect operator perspective; cross-functional validation is recommended.</li>
            <li>Benchmarks (where shown) are internal reference ranges \u2014 not published indices.</li>
            <li>AI-generated recommendations are a starting point, not a contractual opinion.</li>
            <li>Redesign impact estimates compound individual step savings and ignore second-order effects (morale, supplier relationships, compliance overhead).</li>
          </ul>
        </article>

        {benchmark && industry && (
          <article className="report-appendix-card">
            <h3 className="report-appendix-card-title">A.3 Benchmark reference \u2014 {industry}</h3>
            <ul className="report-appendix-list">
              <li>Cycle time: best {benchmark.cycleDays?.best}d \u00B7 median {benchmark.cycleDays?.median}d \u00B7 worst {benchmark.cycleDays?.worst}d</li>
              {benchmark.optimalHandoffs != null && (
                <li>Optimal cross-team handoffs: \u2264 {benchmark.optimalHandoffs}</li>
              )}
              <li>Source: Vesno internal reference dataset. Ranges are indicative, not audited.</li>
            </ul>
          </article>
        )}

        {hasAudit && (
          <article className="report-appendix-card report-appendix-card--trail">
            <h3 className="report-appendix-card-title">A.4 Audit trail \u2014 recent activity</h3>
            {firstEvent && lastEvent && (
              <p className="report-appendix-trail-meta">
                {auditTrail.length} event{auditTrail.length === 1 ? '' : 's'} \u00B7 first {formatDate(firstEvent.timestamp)} \u00B7 last {formatDate(lastEvent.timestamp)}
              </p>
            )}
            <ol className="report-appendix-trail">
              {trailPreview.map((ev, i) => (
                <li key={i} className="report-appendix-trail-item">
                  <span className="report-appendix-trail-time">{formatDate(ev.timestamp)}</span>
                  <span className="report-appendix-trail-label">{EVENT_LABEL[ev.type] || ev.type}</span>
                  {ev.description && <span className="report-appendix-trail-desc">{ev.description}</span>}
                </li>
              ))}
            </ol>
            {auditTrail.length > trailPreview.length && (
              <p className="report-appendix-trail-more">+ {auditTrail.length - trailPreview.length} earlier event{auditTrail.length - trailPreview.length === 1 ? '' : 's'} \u2014 open the activity log (bottom-right) for the full record.</p>
            )}
          </article>
        )}
      </div>
    </section>
  );
}
