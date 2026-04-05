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
    description: 'The number of unique teams assigned to steps in this process.',
    formula: 'Count of distinct team values across all steps.',
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
  systems: {
    title: 'Systems used',
    description: 'The number of unique tools, platforms, or software systems involved in this process. Each system represents a distinct application or service used by one or more steps.',
    formula: 'Count of distinct system names across all steps (systems field per step).',
  },
  decisionPoints: {
    title: 'Decision points',
    description: 'Steps where the process branches into two or more paths. Decision points indicate complexity and often require human judgement to evaluate conditions.',
    formula: 'Count of steps where isDecision is true and at least one branch is defined.',
  },
  approvals: {
    title: 'Approvals',
    description: 'Steps that require an explicit sign-off or approval before the process can continue. High approval counts can indicate bottlenecks or governance overhead.',
    formula: 'Count of steps where isApproval is true.',
  },
  bottlenecks: {
    title: 'Bottlenecks',
    description: 'Steps with recorded wait time that act as constraints on the process. The step with the highest wait time is the primary bottleneck. Severity is increased by approval gates, late-stage decisions, multi-system steps, and unclear handoffs.',
    formula: 'Count of steps with wait time > 0 scoring medium or high risk. The highest-wait step is the key bottleneck.',
  },
  workWaitRatio: {
    title: 'Work / Wait ratio',
    description: 'Active work time versus waiting/idle time across all steps. A high proportion of wait time indicates delays caused by handoffs, approvals, or queuing — prime targets for process improvement.',
    formula: 'Sum of workMinutes across all steps vs sum of waitMinutes. Value-adding % = work ÷ (work + wait) × 100.',
  },
  complexity: {
    title: 'Complexity score',
    description: 'A composite score reflecting how complex this process is to manage and improve. Higher scores indicate more decision points, bottlenecks, cross-team handoffs, and external dependencies.',
    formula: '(decision points × 2) + (bottlenecks × 2) + teams + (handoffs × 0.5) + external steps. Ranges: Low 0–3, Medium 4–7, High 8–12, Very High 13+.',
  },
  externalDependencies: {
    title: 'External dependencies',
    description: 'Steps owned or performed by a party outside your organisation — suppliers, clients, regulators, or third-party services. These steps sit outside your direct control, making them harder to automate, schedule, or improve without vendor cooperation.',
    formula: 'Count of steps where the owner is marked as external.',
  },
  timelineEstimate: {
    title: 'Timeline estimate',
    description: 'Estimated end-to-end duration based on the sum of work and wait times captured across all steps.',
    formula: 'Sum of workMinutes + waitMinutes across all steps, converted to hours or days.',
  },
};

export default function MetricDrillModal({ metricKey, value, label, onClose }) {
  const meta = METRIC_EXPLANATIONS[metricKey] || {
    title: label || metricKey,
    description: 'How this metric was calculated.',
    formula: 'See process data for details.',
  };

  const isArrayValue = Array.isArray(value);

  return (
    <div className="metric-drill-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="metric-drill-modal" onClick={e => e.stopPropagation()}>
        <div className="metric-drill-header">
          <h4 className="metric-drill-title">{meta.title}</h4>
          <button type="button" className="metric-drill-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        {isArrayValue ? (
          <ul className="metric-drill-list">
            {value.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        ) : (
          <div className="metric-drill-value">{value}</div>
        )}
        <p className="metric-drill-desc">{meta.description}</p>
        <div className="metric-drill-formula">
          <strong>How we calculated:</strong> {meta.formula}
        </div>
      </div>
    </div>
  );
}
