# n8n Workflow Setup Guide

This guide walks you through setting up the n8n workflow that powers the three automations triggered when a client completes a diagnostic.

## What Gets Triggered

When a client clicks **"Email Report to Me"** on the results page, the app sends a single webhook to n8n containing:

- **Contact info** (name, email, company, industry, team size)
- **Lead score** (0-100 with grade: Hot/Warm/Interested/Cold)
- **Diagnostic summary** (annual cost, potential savings, automation readiness)
- **Recommendations** (AI-generated or rule-based)
- **90-day roadmap** summary
- **PDF report** (base64-encoded, ready to attach to email)
- **Team notification** (pre-formatted Slack/Teams message)

The n8n workflow then branches into three parallel paths.

---

## Architecture

```
Client clicks "Email Report"
        │
        ▼
/api/send-diagnostic-report  (Vercel serverless)
  ├── Generates unique reportId (UUID)
  ├── Calculates lead score
  ├── Stores FULL diagnostic + PDF in Supabase  ← NEW
  │     (table: diagnostic_reports)
  └── Forwards to n8n webhook (without PDF)
        │
        ▼
n8n Webhook Trigger
        │
        ├──► Path 1: EMAIL REPORT TO CLIENT
        │     ├── Build email body with "Download Report" link
        │     │     (uses reportUrl → /report?id=xxx)
        │     └── Gmail / SMTP node (no attachment needed)
        │
        ├──► Path 2: CRM LEAD CAPTURE
        │     ├── Map contact + leadScore to CRM fields
        │     └── Create/Update Contact (Supabase / HubSpot / etc.)
        │
        └──► Path 3: TEAM NOTIFICATION
              ├── Format notification.body for Slack/Teams
              └── Send to #sales-alerts channel

---

Client clicks "Download Report" link in email
        │
        ▼
/report?id=xxx  (static page)
  ├── Calls /api/get-diagnostic?id=xxx
  ├── Shows summary & recommendations
  └── Offers instant PDF download (stored base64 → blob → download)
```

---

## Step-by-Step Setup

### 1. Create the Webhook Trigger

1. In n8n, create a new workflow
2. Add a **Webhook** node as the trigger
3. Set method to **POST**
4. Set authentication to **None** (the URL itself is the secret)
5. Copy the **Production URL** (e.g., `https://your-instance.app.n8n.cloud/webhook/abc123`)
6. Paste it into your `.env` file as `N8N_DIAGNOSTIC_WEBHOOK_URL`

### 2. Path 1 — Email Report to Client

After the webhook trigger, add a single **Code node** then a **Gmail** (or SMTP) node:

#### a) Build Email Body (Code node)

> **NOTE:** The PDF is no longer sent through n8n. It's stored in Supabase by the API,
> and the email includes a **"Download Report"** link pointing to `/report?id=xxx`.
> This avoids all binary/attachment headaches.

```javascript
const d = $input.first().json.body || $input.first().json;
const c = d.contact || {};
const s = d.summary || {};
const recs = d.recommendations || [];
const auto = d.automationScore || {};
const reportUrl = d.reportUrl || '';

const recsHtml = recs.map((r, i) =>
  `<tr>
    <td style="padding: 8px; border-bottom: 1px solid #eee; color: #6366f1; font-weight: 600;">${r.type}</td>
    <td style="padding: 8px; border-bottom: 1px solid #eee;">${r.text}</td>
  </tr>`
).join('');

const emailHtml = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto; background: #f8fafc; padding: 20px;">
  <div style="background: linear-gradient(135deg, #1e293b, #334155); color: white; padding: 30px; border-radius: 12px 12px 0 0;">
    <h1 style="margin: 0; font-size: 24px;">Your Process Diagnostic Report</h1>
    <p style="margin: 8px 0 0; opacity: 0.8;">Prepared for ${c.company || c.name}</p>
  </div>

  <div style="background: white; padding: 30px; border-radius: 0 0 12px 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
    <p>Hi ${c.name || 'there'},</p>
    <p>Thank you for completing your workflow diagnostic. Here's a summary of what we found:</p>

    <div style="display: flex; gap: 12px; margin: 20px 0;">
      <div style="flex: 1; background: #f0f9ff; padding: 16px; border-radius: 8px; text-align: center;">
        <div style="font-size: 24px; font-weight: 700; color: #1e40af;">£${((s.totalAnnualCost || 0) / 1000).toFixed(0)}K</div>
        <div style="font-size: 12px; color: #64748b;">Annual Process Cost</div>
      </div>
      <div style="flex: 1; background: #f0fdf4; padding: 16px; border-radius: 8px; text-align: center;">
        <div style="font-size: 24px; font-weight: 700; color: #16a34a;">£${((s.potentialSavings || 0) / 1000).toFixed(0)}K</div>
        <div style="font-size: 12px; color: #64748b;">Potential Savings</div>
      </div>
      <div style="flex: 1; background: #faf5ff; padding: 16px; border-radius: 8px; text-align: center;">
        <div style="font-size: 24px; font-weight: 700; color: #7c3aed;">${auto.percentage || 0}%</div>
        <div style="font-size: 12px; color: #64748b;">Automation Ready</div>
      </div>
    </div>

    <h3 style="color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">Key Recommendations</h3>
    <table style="width: 100%; border-collapse: collapse;">
      ${recsHtml}
    </table>

    ${reportUrl ? `
    <div style="margin-top: 24px; padding: 20px; background: #eff6ff; border-radius: 8px; text-align: center;">
      <p style="margin: 0 0 12px; font-weight: 600; color: #1e293b;">Download Your Full Report</p>
      <a href="${reportUrl}"
         style="display: inline-block; padding: 14px 40px; background: linear-gradient(135deg, #1e40af, #1e3a8a); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
        View &amp; Download PDF Report
      </a>
      <p style="margin: 12px 0 0; font-size: 12px; color: #94a3b8;">This link contains your complete diagnostic including process flows, automation scores, and 90-day roadmap.</p>
    </div>
    ` : ''}

    <div style="margin-top: 24px; padding: 20px; background: linear-gradient(135deg, #eff6ff, #f0fdf4); border-radius: 8px; text-align: center;">
      <p style="margin: 0 0 12px; font-weight: 600; color: #1e293b;">Ready to put these insights into action?</p>
      <a href="mailto:hopektettey@gmail.com?subject=Discovery Call - ${encodeURIComponent(c.company || '')}"
         style="display: inline-block; padding: 12px 32px; background: linear-gradient(135deg, #6366f1, #4f46e5); color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">
        Book a Discovery Call
      </a>
    </div>

    <p style="margin-top: 20px; font-size: 13px; color: #94a3b8;">
      This analysis was ${s.analysisType === 'ai-enhanced' ? 'AI-enhanced using Claude' : 'generated using our rule-based engine'}.
    </p>
  </div>
</div>
`;

const savingsK = ((s.potentialSavings || 0) / 1000).toFixed(0);

return {
  json: {
    to: c.email,
    subject: 'Your Process Diagnostic Report — £' + savingsK + 'K savings identified',
    html: emailHtml
  }
};
```

#### b) Send Email (Gmail node)

- **To:** `{{ $json.to }}`
- **Subject:** `{{ $json.subject }}`
- **Email Type:** HTML
- **HTML Body:** `{{ $json.html }}`
- **No attachment needed** — the email contains a download link instead

---

### 3. Path 2 — CRM Lead Capture

From the webhook trigger, branch to a CRM node:

#### HubSpot Example

Use the **HubSpot** node → Create/Update Contact:

| HubSpot Field | n8n Expression |
|---|---|
| Email | `{{ $json.contact.email }}` |
| First Name | `{{ $json.contact.name.split(' ')[0] }}` |
| Last Name | `{{ $json.contact.name.split(' ').slice(1).join(' ') }}` |
| Company | `{{ $json.contact.company }}` |
| Job Title | `{{ $json.contact.title }}` |
| Phone | `{{ $json.contact.phone }}` |
| Industry | `{{ $json.contact.industry }}` |
| Company Size | `{{ $json.contact.teamSize }}` |

Add a **Note** to the contact:

```
Diagnostic completed on {{ $json.timestamp }}

Lead Score: {{ $json.leadScore.score }}/100 ({{ $json.leadScore.grade }})

Summary:
- {{ $json.summary.totalProcesses }} processes analysed
- Annual cost: £{{ ($json.summary.totalAnnualCost / 1000).toFixed(0) }}K
- Potential savings: £{{ ($json.summary.potentialSavings / 1000).toFixed(0) }}K
- Automation readiness: {{ $json.automationScore.percentage }}% ({{ $json.automationScore.grade }})

Top recommendations:
{{ $json.recommendations.map(r => '• [' + r.type + '] ' + r.text).join('\n') }}
```

Custom properties to create in HubSpot:
- `lead_score` (number) → `{{ $json.leadScore.score }}`
- `lead_grade` (dropdown: Hot/Warm/Interested/Cold) → `{{ $json.leadScore.grade }}`
- `automation_readiness` (number) → `{{ $json.automationScore.percentage }}`
- `annual_process_cost` (number) → `{{ $json.summary.totalAnnualCost }}`
- `potential_savings` (number) → `{{ $json.summary.potentialSavings }}`

---

### 4. Path 3 — Team Notification

From the webhook trigger, branch to a Slack or Teams node:

#### Slack Example

Use the **Slack** node → Send Message:

- Channel: `#sales-alerts`
- Message: `{{ $json.notification.body }}`

Or use a **Slack Block Kit** message for richer formatting:

```javascript
// Code node to build Slack blocks
const n = $input.first().json.notification;
const ls = $input.first().json.leadScore;
const c = $input.first().json.contact;
const s = $input.first().json.summary;

const emoji = ls.grade === 'Hot' ? '🔥' : ls.grade === 'Warm' ? '⚡' : '📋';

return {
  json: {
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `${emoji} New Diagnostic: ${c.company || 'Unknown'}` }
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Contact:*\n${c.name} (${c.email})` },
          { type: "mrkdwn", text: `*Company:*\n${c.company} | ${c.teamSize} employees` },
          { type: "mrkdwn", text: `*Annual Cost:*\n£${(s.totalAnnualCost / 1000).toFixed(0)}K` },
          { type: "mrkdwn", text: `*Lead Score:*\n${ls.score}/100 (${ls.grade})` }
        ]
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "View in CRM" },
            url: `https://app.hubspot.com/contacts/search?query=${encodeURIComponent(c.email)}`
          }
        ]
      }
    ]
  }
};
```

#### Microsoft Teams Example

Use the **Microsoft Teams** node → Send Message:

- Message: `{{ $json.notification.body }}`

---

## Webhook Payload Reference

Full JSON structure sent to the webhook:

```json
{
  "requestType": "diagnostic-complete",
  "reportId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "reportUrl": "https://your-site.vercel.app/report?id=a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "contact": {
    "name": "John Smith",
    "email": "john@acme.com",
    "company": "ACME Corp",
    "title": "Operations Director",
    "industry": "Technology",
    "teamSize": "51-200",
    "phone": "+44 7700 900000"
  },
  "leadScore": {
    "score": 78,
    "grade": "Warm",
    "factors": [
      { "factor": "Company size", "value": "51-200", "points": 15 },
      { "factor": "Annual process cost", "value": "£150K", "points": 15 },
      { "factor": "Automation readiness", "value": "72%", "points": 20 },
      { "factor": "Processes analysed", "value": 2, "points": 8 },
      { "factor": "Data quality", "value": "82%", "points": 15 },
      { "factor": "Contact completeness", "value": "8/10", "points": 8 }
    ]
  },
  "summary": {
    "totalProcesses": 2,
    "totalAnnualCost": 150000,
    "potentialSavings": 75000,
    "analysisType": "ai-enhanced",
    "qualityScore": 82
  },
  "automationScore": {
    "percentage": 72,
    "grade": "High",
    "insight": "Strong automation potential across multiple processes."
  },
  "recommendations": [
    {
      "type": "automation",
      "process": "Customer Onboarding",
      "text": "Automate background checks via third-party API integration."
    }
  ],
  "roadmap": {
    "quickWins": 3,
    "agentItems": 2,
    "humanLoopItems": 1,
    "multiAgentItems": 0,
    "totalSavings": 45000
  },
  "processes": [
    {
      "name": "Customer Onboarding",
      "type": "customer-onboarding",
      "annualCost": 150000,
      "elapsedDays": 15,
      "stepsCount": 5,
      "teamSize": 8,
      "qualityGrade": "MEDIUM"
    }
  ],
  "notification": {
    "headline": "New Diagnostic Completed: ACME Corp",
    "body": "**Contact:** John Smith (john@acme.com)\n**Company:** ACME Corp | 51-200 employees | Technology\n\n**Diagnostic Summary:**\n• 2 processes analysed\n• Annual process cost: £150K\n• Potential savings: £75K\n• Automation readiness: 72% (High)\n\n**Lead Score: 78/100 (Warm)**\n\nFollow up within 48 hours.",
    "subject": "[Warm] New Diagnostic: ACME Corp - £150K annual cost",
    "priority": "medium"
  },
  "timestamp": "2026-02-15T12:00:00.000Z"
}
```

> **NOTE:** `pdfBase64` is no longer included in the n8n payload.
> The PDF is stored directly in Supabase by the API and is accessible via
> the `reportUrl` link. This avoids binary handling issues in n8n.
> The email template above includes a prominent "Download Report" button
> that links to `reportUrl`.

---

## Save Progress & Resume via Email Link

When a user is mid-way through a diagnostic (especially complex processes with 10+ steps that take 30+ minutes), they can click **"Save & get link"** in the progress bar. This:

1. Stores their partial progress in Supabase (`diagnostic_progress` table)
2. Optionally sends a resume link to their email via the same n8n webhook
3. Returns a shareable URL they can bookmark or copy

### How It Works

```
User clicks "Save & get link"
        │
        ▼
/api/save-progress  (Vercel serverless)
  ├── Generates progressId (UUID) or reuses existing
  ├── Upserts partial data into Supabase (diagnostic_progress)
  ├── Builds resumeUrl: /diagnostic?resume={progressId}
  └── If email provided → sends to n8n webhook
        │
        ▼
n8n Webhook Trigger (requestType: "save-progress")
  └── Send email with resume link to user

---

User clicks resume link or visits /diagnostic?resume=xxx
        │
        ▼
/api/load-progress?id=xxx  (Vercel serverless)
  ├── Fetches progress from Supabase
  ├── Validates age (expires after 30 days)
  └── Returns progressData → client restores form state
```

### n8n Webhook: Save Progress Payload

The webhook receives a payload with `requestType: "save-progress"`. You can route this in n8n using a Switch node on `requestType`:

```json
{
  "requestType": "save-progress",
  "progressId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "resumeUrl": "https://your-site.vercel.app/diagnostic?resume=a1b2c3d4-...",
  "email": "john@acme.com",
  "processName": "Client Onboarding",
  "currentScreen": 7,
  "screenLabel": "Step Breakdown",
  "timestamp": "2026-02-16T12:00:00.000Z"
}
```

### n8n Email Template (Code node for save-progress)

Add a Switch node after the webhook trigger that checks `{{ $json.body.requestType }}`:
- `diagnostic-complete` → existing email/CRM/notification paths
- `save-progress` → new email path below

```javascript
const d = $input.first().json.body || $input.first().json;

const emailHtml = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; background: #f8fafc; padding: 20px;">
  <div style="background: linear-gradient(135deg, #1e293b, #334155); color: white; padding: 24px; border-radius: 12px 12px 0 0;">
    <h1 style="margin: 0; font-size: 20px;">Continue Your Diagnostic</h1>
    <p style="margin: 8px 0 0; opacity: 0.8;">Progress saved — pick up where you left off</p>
  </div>
  <div style="background: white; padding: 24px; border-radius: 0 0 12px 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.06);">
    <p>Hi there,</p>
    <p>Your progress on <strong>"${d.processName || 'your diagnostic'}"</strong> has been saved.
       You were on step: <strong>${d.screenLabel || 'In Progress'}</strong>.</p>

    <div style="margin: 24px 0; text-align: center;">
      <a href="${d.resumeUrl}"
         style="display: inline-block; padding: 14px 40px; background: linear-gradient(135deg, #3d8ea6, #1e293b); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
        Continue Diagnostic →
      </a>
    </div>

    <p style="font-size: 13px; color: #94a3b8;">This link will work for 30 days. You can continue on any device.</p>
  </div>
</div>`;

return {
  json: {
    to: d.email,
    subject: 'Continue your diagnostic — ' + (d.processName || 'progress saved'),
    html: emailHtml
  }
};
```

Then send via the same Gmail/SMTP node as the report email.

---

## Supabase Setup (for Report Storage)

The API stores diagnostic reports directly in Supabase so they can be downloaded later
from `/report?id=xxx`. This completely avoids PDF-in-email binary issues.

### 1. Create the `diagnostic_reports` table

Run this SQL in the Supabase SQL Editor (Dashboard → SQL Editor → New query):

```sql
CREATE TABLE IF NOT EXISTS diagnostic_reports (
  id text PRIMARY KEY,
  contact_email text,
  contact_name text,
  company text,
  lead_score integer,
  lead_grade text,
  diagnostic_data jsonb,
  pdf_base64 text,
  created_at timestamptz DEFAULT now()
);

-- Optional: index for lookups
CREATE INDEX idx_diagnostic_reports_email ON diagnostic_reports (contact_email);
CREATE INDEX idx_diagnostic_reports_created ON diagnostic_reports (created_at DESC);

-- Allow service key to read/write (RLS disabled for simplicity)
ALTER TABLE diagnostic_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service key full access" ON diagnostic_reports
  FOR ALL USING (true) WITH CHECK (true);
```

### 2. Create the `diagnostic_progress` table (for Save & Resume)

```sql
CREATE TABLE IF NOT EXISTS diagnostic_progress (
  id text PRIMARY KEY,
  email text,
  process_name text,
  current_screen integer DEFAULT 0,
  progress_data jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Index for email lookups (future dashboard feature)
CREATE INDEX idx_diagnostic_progress_email ON diagnostic_progress (email);
CREATE INDEX idx_diagnostic_progress_updated ON diagnostic_progress (updated_at DESC);

-- Auto-expire old progress (optional: run as a cron or pg_cron job)
-- DELETE FROM diagnostic_progress WHERE updated_at < now() - interval '30 days';

-- Allow service key to read/write
ALTER TABLE diagnostic_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service key full access" ON diagnostic_progress
  FOR ALL USING (true) WITH CHECK (true);
```

### 3. Add Supabase credentials to `.env`

Go to **Supabase Dashboard → Project Settings → API** and copy:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Use the **service_role** key (not the anon key) so the API can insert/read without RLS restrictions.

---

## Testing

### Report Delivery
1. Start the dev server: `vercel dev`
2. Complete a diagnostic (or use the test data button)
3. Click **"Email Report to Me"** on the results page
4. Without n8n configured: you'll see "Report generated (email delivery pending setup)"
5. With n8n configured: you'll see "Report sent successfully!"
6. If Supabase is configured, you'll also see a "View & Download Report Online" link
7. Click the link → opens `/report?id=xxx` with a summary + PDF download button

### Save Progress & Resume
1. Start a diagnostic and progress past the process name screen (screen 2+)
2. The **"Save & get link"** button appears in the progress bar
3. Click it → enter an email (or skip) → click Save
4. You'll get a resume URL — copy it
5. Open a new browser tab/incognito → paste the URL
6. Your progress should be restored with a "Welcome back!" banner
7. If you entered an email, check the n8n execution log for the `save-progress` webhook

Check the n8n execution log to verify all paths fire correctly.

---

## Environment Variables

```env
# Diagnostic complete webhook (email + CRM + notification)
N8N_DIAGNOSTIC_WEBHOOK_URL=https://your-instance.app.n8n.cloud/webhook/YOUR-WEBHOOK-ID

# Optional: separate webhook for flow diagram generation
N8N_WEBHOOK_URL=https://your-instance.app.n8n.cloud/webhook/ANOTHER-WEBHOOK-ID

# Supabase (for storing diagnostic reports)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
```
