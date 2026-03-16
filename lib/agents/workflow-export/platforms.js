/**
 * Supported workflow automation platforms.
 * Each platform has: id, name, description, logo, bestFor (use-case guidance).
 */

const logoPath = (id) => `/images/platforms/${id}.svg`;

export const WORKFLOW_PLATFORMS = [
  { id: 'n8n', name: 'n8n', description: 'Open-source workflow automation. Self-host or cloud. Import JSON for a proof-of-concept.', logo: logoPath('n8n'), bestFor: 'Self-hosted or cloud, full control, direct JSON import. Best when you want a working PoC fast.', website: 'https://n8n.io' },
  { id: 'unqork', name: 'Unqork', description: 'Enterprise low-code platform. Workflow Builder with swimlanes, tasks, and handoffs.', logo: logoPath('unqork'), bestFor: 'Enterprise forms and case management. Regulatory compliance, multi-party workflows.', website: 'https://unqork.com' },
  { id: 'make', name: 'Make', description: 'Visual automation (formerly Integromat). Scenario blueprints for no-code workflows.', logo: logoPath('make'), bestFor: 'No-code teams. Complex branching, visual builder. Great for marketing and ops automation.', website: 'https://make.com' },
  { id: 'zapier', name: 'Zapier', description: 'Connect apps with Zaps. Triggers and actions for 5,000+ integrations.', logo: logoPath('zapier'), bestFor: 'Quick integrations between SaaS apps. Non-technical users. Fastest time to first Zap.', website: 'https://zapier.com' },
  { id: 'power-automate', name: 'Power Automate', description: 'Microsoft workflow automation. Flows for Office 365, Dynamics, and custom connectors.', logo: logoPath('power-automate'), bestFor: 'Microsoft 365 shops. SharePoint, Teams, Dynamics. Enterprise SSO and governance.', website: 'https://powerautomate.microsoft.com' },
  { id: 'pipedream', name: 'Pipedream', description: 'Developer-focused workflows. Code steps, 1,000+ pre-built integrations.', logo: logoPath('pipedream'), bestFor: 'Developers who want code in the loop. APIs, webhooks, custom logic. Event-driven flows.', website: 'https://pipedream.com' },
  { id: 'camunda', name: 'Camunda', description: 'BPMN workflow engine. Enterprise process modeling, execution, and monitoring.', logo: logoPath('camunda'), bestFor: 'BPMN workflows, compliance, audit trails. Java/Spring shops. Complex process orchestration.', website: 'https://camunda.com' },
  { id: 'temporal', name: 'Temporal', description: 'Workflow orchestration. Durable execution for long-running, reliable workflows.', logo: logoPath('temporal'), bestFor: 'Developers. Durable workflows, retries, sagas. Microservices, event-driven architectures.', website: 'https://temporal.io' },
  { id: 'retool', name: 'Retool', description: 'Internal tools and workflows. Low-code builder for ops, support, and admin tools.', logo: logoPath('retool'), bestFor: 'Internal tools, admin panels, workflows. Connect to APIs, databases, and internal systems.', website: 'https://retool.com' },
  { id: 'airtable', name: 'Airtable', description: 'Automations. Base triggers and actions for workflows built on spreadsheets.', logo: logoPath('airtable'), bestFor: 'Spreadsheet-based workflows. Non-technical teams. Automations on bases and views.', website: 'https://airtable.com' },
  { id: 'monday', name: 'Monday.com', description: 'Work management. Automations for boards, items, and integrations.', logo: logoPath('monday'), bestFor: 'Project and work management. Board automations. Team collaboration, approvals.', website: 'https://monday.com' },
  { id: 'process-street', name: 'Process Street', description: 'Checklists and workflows. Recurring SOPs, approvals, and compliance.', logo: logoPath('process-street'), bestFor: 'SOPs, checklists, recurring workflows. Compliance, onboarding, audits.', website: 'https://process.street' },
  { id: 'smartsuite', name: 'SmartSuite', description: 'Workflow automation. Workflow builder for apps and automations.', logo: logoPath('smartsuite'), bestFor: 'Workflow apps. No-code automation. Task management, approvals.', website: 'https://smartsuite.com' },
  { id: 'workato', name: 'Workato', description: 'Enterprise iPaaS. Workflow automation for IT and business teams.', logo: logoPath('workato'), bestFor: 'Enterprise integrations. IT-led automation. SSO, governance, recipes.', website: 'https://workato.com' },
  { id: 'tray-io', name: 'Tray.io', description: 'API-led automation. Workflow builder for complex integrations.', logo: logoPath('tray-io'), bestFor: 'API-led workflows. Complex integrations. Developer-friendly connectors.', website: 'https://tray.io' },
];

export function getPlatform(id) {
  return WORKFLOW_PLATFORMS.find((p) => p.id === id);
}

export function getSupportedPlatformIds() {
  return WORKFLOW_PLATFORMS.map((p) => p.id);
}
