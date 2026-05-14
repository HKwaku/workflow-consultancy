---
title: Exports
group: Reference
order: 4
summary: How to get your data out of Vesno.
---

The living-workspace model treats the workspace itself as the deliverable, so Vesno no longer ships PowerPoint, n8n / Zapier build guides, or any other vendor-specific export. The process IS the artefact; share the canvas link.

## Your data -> JSON

Any signed-in user can download every row they own from the Settings popover (gear icon on the chat rail in `/workspace/map`) -> Download my data.

Endpoint: `GET /api/me/export-data`

Returns a single JSON document with your processes, chat sessions, chat messages, chat artefacts, owned deals, document metadata, and token usage. Document bytes are not inlined (download from the deal page individually). Rate-limited per user.

This is the GDPR Article 20 export. Auditors accept it as-is.

## Common questions

**Where did the PowerPoint exports go?** Retired in the living-workspace migration. PPTX was a snapshot deliverable; the canvas + chat replaces it. If you need a screenshot for a deck, the canvas renders cleanly to PNG via the browser print dialog (`Cmd/Ctrl+P -> Save as PDF`).

**Where did the n8n / Zapier build guides go?** Same migration. Those exports translated an AI-generated redesign into platform JSON; AI suggestions now land as inline change proposals on the live canvas rather than as a separate "redesign" artefact.

**Can I share the canvas externally?** Yes - any process URL (`/workspace/map?view=<id>`) is shareable. Access is RLS-gated by the row's owner email and the operating-model membership.

**Can I export findings as JSON?** Use the GDPR export route - it includes `deal_findings` rows for every deal you own.
