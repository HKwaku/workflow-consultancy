/**
 * Suggested steps by process type (shown when 3+ steps exist)
 */

export const STEP_SUGGESTIONS = {
  'customer-onboarding': [
    'Send welcome email', 'Collect requirements', 'Create customer account',
    'Configure permissions', 'Import data', 'Schedule kickoff call',
    'Assign account manager', 'Run training session', 'Verify access',
    'Send handover pack', 'First check-in call', 'Compliance check',
  ],
  'sales-to-delivery': [
    'Qualify lead', 'Send proposal', 'Contract negotiation',
    'Sign contract', 'Internal handover meeting', 'Create project plan',
    'Assign delivery team', 'Kick off delivery', 'Status update to client',
    'Invoice milestone', 'Quality review', 'Project close',
  ],
  'employee-onboarding': [
    'Send offer letter', 'Background check', 'IT equipment request',
    'Create accounts', 'Prepare workspace', 'Day 1 induction',
    'Assign buddy', 'Department intro', 'System training',
    'First week check-in', '30-day review', 'Probation review',
  ],
  'order-fulfillment': [
    'Receive order', 'Validate order details', 'Check inventory',
    'Pick items', 'Quality check', 'Pack order',
    'Generate shipping label', 'Dispatch', 'Send tracking info',
    'Monitor delivery', 'Confirm receipt', 'Process returns',
  ],
  'invoice-to-payment': [
    'Generate invoice', 'Approve invoice', 'Send to client',
    'Track receipt confirmation', 'Log in accounting system',
    'Follow up on overdue', 'Receive payment', 'Reconcile payment',
    'Issue receipt', 'Update revenue records', 'Chase disputes',
  ],
  'issue-resolution': [
    'Log issue', 'Triage priority', 'Assign to team',
    'Investigate root cause', 'Propose fix', 'Get approval',
    'Implement fix', 'Test resolution', 'Notify stakeholders',
    'Update documentation', 'Close ticket', 'Post-mortem review',
  ],
  'approval-workflow': [
    'Submit request', 'Initial review', 'Route to approver',
    'Manager review', 'Finance review', 'Compliance check',
    'Final approval', 'Notify requestor', 'Execute action',
    'Record in system', 'Audit trail update',
  ],
  'product-launch': [
    'Define requirements', 'Market research', 'Design phase',
    'Development', 'QA testing', 'Stakeholder review',
    'Marketing prep', 'Sales enablement', 'Soft launch',
    'Monitor metrics', 'Full launch', 'Post-launch review',
  ],
  'reporting-cycle': [
    'Define report scope', 'Gather data sources', 'Extract data',
    'Clean and validate', 'Run analysis', 'Build visualisations',
    'Draft report', 'Peer review', 'Management review',
    'Distribute report', 'Collect feedback', 'Archive',
  ],
};
