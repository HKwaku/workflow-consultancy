'use client';

/**
 * Modal shown when a user clicks a metric tile.
 * Explains how the metric was calculated.
 */
const METRIC_EXPLANATIONS = {
  stepsMapped: {
    title: 'Steps mapped',
    description: 'The number of steps in your process map. Each step represents a discrete activity in the workflow.',
    formula: 'Count of steps in the process definition.',
  },
  handoffs: {
    title: 'Handoffs',
    description: 'Handoffs are transfers of work between steps (e.g. from one team to the next). Each handoff is the gap between two consecutive steps.',
    formula: 'Number of handoffs = number of steps minus 1.',
  },
  teamsInvolved: {
    title: 'Teams involved',
    description: 'The number of unique departments or teams assigned to steps in this process.',
    formula: 'Count of distinct department values across all steps.',
  },
  checklistItems: {
    title: 'Checklist items',
    description: 'Checklist completion across all steps. Each step can have checklist items that were marked as done or pending.',
    formula: 'Completed items / Total checklist items across all steps.',
  },
  annualCost: {
    title: 'Annual cost',
    description: 'Estimated annual cost of running this process, based on user input: hourly rate, time per instance, and frequency.',
    formula: 'Instance cost × annual instances. Instance cost = hourly rate × hours per instance.',
  },
  averageCycle: {
    title: 'Average cycle',
    description: 'The typical time from start to finish for one instance of this process.',
    formula: 'From costs.cycleDays or lastExample.elapsedDays (days from your last real example).',
  },
  steps: {
    title: 'Steps',
    description: 'Total number of steps in this process.',
    formula: 'Count of steps in the process definition.',
  },
  confidence: {
    title: 'Confidence',
    description: 'Confidence in the quality of the process data. Higher scores indicate more detail and completeness.',
    formula: 'Based on: step count, detail level, handoffs, systems, cost data, bottleneck info, and last example.',
  },
  processesAnalysed: {
    title: 'Processes Analysed',
    description: 'Total number of processes across all your saved diagnostic reports.',
    formula: 'Sum of processes in each report (reports.metrics.totalProcesses).',
  },
  automationReadiness: {
    title: 'Automation Readiness',
    description: 'Average automation readiness percentage across your reports. Steps are classified as simple automation, AI agent, human-in-the-loop, or multi-agent.',
    formula: 'Average of each report\'s automation percentage. 70%+ = High, 40–69% = Moderate, &lt;40% = Low.',
  },
  redesigned: {
    title: 'Redesigned',
    description: 'Number of reports that have a redesign (accepted or pending).',
    formula: 'Count of reports with redesignStatus = accepted or pending.',
  },
  annualProcessCost: {
    title: 'Annual Process Cost',
    description: 'Total estimated annual cost of running all processes across your reports.',
    formula: 'Sum of totalAnnualCost from each report\'s metrics.',
  },
};

export default function MetricDrillModal({ metricKey, value, label, onClose }) {
  const meta = METRIC_EXPLANATIONS[metricKey] || {
    title: label || metricKey,
    description: 'How this metric was calculated.',
    formula: 'See process data for details.',
  };

  return (
    <div className="metric-drill-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="metric-drill-modal" onClick={e => e.stopPropagation()}>
        <div className="metric-drill-header">
          <h4 className="metric-drill-title">{meta.title}</h4>
          <button type="button" className="metric-drill-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="metric-drill-value">{value}</div>
        <p className="metric-drill-desc">{meta.description}</p>
        <div className="metric-drill-formula">
          <strong>How we calculated:</strong> {meta.formula}
        </div>
      </div>
    </div>
  );
}
