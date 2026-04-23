/**
 * Diagnostic module — process audit intake: screens, context, templates, analysis.
 *
 * Consumers should import from '@/modules/diagnostic' rather than reaching into
 * `lib/diagnostic/*` directly. This module's surface is the public API.
 */

export { detectBottlenecks, getSignificantBottlenecks } from '../../diagnostic/detectBottlenecks.js';
export { buildMapObservations } from '../../diagnostic/buildMapObservations.js';
export { calculateAutomationScore, calculateProcessQuality } from '../../diagnostic/buildLocalResults.js';
export * as automationReadiness from '../../diagnostic/automationReadiness.js';
export * as processDuration from '../../diagnostic/processDuration.js';
export * as processData from '../../diagnostic/processData.js';
export { PROCESS_TEMPLATES } from '../../diagnostic/processTemplates.js';
export * as stepConstants from '../../diagnostic/stepConstants.js';
export * as stepSuggestions from '../../diagnostic/stepSuggestions.js';
export * as handoffOptions from '../../diagnostic/handoffOptions.js';
export * as savedSnippets from '../../diagnostic/savedSnippets.js';
export * as diagnosticUtils from '../../diagnostic/utils.js';

// Chat agent (primary intake + map-edit conversation)
export { runChatAgent } from '../../agents/chat/graph.js';
export { ALL_CHAT_TOOLS } from '../../agents/chat/tools.js';

// Diagnostic UI components
export { default as DiagnosticClient } from '../../../components/diagnostic/DiagnosticClient.jsx';
export { default as IntroChatScreen } from '../../../components/diagnostic/IntroChatScreen.jsx';
export { default as ProgressBar } from '../../../components/diagnostic/ProgressBar.jsx';
export { default as ChatPanel } from '../../../components/diagnostic/ChatPanel.jsx';
export { default as ChatHistoryPanel } from '../../../components/diagnostic/ChatHistoryPanel.jsx';
export { default as AuditTrailPanel } from '../../../components/diagnostic/AuditTrailPanel.jsx';
export { default as FlowchartPan } from '../../../components/diagnostic/FlowchartPan.jsx';
export { default as TeamAuthGate } from '../../../components/diagnostic/TeamAuthGate.jsx';
