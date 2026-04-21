/**
 * Report module — report rendering, hero, implementation tracker, metric drill.
 *
 * JSX components live in `components/report/*` and are re-exported here so
 * consumers can `import { ReportReadyHero } from '@/modules/report'`.
 */

export { default as ReportReadyHero } from '../../../components/report/ReportReadyHero.jsx';
export { default as ImplementationTracker } from '../../../components/report/ImplementationTracker.jsx';
export { default as MetricDrillModal } from '../../../components/report/MetricDrillModal.jsx';
export { default as StepInsightPanel } from '../../../components/report/StepInsightPanel.jsx';
export { default as ReportAtAGlanceBody, buildAtAGlanceProps } from '../../../components/report/ReportAtAGlanceSummary.jsx';
export { default as ExecutiveSummary } from '../../../components/report/ExecutiveSummary.jsx';
export { default as KeyFindings } from '../../../components/report/KeyFindings.jsx';
export { default as ValueOpportunity } from '../../../components/report/ValueOpportunity.jsx';
export { default as RoadmapRollup } from '../../../components/report/RoadmapRollup.jsx';
export { default as ProcessViewToggle } from '../../../components/report/ProcessViewToggle.jsx';
export { default as ReportAppendices } from '../../../components/report/ReportAppendices.jsx';

// Analysis helpers used by report rendering
export { detectBottlenecks, getSignificantBottlenecks } from '../../diagnostic/detectBottlenecks.js';
export { buildMapObservations } from '../../diagnostic/buildMapObservations.js';
export { runRecommendationsAgent } from '../../agents/recommendations/graph.js';
