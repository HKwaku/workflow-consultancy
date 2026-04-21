'use client';

/**
 * Cross-process recommendations grouped into an execution roadmap.
 * Quick wins → medium-term → long-term, with optional sequencing notes
 * from redesign.implementationPriority.
 */

const EFFORT_META = {
  'quick-win': { label: 'Quick wins', horizon: '0-30 days', tone: 'win', icon: '\u26A1' },
  'medium':    { label: 'Medium-term', horizon: '30-90 days', tone: 'med', icon: '\u{1F3AF}' },
  'project':   { label: 'Long-term',   horizon: '90+ days',   tone: 'long', icon: '\u{1F527}' },
  'other':     { label: 'Unclassified', horizon: '', tone: 'other', icon: '\u{1F4CB}' },
};

const EFFORT_ORDER = ['quick-win', 'medium', 'project', 'other'];

export default function RoadmapRollup({ recommendations = [], implementationPriority = [] }) {
  if (recommendations.length === 0 && implementationPriority.length === 0) return null;

  const byEffort = {};
  recommendations.forEach((r) => {
    const key = EFFORT_ORDER.includes(r.effortLevel) ? r.effortLevel : 'other';
    if (!byEffort[key]) byEffort[key] = [];
    byEffort[key].push(r);
  });

  const hasPriority = implementationPriority && implementationPriority.length > 0;

  return (
    <section className="report-roadmap-rollup" aria-labelledby="roadmap-rollup-heading">
      <header className="report-section-header">
        <h2 id="roadmap-rollup-heading" className="report-section-title">Execution sequence</h2>
        <p className="report-section-sub">
          {hasPriority
            ? 'Phased plan from the redesign, grouped by effort and impact.'
            : 'Cross-process recommendations grouped by effort. Start at quick wins; sequence long-term items after redesign is signed off.'}
        </p>
      </header>

      {hasPriority && (
        <ol className="report-roadmap-timeline">
          {implementationPriority.map((ip, i) => {
            const isObj = typeof ip === 'object' && ip !== null;
            const text = isObj
              ? (ip.action || ip.description || JSON.stringify(ip)).replace(/^\d+\.\s*/, '')
              : String(ip).replace(/^\d+\.\s*/, '');
            const effortKey = isObj && ip.effort
              ? String(ip.effort).toLowerCase().replace(/\s+/g, '-')
              : EFFORT_ORDER[Math.min(i, EFFORT_ORDER.length - 1)];
            const meta = EFFORT_META[effortKey] || EFFORT_META.other;
            const owner = isObj ? ip.owner : null;
            return (
              <li key={i} className={`report-roadmap-timeline-item report-roadmap-timeline-item--${meta.tone}`}>
                <div className="report-roadmap-timeline-marker" aria-hidden>
                  <span className="report-roadmap-timeline-icon">{meta.icon}</span>
                  {i < implementationPriority.length - 1 && <span className="report-roadmap-timeline-line" />}
                </div>
                <div className="report-roadmap-timeline-body">
                  <div className="report-roadmap-timeline-phase">
                    <span>{meta.label}</span>
                    {meta.horizon && <span className="report-roadmap-timeline-horizon">\u00B7 {meta.horizon}</span>}
                    {owner && <span className="report-roadmap-timeline-owner">\u00B7 {owner}</span>}
                  </div>
                  <p className="report-roadmap-timeline-text">{text}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {recommendations.length > 0 && (
        <div className="report-roadmap-columns">
          {EFFORT_ORDER.filter((k) => byEffort[k]?.length).map((key) => {
            const meta = EFFORT_META[key];
            const items = byEffort[key];
            return (
              <div key={key} className={`report-roadmap-col report-roadmap-col--${meta.tone}`}>
                <header className="report-roadmap-col-head">
                  <span className="report-roadmap-col-icon">{meta.icon}</span>
                  <span className="report-roadmap-col-label">{meta.label}</span>
                  <span className="report-roadmap-col-count">{items.length}</span>
                  {meta.horizon && <span className="report-roadmap-col-horizon">{meta.horizon}</span>}
                </header>
                <ul className="report-roadmap-col-list">
                  {items
                    .sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] ?? 3) - ({ high: 0, medium: 1, low: 2 }[b.severity] ?? 3))
                    .map((r, i) => (
                      <li key={i} className={`report-roadmap-col-item sev-${r.severity || 'low'}`}>
                        {r.severity && <span className="report-severity-pill sev-pill-inline">{r.severity}</span>}
                        <span className="report-roadmap-col-text">{r.action || r.text || r.finding}</span>
                        {r.process && r.process !== 'Overall' && r.process !== 'Cross-process' && (
                          <span className="report-roadmap-col-scope">{r.process}</span>
                        )}
                      </li>
                    ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
