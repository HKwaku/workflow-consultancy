/**
 * Generate platform-specific implementation instructions.
 */

export function generateInstructions({ platform, acceptedProcesses }) {
  const proc = acceptedProcesses[0];
  const processName = proc?.processName || proc?.name || 'Process';
  const stepCount = (proc?.steps || []).filter((s) => s.status !== 'removed').length;

  if (platform === 'n8n') {
    return `## N8N Proof of Concept

**Process:** ${processName}
**Steps:** ${stepCount}

### Import steps
1. Open your N8N instance (self-hosted or cloud).
2. Create a new workflow (or use **Workflows → Import from File**).
3. Paste the JSON below, or save it as a \`.json\` file and import via **Import from File**.
4. The workflow creates a linear chain: **Manual Trigger** → **Set** nodes (one per step).
5. Each Set node stores: step name, department, handoff method, systems.
6. Replace Set nodes with real integrations (HTTP, email, CRM, etc.) as you build out the automation.

### Next steps
- Add credentials for any external services.
- Replace placeholder Set nodes with actual automation nodes.
- Add error handling and retries.
- Consider adding an If node for decision steps (marked isDecision in the original process).`;
  }

  if (platform === 'unqork') {
    return `## Unqork Workflow Definition

**Process:** ${processName}
**Steps:** ${stepCount}

### Setup steps
1. Create a Workflow-type application in your Unqork workspace (or open an existing one).
2. Open the Workflow Builder and locate the workflow.
3. Use **Copy Workflow Definition** / **Paste Workflow Definition** if your Unqork version supports JSON import.
4. Alternatively, use this definition as a **build guide**: create nodes manually following the structure below.
5. Map each Task node to a module or sub-process in your application.
6. Assign swimlanes (Authenticated vs Automated) based on department and step type.

### Structure
- **Start** → **Task** nodes (one per step) → **End**
- Decision steps are marked as ExclusiveGateway  -  add branching logic in Unqork.
- Departments from the redesign map to swimlane assignments.

### Next steps
- Create modules for each Task that requires user input.
- Configure handoffs between lanes (Handoff node).
- Add conditional logic for decision points.`;
  }

  if (platform === 'make') {
    return `## Make Scenario Build Guide

**Process:** ${processName}
**Steps:** ${stepCount}

### Setup steps
1. Log in to Make (make.com) and create a new scenario.
2. Add a trigger module (Webhooks, Schedule, Google Sheets, Airtable, etc.).
3. Add one action module per step below  -  connect them in sequence.
4. Map each step to the suggested module type (or your preferred app).
5. Configure connections and save. Use **Run once** to test.

### Next steps
- Connect your accounts for each module.
- Add error handling (Ignore, Rollback, or Commit) as needed.
- Consider using Router for decision steps.`;
  }

  if (platform === 'zapier') {
    return `## Zapier Zap Build Guide

**Process:** ${processName}
**Steps:** ${stepCount}

### Setup steps
1. Log in to Zapier and click **Create Zap**.
2. Choose a trigger (Manual, Schedule, or app trigger like Google Sheets, Airtable).
3. Add one action per step below  -  connect them in order.
4. Map each step to the suggested app (or your preferred integration).
5. Test each step and turn on your Zap.

### Next steps
- Reconnect any inactive connections.
- Use Filters for conditional logic (decision steps).
- Consider multi-step Zaps or Zaps by Zapier for branching.`;
  }

  if (platform === 'power-automate') {
    return `## Power Automate Flow Build Guide

**Process:** ${processName}
**Steps:** ${stepCount}

### Setup steps
1. Open Power Automate (flow.microsoft.com) and create a new flow.
2. Choose a trigger (Manually trigger, When item created, Recurrence, etc.).
3. Add one action per step below  -  connect them in sequence.
4. Map each step to the suggested action (or your connector).
5. Save and test. Use **Test** to run manually.

### Next steps
- Add conditions for decision steps (Condition or Switch).
- Use Approvals for human-in-the-loop steps.
- Consider solutions for reusable flows.`;
  }

  if (platform === 'pipedream') {
    return `## Pipedream Workflow Build Guide

**Process:** ${processName}
**Steps:** ${stepCount}

### Setup steps
1. Log in to Pipedream and create a new workflow.
2. Add a trigger (Schedule, Webhook, or event source like Airtable, Google Sheets).
3. Add one step per action below  -  connect them in order.
4. Map each step to the suggested component (or Code step for custom logic).
5. Deploy and test. Use **Test** to run manually.

### Next steps
- Add Code steps for transformations or branching.
- Use built-in error handling and retries.
- Connect your accounts for each component.`;
  }

  const buildGuidePlatforms = {
    camunda: { title: 'Camunda BPMN', steps: 'Model in BPMN (Camunda Modeler or web). Deploy to Camunda Engine. Use the step structure below as your task sequence.' },
    temporal: { title: 'Temporal Workflow', steps: 'Define workflow in code (Go, Java, Python, etc.). Use the step structure below as your activity sequence.' },
    retool: { title: 'Retool Workflow', steps: 'Create a Retool app and add a Workflow. Use the step structure below. Trigger on button, schedule, or event.' },
    airtable: { title: 'Airtable Automation', steps: 'Create an automation on your base. Add trigger (record created/updated or schedule). Add actions per step below.' },
    monday: { title: 'Monday.com Automation', steps: 'Add automation to your board. Choose trigger (item created, status changed, etc.). Add actions per step below.' },
    'process-street': { title: 'Process Street Workflow', steps: 'Create a workflow template. Add checklist items per step below. Set up triggers (schedule or manual).' },
    smartsuite: { title: 'SmartSuite Workflow', steps: 'Create a workflow in your app. Add trigger and actions per step below.' },
    workato: { title: 'Workato Recipe', steps: 'Create a recipe. Add trigger (app event, schedule, webhook). Add steps per the structure below.' },
    'tray-io': { title: 'Tray.io Workflow', steps: 'Create a workflow. Add trigger (webhook, schedule, connector). Add steps per the structure below.' },
  };

  const guide = buildGuidePlatforms[platform];
  if (guide) {
    return `## ${guide.title} Build Guide

**Process:** ${processName}
**Steps:** ${stepCount}

### Setup steps
1. ${guide.steps}
2. Map each step to your platform's equivalent (task, activity, action, etc.).
3. Configure handoffs and approvals where needed.
4. Test and deploy.

### Next steps
- Connect your data sources and systems.
- Add error handling and retries.
- Consider branching for decision steps.`;
  }

  return '';
}
