/**
 * Automation opportunity classifier for process steps.
 * Returns { key, label, badge, color, bg, reason } or null.
 *
 * Categories:
 *   'simple'      - Rule-based automation, no AI needed
 *   'agent'       - Autonomous AI agent
 *   'human-loop'  - Agent with human-in-the-loop oversight
 *   'multi-agent' - Multi-agent orchestration system
 */

export const AUTOMATION_CATEGORIES = {
  simple: { key: 'simple', label: 'Simple Automation', badge: 'S', color: '#0891b2', bg: '#ecfeff' },
  agent: { key: 'agent', label: 'AI Agent', badge: 'A', color: '#7c3aed', bg: '#f5f3ff' },
  humanLoop: { key: 'human-loop', label: 'Agent + Human', badge: 'H', color: '#ea580c', bg: '#fff7ed' },
  multiAgent: { key: 'multi-agent', label: 'Multi-Agent System', badge: 'M', color: '#be185d', bg: '#fdf2f8' },
};

export function classifyAutomation(step, stepIdx, process) {
  const name = (step.name || '').toLowerCase();
  const handoffs = process.handoffs || [];
  const steps = process.steps || [];
  const handoff = handoffs[stepIdx];
  const prevHandoff = stepIdx > 0 ? handoffs[stepIdx - 1] : null;

  const allStepSystems = steps.flatMap((s) => s.systems || []);
  const uniqueSystems = new Set(allStepSystems.map((s) => s.toLowerCase()));
  const prevStepSystems = stepIdx > 0 ? (steps[stepIdx - 1]?.systems || []) : [];
  const thisStepSystems = step.systems || [];
  const adjacentSwitch =
    prevStepSystems.length > 0 &&
    thisStepSystems.length > 0 &&
    !prevStepSystems.some((s) => thisStepSystems.map((x) => x.toLowerCase()).includes(s.toLowerCase()));
  const hasCopy = uniqueSystems.size >= 2 || adjacentSwitch;

  const stepDept = step.department || 'Other';
  const prevDept = stepIdx > 0 ? (steps[stepIdx - 1]?.department || 'Other') : null;
  const nextDept = stepIdx < steps.length - 1 ? (steps[stepIdx + 1]?.department || 'Other') : null;
  const crossesDepts = (prevDept && prevDept !== stepDept) || (nextDept && nextDept !== stepDept);

  let isBottleneckStep = false;
  if (process.bottleneck?.longestStep) {
    const bnIdx = parseInt(String(process.bottleneck.longestStep).replace('step-', ''));
    isBottleneckStep = bnIdx === stepIdx;
  }
  const hasBadHandoff = handoff && (handoff.clarity === 'yes-multiple' || handoff.clarity === 'yes-major');
  const hadBadHandoffIn = prevHandoff && (prevHandoff.clarity === 'yes-multiple' || prevHandoff.clarity === 'yes-major');

  if (hasBadHandoff && hadBadHandoffIn && crossesDepts) {
    return { ...AUTOMATION_CATEGORIES.multiAgent, reason: 'Cross-department orchestration gap. Needs coordinated agents with routing, escalation, and status tracking' };
  }
  if ((name.includes('onboard') || name.includes('provision')) && crossesDepts) {
    return { ...AUTOMATION_CATEGORIES.multiAgent, reason: 'Multi-department onboarding. Needs provisioning agent, notification agent, and verification agent working in concert' };
  }
  if (name.includes('coordinate') && crossesDepts) {
    return { ...AUTOMATION_CATEGORIES.multiAgent, reason: 'Cross-team coordination. Requires orchestrator agent delegating to specialist agents per department' };
  }

  if (name.includes('approv')) {
    const extra = isBottleneckStep ? ' (bottleneck. Agent can auto-route and prepare decision summary)' : '';
    return { ...AUTOMATION_CATEGORIES.humanLoop, reason: 'Approval decision. Agent prepares context, validates criteria, and routes; human makes final call' + extra };
  }
  if (name.includes('review') || name.includes('qa') || name.includes('audit')) {
    return { ...AUTOMATION_CATEGORIES.humanLoop, reason: 'Quality review. Agent performs automated checks and flags anomalies; human confirms' };
  }
  if (name.includes('validate') || name.includes('verify')) {
    return { ...AUTOMATION_CATEGORIES.humanLoop, reason: 'Validation step. Agent checks against business rules; human handles edge cases and exceptions' };
  }
  if (name.includes('escalat') || name.includes('exception') || name.includes('dispute')) {
    return { ...AUTOMATION_CATEGORIES.humanLoop, reason: 'Exception handling. Agent triages and categorises; human resolves complex cases' };
  }
  if ((name.includes('configure') || name.includes('design') || name.includes('plan')) && crossesDepts) {
    return { ...AUTOMATION_CATEGORIES.humanLoop, reason: 'Complex setup. Agent drafts configuration; human reviews and adjusts' };
  }

  if (name.includes('match') || name.includes('reconcil') || name.includes('compare')) {
    return { ...AUTOMATION_CATEGORIES.agent, reason: 'Data reconciliation. Agent uses fuzzy matching and context to auto-reconcile across sources' };
  }
  if (name.includes('schedule') || name.includes('book') || name.includes('prioriti')) {
    return { ...AUTOMATION_CATEGORIES.agent, reason: 'Intelligent scheduling. Agent optimises timing, resolves conflicts, and balances workload' };
  }
  if (name.includes('follow up') || name.includes('chase') || name.includes('wait') || name.includes('remind')) {
    return { ...AUTOMATION_CATEGORIES.agent, reason: 'Adaptive follow-up. Agent tracks status, adjusts urgency, and escalates when thresholds hit' };
  }
  if (name.includes('classify') || name.includes('categoris') || name.includes('categoriz') || name.includes('triage') || name.includes('assess')) {
    return { ...AUTOMATION_CATEGORIES.agent, reason: 'Intelligent classification. Agent analyses content and routes to the right team/workflow' };
  }
  if (name.includes('check') && hasCopy) {
    return { ...AUTOMATION_CATEGORIES.agent, reason: 'Cross-system validation. Agent checks data consistency across integrated systems' };
  }
  if (hasBadHandoff && crossesDepts) {
    return { ...AUTOMATION_CATEGORIES.agent, reason: 'Handoff bridge. Agent manages the transition, ensures data completeness, and confirms receipt' };
  }
  if (name.includes('assign') || name.includes('allocat')) {
    return { ...AUTOMATION_CATEGORIES.agent, reason: 'Smart assignment. Agent evaluates workload, skills, and availability to assign optimally' };
  }

  if (name.includes('send') || name.includes('notify') || name.includes('email')) {
    return { ...AUTOMATION_CATEGORIES.simple, reason: 'Notification trigger. Automate with a rule: when step completes, fire templated message' };
  }
  if (name.includes('enter') || name.includes('log') || name.includes('record') || name.includes('copy') || name.includes('input')) {
    return { ...AUTOMATION_CATEGORIES.simple, reason: 'Data entry. Automate with direct API integration between source and target systems' };
  }
  if (hasCopy && (name.includes('update') || name.includes('transfer') || name.includes('move') || name.includes('sync'))) {
    return { ...AUTOMATION_CATEGORIES.simple, reason: 'System sync. Automate with API-to-API data pipeline, no human or AI needed' };
  }
  if ((name.includes('setup') || name.includes('provision') || name.includes('create account')) && !crossesDepts) {
    return { ...AUTOMATION_CATEGORIES.simple, reason: 'Provisioning - automate with scripted API calls to create/configure resources' };
  }
  if (name.includes('status') || name.includes('stamp') || name.includes('mark as') || name.includes('close') || name.includes('archive')) {
    return { ...AUTOMATION_CATEGORIES.simple, reason: 'Status update - automate with a trigger rule that updates the record state' };
  }
  if (name.includes('generate') || name.includes('produce') || name.includes('print') || name.includes('export')) {
    return { ...AUTOMATION_CATEGORIES.simple, reason: 'Report/output generation - automate with templated generation triggered on completion' };
  }
  if (hasBadHandoff && !crossesDepts) {
    return { ...AUTOMATION_CATEGORIES.simple, reason: 'Handoff automation - automate with a queue/notification that pushes work to the next person' };
  }
  if (adjacentSwitch) {
    return { ...AUTOMATION_CATEGORIES.simple, reason: 'System-to-system boundary  -  likely involves manual data transfer. API integration would eliminate this step.' };
  }

  return null;
}
