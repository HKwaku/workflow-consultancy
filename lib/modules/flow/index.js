/**
 * Flow module — process flow canvas, nodes, edges, and flow-generation agent.
 *
 * `lib/flows/index.js` is the internal aggregator; we re-export its public API
 * plus the JSX components that render flows on screen.
 */

// Flow-diagram rendering (SVG/HTML) + classification helpers
export {
  buildFlowSVG,
  buildGridSVG,
  buildSwimlaneSVG,
  buildListHTML,
  getSwimlaneLaneData,
  classifyAutomation,
  AUTOMATION_CATEGORIES,
  escSvg,
} from '../../flows/index.js';

// Flow-generation AI agent (server-side, used by /api routes)
export { runFlowAgent } from '../../agents/flow/graph.js';
export { ALL_FLOW_TOOLS } from '../../agents/flow/tools.js';

// Canvas + viewer components
export { default as InteractiveFlowCanvas } from '../../../components/flow/InteractiveFlowCanvas.jsx';
export { default as DecisionBranchEdge } from '../../../components/flow/DecisionBranchEdge.jsx';
export { default as DeletableEdge } from '../../../components/flow/DeletableEdge.jsx';
export { default as WrapEdge } from '../../../components/flow/WrapEdge.jsx';
export { default as FloatingFlowViewer } from '../../../components/diagnostic/FloatingFlowViewer.jsx';

// React Flow node types (named exports, used via nodeTypes map)
export {
  StartNode, EndNode, StepNode, DecisionNode, MergeNode,
  LaneLabelNode, LaneSeparatorNode,
} from '../../../components/flow/FlowNodes.jsx';
