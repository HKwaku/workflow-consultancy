---
title: Exports
group: Reference
order: 4
summary: Every way to get data out of Vesno — PowerPoint, JSON, build guides for n8n / Zapier / etc.
---

Vesno generates structured outputs you can take elsewhere. Every export below is one click from the relevant view.

## Diagnostic report → PowerPoint

From any saved report (`/report?id=…`), there's an **Export to PowerPoint** action.

Endpoint: `GET /api/export-pptx?id=<reportId>`

The deck has 5 sections:
- Cover (process name + company + date + savings opportunity)
- Executive summary
- Operational footprint (steps, handoffs, departments)
- Key findings + recommendations (grouped by quick-win / medium / project)
- Roadmap

Anyone with the report ID can trigger this — same access model as the report itself.

## Diligence memo → PowerPoint

From a `mode='diligence'` analysis on a deal page, **Export to PowerPoint** activates once at least one finding is approved.

Endpoint: `GET /api/deals/[id]/export-diligence-pptx?analysis_id=<uuid>`

Editor-only. Approved findings only — pending and rejected ones are filtered server-side. Slide order mirrors the on-screen layout exactly.

## Process redesign → workflow build guides

Once a redesign is accepted, the **Build** page shows tiles for every supported platform:

- n8n (importable workflow JSON)
- Zapier
- Make
- Power Automate
- Pipedream
- Airtable
- Camunda
- Monday
- Process Street
- Retool
- SmartSuite
- Temporal
- Tray.io
- Unqork
- Workato

Endpoint: `POST /api/generate-workflow-export` with `{ reportId, platform }`

Generation is **deterministic** — no LLM call at this stage. The AI's work happens in the redesign step; the exporters just translate the redesigned process into each platform's JSON shape.

## Your data → JSON

Any signed-in user can download every row they own from `/portal/settings → Download my data`.

Endpoint: `GET /api/me/export-data`

Returns a single JSON document with diagnostic_reports, chat_sessions, chat_messages, chat_artefacts, owned deals, document metadata, and token usage. Document bytes are not inlined (download from the deal page individually). Rate-limited per user.

This is the GDPR Article 20 export. Auditors accept it as-is.

## Reports → email

Every diagnostic submission triggers an email with the report URL via the n8n webhook. There's no "re-send" button right now; ask support@vesno.io if you need one.

## Common questions

**Can I export findings as JSON instead of PowerPoint?** Not yet — the data is there (it's all in `deal_analyses.result`), but no JSON export endpoint. Use the GDPR export route to get all your owned data including findings.

**Can I export to Google Slides instead of PowerPoint?** PPTX files import cleanly into Google Slides. We don't ship a native Slides exporter.

**The PowerPoint has placeholder text in some slides.** That happens when a section is empty (no findings of that type). The slide renders blank rather than being skipped — easier for reviewers to spot the gap.
