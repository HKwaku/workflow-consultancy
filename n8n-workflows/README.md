# Sharpin N8N Workflows

Separate workflow JSON files for each email/notification type. Import into n8n and configure your Gmail credentials.

## Workflows

| File | Webhook path | Env var | Purpose |
|------|--------------|---------|---------|
| `save-progress.json` | `/webhook/save-progress` | `N8N_SAVE_PROGRESS_WEBHOOK_URL` | "Your Progress Has Been Saved" email |
| `handover.json` | `/webhook/handover` | `N8N_HANDOVER_WEBHOOK_URL` | "You have been sent a process to complete" email |
| `diagnostic-complete.json` | `/webhook/diagnostic-complete` | `N8N_DIAGNOSTIC_COMPLETE_WEBHOOK_URL` | "Your Diagnostic Report is Ready" email |
| `cost-analysis-share.json` | `/webhook/cost-analysis-share` | `N8N_COST_ANALYSIS_SHARE_WEBHOOK_URL` | Cost analysis share email to manager |
| `flow-diagram.json` | `/webhook/flow-diagram` | `N8N_FLOW_DIAGRAM_WEBHOOK_URL` | Flow diagram generation (returns `diagramUrl`) |

## Setup

1. In n8n: **Workflows** → **Import from File** → select each JSON file
2. For email workflows: add your **Gmail OAuth2** credentials to the "Send Email" node
3. Activate each workflow
4. Copy the **Production** webhook URL for each workflow
5. Add the URLs to your `.env.local` (see `.env.local.example`)

## Webhook URLs

After importing and activating, the webhook URL format is:

```
https://your-n8n-instance.app.n8n.cloud/webhook/<path>
```

For example: `https://xxx.app.n8n.cloud/webhook/save-progress`

## Flow Diagram workflow

The `flow-diagram` workflow is a stub. The app sends `{ processes, mermaidCode, contact, timestamp }` and expects `{ diagramUrl }` in the response. Implement your diagram generation (e.g. Mermaid → image → upload to storage) in the "Process Diagram" Code node. If you don't need flow diagrams, leave `N8N_FLOW_DIAGRAM_WEBHOOK_URL` unset.
