# Workflow Consultancy — Developer Guide

> **Last updated:** 2026-05-13
> Reference document for engineers working on the workflow-consultancy app. Covers the full surface area: routes, agents, persistence, modules, deals, RBAC. Update this file when you add a route, table, agent tool, or module.
>
> **Architecture diagram** (start here): open [`docs/ARCHITECTURE.html`](./docs/ARCHITECTURE.html) in a browser - the visual single-source-of-truth for what's live in the codebase right now.
>
> **Building this from scratch?** See [`BUILD_GUIDE.md`](./BUILD_GUIDE.md) - rebuild spec covering schema, prompts, tool architecture, workers. Same caveat applies: read the architecture diagram first to know what's actually live.
>
> **Going live?** See [`GO_LIVE_CHECKLIST.md`](./GO_LIVE_CHECKLIST.md) - single source of truth for every action between "engineering done" and "real customer paying us."
>
> **Customer-facing docs** live in `content/docs/*.md`, rendered at `/docs`. Different audience from this file.

> [!IMPORTANT]
> **This file mixes current and historical content.** It was the in-codebase reference before the living-workspace migration. The migration physically removed many surfaces this file once described in detail. The `docs/ARCHITECTURE.html` diagram is the authoritative map of what's live now. Treat any section below that describes a removed capability as historical; the migration preamble lists exactly what's gone.

---

## Living-workspace migration (2026-05)

A foundational shift: **processes are live, not snapshots**. The "generate a report, redesign it, export a deck" paradigm is gone. The canvas + chat surface IS the deliverable, and every metric is derived on read from `flow_data`.

The migration was applied in two waves: first as 410 stubs (back-compat), then as physical deletions. **Routes and components for the removed surfaces are now 404 / not-imported** - older sections in this doc that describe `runDealAnalysis`, the deal-analysis pipeline, PPTX exports, redesign flows, the scorecard, the report page, etc. refer to capabilities that no longer exist in the codebase. They're left here only where the historical context aids understanding of the post-migration design choices.

**Database (see `supabase/migration-living-workspace-{1,2,3}*.sql`)**
- `diagnostic_reports` → renamed to **`processes`**. `diagnostic_data` JSONB → renamed to **`flow_data`**.
- Foreign-key columns `report_id` → renamed to **`process_id`** on `process_systems`, `process_instances`, `discovery_sessions`, `changes`, `chat_sessions`, `deal_flows`, `deal_participants`.
- Dropped tables: `deal_analyses`, `report_redesigns`, `chat_artefacts`, `team_diagnostics`, `team_responses`, `diagnostic_progress`, `followup_events`.
- Dropped columns on `processes`: `cost_analysis_*`, `target_data`, `state_kind`, `lead_score`, `lead_grade`, `display_code`, `automation_grade`, `automation_percentage`, `total_annual_cost`, `potential_savings`, `contributor_emails`, `diagnostic_mode`, `design_owner_email`. Also dropped: `deal_participants.deal_role`.
- Findings are reparented from `(analysis_id, finding_key)` to **`(deal_id, finding_key)`**.

**Code paradigm**
- AI improvement suggestions become inline rows in the **`changes`** table on the live process (`proposed → accepted → applied → live → measured`). No more "redesign" artefact.
- Cost / savings / automation come from **`lib/processMetrics.js`** at read time. The helper prefers a cached `flow_data.summary.*` / `flow_data.automationScore.*` written by the save path; otherwise it walks `flow_data.rawProcesses[].steps[]` and derives totals from per-step `workMinutes` × `costAnalysis.labourRates`.
- Snapshot-era surfaces are **physically deleted** (not 410-stubbed any more): redesign, cost-analysis, deal-analysis runs + analyses sub-routes, exports (PPTX / build guides / CSV), scorecard, target-state promote, team-survey, progress-save, follow-up nurture, /report, /cost-analysis, /deal-analysis, /build. See `README.md` for the full list and `docs/ARCHITECTURE.html` for the resulting shape.

**Workspace UX**
- `/workspace` hosts `DiagnosticClient` (the same shell `/process-audit` uses) and auto-opens the workspace overlay scoped to the user's **active operating model** (per-member preferred → org default; see [Operating models — multiple per org](#operating-models--multiple-per-org)). The graph view is the default tab.
- Clicking a process anywhere dispatches **`vesno:open-process`** — `DiagnosticWorkspace` listens and runs the same silent-swap path the chat agent's `open_process` tool uses (no route change, no remount, chat thread intact, URL updated via `history.replaceState`).
- The "Continue mapping" row above the chat input is **context-aware**: filtered by `dealId` > `operatingModelId` > user email via `/api/me/recent-processes?...`.
- The view-only banner pill and the canned read-only chat greeting are gone — the agent silently switches between view and edit intent.

---

## Contents

1. [What this app does](#what-this-app-does)
2. [Tech stack](#tech-stack)
3. [Top-level routes](#top-level-routes)
4. [Module system (4 audience pillars)](#module-system-4-audience-pillars)
5. [Diagnostic flow](#diagnostic-flow)
6. [Chat agent (router-selected toolsets)](#chat-agent-router-selected-toolsets)
7. [Other AI agents](#other-ai-agents)
8. [Model tiers](#model-tiers)
9. [Report system](#report-system)
10. [PE / M&A / Scaling deals](#pe--ma--scaling-deals)
11. [Portal & org admin](#portal--org-admin)
12. [Entitlements & RBAC](#entitlements--rbac)
13. [Chat persistence (sessions, messages, artefacts)](#chat-persistence-sessions-messages-artefacts)
13b. [Outputs panel & artefact generation](#outputs-panel--artefact-generation)
14. [Workflow exports](#workflow-exports)
15. [Database schema](#database-schema)
16. [API routes](#api-routes)
17. [Authentication](#authentication)
18. [External integrations](#external-integrations)
19. [Deal data room & diligence RAG](#deal-data-room--diligence-rag)
20. [Findings, citations & approval workflow](#findings-citations--approval-workflow)
21. [Going live: deal diligence rollout checklist](#going-live-deal-diligence-rollout-checklist)
22. [Background workers (Inngest)](#background-workers-inngest)
23. [Per-party document visibility](#per-party-document-visibility)
24. [GDPR](#gdpr)
25. [Customer-managed API keys (BYO)](#customer-managed-api-keys-byo)
26. [Per-org model allowlist](#per-org-model-allowlist)
27. [AI SDK landscape](#ai-sdk-landscape)
28. [Production guardrails](#production-guardrails)
29. [Tests](#tests)
30. [Deferred work — decision register](#deferred-work--decision-register)
31. [Where to look (file index)](#where-to-look-file-index)

---

## What this app does

A consulting platform that audits, redesigns, and helps automate operational processes. Users map a process via chat, get an AI-generated diagnostic report (bottlenecks, costs, automation readiness), then optionally accept an AI-redesigned version and export build guides for n8n/Zapier/Make/etc. PE and M&A clients use a multi-participant deal flow that compares processes across companies.

Three primary audiences (called **pillars**): PE roll-up firms, M&A acquirers, and high-growth single companies. A fourth pillar covers high-risk regulated workflows (compliance, audit-trail).

---

## Tech stack

| Layer | Stack |
|-------|-------|
| Framework | Next.js 15 App Router |
| Language | JavaScript (no TypeScript) |
| AI | Anthropic Claude via `@langchain/anthropic` + raw `@anthropic-ai/sdk` |
| Agent framework | `@langchain/langgraph` (StateGraph + ToolNode), Zod schemas |
| Auth + DB | Supabase (Postgres + RLS), JWT in cookies |
| Email + workflows | n8n webhooks (HMAC-signed) |
| Markdown | `react-markdown`, `remark-gfm`, `rehype-highlight` |
| Tests | Node `node:test` runner; Playwright for E2E |

---

## Top-level routes

Every page under `app/` (excluding `app/api/`):

| Route | Purpose | Auth |
|-------|---------|------|
| `/` | Marketing landing | Public |
| `/process-audit` | Run / resume a diagnostic (the chat-driven canvas) | Optional (required for comprehensive + team) |
| `/report` | View a saved diagnostic report by `?id=` | Public read by ID |
| `/workspace/map` | Authenticated workspace: canvas, chat, deals briefcase, analytics, settings (all via chat-rail popovers) | Required |
| `/org-admin` | Manage org members, entitlements, API keys, usage | Org admin |
| `/signin` | Sign in / sign up | Public |
| `/deals` | Deal portal landing | `deals` entitlement |
| `/deals/[id]` | PE / M&A / Scaling deal page (per-type renderer) | Owner / collaborator |
| `/cost-analysis` | Standalone labour-rate + ROI editor (also embedded as iframe) | `cost_analyst` |
| `/build` | Pick a build platform after redesign accepted | Owner of report |
| `/survey` | Static survey shim → `public/survey.html` (legacy team flow) | Public |
| `/monitor` | Static monitor shim → `public/monitor.html` (legacy ops view) | Public |
| `/team-results` | Static team results shim → `public/team-results.html` | Public (URL-coded) |
| `/status` | Public status page. Vendor link-out when `STATUS_PAGE_URL` is set; self-reported component health from `/api/health` otherwise. | Public |
| `/docs` and `/docs/[...slug]` | Customer-facing documentation. Markdown files in `content/docs/`; nav generated from filesystem; rendered by `react-markdown` with syntax highlighting. | Public |

The three `survey/monitor/team-results` pages are thin App Router shims that redirect to static HTML in `public/`. Do not delete; the HTML files are linked from outbound emails.

---

## Module system (4 audience pillars)

`lib/modules/index.js` registers four **pillar modules** — each a self-contained config bundle for a specific audience:

| ID | Label | Used for |
|----|-------|----------|
| `pe` | Private Equity | Roll-up audits, key-person dependency, investor-reporting impact |
| `ma` | M&A | Acquirer/target step-level consolidation, post-merger integration |
| `scaling` | Scaling | High-growth single entity, manual-to-SaaS automation |
| `high-risk-ops` | High-risk Ops | Regulated workflows, compliance, SOX/PCI context |

Each pillar exposes: `agentConfig` (system prompt, segment block, optional builder), `templates` (pre-built process templates), and display metadata (label, color, tagline). Get one with `getModule(id)`; legacy aliases (`highstakes`, `mergers`, `private_equity`, `scale`) resolve via `normalisePillarId()`.

The `FEATURE_MODULES` array in the same file is **documentation-only** — it lists capability folders (diagnostic, flow, report, redesign, cost, portal, build, marketing, shared) that re-export public APIs but are not part of the runtime registry.

---

## Diagnostic flow

The diagnostic is a **chat-first** experience powered by "Reina", an AI process-mapping assistant. Users converse to define their process, then map steps visually, and optionally quantify costs. Output is a comprehensive report with flowchart, automation-readiness score, cost projections, and a 90-day improvement roadmap.

### Three diagnostic paths

```
                         Welcome (Reina, Screen 0)
                                  │
            ┌─────────────────────┼─────────────────────┐
            ▼                     ▼                     ▼
       Map Only            Comprehensive          Team Alignment
       (~15 min)           (~30 min, auth)        (~auth, multi-user)
            │                     │                     │
            ▼                     ▼                     ▼
   Screen 2 ──► 5 ──► 6   Screen 2 ─► 4 ─► 5 ─► 6   Setup ─► 1 ─► 2 ─► …
            │                     │                     │
            └────────► /report ◄──┘                     └► /team-results
```

### Screens

The intake-screen sequence was consolidated. Only three screen files remain in `components/diagnostic/screens/`; the rest is orchestrated inline in `DiagnosticClient.jsx`.

| Screen | File | Purpose |
|--------|------|---------|
| Gate | `DiagnosticClient.jsx` (`AuditGate` inline) | Pillar selection (`AUDIT_SEGMENTS`) + contact intake (name/email/company/title) + deal-code lookup. Replaces the old IntroChatScreen + Screen5YourDetails + ScreenTeam + ScreenPEDealSetup |
| 1 | `screens/Screen1SelectTemplate.jsx` | Pillar template / process kind selection (lazy loaded) |
| 2 | `screens/DiagnosticWorkspace.jsx` | Main canvas: chat + step editor + flow preview + cost panel + report panel (lazy loaded) |
| 6 | `screens/Screen6Complete.jsx` | Auto-submit + redirect to `/report?id=…` (lazy loaded) |

Cost (formerly Screen 4) is now collected inside `DiagnosticWorkspace` (cost panel) and via Reina's chat-driven intake rather than as a standalone screen. Deal-participant context is resolved by `dealRoleToSegment()` in `DiagnosticClient.jsx`.

### DiagnosticWorkspace (Screen 2)

The most feature-rich screen. Three-panel layout:

- **Pill toggle** between AI Chat and Step Editor (mutually exclusive)
- **Flow Preview** always visible; click a node to jump to that step
- Per-step expansion: name, decision toggle, owner, systems, handoff method, clarification frequency, checklist
- "Save & get link" per step → resumeable URL (`?resume=ID&step=N`)
- Drag-and-drop file upload (Excel, DOCX, PDF, PPTX, images) for process extraction
- Handover modal → cloud-saves with step index → shareable URL with frosted-glass landing page

State lives in `DiagnosticContext` (the central reducer). Phase state and undo-stack are derived from a `MUTATING` set of tool actions.

### Chat-driven intake

Reina greets the user, then conversationally collects:
- Last instance name + start/end dates → `lastExample.elapsedDays` (natural-language date parsing)
- Hands-on hours vs waiting hours → `hoursPerInstance`
- Performance (faster/typical/slower than usual)
- Frequency, priority, bottleneck reason

These pre-fill Screen 4 so users adjust rather than guess. Labels read "Reina estimated Xh based on your answers — adjust if needed."

### Diagnostic depth score

`ProgressBar.jsx` shows a "Diagnostic Depth" percentage (formerly "Process Health") rewarding granular data: step count, departments, handoffs, systems, cost data, cycle time, bottleneck, example name.

---

## Chat agent (router-selected toolsets)

The diagnostic chat (`/api/diagnostic-chat`, SSE) runs an Anthropic tool-use loop in `lib/agents/chat/graph.js` (`runStreamingLoop`). The chat tier is Claude **Sonnet 4.6** unless an org model override is in scope. Reina is the assistant persona; Vesno is the product brand surfaced in the audit gate.

`pickAgent` (`lib/agents/chat/router.js`) selects one of three toolsets per turn — there is no single "all tools" list:

| Agent | When | Toolset (`lib/agents/chat/tools.js`) | Count |
|-------|------|--------------------------------------|------:|
| **process** | a process is open, or onboarding (default) | `ALL_CHAT_TOOLS` | 70 |
| **model** | an operating model anchored, no deal/process | `MODEL_AGENT_TOOLS` | 26 |
| **deal** | a deal anchored, no process | `DEAL_AGENT_TOOLS` | 16 |

Tools return result strings; the **client** applies canvas mutations via `processActions()`. The server is stateless w.r.t. canvas state — it only reads what the client passes in `processData`. Deal-scoped tools resolve only when the session is bound to a `dealId` and `ctx.dealAccessVerified` is true — see [Deal data room](#deal-data-room--diligence-rag).

> Counts are derived from the exported arrays in `tools.js`; keep this section in sync when adding/removing a tool (or regenerate from `ALL_CHAT_TOOLS.map(t => t.name)`).

### `ALL_CHAT_TOOLS` — process / onboarding agent (70)

**Step CRUD (6):** `add_step`, `update_step`, `remove_step`, `set_handoff`, `add_custom_department`, `replace_all_steps`
**Connectors (4):** `add_connector`, `remove_connector`, `redirect_connector`, `insert_step_between`
**Branches (5):** `set_branch_target`, `set_branch_probability`, `set_branch_label`, `remove_branch`, `add_branch`
**Step ordering & metadata (8):** `reorder_step`, `set_process_name`, `set_process_definition`, `set_step_details`, `set_cost_input`, `set_bottleneck`, `set_frequency_details`, `set_pe_context`
**Step systems (2):** `add_step_system`, `remove_step_system`
**Checklist & departments (4):** `add_checklist_item`, `toggle_checklist_item`, `remove_checklist_item`, `remove_custom_department`
**Read-only queries (5):** `get_bottlenecks`, `get_critical_path`, `get_step_metrics`, `get_cost_summary`, `get_recommendations`
**Cross-report (1):** `load_report_summary`
**Cost editing (3):** `set_labour_rate`, `set_non_labour_cost`, `set_investment`
**UI / navigation (2):** `highlight_step`, `open_process`
**Discovery / proposal (3):** `undo_last_action`, `propose_change`, `ask_discovery`
**Deal reads (6):** `search_deal_documents`, `get_deal_summary`, `list_deal_participants`, `list_deal_documents`, `list_deal_findings`, `list_deal_changes`
**Deal proposers (5):** `propose_invite_participant`, `propose_reprocess_document`, `propose_link_participant_report`, `propose_upload_document`, `propose_undo_last_action`
**Workspace proposers (4):** `propose_add_function`, `propose_add_role`, `propose_add_system`, `propose_workspace_bulk_setup`
**Process lifecycle — Tier 1 (4):** `create_process`, `duplicate_process`, `file_process`, `delete_process`
**Operating-model edit/delete — Tier 2 (7):** `propose_update_function`, `propose_move_function`, `propose_delete_function`, `propose_update_role`, `propose_delete_role`, `propose_update_system`, `propose_delete_system`
**Artefact (1):** `emit_artefact` — see [Outputs panel & artefact generation](#outputs-panel--artefact-generation)

Tier 1/2 mirror the `propose_*` governance: the executor validates and emits a `workspace_proposal` SSE; the user clicks **Confirm** on a card in `DiagnosticWorkspace.jsx`, which fires the matching `POST`/`PATCH`/`DELETE` on `/api/operating-models/[id]/…`. Nothing is written server-side until that confirm. Target ids come from `list_model_processes` / the `<workspace_tree>` block (functions, roles, and systems are rendered with `[id]` so the agent can reference them).

### `MODEL_AGENT_TOOLS` — model agent (26)

`get_model_summary`, `get_function_heatmap`, `get_top_recommendations`, `get_top_bottlenecks`, `list_model_processes`, `load_report_summary`, `open_workspace_view`, `focus_function`, `open_process`, `propose_add_function`, `propose_add_role`, `propose_add_system`, `propose_workspace_bulk_setup`, `create_process`, `duplicate_process`, `file_process`, `delete_process`, `propose_update_function`, `propose_move_function`, `propose_delete_function`, `propose_update_role`, `propose_delete_role`, `propose_update_system`, `propose_delete_system`, `emit_artefact`, `ask_discovery`

### `DEAL_AGENT_TOOLS` — deal agent (16)

`get_deal_summary`, `list_deal_participants`, `list_deal_documents`, `list_deal_findings`, `list_deal_changes`, `search_deal_documents`, `load_report_summary`, `open_deal_view`, `focus_participant`, `open_process`, `propose_invite_participant`, `propose_reprocess_document`, `propose_link_participant_report`, `propose_upload_document`, `emit_artefact`, `ask_discovery`

> **Removed in the living-workspace migration** (no longer in `tools.js`): `trigger_redesign`, `pin_flow_snapshot`, `generate_report`, `generate_cost`, `list_reports`, `open_panel`. AI improvements now land as inline `propose_change` rows; cost/recommendations derive live; there is no terminal "generate" step.

### Deliberately NOT agent-accessible (governance boundary)

The chat agent has **no** tools for org/account governance: model allowlist + default model, BYO API keys, token budget, org membership, or GDPR account-deletion. These are security/billing controls and stay manual in org settings — an LLM agent must not be able to rotate keys, change budgets, or delete accounts. This is an intentional exclusion, not a coverage gap. Connector-binding credentials (data-room sources) are likewise manual-only.

### New backing endpoints (Tier 1)

`POST /api/operating-models/[id]/processes` (create, or duplicate when `source_process_id` is supplied) and `DELETE /api/operating-models/[id]/processes/[processId]` were added for the process-lifecycle tools; both `requireAuth` + `resolveModelAccess` like their siblings. Repo helpers: `createModelProcess` / `duplicateModelProcess` / `deleteModelProcess` in `lib/operatingModel/repo.js`. The same change fixed a latent bug: the capability routes imported `createFunction`/`updateFunction`/`deleteFunction`, which `repo.js` never exported (manual add/edit/delete of a function 500'd at runtime) — now exported as aliases of the `*Capability` functions.

### Mutation tracking

The client's `MUTATING` set in `DiagnosticWorkspace.jsx` lists every tool that mutates `processData`. Each mutation pushes a snapshot onto an undo stack consumed by `undo_last_action`. **Add new mutating tools to this set** when you ship new tool schemas, otherwise undo will silently skip them.

### Action plumbing

1. Schema in `lib/agents/chat/tools.js` (Zod)
2. Server executor case in `lib/agents/chat/graph.js` (returns result string + `actions[]`)
3. Client handler case in `components/diagnostic/screens/DiagnosticWorkspace.jsx` `processActions()`
4. Prompt description in `lib/prompts.js` so the model knows when to call it

Skip any of these four and the tool will quietly fail.

---

## Other AI agents

`lib/agents/` directories beyond `chat/`:

### `flow/` — Process extraction
Parses uploaded text/Excel/PDF/DOCX into a canonical `processData` JSON. Model: **Fast (Haiku)**. Used by file-upload paths in the chat. Files: `graph.js`, `tools.js`.

### `recommendations/` — Improvement recommendations
Single-shot LLM that produces 3–6 prioritised recommendations per process. Model: **Fast (Haiku)** for the main pass. Has knowledge bases: `industry-knowledge.js`, `methodology-knowledge.js`. Used by `/api/process-diagnostic`. Falls back to rule-based generator if AI fails.

### `redesign/` — AI process redesign
Tool-calling agent that produces optimised step lists, change records, and cost summaries. Model: **Deep (Opus)** for planner + repair, **Fast (Haiku)** for summary. Three Zod-validated tools: `optimize_process`, `record_change`, `calculate_cost_summary`. Programmatic validation via `validateRedesign()`; one repair retry on validation failure. Used by `/api/generate-redesign`.

### `redesign-chat/` — Redesign exploration
Secondary chat for iterating on a redesign variant — apply individual changes, ask "what if". Model: **Sonnet 4.6**. Files: `graph.js`, `tools.js`.

### `workflow-export/` — Build platform exporters
Deterministic (no LLM) generators that take a redesigned `processData` and emit JSON for build platforms. One file per platform: `n8n.js`, `make.js`, `zapier.js`, `powerAutomate.js`, `pipedream.js`, `unqork.js`, `airtable.js`, `camunda.js`, `monday.js`, `processStreet.js`, `retool.js`, `smartsuite.js`, `temporal.js`, `trayIo.js`, `workato.js`. Plus `instructions.js` (per-platform build steps), `buildGuide.js`, `platforms.js` (registry). Used by `/api/generate-workflow-export`.

### Singletons
- `models.js` — three model factories: `getFastModel()`, `getChatModel()`, `getDeepModel()`
- `structured-output.js` — Zod-validated structured output helper for non-tool LLM calls
- `ai-cache.js` — request-level cache for repeated LLM calls

### Single-shot LLM calls (no agent graph)
- `/api/team` (action=analyze) — team alignment analysis, Fast
- `/api/survey-submit` — survey workflow analysis, Fast
- `/api/cost-copilot` — streaming cost Q&A via raw Anthropic SDK
- `/api/cost-analysis/suggest-savings` — labour-rate suggestion, Fast
- `/api/deals/[id]/analyse` — synergy/comparison/redesign analysis on multi-participant deals

---

## Model tiers

`lib/agents/models.js` defines three factories. **All models are Anthropic Claude.**

| Tier | Model ID | Max tokens | Temp | Used for |
|------|----------|-----------|------|----------|
| **Fast** | `claude-haiku-4-5-20251001` | 4 096 | 0.3 | Recommendations, team analysis, survey analysis, redesign summarizer, flow extraction, deal-analysis pipeline (Hobby plan) |
| **Chat (primary)** | `claude-sonnet-4-6` | 16 384 | 0.3 | Diagnostic chat, redesign-chat, cost-chat, deal-analysis pipeline (Pro plan) |
| **Deep** | `claude-opus-4-7` | 16 000 | 0 | Redesign planner/repair |

Override any with `getXModel({ temperature, maxTokens, model })`.

**Deal analysis model selection** is plan-tier-aware. The `runDealAnalysis` Inngest function runs an LLM step that produces a 6–8K-token JSON redesign / synergy / diligence output. Wall-clock cost vs Vercel timeout caps:

| Vercel plan | Per-route timeout | Model | Wall-clock | Quality |
|---|---|---|---|---|
| Hobby (free) | 60s | `getFastModel` (Haiku 4.5, `maxTokens: 6144`) | 25–40s | Structurally identical; narrative slightly less nuanced |
| Pro ($20/mo) | 300s | `getChatModel` (Sonnet 4.6, `maxTokens: 8192`) | 90–150s | Higher narrative quality on phasing / risks |

Switch in `lib/inngest/functions/runDealAnalysis.js:252` (model + maxTokens) and `app/api/inngest/route.js` (`maxDuration`). Re-sync the Inngest app after every flip.

---

## Report system

The report is rendered at `/report?id=<reportId>` and re-renders on edit at `/workspace/map?view=<reportId>`.

`components/report/`:

| Component | Purpose |
|-----------|---------|
| `ReportReadyHero.jsx` | Top banner: process name, company, savings, "Build this" CTA |
| `ReportAtAGlanceSummary.jsx` | Metrics grid: cycle time, cost, automation readiness, bottleneck |
| `ExecutiveSummary.jsx` | C-suite overview |
| `KeyFindings.jsx` | Top bottlenecks ranked by severity |
| `ValueOpportunity.jsx` | ROI, payback, savings breakdown |
| `RoadmapRollup.jsx` | Phased roadmap (quick wins, medium, long-term) |
| `ImplementationTracker.jsx` | Checklist of implementation actions |
| `StepInsightPanel.jsx` | Per-step drill-down |
| `MetricDrillModal.jsx` | Metric explanation popup |
| `ProcessViewToggle.jsx` | Swimlane vs grid flow toggle |
| `ReportAppendices.jsx` | Detailed cost tables, system mapping, audit trail |

The flow itself is rendered SVG-side via `lib/flows/grid.js` (serpentine grid) or `lib/flows/swimlane.js` (department lanes). Both produce `data-step-idx` attributes for click-to-navigate.

Reports persist to the `diagnostic_reports` table; redesigns to `report_redesigns` (named, with status pending/accepted).

---

## PE / M&A / Scaling deals

The deal portal (`/deals`) is a multi-participant flow where multiple companies / people each map their process, then AI analyses them together.

### Three deal types

| Type | Use case |
|------|----------|
| `pe_rollup` | PE roll-up: benchmark portfolio companies, find synergies |
| `ma` | M&A: acquirer + target flow comparison, integration planning |
| `scaling` | Single-company: optimisation roadmap |

There is no per-type page component anymore — all three render through the chat workspace at `/process-audit?deal=<id>` with `DealWorkspaceModal` as the surface. The legacy per-type pages (`DealPagePE.jsx` / `DealPageMA.jsx` / `DealPageScaling.jsx`) and `DealAnalysisSection.jsx` were removed in Phase 18; `app/deals/[id]/page.jsx` is now a redirect.

### Flow

1. Owner creates deal → `POST /api/deals` (returns 8-char `deal_code`)
2. Owner adds participants → `POST /api/deals/[id]/participants`
3. Owner invites by email → `POST /api/deals/[id]/invite` (token-based acceptance)
4. Each participant fills a `deal_flow` slot at `/process-audit?dealFlowId=…` — when they save the diagnostic, `deal_flows.report_id` is populated
5. Owner runs analysis → `POST /api/deals/[id]/analyse?mode=comparison|synergy|redesign|diligence`
6. Result stored in `deal_analyses` and (since migration #24) materialised into `deal_findings`; rendered in `DealWorkspaceModal` (chat workspace). The findings list, exec-summary banner, per-finding evidence drawer, and Day-1 / TSA / Separation cross-cut are all sections of the modal. Diligence-mode PPTX export goes through `lib/exporters/dealDiligenceToPptx.js`

### Analysis modes

| Mode | Inputs | Output | Renderer |
|------|--------|--------|----------|
| `comparison` | All participant process maps | Common steps, unique steps, merge recommendations, proposed standard process | `ComparisonResults` |
| `synergy` | All participant process maps | Quantified opportunities, FTE overlap, systems consolidation, integration risks | `SynergyResults` |
| `redesign` | All participant process maps | Decisive unified target process with per-step lineage + phasing | `RedesignResults` |
| `diligence` | **Data room (primary)**; process maps optional | Exec summary + Tech Landscape / Operational Footprint / Organisation / Red Flags / Day-1+TSA+Separation cross-cut + Key Takeaways | `DealDiligenceReport` (with PPTX export) |

Diligence mode is document-primary and runs without participant maps — the CTA appears as soon as the deal exists. Other modes still gate on "all participants complete".

### Tables

`deals` → `deal_participants` → `deal_flows` → `diagnostic_reports`. `deal_collaborators_emails` is a `TEXT[]` on `deals` (collaborators can edit but aren't participants). Cross-flow analyses live in `deal_analyses` with `source_flow_ids UUID[]` + `mode`.

### Auth model

`lib/orgAdmin.js` and a deal auth helper enforce three roles: **owner**, **collaborator** (in `collaborator_emails`), and **participant** (via `deal_participants.email`). Anonymous flow resolution by code: `POST /api/deals/resolve` (used when a participant clicks an invite link).

### Deal context in the diagnostic chat

The chat surface carries a left rail with a **briefcase icon** (`components/diagnostic/chat/DealsRailButton.jsx`), wired into both `ChatWorkspaceShell` (pre-map screens) and `DiagnosticWorkspace` (the screen-2 map). Click → popover lists the user's deals (signed-in only).

**Selection flow** — picking a deal:
1. Calls `setDeal(...)` on `DiagnosticContext` so `dealId` flows into every `/api/diagnostic-chat` call.
2. Calls `POST /api/deals/[id]/chat-session` to find-or-create the per-(user, deal) copilot session (`chat_sessions` row with `kind='copilot'` + `deal_id`). Migration 28 adds the column + partial index.
3. Pushes `?deal=<id>&chatSession=<sessionId>` so the existing chat-session resume logic in `DiagnosticClient` loads the thread. Refresh / shared links restore both the scope and the conversation.

A small chip at the top of the chat panel ("Talking about <name>") confirms the active scope. **Clear** in the popover removes both query params.

Server-side: `lib/dealAuth.js` verifies access (writes `deal.access_resolved` to `audit_logs`); `search_deal_documents` is gated on `dealAccessVerified`; `findOrCreateDealChatSession()` in `lib/chatPersistence.js` returns `{ sessionId, created }`. No backend changes were needed for the chat agent itself — `dealId` was already a first-class parameter.

**Source cards.** When the agent calls `search_deal_documents` mid-turn, the executor pushes a `deal_documents` SSE event (`{ dealId, query, chunks: [{ chunkId, documentId, filename, page/slide/sheet/cellRange, section, snippet }] }`) via `ctx.onEmit`. The chat client accumulates chunks per turn and attaches them to the assistant message as `m.dealDocs`. The renderer (`DealDocsSources` in `DiagnosticWorkspace.jsx`) shows a "N sources from the data room" strip below the bubble with filename + location + 280-char snippet per chunk. Side-effect only — the model still receives the same text payload for citation, so prose answers stay grounded.

**Deal-metadata tools.** Four read-only tools answer dashboard-y questions without searching the data room:

| Tool | Returns |
|---|---|
| `get_deal_summary` | One-shot snapshot: name, type, status, owner, participant counts, document counts by status, latest analysis status |
| `list_deal_participants` | Participants with role, company, status, completion date |
| `list_deal_documents` | Docs with filename, status, source party, page count, byte size — optional `party` filter |
| `list_deal_findings` | Latest completed analysis's findings with section/category/severity/evidence count + per-finding review status (pending/approved/rejected) |

`list_deal_documents` and `list_deal_findings` also emit a `deal_metadata` SSE event with structured items so the client renders compact cards (`DealMetaCards`) under the bubble — colour-coded status pills (ready/pending/failed) for docs and severity pills (low/medium/high/critical) for findings. Same access-gate pattern as `search_deal_documents`: refuses without `dealAccessVerified`. Reads via service-role.

**Clickable cards.** Document cards (both `DealDocsSources` and the docs section of `DealMetaCards`) make the filename a button — click fetches a 5-min signed Storage URL via `GET /api/deals/[id]/documents/[docId]/signed-url` (any deal viewer; `resolveDealAccess`, audit-logged) and opens the file in a new tab. Finding cards link to `/deals/[id]?focusFinding=<key>` so the user can act on the finding (approve/reject/edit) from the existing deal-page review UI; `DealDiligenceReport` reads the param via `useSearchParams`, scrolls the matching `<FindingCard id="finding-<key>">` into view, and runs a 2.4s teal pulse animation (`finding-card--pulse` keyframes in `app/deals/deals.css`) so the user sees where they landed.

**Mutation tools (proposed → user confirms).** Three deal-mutation tools all follow the same pattern: the executor stages a proposal via a `deal_proposal` SSE event; the client renders an Apply/Dismiss card; the user clicks Apply to actually call the relevant endpoint. **The agent never mutates deal state directly.**

| Tool | What Apply does | Endpoint | Auth at apply |
|---|---|---|---|
| `propose_finding_review` | Approve/reject/mark-for-revision on a finding | `PATCH /api/deals/[id]/analyses/[analysisId]/reviews` | Editor |
| `propose_run_analysis` | Kick off a `comparison`/`synergy`/`redesign`/`diligence` analysis (async via Inngest) | `POST /api/deals/[id]/analyse` | Editor |
| `propose_export_pptx` | Download the latest diligence memo (validates ≥1 approved finding before staging) | `GET /api/deals/[id]/export-diligence-pptx?analysis_id=...` | Editor |
| `propose_invite_participant` | Add a participant slot (companyName + role + optional email/name) and optionally send the invite email | `POST /api/deals/[id]/participants` (NEW) | Editor |
| `propose_generate_report` | Stage a deal-scoped report generation. Picker covers four scopes: `process_per_company`, `company_rollup`, `process_across_companies`, `multi_company_multi_process`. Cross-company scopes accept `mode` (standard / comparison / synergy / redesign) and route through the analyse pipeline | `POST /api/deals/[id]/analyse` (cross-company scopes) or report fetch (single-company) | Editor |
| `propose_reprocess_document` | Reset a document to `pending` and re-fire the parsing+embedding worker. Optional `wipe` deletes existing chunks first (chunker-upgrade case). Validates the doc has stored bytes before staging | `POST /api/deals/[id]/documents/[docId]/reprocess[?wipe=1]` | Editor |
| `propose_link_participant_report` | Bind one of the user's existing diagnostic reports to a participant slot (e.g. "use my last audit for Acme") | `PATCH /api/deals/[id]/participants` | Editor |
| `propose_upload_document` | Suggest specific docs to add to the data room (free-text doc-type list). Apply opens `/deals/[id]?focus=documents` in a new tab; the deal page scrolls + pulses the data-room panel | (navigation only) | n/a (just navigation) |
| `propose_undo_last_action` | Revert a recent reversible action. v1 supports `finding_review` (re-PATCH to pending) and `link_participant_report` (clear binding). Other actions (analysis runs, exports, invites, uploads, reprocess) are NOT undoable from chat — explained in the tool description | `PATCH /reviews` or new `PATCH /participants/[id]` (NEW) | Editor |

**Auto-loaded deal-context pane.** When chat is scoped to a deal, the chip ("Talking about X") gets a "Show context" toggle that expands a compact stat strip — *participants ready · documents indexed · latest analysis · deal status*. Data fetched once from `GET /api/deals/[id]` on mount; the route now joins `deal_documents` (count + ready count) and the latest `deal_analyses` row into the response (`buildDealAuxiliaryStats`). No tool round-trip needed for at-a-glance state.

**Deal workspace modal.** "Open workspace" button on the chip opens `DealWorkspaceModal` — a full-screen lightbox that surfaces the most-used dashboard widgets *inside* the chat surface: participants list, data room (with the expected-docs checklist), structured **Q&A** queue, and latest findings. Reuses `/api/deals/[id]`, `/api/deals/[id]/documents`, `/api/deals/[id]/analyses[/id]`, plus the new `/api/deals/[id]/qa`, `/api/deals/[id]/checklist`, and `/api/deals/[id]/scorecard`. Click a doc filename → signed URL → new tab; click a finding → deep-link to `/deals/[id]?focusFinding=<key>`.

The header "Scorecard" button toggles the `DealScorecard` view: a one-page IC summary auto-filled from the latest completed analysis (thesis from exec summary, top-5 risks ranked by severity × confidence, mitigants from recommendations, severity counts, doc coverage, rule-based recommended action — *Re-trade or walk* / *Negotiate price* / *Proceed with conditions* / *Proceed; address in 100-day plan* / *Proceed with confidence*). Top-risk rows deep-link back to their finding row in the workspace using the same pulse-and-scroll path as `focusFindingKey`.

**Workspace collaboration (migration #31).** Four additions turn the modal from read-mostly into a working surface:

| Feature | Where | Notes |
|---|---|---|
| **Q&A queue** | `deal_qa_items` table; `/api/deals/[id]/qa` (GET/POST/PATCH/DELETE) | Question + asker + assigned participant + status (open/answered/skipped/obsolete) + answer + optional evidence_chunk_ids[] + optional related_finding_key. Editor writes; assigned participants can answer their own. Workspace section between Documents and Findings with composer, assignee dropdown, per-item answer composer, reopen. |
| **Finding comments** | `deal_finding_comments` table; `/api/deals/[id]/analyses/[id]/findings/[key]/comments` | Threaded discussion per finding distinct from `reviewer_note`. `@email` mentions parsed and stored in `mentions[]` for future webhook. Lazy-loaded on row expand. |
| **Finding tags** | `deal_findings.tags text[]` (GIN); `/api/deals/[id]/analyses/[id]/findings/[key]` PATCH | Recommended vocabulary in `lib/deal-analysis/findingTags.js`: `deal_breaker / re_trade / disclose / mitigate / monitor`. UI: `FindingTagsChips` toggles below expanded finding (editor-only). Free-form — DB doesn't constrain. |
| **Finding staleness** | `deal_findings.stale boolean` + `stale_reason` + `stale_at` | Flipped to `true` when a cited document is reprocessed (eager via `/documents/[docId]/reprocess`) or replaced. `lib/deal-analysis/staleness.js` walks finding evidence and matches by `document_id`. Yellow STALE pill on the row + in-row stale bar with **Mark verified** button (editor-only PATCH `stale=false`). |

**Per-finding evidence drawer.** `EvidenceRow` in the modal shows **Inspect** + **Open** buttons on each evidence pointer. *Inspect* lazy-loads the chunk plus 1 neighbour either side via `GET /api/deals/[id]/documents/[docId]/preview?chunk_id=…&context=1` (relaxed from editor-only to any deal viewer; per-doc visibility enforced via `canSeeDocument`). The target chunk is highlighted in the drawer. *Open* fetches a signed URL for the source document.

**Auto-rerun on doc changes (migration #30).** `lib/deal-analysis/autoTrigger.js` queues a delta diligence analysis from `processDealDocument` after `mark-ready`. Throttled: needs a prior completed analysis, no in-flight run, and ≥1 hour gap. Inserts with `auto_triggered: true` so the workspace can distinguish auto-queued runs from user-initiated ones. The header sub-line shows " · auto" and findings new since the previous run get a small **NEW** pill.

**Severity-weighted risk score on the deals rail.** `/api/deals` enriches each deal with `riskScore` (Σ severity × confidence on the latest analysis), `openFindings`, `criticalFindings`. The Deals rail panel sorts deals by risk descending and renders a coloured pill (`critical` / `high` / `medium` / `low`) next to each name. The findings query runs in the same parallel batch as the three deal-source queries — no extra round-trip.

**Workspace perf.** Modal load is parallelised: deal + documents + Q&A + analyses-list all fire in one `Promise.all`. The findings detail (analysis + reviews + previous-analysis) starts as soon as the analyses list returns, in parallel with anything else. Loading is split into `loadingCore` (deal/docs/QA) and `loadingFindings` so the modal paints progressively. A module-level cache keyed by `dealId` (max 8 entries, LRU) renders the previous snapshot instantly on re-open and refreshes in the background.

**Inline review + upload (editor-only).** When `deal.canEdit` is true on the loaded payload, the modal renders:
- **Multi-file upload** in the data-room section: a `+ Upload` button (multiple-select) and **drag-and-drop** anywhere inside the section. Files upload sequentially via multipart `POST /api/deals/[id]/documents`; per-file errors are aggregated and shown inline. Optimistic prepend of new rows.
- **Inline review** on each finding row: status pill (`pending`/`approved`/`rejected`/`needs_revision`) + five icon buttons (`✓` approve, `✕` reject, `?` needs revision, `✎` reviewer note, `✏` edit finding text). The note button toggles a textarea editor; saving sends `{ finding_key, status, reviewer_note }` to `PATCH /reviews`. The edit button toggles a title input + body textarea + "Revert to original" button (when an override is in place); saving sends `edited_title` / `edited_body`. All review writes go through one `submitReviewPatch(key, status, extras)` so quick status changes preserve any existing note/edits (omitted fields are preserved server-side). A trimmed inline preview of the saved note shows under the row when not editing; both buttons glow accent-coloured when their respective override is set, and an "·edited" flag appears next to titles where the reviewer has overridden the agent's text.

This is the **hard-dismantle** of `/deals/[id]`'s primary verbs: a reviewer can now run the entire diligence triage workflow inside chat — open data room, drag-drop upload, run analysis, triage findings (approve/reject/notes/edits), and manage participants (edit role / contact email / company name, delete with inline confirmation), without leaving the chat surface. The participant edit/delete UI calls `PATCH /api/deals/[id]/participants/[participantId]` (extended to accept `{ role?, companyName?, participantEmail?, participantName? }` alongside the existing `{ report_id: null }` unlink path) and `DELETE /api/deals/[id]/participants/[participantId]` (cascades to `deal_flows` via FK; the participant's underlying diagnostic report survives — only the deal binding is removed).

**Cross-cut lens.** The findings section now offers two views via tabs in its header: **List** (default — flat list with severity/section/review controls, as documented above) and **Day-1 / TSA / Separation** (three-column view filtered by the finding's `impact` array using the axis constants `day_one`, `tsa`, `separation`). Each column shows severity pill + clickable title (deep-link to the finding) + review status pill. Empty state explains the cross-cut tags come from diligence runs and a re-run may be needed for older analyses.

**Read-only memo features (Phase 18 parity push).** The modal now also surfaces:
- **Executive summary banner** — top of the findings section, always visible, shows the analysis's `executiveSummary` finding inline (title + body)
- **Per-finding expand** — `▸` chevron on every body finding row reveals an inline detail block with the prose body, recommendations bullet list, model confidence %, and evidence rows. Each evidence row is clickable (signed URL → new tab) when it cites a specific document
- **Key Takeaways block** — bottom of the findings section, dedicated panel listing the analysis's `keyFindings` rows
- **5-second polling** on the data-room list while any document is in `pending`/`parsing`/`embedding` status; stops once all are terminal — matches the legacy `DealDocumentsPanel` cadence
- **Auto-open + scroll-to-finding** when the modal mounts with `focusFindingKey` set: expands the row, scrolls into view, runs a 2.4s teal pulse — same UX as the old deal-page deep-link landing

These pieces close the parity gap with the legacy diligence memo. Reviewers can now read the executive summary, drill into bodies/recommendations/evidence, and see takeaways without leaving the chat surface.

**Legacy `/deals/[id]` removed (Phase 18).** `app/deals/[id]/page.jsx` is now a server-side `redirect()` to `/process-audit?deal=<id>` (forwarding `?focusFinding=` and `?focus=` query params untouched). The legacy components (`DealAnalysisSection.jsx`, `DealPagePE.jsx`, `DealPageMA.jsx`, `DealPageScaling.jsx`, `components/deals/DealDiligenceReport.jsx`, `components/deals/FindingCard.jsx`, `components/deals/DealDocumentsPanel.jsx`) are deleted. All chat-side finding deep-links (`DealMetaCards`, `DealWorkspaceModal`) updated to point at the new URL pattern. The "Open full dashboard ↗" button in the modal is removed (there's no full dashboard anymore — the modal *is* the surface). Old bookmarks keep working via the redirect; the user lands in the chat with the workspace modal pre-opened on the right finding. To recover the legacy long-form layout: `git log --diff-filter=D -- app/deals/[id]/page.jsx`.

**Portal dismantle (Phase 19).** All portal surfaces except org admin are now chat-rail icons in `/process-audit`:

| Rail icon | Component | Replaces |
|---|---|---|
| 🏠 (top) | `HomeRailButton.jsx` | Returns to a fresh chat with the standard intro — clears deal scope, canvas, and any in-flight conversation via hard navigation to `/process-audit` |
| ▦ | Admin dashboard link | `/org-admin` opens in new tab |
| 📄 | `ReportsRailButton.jsx` | Slide-in panel listing user's diagnostic reports grouped by company → recency bucket. Per-row +/− toggles, edit/redesign/delete at child level (current process + each redesign), delete + collapse at parent. Risk-orderable companies. Powered by `/api/get-dashboard` and `/api/save-redesign` (DELETE) |
| 💼 | `DealsRailButton.jsx` | Slide-in panel listing user's deals (owner / collaborator / participant). Sorted by `riskScore` desc with coloured pill (`critical`/`high`/`medium`/`low`) + `criticalFindings` count. Click → scopes the chat to that deal (URL `?deal=<id>&chatSession=<sessionId>`) |
| 💬 | Chat history | Toggles `ChatHistoryPanel` |
| ◫ | Artefacts | Slide-in panel listing artefacts (snapshots, reports, cost analyses) attached to messages in the current session. Doesn't displace chat. |
| 📋 | View report | Visible when `editingReportId` set |
| 💾 | Save to report | Visible when `editingReportId` set |
| 💲 | Cost analysis | Visible when `hasCostAccess && editingReportId` |
| ☰ | Steps list | Slide-in panel hosting `stepListContent` |
| 📊 | `AnalyticsRailButton.jsx` | Full-screen modal that mounts `AnalyticsCanvasPanel` natively (auth + fetch + render). On mobile, dispatches `vesno:open-analytics-canvas` so the workspace mounts the same panel in its canvas column. |
| 📚 (bottom group) | `DocsRailButton.jsx` | Slide-in panel listing doc groups → click opens `/docs/<slug>` in new tab; backed by `GET /api/docs/list` |
| 🔁 | Replay walkthrough | Re-opens the GUIDE_TOUR from the first stop |
| 🕒 | Activity log | Slide-in panel hosting `<AuditTrailPanel embedded />` (drops outer floater chrome) |
| ⚙ (footer) | `SettingsRailButton.jsx` | Popover with email, GDPR export, GDPR account deletion (`DELETE`-typed confirm gate), sign out. Anchored from the rail bottom so the popover never clips against the viewport |

The five popover-style rail icons (Reports / Deals / Docs / Steps / Artefacts / Activity log) all use the shared `RailSlidePanel` component (`components/diagnostic/chat/RailSlidePanel.jsx`) — same anchoring (rail right edge), close affordance (× button + outside-click + Escape), and width (default 420px from `.s7-rail-pane` CSS).

The chat-rail popovers respond to auto-open params on `/workspace/map`: `?openDeals=1`, `?openAnalytics=1`, `?openSettings=1`. The corresponding rail button reads the flag on mount and auto-opens. `/portal`, `/portal/analytics`, `/portal/deals`, and `/portal/settings` are gone — bare `/portal` and the analytics / deals / settings sub-routes were deleted (analytics is now `components/workspace/AnalyticsCanvasPanel.jsx` mounted natively in the canvas). Org admin stays on `/org-admin` because: members + BYO API keys + budgets are infrequent, dense, and benefit from a full-page UI rather than a modal.

**Inline document viewer.** Document filenames in chat (both `DealDocsSources` source cards and `DealMetaCards` document rows) now open a `DealDocViewer` modal — full-screen lightbox, `<iframe>` for PDFs, `<img>` for images, "Open in new tab" fallback for everything else. Closes on overlay click / Close button. The signed URL still flows through the same `GET /api/deals/[id]/documents/[docId]/signed-url` endpoint (any deal viewer; audit-logged).

**Legacy `/deals/[id]` dashboard is gone.** Phase 18 deleted it; the route is now a server-side redirect to `/process-audit?deal=<id>` that forwards `?focusFinding=` and `?focus=` untouched. All deal-side verbs — uploads, review, Q&A, scorecard, exports, participant management — live inside `DealWorkspaceModal` now. Old bookmarks land in the chat surface with the modal pre-opened on the right finding. To recover the legacy long-form layout: `git log --diff-filter=D -- app/deals/[id]/page.jsx`.

`DealProposalCards` (in `DiagnosticWorkspace.jsx`) renders each proposal as a bordered card with status-coloured left edge (teal=approve, red=reject, amber=needs_revision, indigo=run analysis, violet=export). Apply swaps to "✓ Applied" plus an info line (e.g. "Analysis started · id=xxxxxx" or "Download started"); errors surface inline. The 403 path for participant-tier users surfaces gracefully (no silent failures). Mirrors the cost-proposal pattern (`set_labour_rate`, `set_non_labour_cost`, `set_investment`) so the UX is consistent.


---

## Org admin

Route: `/org-admin` (`app/org-admin/page.jsx`). The route shell mounts `OrgAdminClient` from `components/org-admin/`. The whole `/portal/*` namespace has been removed.

`components/org-admin/`:

| File | Purpose |
|------|---------|
| `OrgAdminClient.jsx` | Org member management UI |
| `CustomerKeyPanel.jsx` | BYO API key set/rotate/revoke per org |
| `UsageAnalyticsPanel.jsx` | Per-org usage rollup (tokens, surface, budget) |
| `ModelAllowlistPanel.jsx` | Allow-list of models the org may pick + default |
| `IntegrationsPanel.jsx` | Per-org OAuth integrations (Google Drive, etc.) |
| `FirstRunOnboarding.jsx` | One-shot onboarding when `?firstRun=1` |
| `AreaChart.jsx` | SVG area chart used by `UsageAnalyticsPanel` |
| `org-admin.css` / `org-admin-byo.css` | Shared admin styles (class prefix `.portal-*` is historical) |

`components/auth/SignInForm.jsx` — Supabase login/signup form. Mounted by `/signin`, `/org-admin`, the analytics canvas auth gate, and `TeamAuthGate`.

Analytics moved to `components/workspace/AnalyticsCanvasPanel.jsx` and renders natively in the canvas. Deals and settings live in chat-rail popovers reachable via `/workspace/map?openDeals=1` / `?openSettings=1`.

### Responsive / mobile

The app ships a deliberate responsive layer (~30 `@media` blocks in `public/styles/diagnostic.css`; primary breakpoint `@media (max-width: 768px)` ~line 19466): rail slide panels go full-bleed (`.s7-rail-pane` → 100vw/100vh, overriding the JS inline anchor), rail buttons enlarge, scorecards/checklists stack, modals are viewport-bounded, and secondary zoom/close controls hit a 40px touch target. `env(safe-area-inset-*)` handles notches. JS side: a `useIsMobile()` hook (768px) drives a `mobileView` chat/canvas toggle, and `MobileViewGate` fronts the flow/report surfaces with a "best viewed on desktop" opt-in.

This layer was previously inert: `app/layout.jsx` had no viewport meta, so phones used a ~980px layout viewport and no breakpoint matched. Fixed via `export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' }` in `app/layout.jsx` (`viewport-fit=cover` is required for the existing safe-area-inset rules to take effect; no `maximum-scale`/`user-scalable=no`, so pinch-zoom stays). **Apply mobile fixes by extending the existing 768px block, not by inventing new breakpoints.**

---

## Entitlements & RBAC

`lib/entitlements.js` defines four boolean keys stored in `organization_members.entitlements` (JSONB):

| Key | Default | Gates |
|-----|---------|-------|
| `portal` | `true` | `/workspace/map` and authenticated diagnostic |
| `cost_analyst` | `false` | `/cost-analysis`, cost copilot, labour-rate edits |
| `deals` | `false` | `/deals` create/edit |
| `analytics` | `false` | The Analytics popover (chat rail) and workspace analytics tab |

Plus `is_org_admin` (boolean column) which overrides individual entitlements at the org level.

Helpers: `defaultEntitlements()`, `mergeWithDefaults()`, `hasEntitlement(ents, key)`, `sanitizeEntitlements(raw)` (strips unknown keys).

`lib/orgAdmin.js` exposes server-side helpers for fetching the active member row and checking gates inside API routes.

---

## Chat persistence (sessions, messages, artefacts)

Three tables back the chat history experience:

| Table | Holds | Linked from |
|-------|-------|-------------|
| `chat_sessions` | One row per conversation; `kind` ∈ {map, redesign, cost, copilot}; `report_id` FK; full-text search on `title` + `summary` | `/api/chat-sessions`, `/api/chat-sessions/[id]` |
| `chat_messages` | Each turn (user/assistant/tool); `actions` JSONB, `attachments`, `artefact_id` FK | `/api/chat-messages` |
| `chat_artefacts` | Durable outputs: `kind` ∈ {flow_snapshot, report, cost_analysis, deal_analysis}; `ref_id` to external row; `snapshot` for inlined `processData` | Linked from messages |

### Artefact lifecycle

Artefacts pin durable moments. Created on:
- Phase transitions (intake → map → details → cost → complete)
- Redesign triggers
- Inline report ready
- File-upload reshape (large `replace_all_steps`)
- User pin via `pin_flow_snapshot` tool

Rendered as pills in the chat history rail. Hydrate on report edit and on cold-load via localStorage fallback (for pre-report state where there's no `report_id` yet).

---

## Outputs panel & artefact generation

A persistent, model-scoped home for generated content that does not fit the canonical model schema (tables, docs, code, datasets, diagrams, project plans) - the equivalent of the artefacts panel in a Claude chat. Emitting an artefact never mutates the canonical model.

### One list (rail slider) + a render-only canvas

There is a single list of artefacts and a single place they render. The chat rail's **Artefacts** slider is the one list: an **Outputs** group of persistent `workspace_artefacts` (latest of each `meta.supersedes` lineage) sits alongside the session-computed snapshots/reports, so every artefact, however produced, is in one place. The rail icon's badge/count is the combined total.

Selecting a generated output sets `window.__vesnoPendingOutputArtefact`, dispatches `vesno:open-workspace` (`scope:'outputs'`) + `vesno:open-output-artefact`, and the **Outputs** canvas renders just that artefact. The Outputs scope tab still exists at `/workspace?view=outputs` (scope id `outputs`, `components/workspace/WorkspaceScopeNav.jsx`) and is rendered by `components/workspace/WorkspaceOutputsTab.jsx` inside the embedded chat canvas when `effectiveCanvasScope === 'outputs'`, but it is now **render-only**: its old left-hand artefact list/sidebar was removed (the rail slider owns the list). `WorkspaceOutputsTab` keeps a pending-selection ref (seeded from `window.__vesnoPendingOutputArtefact`) so the requested artefact wins over select-newest even when the tab mounts from the same click, plus a `vesno:open-output-artefact` listener for the already-mounted case. The canvas is a single flex column with one scroll region (`.ws-out-body` via the `ws-out-tab--full` modifier) — the earlier nested 72vh/70vh boxes that each grew their own scrollbar are gone. Emitting an artefact never mutates the canonical model.

### `emit_artefact` tool + executor

Chat tool `emit_artefact` lives in `lib/agents/chat/tools.js` and is added to `ALL_CHAT_TOOLS`, `MODEL_AGENT_TOOLS`, and `DEAL_AGENT_TOOLS`. Spec-based input: `{ skill, title, spec, context, content? (only for skill="raw"), language?, supersedes? }`. The agent does NOT write the artefact body itself (except `raw`); it picks a skill and hands a brief to a specialist sub-agent. The executor is the `emit_artefact` case in `lib/agents/chat/graph.js`. The model the artefact binds to is resolved centrally by `resolveActiveModelId` (graph.js): session `operatingModelId` → the open process's `operating_model_id` (process chats, ownership-checked) → the signed-in user's **active operating model** (`resolveDefaultModelForUser`: per-member preferred → org default).

**Text/structured skills** generate synchronously in the chat turn, then the executor emits an SSE `artefact` event and `DiagnosticWorkspace` dispatches `vesno:artefact-created` so a mounted Outputs panel refreshes live.

**Office skills (`.pptx`/`.docx`/`.xlsx`) are async** (a synchronous sandbox build took minutes and blocked the chat). The executor: creates a placeholder `workspace_artefacts` row with `meta.build.status = 'building'`, emits the `artefact` SSE immediately (it shows in Outputs as "Building…"), enqueues an `artefact/office.requested` Inngest event, and returns to the chat in ~1s. The **`buildOfficeArtefact`** Inngest worker (`lib/inngest/functions/`) runs the slow model+sandbox build off the request path via the shared `runOfficeArtefactBuild` helper (`lib/operatingModel/officeArtefactBuild.js`): generate → upload bytes → set `meta.file` + `build.status='ready'` (or `'failed'` with an error) → meter tokens. `WorkspaceOutputsTab` polls every 9s while any row is `building` and stops when none are, so the finished file appears on its own. If Inngest is **not** configured, `emit_artefact` falls back to running `runOfficeArtefactBuild` inline (that path waits, but the file still completes). A download is only ever offered when a real `meta.file.path` exists — a failed/incomplete build shows an honest "didn't finish — regenerate" state, never a JSON body saved as `.pptx`.

### Artefact sub-agent (`lib/agents/artefacts/generate.js`)

A focused, non-conversational one-shot generator. **Per-skill model tier** (`modelTierForSkill` in `generate.js`), not Opus-for-everything (that was the dominant emission-latency cause): the common text/table/csv/diagram/code skills run on **Haiku 4.5** (`FAST_MODEL_ID`) — ~3–5× faster, and the one repair pass is also Haiku-fast; a small `DEEP_SKILLS` set (`business_case`, `board_pack`, `qofe_summary`, `decision_memo`, `target_operating_model`, `project_charter`, `scenario_model`, and the structured Gantts) stays on **Opus 4.7** (`DEEP_MODEL_ID`); **office** skills run on **Sonnet 4.6** (`CHAT_MODEL_ID`, no adaptive thinking — building `python-pptx`/`docx`/`openpyxl` is mechanical codegen, not deep reasoning). `emit_artefact` no longer forces the chat-session model onto the specialist — the skill tier decides; BYO key still passes through. `max_tokens` 8000; no `temperature`. Static per-skill system prompt is prompt-cached (`cache_control: ephemeral`). `jsonSchema` skills use structured outputs (schema-valid first-shot); others validate→repair-once; refusals fail fast. Token usage **is** metered into the org ledger (`meterArtefact` for the text path; the office worker meters after build) — no longer a follow-up.

### Skill registry (`lib/agents/artefacts/skills.js`)

A skill is the unit of specialisation: it tells the sub-agent what to produce and how to validate it. `ARTEFACT_SKILLS` is the registry; `skillIds()` (registry keys + `raw`) is the enum the `emit_artefact` tool exposes; `skillCatalogue()` is the one-line "id - whenToUse" digest injected into the tool description so the model can pick.

**Skill object shape:**

| Field | Required | Purpose |
|-------|----------|---------|
| `id` | yes | Stable key; also the `skill` enum value on `emit_artefact` |
| `label` | yes | Human label shown in the Outputs list |
| `type` | yes | Artefact `type` written to `workspace_artefacts.type` - drives which renderer `WorkspaceOutputsTab` uses |
| `language` | no | Syntax hint for `type: code` (e.g. `sql`) |
| `whenToUse` | yes | One line; aggregated into the tool description so the agent routes correctly |
| `instructions` | yes | The format contract handed to the sub-agent as its system prompt body |
| `validate(content)` | yes | `{ ok, content?, error? }` - structural check + cheap auto-repair (fence-strip etc.); a fail triggers the one repair pass with `error` fed back |
| `jsonSchema` | no | When present, the sub-agent uses structured outputs (`output_config.format`) so the output is schema-valid first-shot |

**Registered skills — 47, plus the special `raw` (48 `emit_artefact` enum values).** `mode`: `structured` = ships a `jsonSchema` (schema-valid first-shot); `validate→repair` = one-shot text + validate-once; `office` = built **async** by the `buildOfficeArtefact` Inngest worker (code-execution sandbox → binary in Storage; placeholder row flips building→ready/failed); `raw` = no sub-agent (the agent supplies `content`).

_Plans & diagrams_

| `id` | output | mode | When to use |
|------|--------|------|-------------|
| `gantt` | `gantt` | structured | timeline / project plan with phases, dependencies, milestones |
| `hundred_day_plan` | `gantt` | structured | post-deal Day-1 / 100-day integration plan |
| `automation_roadmap` | `gantt` | structured | initiatives sequenced by ROI / dependency |
| `flow_diagram` | `mermaid` | validate→repair | process flow / decision tree / system diagram |
| `kpi_tree` | `mermaid` | validate→repair | KPI / driver tree decomposing a top metric |
| `capability_map` | `mermaid` | validate→repair | value-chain / business-capability map |
| `swimlane` | `mermaid` | validate→repair | cross-functional process as swimlanes |
| `sequence_diagram` | `mermaid` | validate→repair | interaction/sequence between actors or systems |
| `er_diagram` | `mermaid` | validate→repair | data model / entity-relationship diagram |
| `roadmap_timeline` | `mermaid` | validate→repair | high-level themed roadmap (not a task Gantt) |
| `quadrant_2x2` | `mermaid` | validate→repair | 2x2 prioritisation (effort vs impact, …) |

_Docs & memos (markdown)_

| `id` | mode | When to use |
|------|------|-------------|
| `one_pager` | validate→repair | concise exec summary / one-pager |
| `policy` | validate→repair | policy / SOP / controlled-process doc |
| `decision_memo` | validate→repair | memo framing a decision with options + recommendation |
| `raci` | validate→repair | RACI matrix across activities and roles |
| `project_charter` | validate→repair | initiative charter: goal/scope/stakeholders/milestones |
| `business_case` | validate→repair | investment justification: costs, benefits, options |
| `swot` | validate→repair | strengths / weaknesses / opportunities / threats |
| `board_pack` | validate→repair | board / steering-committee update |
| `test_plan` | validate→repair | test / validation plan for a change |
| `qofe_summary` | validate→repair | quality-of-earnings adjustments summary |
| `target_operating_model` | validate→repair | TOM blueprint |
| `cutover_runbook` | validate→repair | go-live / cutover runbook with rollback |
| `status_report` | validate→repair | periodic project status / RAG |
| `custom` | validate→repair | fallback for anything not matching a specific skill |

_Structured data (`table` JSON, or `csv`)_

| `id` | output | When to use |
|------|--------|-------------|
| `comparison_table` | table | side-by-side comparison on criteria |
| `risk_register` | table | risks: likelihood / impact / owner / mitigation |
| `scenario_model` | table | what-if / financial model: scenarios x metrics |
| `raid_log` | table | risks, assumptions, issues, dependencies |
| `stakeholder_map` | table | interest vs influence, stance, engagement |
| `okrs` | table | objectives and key results |
| `comms_plan` | table | stakeholder communications plan |
| `data_dictionary` | table | fields/columns of a dataset or table |
| `red_flag_register` | table | diligence findings: severity / evidence / recommendation |
| `dd_checklist` | table | diligence request list with received/missing status |
| `benefits_realisation` | table | benefit / metric / baseline / target / owner / timing |
| `change_impact` | table | change-impact across processes/systems/people |
| `decision_log` | table | decision / rationale / owner / date / status |
| `dataset` | csv | tabular dataset for spreadsheet export |

_Analytical / code_

| `id` | output | When to use |
|------|--------|-------------|
| `sql` | `code` (`sql`) | a SQL query (cohort, metric, extract) |

_Office files (async `buildOfficeArtefact` Inngest worker → code-execution sandbox → binary in Storage; Sonnet 4.6)_

| `id` | output | When to use |
|------|--------|-------------|
| `deck` | `.pptx` | PowerPoint — exec readout, steering pack, diligence summary |
| `document` | `.docx` | formatted Word report / SOP / board memo |
| `workbook` | `.xlsx` | Excel model, register, or multi-sheet dataset |
| `ic_memo` | `.docx` | investment-committee / deal memo |
| `process_sop` | `.docx` | controlled SOP document |
| `synergy_model` | `.xlsx` | deal synergy model (cost + revenue, phasing) |
| `cost_baseline` | `.xlsx` | per-function cost baseline with rollups |

_Special_

| `id` | When to use |
|------|-------------|
| `raw` | the agent supplies `content` directly; the sub-agent is skipped entirely |

The three `gantt`-type skills share one structured-output schema (`GANTT_SCHEMA` in `skills.js`, reused via `jsonSchema: GANTT_SCHEMA`); their `okGanttData` validator also enforces the *semantic* bar (dependency density, milestones, a date anchor) a JSON Schema can't. Office skills bypass `jsonSchema`/`validate` entirely — they route through the async `buildOfficeArtefact` worker → `generateOfficeArtefact` (code execution), validated by PK-zip magic bytes. Everything else rides the validate→repair-once loop; `csv`/`table`/`json` are intentionally schema-free.

**Adding a skill** - one file, no plumbing elsewhere:

1. Add an entry to `ARTEFACT_SKILLS` with the shape above. `type` must be one the renderer handles (`markdown`/`code`/`table`/`csv`/`json`/`html`/`svg`/`mermaid`/`gantt`); reuse an existing renderer or add a `type` branch in `WorkspaceOutputsTab.jsx`.
2. Write a `validate()` (reuse `okText`/`okJson`/`okTable`/`okCsv`/`okMermaid`/`okCode`, or a bespoke one like `okGanttData`).
3. Optionally add a `jsonSchema` (kept within the structured-outputs subset: no recursion, no min/max/length, `additionalProperties:false` on every object) to remove the repair round-trip.

It is then automatically in the `emit_artefact` enum + catalogue and usable by every agent that has the tool - no `tools.js`/`graph.js` edit needed.

### Storage (`workspace_artefacts`)

`supabase/migration-workspace-artefacts.sql` (migration #39) creates `public.workspace_artefacts`: columns `id`, `operating_model_id` (FK → operating_models, NOT NULL), `session_id` (nullable FK → chat_sessions ON DELETE SET NULL), `type` (free text, no CHECK - schema-light by design), `title`, `content` (string), `language`, `source` (`agent`|`user`), `meta` jsonb, `created_by_email`, `created_at`, `updated_at`. RLS: any member of the model's org may READ and WRITE (NOT admin-gated, because emitting an artefact never mutates the canonical model). Version lineage is tracked via `meta.supersedes` (the id of the artefact a revision replaces) - no migration needed. Repo helper: `lib/operatingModel/artefacts.js` (`listArtefacts`, `createArtefact`, `updateArtefact`, `deleteArtefact`).

### API routes

Auth + `resolveModelAccess`, member access (not admin-gated):

- `GET /api/operating-models/[id]/artefacts` - list (newest first)
- `POST /api/operating-models/[id]/artefacts` - manual create
- `PATCH /api/operating-models/[id]/artefacts/[artefactId]` - rename
- `DELETE /api/operating-models/[id]/artefacts/[artefactId]` - delete

### Rendering

`WorkspaceOutputsTab.jsx` renders by `type`: markdown/code via `react-markdown` + `rehype-highlight`; `table`/`csv` parsed to HTML tables; `json` pretty-printed; `html`/`svg` in a sandboxed iframe; `mermaid` via a dynamically-imported `mermaid` renderer with pan/zoom; `gantt` via an interactive `components/workspace/GanttChart.jsx`. GanttChart is a real interactive chart (not an image) modeled on `WorkspaceGraph`'s interaction grammar: hover/click a task highlights its full dependency lineage and dims the rest, SVG arrowed dependency connectors, a Critical-Path-Method-computed critical path, a "today" marker, month bands, and timeline zoom. Legacy `mermaid`-type Gantt artefacts are auto-parsed into the interactive chart via `parseMermaidGantt`. Version lineage UI: the list shows the latest of each chain with a `vN` badge plus a version switcher, derived from `meta.supersedes`.

---

## Workflow exports

After redesign acceptance, `/build?id=<reportId>` shows tiles for the supported platforms. Generation is deterministic (no LLM):

| Platform | Output | Notes |
|----------|--------|-------|
| n8n | Importable workflow JSON | Manual Trigger → Set nodes |
| Zapier | Build guide JSON | Trigger + actions per step |
| Make | Scenario build guide | Modules per step |
| Power Automate | Flow build guide | Microsoft connectors |
| Pipedream | Workflow build guide | Components per step |
| Unqork | Workflow definition JSON | Swimlane-aware |
| + Airtable, Camunda, Monday, Process Street, Retool, SmartSuite, Temporal, Tray.io, Workato | Build guides | Platform-specific shapes |

API: `POST /api/generate-workflow-export` with `{ reportId, platform }`. Cost-related entitlement check on entry.

---

## Database schema

> ⚠️ **Living-workspace migration (2026-05)** — Several tables and columns below were dropped or renamed. The list is kept for back-compat context (shims still accept the old names). See the [migration section](#living-workspace-migration-2026-05) at the top of this doc for the full delta.
>
> Quick deltas vs the listing below:
> - `diagnostic_reports` → renamed to **`processes`**, `diagnostic_data` → **`flow_data`**
> - `report_id` columns → renamed to **`process_id`** on every FK
> - Dropped: `diagnostic_progress`, `report_redesigns`, `followup_events`, `chat_artefacts`, `deal_analyses`, `team_diagnostics`, `team_responses`
> - Dropped columns on `processes`: `cost_analysis_*`, `target_data`, `state_kind`, `total_annual_cost`, `potential_savings`, `automation_percentage`, `automation_grade`, `lead_score`, `lead_grade`, `display_code`, `diagnostic_mode`, `contributor_emails`, `design_owner_email`
> - Findings reparented to **`(deal_id, finding_key)`** (was `(analysis_id, finding_key)`)

### Diagnostic core
- **`processes`** (text id) — live process rows (formerly `diagnostic_reports`). `contact_email`, `flow_data` JSONB (formerly `diagnostic_data`), `user_id`, `operating_model_id`, `function_id`, `deal_id`, `parent_report_id` (kept for lineage)
- **`process_instances`** — team-member survey responses; `email`, `process_name`, `responses` JSONB, `process_id` FK (renamed from `report_id`)
- **`changes`** — inline change-proposal rows (`proposed → accepted → applied → live → measured`); replaces `report_redesigns` as the lineage surface
- ~~`diagnostic_progress`~~, ~~`report_redesigns`~~, ~~`followup_events`~~ — dropped

### Chat
- **`chat_sessions`** (uuid) — conversation containers; FTS on `title`+`summary`. `process_id` FK (renamed from `report_id`)
- **`chat_messages`** (uuid) — turns with `role`, `content`, `actions`, `attachments`, `artefact_id`
- ~~`chat_artefacts`~~ — dropped; helpers in `lib/chatPersistence.js` are stubbed (no-op returning `[]` / `null`) so callers don't crash

### Deals
- **`deals`** (uuid) — `deal_code` (8-char), `type`, `name`, `process_name`, `owner_email`, `owner_user_id`, `status`, `settings` JSONB, `collaborator_emails` TEXT[]
- **`deal_participants`** — companies/entities; `role`, `status`, `process_id` FK (renamed from `report_id`)
- **`deal_flows`** — flow slot per participant; `process_id` FK populated when a process is mapped
- **`deal_findings`** + **`deal_finding_reviews`** + **`deal_finding_comments`** — diligence findings keyed on `(deal_id, finding_key)` rather than an analysis snapshot
- ~~`deal_analyses`~~ — dropped; insights derive live from documents / flows / changes

### Org & RBAC
- **`organizations`** — tenant container
- **`organization_members`** — `is_org_admin` boolean, `entitlements` JSONB

### Team alignment (removed)
- ~~`team_diagnostics`~~, ~~`team_responses`~~ — dropped. Multiple users now collaborate directly on the live process rather than through a one-shot survey flow.

### Migration files

**Active migrations** (`supabase/`): `migration.sql` (base), `migration-display-code.sql`, `migration-report-redesigns-name.sql`, `migration-chat-history.sql`, `migration-chat-snapshot.sql`, `migration-org-rbac.sql`, `migration-chat-artefacts.sql`, `migration-deal-diligence.sql` (deal documents + chunks + finding reviews + `search_deal_chunks` RPC + storage bucket), and the deal-workspace stack: `migration-deal-doc-stored-and-category.sql` (#29 — `stored` status + `category` column), `migration-deal-analysis-auto-trigger.sql` (#30 — `auto_triggered` flag + throttle index), `migration-deal-workspace-collab.sql` (#31 — `deal_qa_items` + `deal_finding_comments` + `deal_findings.tags/stale`). Full ordered list: [`supabase/MIGRATIONS.md`](./supabase/MIGRATIONS.md). Plus `seed-team-alignment.sql` for dev seeding.

**Older migrations** (`scripts/`): `migration-v2.sql`, `migration-add-segment.sql`, `migration-add-high-risk-ops-segment.sql`, `migration-add-contributor-emails.sql`, `migration-create-diagrams-bucket.sql`, `migration-deals.sql`, `migration-deal-flows.sql`, `migration-schema-fixes*.sql` (1, 2, 3). Apply in order if bootstrapping a new database.

---

## Operating models — multiple per org

Originally one model per org (`organizations.default_operating_model_id`) with no create path, so a signed-in user was permanently pinned to it (Home / New chat always snapped back). Now an org can hold many operating models and each member has an **active model**.

- **Schema:** `organization_members.preferred_operating_model_id` (migration **41**, `migration-member-preferred-model.sql`; FK → `operating_models`, `ON DELETE SET NULL` so deleting a model cleanly reverts affected members to the default).
- **Resolution:** `resolveDefaultModelForUser` (`lib/operatingModel/auth.js`) returns the member's preferred model when set **and** still in the same org, else the org default. It's a **separate best-effort second query** — on a DB where migration 41 hasn't run the select 400s and it silently falls back to the default, so resolution never breaks pre-migration. Returns `{ modelId, organizationId, isAdmin, defaultModelId, isDefault }`. Every surface (workspace, chat agent `resolveActiveModelId`, artefacts, Home, New chat) follows because they all route through this resolver.
- **API** `/api/me/operating-models`: `GET` → `{ models[], activeModelId, defaultModelId, organizationId, isAdmin }`; `POST { name }` → create a model in the caller's org and auto-activate it; `PUT { modelId|null }` → set the active model (org-validated; `null` resets to the org default). Helpers `listOrgModels` / `setMemberPreferredModel` / `createOperatingModel` in `lib/operatingModel/repo.js`.
- **Switcher UI:** `components/workspace/WorkspaceModelsTab.jsx` (the Standard-scope model picker in `DiagnosticWorkspace`): lists org models with **Active** / **Default** badges, a **"+ New model"** action (prompt → POST → lands on the fresh model), and a model click persists the choice via `PUT` so it survives Home / New chat (not just in-canvas navigation).
- **Operational gotcha:** migration 41 must be applied (`npm run migrate`) for switching to take effect. Pre-migration, GET/POST still work but `PUT` 502s and resolution stays on the org default (safe degrade, no breakage).

## API routes

> ⚠️ **Living-workspace migration (2026-05)** — Several endpoints listed below now return **410 Gone**. README.md has the authoritative live + disabled list; the table below remains as historical context for anything still referencing the old surfaces. Stubs return a friendly error message so older clients fail loudly.
>
> 410-stubbed: `/api/generate-redesign`, `/api/save-redesign`, `/api/report-redesigns`, `/api/rename-redesign`, `/api/cost-analysis*`, `/api/share-cost-analysis`, `/api/cost-authorized-emails`, `/api/export-pptx`, `/api/generate-workflow-export`, `/api/recommend-workflow-platform`, `/api/diagnostic-recommendations/[reportId]`, `/api/progress`, `/api/get-followups`, `/api/team`, `/api/deals/[id]/analyses*`, `/api/deals/[id]/analyse`, `/api/deals/[id]/export-diligence-pptx`, `/api/deals/[id]/export.csv`, `/api/deals/[id]/scorecard`, `/api/portfolio/findings`.

### Diagnostic
| Method + path | Purpose | Auth |
|---|---|---|
| `POST /api/diagnostic-chat` | Chat agent (SSE), `maxDuration: 300`. If body includes `dealId`, the route runs `resolveDealAccess` and only forwards the id to the agent if the user is owner/collaborator/participant — silently dropping it on access failure. The `search_deal_documents` tool refuses unless `ctx.dealAccessVerified` is true (defence in depth). | Optional (required for `dealId` to be honoured) |
| `POST /api/process-diagnostic` | Generate findings from processData | Public |
| `POST /api/send-diagnostic-report` | Persist a freshly-mapped process | Rate-limited |
| `GET/PATCH /api/get-diagnostic` | Fetch / update a process | Owner |
| `PUT /api/update-diagnostic` | Save flow steps + JSONB state | Owner |
| `GET /api/get-dashboard` | Dashboard summary | Required |
| `GET /api/me/recent-processes` | Continue-mapping cards (context-aware via `?operatingModelId=` / `?dealId=`) | Required |
| ~~`GET/POST /api/progress`~~ | **410** — `diagnostic_progress` table dropped | — |
| ~~`POST /api/get-followups`~~ | **410** — `followup_events` table dropped | — |

### Chat persistence
| `POST /api/chat-sessions` | Create session | Required |
| `GET/PATCH /api/chat-sessions/[id]` | Fetch session + messages + artefacts | Owner |
| `POST /api/chat-messages` | Append message | Required |

### ~~Redesign~~ — removed
All redesign endpoints return **410 Gone**. AI improvements now land as inline rows on the **`changes`** table via the chat agent's `propose_*` tools; the lifecycle (`proposed → accepted → applied → live → measured`) is observable via `/api/diagnostic-changes/[reportId]`.

### ~~Cost analysis~~ — removed
All standalone cost endpoints return **410 Gone**. Cost / savings derive on read from `flow_data.rawProcesses[].steps[]` via `lib/processMetrics.js`; the dashboard, deal-summary, and operating-model rollups all consume that helper.

### Inline change proposals (replaces redesign + cost)
| Method + path | Purpose | Auth |
|---|---|---|
| `GET /api/diagnostic-changes/[reportId]` | Change timeline for one process | Owner |
| `PATCH /api/diagnostic-changes/[reportId]/[changeId]` | Advance state (e.g. `proposed → accepted`) | Owner |
| `POST /api/diagnostic-changes/[reportId]/[changeId]/outcomes` | Record a measured outcome (`metric`, `delta`, `source`) | Owner |
| `GET /api/deals/[id]/changes` | Deal-scoped change timeline | Owner / collab / participant |

### Deals
| `GET/POST/PATCH /api/deals` | List / create / bulk update | Required |
| `GET/PATCH /api/deals/[id]` | Detail / update — `report:` block now carries **derived** `totalAnnualCost` / `potentialSavings` / `automationPercentage` (not cached columns) | Owner / collab |
| ~~`POST /api/deals/[id]/analyse`~~ | **410** — `deal_analyses` table dropped; insights derive live | — |
| ~~`GET /api/deals/[id]/analyses/[analysisId]/*`~~ | **410** — same | — |
| `GET /api/deals/[id]/analyses` | Returns `{ analyses: [] }` shape so legacy clients render an empty timeline rather than 404 | Any deal viewer |
| `GET/POST/PATCH /api/deals/[id]/collaborators` | Manage edit-rights emails | Owner |
| `GET/POST/PATCH /api/deals/[id]/flows` (+ `/[flowId]`) | Flow slots + metadata | Owner / participant |
| `GET/POST/PATCH /api/deals/[id]/invite` | Send invites; create/accept tokens | Owner |
| `GET/POST/PATCH /api/deals/[id]/participants` (+ `/[participantId]`) | Roster management | Owner |
| `POST /api/deals/resolve` | Resolve flow by code (anon) | Public |

### Org & portal
| `GET/POST/PATCH /api/organizations` | Create / list orgs | Admin |
| `GET/POST/PATCH /api/organizations/[orgId]/members` (+ `/[userId]`) | Member CRUD + entitlements | Org admin |
| `GET/POST/DELETE /api/organizations/[orgId]/api-keys` | List / set-or-rotate / revoke customer-managed AI keys (BYO Anthropic). POST validates the key with a tiny live call before storing. | Org admin |
| `GET /api/organizations/[orgId]/api-keys/audit` | Append-only audit log of every set / rotate / revoke / first-use / reminder event. | Org admin |
| `GET /api/organizations/[orgId]/usage?period=...&groupBy=day\|surface\|model\|vendor` | Aggregated token usage from `token_usage_ledger`. `groupBy=model` splits per-model spend. | Org admin |
| `GET/PATCH /api/organizations/[orgId]/budget` | Get / set `monthly_token_budget`. Editor in the Usage panel takes "millions of tokens"; PATCH stores the integer or NULL for unlimited. | Org admin |
| `GET/PATCH /api/organizations/[orgId]/models` | List + update the per-org model allowlist + default. PATCH validates ids against the catalogue. | Org admin |
| `GET /api/me/models` | Returns the calling user's allowed models + default for the chat picker. | Optional |
| `GET /api/me/export-data` | GDPR Art. 20 — JSON of every row owned by the user (reports, chat sessions/messages/artefacts, owned deals, doc metadata, ledger). Rate-limited per user. | Required |
| `GET/DELETE/POST /api/me/account` | GDPR Art. 17 — schedule deletion (DELETE with confirmation phrase), check status (GET), cancel pending (POST). 30-day grace; cron processes after. | Required |

### Recommendations & exports
| `GET /api/diagnostic-recommendations/[reportId]` | Per-report recommendations fetch (separate from one-shot `/api/process-diagnostic`) | Public by ID |
| `GET /api/export-pptx?id=…` | Server-rendered PowerPoint of a saved report (uses `lib/exporters/reportToPptx.js`); mirrors `get-diagnostic` access (public by UUID, rate-limited) | Public by ID |

### Cron (Vercel Cron schedule in `vercel.json`)
| `GET /api/cron/reap-stuck-documents` | Every 15 min. Re-emits `deal-document.uploaded` for documents stuck in `pending` (>15m), `parsing` (>30m), or `embedding` (>60m). Recovers from Inngest outages. | `Authorization: Bearer $CRON_SECRET` |
| `GET /api/cron/reset-budgets` | Daily 04:00. Calls `reset_monthly_budgets()` RPC which zeroes `tokens_consumed_this_month` for orgs whose period crossed a month boundary. | `Authorization: Bearer $CRON_SECRET` |
| `GET /api/cron/key-rotation-reminders` | Daily 06:00. Writes a `rotation_reminder_sent` audit row for every active customer key whose `rotation_due_at` falls within 14 days. Idempotent per rotation period. Hook for future email/Slack notification. | `Authorization: Bearer $CRON_SECRET` |
| `GET /api/cron/expunge-deleted-accounts` | Daily 03:00. Processes `user_deletion_requests` past the 30-day grace; anonymises diagnostic_reports / chat_sessions / token_usage_ledger; transfers owned deals to `PLATFORM_ADMIN_TRANSFER_EMAIL`; renames the auth.users row to `deleted-{uuid}@deleted.invalid`. | `Authorization: Bearer $CRON_SECRET` |

### Deal diligence (data room + finding reviews + diligence memo)
| `GET/POST/DELETE /api/deals/[id]/documents` | Upload, list, delete data-room documents. POST is multipart; enqueues `deal-document.uploaded` to Inngest. | Owner / collab |
| `GET /api/deals/[id]/documents/[docId]/preview?chunk_id=…&context=N` | Returns the cited chunk plus N neighbours (default 1) for in-modal preview. | Owner / collab |
| `GET /api/deals/[id]/documents/[docId]/preview?raw=1` | Returns a 5-min signed Storage URL pointing at the original bytes for inline preview / download. | Owner / collab |
| `POST /api/deals/[id]/documents/[docId]/reprocess?wipe=1` | Resets status to `pending` (clears error), optionally deletes existing chunks (`wipe=1`), and re-emits `deal-document.uploaded`. Used by the Retry / Re-run buttons in the documents panel. | Owner / collab |
| `GET/PATCH /api/deals/[id]/analyses/[analysisId]/reviews` | Per-finding approval state. PATCH upserts `{finding_key, status, reviewer_note?, edited_title?, edited_body?}`. | Owner / collab |
| `GET /api/deals/[id]/export-diligence-pptx?analysis_id=…` | Slide-deck export of a `mode='diligence'` analysis. APPROVED findings only (filtered via `applyReviewsToAnalysis` with `viewerMode='public'`). | Owner / collab |
| `POST /api/inngest`, `GET /api/inngest`, `PUT /api/inngest` | Inngest serve handler (registered functions). Internal — called by Inngest cloud or local dev server. | Inngest signing |

### Misc
| `POST /api/team` | Team session CRUD + AI analysis (action param) | Email-gated |
| `GET/POST /api/process-instances` | Live instance tracking | Required |
| `POST /api/generate-workflow-export` | n8n/Zapier/etc JSON | Required |
| `POST /api/recommend-workflow-platform` | Suggest a build platform | Required |
| `POST /api/survey-submit` | Survey feedback | Rate-limited |
| `GET /api/public-config` | Feature flags | Public |
| `GET /api/health` | Synthetic-monitor target. Returns 200 + `{ok, checks, latencyMs, version }` when DB reachable; 503 when not. Cache-bust headers. Anthropic / Voyage / Sentry / Inngest checked by env-presence only (no live calls — would couple our uptime to vendors and burn tokens). | Public |

### Placeholder route folders

The following directories exist under `app/api/` but contain **no `route.js`** and are not live endpoints. They're scaffolding for upcoming work — do not link to them:

- `app/api/export-pdf/`
- `app/api/list-sessions/`
- `app/api/move-to-project/`
- `app/api/projects/`

---

## Authentication

Supabase Auth (email + password) is required for:
- All authenticated portal routes
- Comprehensive diagnostic (gate triggered after process selection)
- Team alignment (gate before team setup)
- Deals routes
- Cost analysis

`components/diagnostic/TeamAuthGate.jsx` wraps `SignInForm` (from `components/auth/SignInForm.jsx`) and stores the resolved user as `authUser` in `DiagnosticContext`. From there, name/email pre-populate Screen 5 and creator identity for team sessions.

Required env vars (client):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Server uses `lib/supabase.js` for the service-role client.

### `requireAuth` cache (perf)

`lib/auth.js` runs on every protected API request and previously called `supabase.auth.getUser(token)` — a network round-trip to Supabase Auth (~100-300ms) on **every** call. With a typical surface firing 4–8 parallel API requests, that meant 4–8 simultaneous auth round-trips before any actual work began.

Two layered fixes now sit in front of the network call:

1. **Local JWT shape + expiry check** — `peekJwtPayload()` base64-decodes the token, rejects malformed/expired tokens at near-zero cost. Doesn't verify the signature.
2. **In-memory verification cache** — `Map<sha256(token), {session, expiresAt}>`, TTL `min(60s, JWT exp)`, LRU-evicts at 1024 entries. Same JWT in the same minute → cache hit.
3. **Concurrent-request coalescing** — `Map<tokenHash, Promise>` makes 4 simultaneous calls with the same token resolve through ONE network round-trip. Without this, the first cache fill loses the parallel race and you still pay 4× the latency.

End result: cold first call after sign-in pays one Supabase Auth round-trip; every subsequent call within 60s has zero auth cost. A page that fires 8 parallel API calls now pays at most one auth round-trip, coalesced.

Test helper: `_clearAuthCacheForTesting()` exported for tests that mint synthetic JWTs.

---

## External integrations

| Service | What we use | Env vars |
|---------|-------------|----------|
| Anthropic | All LLM calls (chat agent, redesign, recommendations, cost copilot, structured analysis) | `ANTHROPIC_API_KEY` |
| Voyage AI | Embeddings for deal-document chunks + queries (`voyage-3-large`, 1024 dims). Optional — keyword search works without it. | `VOYAGE_API_KEY` |
| Supabase | Auth + Postgres (incl. `pgvector`, `pg_trgm`) + storage (`diagrams` + `deal-documents` buckets) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Inngest | Async worker for deal-document parse / chunk / embed. Optional — uploads stay at `pending` without it (recovered by the stuck-doc cron). | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` (or `INNGEST_DEV` for local) |
| Sentry | Error monitoring. `lib/logger.js` `error()` calls auto-capture with `requestId` tags. Optional — degrades to no-op. | `SENTRY_DSN` (server), `NEXT_PUBLIC_SENTRY_DSN` (browser) |
| Vercel Cron | Stuck-document reaper (every 15m) + monthly budget reset (daily 04:00). | `CRON_SECRET` (auto-injected) |
| n8n | Webhook for report email + followup campaigns; HMAC-SHA256 signed | `N8N_*_WEBHOOK_URL` family + `WEBHOOK_SIGNING_SECRET` |
| Microsoft Graph | OAuth + folder-level sync from SharePoint sites + OneDrive for Business. Multi-tenant Entra app, `/organizations` endpoint (work / school accounts only — personal accounts excluded since they have no SPO). Picker falls back to `/me/drives` + `/me/drive` so users without an SPO licence can still bind a OneDrive folder. Tokens encrypted via `set_org_integration_tokens` RPC (same Vault secret as `customer_api_keys`). | `SHAREPOINT_CLIENT_ID`, `SHAREPOINT_CLIENT_SECRET`, `NEXT_PUBLIC_APP_URL` |
| Google Drive API | OAuth + folder-level sync. `drive.readonly` + `userinfo.email` scopes; `prompt=consent` so refresh tokens are reissued every connect. Same encrypted-token storage as SharePoint. | `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `NEXT_PUBLIC_APP_URL` |

No Resend, OpenAI, Gemini, or direct SMTP — all email goes through n8n. (Voyage is the only non-Anthropic AI vendor; chosen because Anthropic does not ship an embedding model and recommends Voyage.)

### Connector consent model

Org admin connects once at the org level (Org admin → Integrations); deal editors then bind specific folders per deal (Workspace → Data room → + Microsoft 365 / SharePoint or + Google Drive). Synced files flow through the same parse / OCR / chunk / embed pipeline as manual uploads, so findings can cite them with no special handling.

For multi-tenant SharePoint deployments, the Vesno Entra app needs **Verified Publisher** status (Microsoft Partner Network ID added under Branding & properties) before end users in customer tenants can self-consent. Until that's resolved, customer admins grant org-wide consent once via `https://login.microsoftonline.com/<tenant-id>/adminconsent?client_id=<vesno-app-id>` — see `RUNBOOK.md` § "SharePoint connector — Tenant does not have a SPO license" for the full diagnosis tree.

---

## Deal data room & diligence RAG

The deal portal supports a per-deal **document corpus** so analyses (and Reina) can cite source material from CIMs, financials, contracts, decks, *and now* images / audio / video / archives alongside the participant process maps.

### Open-format dataroom (migration #29)

`POST /api/deals/[id]/documents` accepts **any file format** — the legacy MIME whitelist is gone. Behaviour by format:

| Format | Outcome |
|---|---|
| pdf, docx, xlsx, pptx, csv, txt, md, json, xml, yaml, source code | Native text extraction → chunked → embedded → `status='ready'` (searchable) |
| Scanned PDF (no text layer) or image | Falls through to OCR via Mistral Document OCR (see below). On success → `ready`. On failure or no key → `stored`. |
| Images, audio, video, archives, executables, CAD | `status='stored'` — file is in the data room and downloadable + previewable, just not text-indexed |
| Genuine extractor error | `status='failed'` with `processing_error` populated |

Status enum is now `pending → parsing → embedding → (ready | stored | failed)`. The size cap (50 MB) and SHA-256 dedup stay. `lib/inngest/functions/extractText.js` carries the explicit mime → handler dispatch with a `text/*` catch-all.

### OCR fallback (Mistral, per-org BYO)

`lib/ai/ocr.js` calls Mistral Document OCR (`mistral-ocr-latest`) with a base64 data URL when (a) native extraction returned no text AND (b) the file is image-based or a `pdf_no_text_layer`. Per-page text becomes locator-aware segments and feeds the same chunker/embedder pipeline.

Key resolution: `resolveActiveKey({ orgId, vendor: 'mistral' })`. Org admins set the key under **Org admin → API keys → Mistral (OCR)** (the panel was extended for this). `MISTRAL_API_KEY` env is the platform fallback only.

### AI auto-categorisation

`lib/ai/categorizeDoc.js` uses Haiku (`FAST_MODEL_ID`) to classify each ready document into one of: **Financial · Legal · HR · IP · Tech · Commercial · Operational · Other**. Stored on `deal_documents.category` (added by migration #29). Best-effort — failures leave the column null and the user can override via `PATCH /api/deals/[id]/documents/[docId]` (new endpoint accepting `category`, `label`, `source_party`, `tags`, `visibility`). The Anthropic key is resolved via the same `resolveActiveKey` path so org-level BYO keys win.

### Expected-docs checklist (per deal type)

`GET /api/deals/[id]/checklist` returns the per-deal-type expected-docs template with each item matched against the docs already in the data room. Templates live in `lib/dealDocumentChecklist.js` — common items (articles, cap table, board minutes, audited accounts, mgmt accounts, forecast, tax returns, employment contracts, org chart, IP register, customer concentration) plus per-type extras (CIM/data-room index/change-of-control consents for M&A; platform summary + add-on pipeline for PE roll-ups; product roadmap + tech architecture + security audit for scaling).

Workspace surface: collapsible "Expected documents (3 / 12 received)" panel inside the data-room section of `DealWorkspaceModal`. Each line shows ✓ / ○; matched docs are clickable links into the existing previewer.

### Tables

| Table | Purpose |
|-------|---------|
| `deal_documents` | One row per uploaded file. Tracks `status` (`pending → parsing → embedding → ready / stored / failed`), `category`, `source_party`, `label`, `tags`, `page_count`, `visibility`, `content_hash`. Bytes live in the `deal-documents` Storage bucket at `{deal_id}/{doc_id}/{filename}`. |
| `deal_document_chunks` | Parsed text chunks with locator metadata (`page_number` / `slide_number` / `sheet_name` / `cell_range` / `section_path`), `content`, generated `content_fts` tsvector, optional `embedding vector(1024)`. HNSW index for cosine, GIN index for FTS + trigram. |

### Search RPC

`public.search_deal_chunks(p_deal_id, p_query_text, p_query_vector, p_limit, p_party)` performs **reciprocal-rank fusion** of semantic (cosine over `embedding`) and keyword (`websearch_to_tsquery`) results. If `p_query_vector` is null (or no chunks have embeddings yet) it degrades cleanly to keyword-only.

Caller wrapper: `lib/deal-analysis/chunkSearch.js` — embeds the query via Voyage and calls the RPC. Used by both `/api/deals/[id]/analyse` (auto-grounding) and the chat tool `search_deal_documents`.

### Embeddings

`lib/ai/embeddings.js` wraps Voyage AI (`voyage-3-large`, 1024 dims). Anthropic does not ship its own embedding model — Voyage is their official recommendation. Env: `VOYAGE_API_KEY`. If unset, uploads still parse + chunk + index for keyword search; semantic search is silently disabled.

### UI surface

The data-room UI now lives inside `components/diagnostic/chat/DealWorkspaceModal.jsx` — drag-and-drop upload, multi-file `+ Upload`, status polling (5s while any doc is mid-pipeline), category / source-party / tags / visibility editors, expected-docs checklist, delete. The legacy `DealDocumentsPanel.jsx` was removed with Phase 18.

---

## Findings, citations & approval workflow

Every analysis finding emitted by `/api/deals/[id]/analyse` now follows the canonical shape in `lib/deal-analysis/findingsShape.js`:

| Field | Meaning |
|-------|---------|
| `key` | Stable 12-char sha1(category + title). Survives re-runs so reviewer decisions carry forward. |
| `title`, `body` | Short headline + 1–3 sentence explanation. |
| `category` | Free-form bucket (e.g. `systems`, `headcount`, `contracts`). |
| `severity` | `low | medium | high | critical`. |
| `confidence` | Number 0..1; reviewer queue gate. |
| `impact[]` | Subset of `day_one`, `tsa`, `separation`, `long_term`. Mirrors the article's Day-1 / TSA / separation framing. |
| `evidence[]` | `{ kind, ref, snippet }` pointers — `kind` is one of `document_chunk`, `process_step`, `chat_turn`, `metric`. Findings without evidence are flagged in the renderer. |
| `recommendations[]` | Short action strings. |

`FINDINGS_SHAPE_PROMPT_BLOCK` (same file) is injected into every deal-analysis system prompt so the model is required to produce this shape.

### Approval state machine (per finding)

`deal_finding_reviews` (one row per `(analysis_id, finding_key)`) records the reviewer decision:

```
pending  ──approve──▶  approved   (visible to all viewers)
   │ ───reject──────▶  rejected   (hidden from everyone)
   │ ─needs_revision▶  needs_revision (editor-only)
```

Endpoint: `GET / PATCH /api/deals/[id]/analyses/[analysisId]/reviews`. Edited title / body in the review row override the AI-generated values at render time.

### Visibility gate

`lib/deal-analysis/applyReviews.js` filters an analysis result for the requested viewer mode:

| Status | viewerMode='public' | viewerMode='editor' |
|--------|---------------------|---------------------|
| `approved` | shown | shown |
| `pending` / `needs_revision` | hidden | shown with status pill |
| `rejected` | hidden | hidden |

Renderer: the findings section of `components/diagnostic/chat/DealWorkspaceModal.jsx` — severity colour, confidence pct, impact chips, expandable evidence list (with snippet + locator and `Inspect` / `Open` buttons), tag chips, comments thread, and review controls (editor-only). The legacy `components/deals/FindingCard.jsx` was removed with Phase 18.

---

## Going live: deal diligence rollout checklist

After pulling the diligence changes (migration + `inngest` dep + new routes), an env needs four things before the data-room flow works end-to-end. Items are independent — you can defer (3) and (4) and still parse + keyword-search documents.

### 1. Apply the migration
Run `supabase/migration-deal-diligence.sql` against the target database (Supabase SQL editor or `psql $DATABASE_URL -f …`). It is idempotent: `CREATE TABLE IF NOT EXISTS`, `CREATE EXTENSION IF NOT EXISTS`, `ON CONFLICT DO NOTHING` on the bucket insert. It enables `pgvector` + `pg_trgm`, creates the three tables and the `search_deal_chunks` RPC, and inserts the `deal-documents` storage bucket.

If the bucket `INSERT` errors (some Supabase projects restrict `storage.buckets` writes via SQL), create it via the dashboard: **Storage → New bucket → name `deal-documents`, Public: off**.

### 2. Install dependencies
```
npm install
```
Picks up `inngest@^3.27.0`. No other new packages — embeddings call Voyage over plain `fetch`.

### 3. Configure env vars

Add to `.env.local` (and to the production env in Vercel / wherever the app is hosted). All four are optional; the app degrades gracefully when any is missing.

| Var | Purpose | What you lose if missing |
|-----|---------|--------------------------|
| `VOYAGE_API_KEY` | Voyage AI embeddings (`voyage-3-large`, 1024 dims) | Hybrid search collapses to keyword-only; no semantic match |
| `INNGEST_EVENT_KEY` | Send events to Inngest cloud | Document uploads stay at `pending` forever (worker never fires) |
| `INNGEST_SIGNING_KEY` | Verify Inngest cloud invocations against `/api/inngest` | Cloud-triggered functions reject as unsigned |
| `INNGEST_DEV` | Bypass signing when running the local Inngest dev server | Required to register functions against the dev server |

### 4. Wire Inngest

- **Local dev:** `npx inngest-cli@latest dev` — auto-discovers `/api/inngest` on the running Next.js dev server. No keys needed.
- **Production:** create an Inngest app at [app.inngest.com](https://app.inngest.com), copy the event + signing keys into prod env, and register the deployment URL (`https://<your-host>/api/inngest`) under **Apps → Sync new app**. The `process-deal-document` function will appear automatically.

### 5. Smoke test

1. As a deal owner, open any deal page → the new **Data room** panel should render below the participants section.
2. Drag a small PDF or DOCX onto the dropzone. The row should flip `Queued → Parsing → Embedding → Ready` within ~30 s (or stop at `Embedding` indefinitely if `VOYAGE_API_KEY` is unset — that's expected, search still works).
3. Open Reina inside any deal-bound chat session and ask a question that should hit the doc — confirm `search_deal_documents` returns chunk citations in her reply.
4. Run a deal analysis. Findings should now carry `severity` / `confidence` / `impact[]` / `evidence[]` chips. Editor controls should let you approve / reject / mark "needs revision".

### 6. Optional: backfill embeddings

If you upload documents while `VOYAGE_API_KEY` is unset and add it later, re-trigger by sending the `deal-document.uploaded` event from the Inngest dashboard with the existing `document_id`. The function is idempotent — chunks insert with `ON CONFLICT (document_id, chunk_index)` semantics implied by the unique constraint, and embeddings overwrite.

---

## Background workers (Inngest)

Heavy work (deal-doc parse + chunk + embed; connector sync; **office-artefact builds**) runs in **Inngest** functions registered at `/api/inngest`. Synchronous routes stay snappy; async work survives timeouts and retries.

### Configured functions

| Function id | Trigger event | What it does |
|-------------|---------------|--------------|
| `process-deal-document` | `deal-document.uploaded` | Downloads bytes from storage → extracts text (`mammoth` / `officeparser` / `xlsx`) → chunks (`lib/inngest/functions/chunker.js`) → inserts `deal_document_chunks` → embeds via Voyage in batches of 32 → marks `deal_documents.status = ready`. Each step is `step.run(...)`-wrapped for resumability. Concurrency limit 4, 3 retries. |
| `sync-connector-binding` | `connector-binding.sync-requested` + `*/15 * * * *` cron | Pulls delta changes from a linked data-room source, upserts `deal_documents`, fans out `deal-document.uploaded`. Concurrency 5, 1 retry. |
| `build-office-artefact` | `artefact/office.requested` | Async `.pptx`/`.docx`/`.xlsx` build (the user no longer waits — `emit_artefact` queues this and returns). One `step.run` calls `runOfficeArtefactBuild` (`lib/operatingModel/officeArtefactBuild.js`): generate (Sonnet 4.6 + code-execution sandbox) → upload bytes → set `meta.file` + `build.status='ready'`, or `'failed'` on any error. Concurrency 5, 1 retry. Because the build is one long single step, `app/api/inngest/route.js` `maxDuration` is **300s** (it must cover that step; a 60s-capped host would kill a multi-minute build mid-step and the row would stay `building`). `WorkspaceOutputsTab` polls every 9s while any row is `building`. |

### Env

| Var | Purpose |
|-----|---------|
| `INNGEST_EVENT_KEY` | Required to send events from the Next.js app (cloud). |
| `INNGEST_SIGNING_KEY` | Required by the `/api/inngest` serve handler to verify cloud invocations. |
| `INNGEST_DEV` | Set when running `npx inngest-cli@latest dev` locally — bypasses signing. |

If neither key is configured, `lib/inngest/client.js`'s `sendEvent()` is a no-op — the document upload row stays at `pending` until manually retriggered. Office-artefact emission detects the skipped enqueue and **falls back to building inline** (synchronous, that path waits) so the file still completes without queue infra.

---

## Per-party document visibility

Two-sided M&A deals can't safely share a single document pool — buy-side shouldn't see seller's CIM annotations, target shouldn't see acquirer's offer prep. The deal-documents pipeline now enforces per-party visibility.

### Storage (`migration-deal-doc-visibility-and-hash.sql`)
- `deal_documents.visibility text` enum: `all_editors`, `acquirer_only`, `target_only`, `seller_only`, `portfolio_only`, `owner_only`.
- RLS policy split: writes need editor, reads check visibility against `deal_participants.role` for the viewer.
- `deal_documents.content_hash text` + unique-per-deal partial index for upload idempotency.

### Helper (`lib/dealDocumentVisibility.js`)
- `canSeeDocument({ document, viewerRole, isOwner, isCollaborator })` — mirror of the RLS predicate; used by the list route as defence in depth (since the route uses the service-role key and bypasses RLS).
- `visibilityOptionsForDealType(dealType)` — drives the upload dropdown. PE deals don't show acquirer/target options; M&A doesn't show portfolio.
- `validateVisibilityForDealType(visibility, dealType)` — refuses semantically-invalid combinations at upload time.

### Upload idempotency
SHA-256 of bytes computed at upload. Pre-check by `(deal_id, content_hash)`; if a row exists, return it without re-creating + re-embedding. Race condition handled — concurrent identical uploads catch the unique-constraint violation and resolve to the winner. Saves real money on the embedding pipeline.

---

## GDPR

### Article 20 — Data portability
`GET /api/me/export-data` returns a JSON document with every row owned by the calling user across diagnostic_reports, chat_sessions, chat_messages, chat_artefacts, owned deals, doc metadata, token usage. Rate-limited per user. Document bytes are NOT inlined — those are downloadable individually (keeps the export size sane). Rows where the user is a collaborator but not owner are excluded — that's the owner's data.

### Article 17 — Right to erasure
- `DELETE /api/me/account` with `{ confirmation: 'DELETE MY ACCOUNT' }` schedules deletion. Writes a `user_deletion_requests` row, sets `auth.users.banned_until` for 365d to block sign-in, returns expungement timestamp (now + 30d).
- `POST /api/me/account` with `{ action: 'cancel' }` cancels a pending request and lifts the auth ban.
- `GET /api/cron/expunge-deleted-accounts` (daily 03:00) processes pending requests past the 30-day grace:
  1. Anonymise diagnostic_reports (`contact_email` / `contact_name` / `company` → redacted).
  2. Anonymise chat_sessions (`email` / `title` / `summary` → redacted; messages stay because they may contain other users' content).
  3. Transfer owned deals to `PLATFORM_ADMIN_TRANSFER_EMAIL` so collaborators retain access.
  4. Redact `token_usage_ledger.user_email`.
  5. Rename auth.users to `deleted-{uuid}@deleted.invalid`.
  6. Mark request `status='completed'`.

### UI
- Settings popover on the chat rail (gear icon) in `/workspace/map` — hosts both controls (data export + account deletion). Auto-opens on `/workspace/map?openSettings=1`. Implemented in `components/diagnostic/chat/SettingsRailButton.jsx`.

### Required env
- `PLATFORM_ADMIN_TRANSFER_EMAIL` — email of the platform-admin account that becomes the new owner of expunged users' deals. Without it, the cron skips ownership transfer (deals become un-owned but still accessible to collaborators).

---

## SOC 2 readiness baseline

**Status: readiness shipped, audit not started.** This is the "policies + controls + evidence collection exists" milestone — not a SOC 2 Type I or Type II report. Those require a CPA engagement (~2-4 weeks for Type I, 3-12 months of evidence then audit for Type II, total ~$25-80k).

### What shipped

`compliance/` directory:
- `README.md` — gap analysis between readiness and audit-passed; vendor recommendations (Drata / Vanta / Secureframe); next-step playbook.
- `CONTROLS_MATRIX.md` — every Trust Services Criterion (CC1-CC9, A, C, PI, P) mapped to actual code/process in this repo, with status flags COVERED / PARTIAL / GAP. Re-evaluated quarterly.
- `policies/01-12-*.md` — 12 policy templates (Information Security, Access Control, Change Management, Incident Response, Vendor Management, BCDR, Data Classification, Acceptable Use, Risk Management, Onboarding/Offboarding, Vulnerability Management, Backup & Recovery). Every template has `[COMPANY NAME]` / `[POLICY OWNER]` / `[REVIEW DATE]` placeholders + a "NOT LEGAL ADVICE" header.

### MFA helper

`lib/mfaCheck.js`:
- `getUserMfaStatus(userId)` — Supabase Admin API `mfa.listFactors`; returns `{ enabled, factorCount, verifiedCount, factors }`.
- `getOrgMfaReport(orgId)` — every org member's MFA status + `enforcementRate` + `fullyEnforced` flag.
- `getAllOrgsMfaReport()` — bulk version for the evidence script.

`/api/organizations/[orgId]/mfa-status` (GET) — org-admin / platform-admin only; returns the org report. Used by the admin UI banner in `OrgAdminClient.jsx` (Members tab) which shows green-OK or amber-warning depending on `fullyEnforced`. Auditor evidence for **CC6.2**.

### Evidence-collection script

`scripts/collect-soc2-evidence.mjs` — run monthly (or via CI cron). Writes `compliance/evidence/YYYY-MM-DD/` with:

| Artefact | TSC mapping |
|----------|-------------|
| 01-rls-policies.json | CC6.1, CC6.3, C1.1 |
| 02-cron-runs.json | CC4.1, CC7.2, A1.2 |
| 03-audit-log-summary.json | CC2.1, CC4.2 |
| 04-mfa-status.json | CC6.2 |
| 05-token-usage.json | CC9.1 |
| 06-vendor-inventory.json | CC9.2 |
| 07-migration-history.json | CC8.1 |
| 08-customer-key-status.json | CC6.5, P-series |
| 00-MANIFEST.md | Index + handling notes |

`compliance/evidence/` is in `.gitignore` (contains customer identifiers — never commit). Upload to Drata / Vanta / Secureframe portal or to a private versioned object store the auditor can read.

### What's still gap

See `compliance/README.md` "Honest gap analysis" section. Highlights: management-signed policies, background checks, security training vendor, vendor risk reviews, penetration test, IR tabletop, quarterly access review with sign-off, customer-facing trust page.

### Required to operate

- MFA enrolment by every workforce member on every system in scope (Supabase, Vercel, GitHub, Sentry, Anthropic, OpenAI, Google Workspace, Inngest, Upstash).
- Quarterly access review by Engineering Manager (output documented in ticketing system + signed by Security Officer).
- Annual review of every policy in `compliance/policies/`; re-approval by [CEO/CISO]; update `Last reviewed:` line.
- Monthly run of `scripts/collect-soc2-evidence.mjs` (or whatever cadence the chosen compliance vendor demands — Drata typically auto-collects daily and you only need this script for things their connectors don't reach).

---

## Customer-managed API keys (BYO)

Org admins can paste their own Anthropic API key in the admin UI. When set, all LLM calls billable to that org's surfaces use the customer's key — Anthropic charges them directly, our platform-key bill goes down, and our org token-budget enforcement is bypassed for that org (we still record usage for their observability).

### Storage

- `customer_api_keys` — encrypted via `pgcrypto` `pgp_sym_encrypt` keyed on `app.model_key_encryption_secret` (a Postgres-level setting, intentionally separate from any other secret). Unique on `(organization_id, vendor, status='active')` so there's only one live key per (org, vendor).
- `customer_api_key_audit` — append-only. Records `set` / `rotated` / `revoked` / `validated` / `used_first_time` / `rotation_reminder_sent` events with actor + request id + masked fingerprint.
- All access via `SECURITY DEFINER` RPCs (`set_customer_api_key`, `get_active_customer_api_key`, `revoke_customer_api_key`, `audit_customer_key_event`). The encrypted column is never SELECTed via PostgREST.

### Helper

`lib/customerKey.js`:
- `resolveActiveKey({ orgId, vendor }) → { key, source: 'customer'|'platform'|'none', fingerprint?, keyId?, rotationDueAt? }` — primary read path; per-process 60s LRU cache.
- `setCustomerKey({ orgId, vendor, rawKey, actorEmail, ... })` — validates with a 1-token Anthropic call before storing; calls the encrypted-write RPC; writes audit row atomically.
- `revokeCustomerKey(...)`, `validateAnthropicKey(rawKey)`, `maskKey(raw)`, `daysUntilRotation(date)`.
- `CustomerKeyError` — surfaces 402-style failures with vendor + orgId context.

### Wired into

- `/api/diagnostic-chat` — resolves the org's customer key (if any) before invoking `runChatAgent`; threaded through `ctx.apiKey` and into the per-request `Anthropic` client constructor.
- `/api/deals/[id]/analyse` — same pattern; surfaces a clear "your key was rejected" error when the customer key 401s.
- `lib/agents/models.js` — all three model factories (`getFastModel`, `getChatModel`, `getDeepModel`) accept `apiKey` override.

### Cost-guard interaction

When `source === 'customer'`, the analysis route SKIPS `preflightTokenBudget` (the customer pays Anthropic directly; our budget doesn't apply). `recordTokenUsage` runs in BOTH cases — the ledger is observability for the customer too.

### Admin UI

- `components/org-admin/CustomerKeyPanel.jsx` — set/rotate/revoke, masked display (`sk-ant-...XYZW`), set-by + last-used + rotation-due columns, rotation banner (overdue / soon), expandable audit log table.
- `components/org-admin/UsageAnalyticsPanel.jsx` — periods (7d/30d/90d/MTD), groupBy (day/vendor/surface), token totals, budget progress bar with 80% threshold marker, inline bar-chart of buckets.
- Both mounted as new tabs in `OrgAdminClient.jsx` next to Members.

### Required env / DB setup

**Two-step procedure. The migration refuses to apply without step 1 — if you skip it, you get a clear error rather than rows that crash on first decrypt.**

The encryption secret lives in **Supabase Vault**, not in `app.model_key_encryption_secret` / `ALTER DATABASE` (Supabase doesn't grant non-superusers permission to set cluster parameters — you'll get `42501: permission denied to set parameter`).

1. **Generate + store the encryption secret in Vault.** Open `scripts/set-model-key-encryption-secret.sql`, replace the placeholder with a freshly-generated 48-byte secret, and run it via the Supabase SQL editor. Generate with one of:
   - `openssl rand -base64 48`
   - `python3 -c "import secrets; print(secrets.token_urlsafe(48))"`
   - `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`

   The script calls `vault.create_secret()` (idempotent — `vault.update_secret` if a row already exists). Store the plain secret in your password manager AND your incident-response runbook — you'll need it during a backup-restore drill (Vault state is included in pg_dump but you should still have it offline). **Do not** put it in `.env.local` or any application secret store; it lives only in `vault.secrets`.

2. **Apply the migration.** `supabase/migration-customer-api-keys.sql`. The migration runs a pre-flight `SELECT FROM vault.decrypted_secrets WHERE name = 'model_key_encryption_secret'` and raises if missing or shorter than 16 chars.

**Verify before applying:**

```sql
SELECT name, length(decrypted_secret) AS chars
  FROM vault.decrypted_secrets
 WHERE name = 'model_key_encryption_secret';
```

Should return one row with `chars >= 16`.

**Rotating the secret breaks every existing customer key.** There's no automated re-encryption. If you must rotate: revoke all keys via the admin UI, re-run the setup script with a new value (it'll call `vault.update_secret`), ask each org admin to re-paste their key.

---

## Per-org model allowlist

Org admins can pick which Anthropic models their users see in the chat picker. Per-organisation allowlist + default.

### How resolution works (`lib/orgModels.js`)

1. Org has explicit `allowed_models[]` set → use that.
2. Else org has a customer (BYO) Anthropic key → allow the entire active catalogue (deprecated models hidden). Rationale: they're paying Anthropic directly; no reason for us to gatekeep.
3. Else (platform key) → fixed `PLATFORM_ALLOWED_MODEL_IDS` (`claude-sonnet-4-6` only). Rationale: prevents free-tier users from racking up Opus calls on our bill.

Default: `org.default_model` if set AND in allowed[]; else first allowed; else `SAFE_FALLBACK_MODEL_ID`.

### Catalogue (`lib/agents/modelCatalogue.js`)

Multi-vendor (Anthropic + OpenAI). Each entry: `id`, `vendor`, `label`, `tier` (`fast`/`chat`/`deep`), `contextWindow`, `inputCostPer1M`, `outputCostPer1M`, `deprecated`, `unsupported`, `blurb`. Adding a model = appending one row. Mark `deprecated` when the vendor announces sunset (catalogue still respects them if an org already has them); mark `unsupported` when we list a vendor in the catalogue but the runtime can't actually call it yet.

**Today every OpenAI entry is `unsupported: true`** — the chat agent only knows `@anthropic-ai/sdk`. Admins can toggle them in the allowlist UI as a roadmap signal, but the user-facing picker hides them until the OpenAI client wires up. Remove `unsupported` per entry as that ships.

### Helpers
- `userPickableIds(allowlist)` — drops `unsupported` from a list of ids before showing to users.
- `suggestedModelIdForPhase({ allowed, phase, editingRedesign, hasAttachments })` — picks the best in-allowlist model for the chat's current state. Mapping: `editingRedesign` → deep · `hasAttachments` → fast · `intake` phase → fast · everything else → chat. Falls back to first allowed if the desired tier isn't available.

### Picker behaviour (`components/diagnostic/chat/ModelPicker.jsx`)
- **Instant render**: hydrates from `sessionStorage` (5-min TTL) on mount, then re-fetches `/api/me/models` in the background and reconciles. No first-paint blocker.
- **Auto-default by phase**: until the user explicitly picks, the picker tracks `suggestedModelIdForPhase(...)` for the current state. The popover marks the suggested entry with a `· suggested` tag.
- **User pick sticks** for the session. Reload resets.
- **Hides itself** when allowlist size ≤ 1.

### `/api/me/models` performance
- Per-orgId in-memory cache, 60s TTL (matches the customer-key cache).
- `Cache-Control: private, max-age=60` so the browser caches too.
- After resolving `orgId`, the customer-key + allowed-models lookups fan out via `Promise.all`.

### Storage (`migration-org-model-allowlist.sql`)

Two columns on `organizations`:
- `allowed_models text[]` — subset of catalogue ids; NULL = inherit default per resolution rules.
- `default_model text` — pre-selected for the picker; must be in allowed[] if both set.

No CHECK constraint on the array values — the catalogue lives in code and changes more often than schema. The API layer validates against the catalogue and refuses unknowns before the row is written.

### API

| Method + path | Purpose | Auth |
|---|---|---|
| `GET /api/organizations/[orgId]/models` | Full catalogue marked with `allowed` + `isDefault` flags. Admin UI hydration. | Org admin |
| `PATCH /api/organizations/[orgId]/models` | Body: `{ allowed: string[]\|null, default: string\|null }`. Validates ids; refuses unknowns. | Org admin |
| `GET /api/me/models` | Returns the calling user's allowed models + default for the chat picker. Anonymous → platform allowlist. | Optional |

### Chat plumbing

- `DiagnosticChatInputSchema` accepts an optional `model` field.
- `/api/diagnostic-chat` validates the requested `model` against `resolveAllowedModels`. If it's not in the allowlist, falls back silently to the resolved default (the picker should never offer a forbidden model — this is defence in depth for tampered requests).
- `runChatAgent({ ..., modelOverride })` threads through to `runStreamingLoop`, which passes it as `model` to `client.messages.stream({ ... })`.
- `recordTokenUsage` stores the actual model used so the Usage analytics splits per-model spend correctly.

### UI

| File | Role |
|---|---|
| `components/org-admin/ModelAllowlistPanel.jsx` | Admin: checkbox list + radio for default + Save/Reset. Mounted under the API keys tab. |
| `components/diagnostic/chat/ModelPicker.jsx` | User: pill above the chat input. Click → popover with allowed models + tier badges + cost-aware blurbs. Hides itself when allowlist size ≤ 1. |
| Sticks for the session — selection is in `useState` in `DiagnosticWorkspace`; resets on page reload (intentional, see decision rationale in BUILD_GUIDE §5.10). |

---

## AI SDK landscape

What we use, what exists that we don't, and why. Audit-style — kept terse so it stays current.

### What we use

| SDK / API | Version | Where | Why |
|-----------|---------|-------|-----|
| `@anthropic-ai/sdk` (raw) | `^0.90.0` | `lib/agents/chat/graph.js` (streaming chat loop with tool execution) | Need raw SSE streaming + per-event delta emission; LangChain's wrapper hides too much |
| `@langchain/anthropic` | `^1.3.21` | `lib/agents/redesign/graph.js`, `lib/agents/recommendations/`, `lib/agents/flow/`, `app/api/deals/[id]/analyse/route.js` (via `lib/agents/models.js` factories) | Convenience for non-streaming `model.invoke([...])` calls; ~5MB of deps |
| `@langchain/core` + `@langchain/langgraph` | `^1.x` | Redesign agent's `StateGraph` | Multi-step state machine for redesign + repair-on-validation-failure |
| Voyage AI (HTTP, no SDK) | n/a | `lib/ai/embeddings.js` | Anthropic doesn't ship embeddings; Voyage is their official recommendation. Wrapped in plain `fetch` to keep deps minimal |
| Inngest | `^3.27.0` | Async worker harness for the document pipeline | Step-resumable functions survive Vercel timeouts |
| Sentry | `^9.0.0` | `lib/logger.js` `error()` capture | Production error monitoring |

### What we evaluated and consciously declined

**These are NOT bugs to fix later — they're decisions with reasoning. Re-open the decision if the underlying constraint changes.**

| SDK / API | Status | Why we declined | When to revisit |
|-----------|--------|-----------------|-----------------|
| **Anthropic Files API** (`client.beta.files.upload`) | beta, free, available in `@anthropic-ai/sdk` ≥ 0.90 | Tempting for the chat-attachment path (`lib/agents/flow/`), but: (a) Files API is beta; (b) adds an Anthropic-side data-residency surface for user-uploaded process docs; (c) the latency penalty (upload → reference) is +2-5s on first use vs. our existing in-process parsing; (d) our XLSX path produces better-structured input than opaque file handoff. | When Files API exits beta AND we want PDF support better than `officeparser` provides. Likely Q3 2026. |
| **Anthropic Citations API** (`citations: { enabled: true }` on document blocks) | GA | Citations cannot coexist with structured outputs (we require JSON-shaped findings). Workaround is two LLM calls (citations call → JSON-coercion call) which doubles cost and adds disagreement-failure modes. **We replicated the value of Citations** by (1) prompting the model to emit `evidence[]` pointers and (2) verifying them server-side via `verifyEvidence()` — see Production guardrails below. | If Anthropic ships structured-outputs + citations composability (in research at time of writing). |
| **Anthropic Batch API** (`messages.batches.create`) | GA, 50% discount | No current workload that's both (a) non-interactive and (b) tolerates ≤24h latency. All current calls are user-blocking (chat, analysis, recommendations). | When we add bulk admin work (eval re-runs, model migration, periodic re-analysis). |
| **Claude Agent SDK / Managed Agents** (`client.beta.agents.create`) | beta | Anthropic's docs are explicit that Managed Agents aren't suitable for embedding in Next.js route handlers — they run in Anthropic-managed cloud containers with their own SSE protocol. Our chat agent runs in-process against client-held canvas state; that's the right pattern for our UX. The Inngest worker IS long-running async, but it's deterministic (parse → chunk → embed) and gets no benefit from agentic behaviour. | When we add a real autonomous-research feature (e.g. "overnight, monitor SEC filings on target companies"). |
| **Replace `@langchain/anthropic` with raw SDK** | — | Pure cleanup, ~5MB bundle saving + access to beta features faster. **Cost**: locks us to Claude. We deliberately keep LangChain in non-streaming paths so a future multi-provider option (Claude + GPT/Gemini routing) remains a config change rather than a rewrite. | If we make a "Claude forever" call, drop LangChain. Until then, the optionality is worth the bundle. |

### Anti-pattern we built ourselves

We wrote a custom `evidence[]` schema + `FINDINGS_SHAPE_PROMPT_BLOCK` + `verifyEvidence()` validator instead of using Anthropic's Citations API. **This is the structured-outputs incompatibility — we have to ship JSON.** The `verifyEvidence()` step is the production replacement for Citations-API-grade trust: it drops findings whose cited `chunk_id` doesn't exist and downgrades confidence on snippet mismatches. See Production guardrails → Evidence validator.

If you ever see "Anthropic announced Citations + Structured Outputs composition," delete `verifyEvidence` and switch.

---

## Production guardrails

Three production-readiness systems were added April 2026:

### Sentry error monitoring
- Server / edge / browser configs at `sentry.{server,edge,client}.config.js`; loaded by `instrumentation.js` per runtime.
- `lib/logger.js` — every `logger.error()` calls `Sentry.captureException` with `requestId` as a tag and the meta object as `extra`. `meta.error` (Error or string) becomes the exception payload; falls back to `message` if absent.
- Browser DSN can be either `SENTRY_DSN` or `NEXT_PUBLIC_SENTRY_DSN`; server uses `SENTRY_DSN` only. Without a DSN, init is a no-op.
- Defaults: 10% trace sample, 100% replay-on-error.

### Evidence validator (`verifyEvidence`)

The single thing that keeps our hand-rolled citation pattern honest. Lives in `lib/deal-analysis/findingsShape.js`; called from `/api/deals/[id]/analyse` after `normaliseFindings` and before persistence.

For every `evidence[]` pointer with `kind: 'document_chunk'`:

1. **Existence check.** Look up `ref.chunk_id` in `deal_document_chunks`. If missing → drop the pointer.
2. **Snippet check.** If the model emitted a `snippet`, compare against the real chunk content via case-insensitive longest-substring + 5-gram overlap. If overlap < 60% → drop the pointer.
3. **Aggregate effect on the finding.** If at least one pointer was invalidated, downgrade `confidence` by 0.2 (floor 0). If ALL originally-claimed pointers were invalidated, drop the finding entirely.

Findings that legitimately had no evidence to begin with stay (the renderer flags them with `⚠ No source evidence cited.`). Non-document-chunk evidence kinds (`process_step`, `chat_turn`, `metric`) pass through — we can't cheaply verify those without more context.

Telemetry: `analysis._evidenceStats = { droppedFindings, downgradedFindings, droppedEvidence }` is logged at info level and persisted on the analysis row for debugging hallucination patterns over time.

### Per-organisation token budget
- Migration: `migration-cost-guardrails.sql`. Adds `monthly_token_budget` + `tokens_consumed_this_month` + `budget_period_started_at` + `budget_alerted_at_80pct` on `organizations`. Plus the `token_usage_ledger` append-only table.
- RPCs:
  - `bump_token_usage(org_id, tokens)` — atomic check + increment. Raises `token_budget_exceeded` (SQLSTATE `23514`) when over.
  - `reset_monthly_budgets()` — zeroes consumed for orgs whose period has rolled over. Idempotent.
- Helper: `lib/costGuard.js`
  - `preflightTokenBudget({ orgId, estimatedTokens })` — read-only check; called BEFORE expensive LLM jobs to fail fast.
  - `recordTokenUsage({ orgId, vendor, model, surface, refId, inputTokens, outputTokens, userEmail })` — appends to ledger AND atomically bumps the org total. Soft-warns at 80%.
  - `getOrgIdForUser({ email, userId })` — resolves an org membership.
- Wired into:
  - `/api/deals/[id]/analyse` — pre-flight blocks the run with an over-budget error event; post-call records actual `usage_metadata`.
  - `lib/inngest/functions/processDealDocument` — per-batch Voyage embedding tokens recorded after each `embed-${i}` step.

### Stuck-document reaper + budget reset cron
- Configured in `vercel.json` under `"crons"`.
- `/api/cron/reap-stuck-documents` — every 15m. Scans `deal_documents` for `pending` (>15m old), `parsing` (>30m), `embedding` (>60m); re-emits `deal-document.uploaded` for each. Marks `failed` if there's no `storage_path`.
- `/api/cron/reset-budgets` — daily 04:00. Calls `reset_monthly_budgets()` RPC.
- Auth via `Authorization: Bearer $CRON_SECRET` (Vercel auto-injects). Helper: `lib/cronAuth.js`.
- Both endpoints return JSON summaries so cron history is auditable.

### Open guardrails (deferred)
See [`BUILD_GUIDE.md` Appendix B](./BUILD_GUIDE.md#appendix-b--trade-offs-wed-reconsider) for the full list. Highest-value remaining items:
- Per-party document visibility (acquirer-only / target-only docs)
- Real audit trail on finding edits (today: only latest version)
- Async analysis (move SSE → enqueue + poll)
- Idempotency on document upload (content-hash dedup)

---

## Tests

Unit tests live in `tests/` and run via the Node built-in test runner (`node:test`). Playwright E2E specs live in `tests/e2e/`.

Run:

| Command | What it does |
|---------|-------------|
| `npm test` | All `tests/**/*.test.mjs` (Node test runner) |
| `npm run test:e2e` | Playwright E2E (`tests/e2e/*.spec.mjs`) |
| `npm run test:all` | Both |
| `node --test tests/<one>.test.mjs` | Single file (handy when iterating) |

### Current coverage

| File | Covers | Test count |
|------|--------|-----------:|
| `tests/findingsShape.test.mjs` | `findingKey` stability, severity/confidence clamping, evidence-kind filtering, singleton `executiveSummary` normalisation, prompt-block completeness | 23 |
| `tests/applyReviews.test.mjs` | `viewerMode` visibility rules (public hides pending/rejected/needs_revision; editor hides only rejected), edited title/body overrides, summariser counts | 9 |
| `tests/chunker.test.mjs` | Locator-boundary flush (page/slide/sheet), oversized segment hard-split with locator preserved on every part, `MAX_TOKENS_PER_CHUNK` flush, empty-segment handling | 8 |
| `tests/embeddings.test.mjs` | No-op behaviour when `VOYAGE_API_KEY` unset (returns `null` / array of nulls); model + dim constants match the migration's `vector(1024)` column | 6 |
| `tests/dealDiligenceToPptx.test.mjs` | PPTX buffer is produced (`PK\x03\x04`-prefixed ZIP), empty sections don't throw, rich evidence + recommendations render | 5 |
| `tests/searchDealDocumentsAuth.test.mjs` | Regression: `search_deal_documents` chat tool refuses unless `ctx.dealAccessVerified` is true. Closes the cross-deal read bypass where a user could pass an arbitrary `dealId` and read another user's data-room chunks. | 5 |
| `tests/diagnostic-context.test.mjs` (pre-existing) | Diagnostic reducer | 33 |
| `tests/reconcileEdges.test.mjs` (pre-existing) | Decision-branch edge reconciliation | 16 |

**Total: 217 tests, 54 suites, all passing.** (The `Current coverage` table above is a snapshot of the highest-signal suites, not the full inventory — `npm test` is the source of truth.)

### Test-runner convention

Files in `lib/` that need to be importable from `tests/` via plain `node --test` should use **relative imports** (`'../logger.js'`) rather than the Next.js path alias (`'@/lib/logger'`). The alias works in the bundler but not under bare Node, so any file imported by tests will fail with `ERR_MODULE_NOT_FOUND`. Files only imported via Next.js routes can keep the `@/` alias.

### What's deliberately NOT covered

- **API route handlers** — would need a real Supabase test project + auth fixtures; deferred until a staging env exists.
- **React components** (`DealWorkspaceModal`, `EvidenceModal`, `DiagnosticWorkspace`) — would need Playwright + mocked auth.
- **Inngest `processDealDocument` function** — would need mocked Storage + Voyage + Postgres; the deterministic pieces (chunker, embeddings no-op) are covered separately.
- **Voyage HTTP path** — would need a fake Voyage server or `nock`; the no-op-when-unset path is covered.

---

## Deferred work — decision register

This is what we've **consciously chosen not to ship yet**, with the trigger that should make you reopen the decision. Treat each row as a decision, not a TODO. Building everything up-front is how MVPs die; the discipline here is knowing what you're not doing and why.

If you find yourself about to add one of these, check the trigger column first — if the trigger has actually fired, ship it; otherwise add it to the trigger.

### Critical (blocks first paying customer)

| Item | Why deferred | Reopen when |
|------|--------------|-------------|
| Stripe / payment integration | Out of engineering scope — needs business decision on plans/tiers. Token ledger + budget infra is plug-in-ready. | First customer wants to pay |
| ToS / Privacy / DPA / MSA contracts | Legal cost ($2-5k), not engineering | Before any signed deal above SMB |
| Status page vendor signup (Better Stack / Statuspage / Instatus) | Code shipped (`/status` route + `<StatusBadge />` footer + polished `/api/health`); waiting on vendor signup. See `RUNBOOK_STATUS_PAGE.md`. | First paying customer |
| External uptime monitoring | Same as above — vendor signup pending. The synthetic-check target (`/api/health`) is in place. | Same trigger as status page |

### High (week-one customer pain)

| Item | Why deferred | Reopen when |
|------|--------------|-------------|
| Voyage / OpenAI runtime routing | OpenAI **key setup** ships (`CustomerKeyPanel` paste path + `validateOpenAIKey()` against `GET /v1/models` + audit + envvar fallback). What's still deferred: routing actual chat traffic / embeddings to OpenAI — the chat agent uses raw `@anthropic-ai/sdk`, so OpenAI catalogue entries stay `unsupported: true` until a vendor-aware streaming-loop wires up. | Customer's bill is dominated by embeddings, OR wants OpenAI parity |
| Customer-facing documentation site | **Code shipped** (`/docs` route + 10 starter pages in `content/docs/`). Pending: more pages as users ask for them; embed in the marketing footer. | First customer asks for something not covered |
| ~~Wire `audit_log_event()` + `cron_run_open/close()` into call sites~~ | **Closed.** `lib/auditLog.js` ships the never-throws RPC wrapper. Wired into: `lib/dealAuth.js` (deal.access_resolved / deal.access_denied), `lib/orgAdmin.js` (member.invited), `app/api/organizations/[orgId]/members/[userId]` (member.role_changed / .entitlements_changed), `lib/customerKey.js` (key.set_or_rotated / key.revoked), `app/api/me/account` (gdpr.erasure_requested / .erasure_cancelled), expunge cron (gdpr.erasure_processed / .erasure_failed). `lib/cronWrapper.js` now opens/closes a `cron_run_log` row per execution and forwards numeric body fields to its `metrics` jsonb. | Closed |
| ~~SOC 2 readiness baseline~~ | **Closed.** `compliance/` directory shipped: README, CONTROLS_MATRIX (TSC → our controls), 12 policy templates (Info Sec / Access / Change / IR / Vendor / BCDR / Data Class / AUP / Risk / On-Off / Vuln / Backup), `lib/mfaCheck.js` + `/api/organizations/[orgId]/mfa-status` + admin UI banner, `scripts/collect-soc2-evidence.mjs` for monthly snapshots. **NOT audit-passed** — Type I requires CPA engagement (~2-4 weeks); Type II requires 3-12 months of evidence + audit (~$25-80k). | Closed (readiness); reopen as "SOC 2 Type II audit" when first procurement asks |
| Customer support tooling | Ticketing + impersonate-user-for-debug | First outage you can't reproduce |

### Medium (month-one polish)

| Item | Why deferred | Reopen when |
|------|--------------|-------------|
| Audit-trail history on findings + reviews | Today: only latest `edited_title`/`edited_body`. ~4 hours via trigger or `pg_audit`. | First compliance-driven customer or any disputed finding |
| Email deliverability monitoring | n8n sends report emails. SPF/DKIM/DMARC unverified. | First "I never got the report" complaint |
| Cookie consent banner | Required for EU + analytics cookies | First EU user signs up |
| Accessibility audit (WCAG 2.1 AA) | Required for public-sector + most enterprise. Run axe DevTools | RFP that requires it |
| CSP + security headers | `Content-Security-Policy`, `X-Frame-Options`, etc. ~2 hours middleware | Next quarter regardless — cheap insurance |
| `SECURITY.md` + responsible disclosure | 30-min job. Friendly researchers have nowhere to send bug reports | This week — there's no reason not to |
| Internal admin dashboard | Per-org consumption / active users / failed crons / funnel. Basic `/admin` route ~1 day | Customer #5 |

### Architecture debt (refactor before scale)

| Item | Why deferred | Reopen when |
|------|--------------|-------------|
| ~~Findings out of JSONB → relational table~~ | **Closed.** `deal_findings` table introduced; `deal_analyses.result` JSONB stays as the raw audit archive; `lib/deal-analysis/findingsRepo.js` provides persist + hydrate; reads + PPTX export hydrate from the table. Backfill in the migration. | Closed |
| ~~SSE → enqueue+poll for `/api/deals/[id]/analyse`~~ | **Closed.** Route now inserts `pending` row + fires `deal-analysis.requested` Inngest event + returns `{ analysis_id, poll_url }`. Worker (`runDealAnalysis`) does the LLM call in `step.run()` blocks, updates `deal_analyses.progress_message` between steps. Client polls every 2s. Disconnect-tolerant; resumable across page reloads. | Closed |
| 62 chat tools → consolidate to ~20 | Anthropic guidance is ≤20. Overlap in `update_step` / `set_step_details` / `set_cost_input`; the deal-scoped `propose_*` family has grown to 9 entries with overlapping picker logic | When adding new tools makes the model pick wrong ones |
| Duplicate analysis state | `deal_analyses` table + `deals.settings.analysis` JSONB both written. Can diverge | Next time you touch the analysis route |
| `dealId` session-vs-turn validation | Multiple-tab user can leak deal context via stale chat-session state. ~2 hours | Before second customer with multiple deals |
| ~~Decode JWT locally instead of `auth.getUser()` round-trip~~ | **Closed.** `lib/auth.js:verifyJwtLocal` verifies HS256 against `SUPABASE_JWT_SECRET` (timing-safe compare), short-circuits the network round-trip when the secret is set; falls through to the existing cached `auth.getUser` path otherwise so deployments adopt incrementally. `.env.example` documents the var. | Closed |
| Per-process `_cache` → Upstash Redis | `costGuard.js` + `customerKey.js` cache in process memory; Vercel runs many Lambdas. Up to 60s stale after rotation | Scale where serverless variance is visible (~10+ concurrent paid users) |
| Archive legacy / ambiguous-status code into `archive/` (or delete) | Several files survive from the pre-`/process-audit` era and the pre-rail-button portal layout. Today they're either orphaned, used in only one place, or only reachable through a route whose status is ambiguous. Risk: a code path quietly falls back to a "legacy" UI when the new one fails (the recent sign-out crash + AuditGate flash were both edge cases of this). Decision deferred — list of candidates and call sites captured in [Legacy archive — pending decision](#legacy-archive--pending-decision). | Next time the surface is being touched anyway, OR a regression is traced back to a legacy fallback rendering, OR the next quarterly cleanup pass |

### Operational

| Item | Why deferred | Reopen when |
|------|--------------|-------------|
| Cron failure alerts (Sentry capture) | Crons return 200 + JSON; if they 500 silently for a month, you find out from a customer. ~1 hour | This week — trivial |
| Vault rotation drill | Procedure documented, never tested end-to-end. Encryption-secret rotation breaks every customer key by design | Quarterly, starting now |
| Backup restore drill | Supabase auto-backups daily. Cross-project restore needs the original Vault secret in the runbook | Quarterly |
| Inngest function manifest in CI | `inngest sync` is manual today; cloud-side registration can drift from code | When you next change a function's `retries`/`concurrency` |
| Component / E2E tests | 217 unit tests cover deterministic logic; picker/chat/diligence flows have zero E2E coverage | Before a UI refactor that could regress silently |
| Multi-region deployment | Vercel Edge is global; Supabase isn't. EU residency | First EU enterprise lead |
| Load testing | k6/Artillery scenario for diligence pipeline | Before a customer with >100 concurrent users |
| Performance SLOs | p50/p95/p99 for chat first-token, doc upload→ready, analysis e2e | When SOC 2 Type II prep starts |
| Browser compat matrix | Tested on dev's Chrome. Specify + BrowserStack quarterly | First "doesn't work in Safari" report |
| Dependency scanning (Dependabot + Snyk) | ~30 npm deps; one will be CVE'd within a year | Before any SOC 2 prep |

### What we WOULD NOT defer past first customer

The five things to do this week regardless of the rest:

1. **`PLATFORM_ADMIN_TRANSFER_EMAIL`** set in Vercel — GDPR cron silently skips deal-transfer without it
2. **`SECURITY.md`** — 30 minutes; embarrasses no-one to land
3. **Cron failure alerts** — wire `Sentry.captureException` in each cron's catch path
4. **Backup restore drill** — at least once; confirms Vault secret is in the runbook
5. **ToS / Privacy / DPA** — legal can take 1-2 weeks; start now even if everything else is ready

### How to use this register

- **Don't grow it.** If you find a new gap, decide explicitly: ship now, or add to the register with a trigger.
- **Update it when triggers fire.** When you implement an item, delete its row. Don't leave done items here — that's what the rest of this doc is for.
- **Question old entries.** Quarterly, ask: "is this still true? did circumstances change?" Triggers age.

### Legacy archive — completed

The chat-rail-driven `/workspace/map` surface replaced the earlier "portal dashboard" layout. The legacy files (`PortalDashboard.jsx`, `PortalAnalyticsPanel.jsx`, `DealsPanel.jsx`, `DiagnosticEdit.jsx`, `app/portal/page.jsx`, and the `/portal/analytics`, `/portal/deals`, `/portal/settings` route directories) have been deleted. Analytics now lives in `components/workspace/AnalyticsCanvasPanel.jsx` and is mounted natively by `WorkspaceAnalyticsTab`, `AnalyticsRailButton`, and the workspace's mobile analytics overlay.

`app/portal/` and `components/portal/` have been deleted. The sign-in form lives at `components/auth/SignInForm.jsx`; the org-admin shell and panels live at `components/org-admin/` (including the `org-admin.css` + `org-admin-byo.css` stylesheets). The `.portal-*` CSS class prefix is a cosmetic-only historical artifact and was left alone.

---

## Where to look (file index)

### Diagnostic
| File | Purpose |
|------|---------|
| `app/process-audit/page.jsx` | Route entry |
| `components/diagnostic/DiagnosticClient.jsx` | Top-level client: orchestrates AuditGate + Screen1 + Workspace + Screen6, owns resume logic, deal-context resolution, audit-segment selection |
| `components/diagnostic/DiagnosticContext.jsx` | Central reducer + save/restore |
| `components/diagnostic/DiagnosticNavContext.jsx` | Navigation state context (active screen, transitions) |
| `components/diagnostic/screens/DiagnosticWorkspace.jsx` | The main canvas (chat + editor + flow + cost + report) |
| `components/diagnostic/screens/Screen1SelectTemplate.jsx` | Pillar / process template picker |
| `components/diagnostic/screens/Screen6Complete.jsx` | Auto-submit + redirect |
| `components/diagnostic/ChatHistoryPanel.jsx` | Session history rail |
| `components/diagnostic/ChatMessageContent.jsx` | Markdown + artefact pill renderer |
| `components/diagnostic/AuditTrailPanel.jsx` | Per-step change-history side panel |
| `components/diagnostic/FloatingFlowViewer.jsx` | Detached/expanded flow preview window |
| `components/diagnostic/FlowchartPan.jsx` | Pan/zoom controls for the flow SVG |
| `components/diagnostic/chat/ReportCanvasPane.jsx` | Inline report-canvas surface inside the chat panel |

### Agents & prompts
| File | Purpose |
|------|---------|
| `lib/agents/models.js` | `getFastModel`, `getChatModel`, `getDeepModel` |
| `lib/agents/chat/graph.js` | Chat agent Anthropic tool-use loop + executor |
| `lib/agents/chat/tools.js` | 62 tool schemas (48 base + 14 deal-scoped) |
| `lib/agents/redesign/graph.js` | Redesign planner + repair + summarizer |
| `lib/agents/redesign/tools.js` | 3 redesign tools + `validateRedesign()` |
| `lib/agents/redesign-chat/{graph,tools}.js` | Redesign exploration chat |
| `lib/agents/recommendations/{graph,tools}.js` | Recommendations agent + knowledge bases |
| `lib/agents/flow/{graph,tools}.js` | Process extraction from uploaded files |
| `lib/agents/workflow-export/*.js` | Per-platform build-guide generators |
| `lib/agents/structured-output.js` | Zod-validated structured output helper |
| `lib/agents/ai-cache.js` | Request-level LLM cache |
| `lib/prompts.js` | Centralised system + user prompt definitions |

### Modules
| File | Purpose |
|------|---------|
| `lib/modules/index.js` | Pillar registry (`MODULES`, `getModule`, `getAllModules`) |
| `lib/modules/pillars.js` | ID normalisation + meta lookup |
| `lib/modules/pe/`, `ma/`, `scaling/`, `high-risk-ops/` | Per-pillar config, agent prompt, templates |

### Diagnostic library
| File | Purpose |
|------|---------|
| `lib/diagnostic/processTemplates.js` | Pre-built process templates by pillar |
| `lib/diagnostic/detectBottlenecks.js` | Bottleneck severity scoring |
| `lib/diagnostic/automationReadiness.js` | Per-step automation classification + colour |
| `lib/diagnostic/buildLocalResults.js` | Client-side fallback report builder |
| `lib/diagnostic/buildMapObservations.js` | Synthesises observation strings from the current map (used in Reina prompts and recommendations) |
| `lib/diagnostic/inlineGenerate.js` | Inline report generation invoked from the chat (`generate_report` tool) |
| `lib/diagnostic/intakePhases.js` | 6-phase intake state machine |
| `lib/diagnostic/handoffOptions.js` | Handoff method picklist |
| `lib/diagnostic/processData.js` | Shape validator + normaliser |
| `lib/diagnostic/processDuration.js` | Cycle-time / elapsed-time computations |
| `lib/diagnostic/savedSnippets.js` | User-saved chat snippet library |
| `lib/diagnostic/stepConstants.js` | Default departments + system names |
| `lib/diagnostic/stepSuggestions.js` | Suggested next steps shown beside the editor |
| `lib/diagnostic/constants.js`, `utils.js`, `index.js` | Shared constants, helpers, barrel re-exports |

### Flow rendering
| File | Purpose |
|------|---------|
| `lib/flows/index.js` | Public API (`buildFlowSVG`, `buildListHTML`) |
| `lib/flows/grid.js` | Serpentine grid SVG |
| `lib/flows/swimlane.js` | Department-lane SVG |
| `lib/flows/automation.js` | Step automation classification |
| `lib/flows/flowModel.js` | Wait-time prediction (`getWaitProfile`) |
| `lib/flows/layoutStorageKeys.js` | Position persistence helpers |

### Auth + RBAC
| File | Purpose |
|------|---------|
| `lib/supabase.js` | Service-role + browser clients |
| `lib/auth.js` | API route auth helpers |
| `lib/entitlements.js` | Entitlement keys + defaults + helpers |
| `lib/orgAdmin.js` | Org-membership server helpers |

### Persistence helpers
| File | Purpose |
|------|---------|
| `lib/chatPersistence.js` | Session + message + artefact CRUD |
| `lib/chat-utils.js` | Client-side chat helpers (formatting, action plumbing) |
| `lib/api-fetch.js`, `lib/api-helpers.js` | Client/server fetch wrappers (rate-limit, request id, supabase headers) |
| `lib/ai-retry.js`, `lib/ai-schemas.js` | Retry + schema utilities for LLM calls |

### Cost & deal helpers
| File | Purpose |
|------|---------|
| `lib/computeRedesignCostProfile.js` | Per-step redesign cost rollup |
| `lib/costSavingsCalculator.js` | Savings math used by Screen 4 / cost panel / Reina |
| `lib/costAnalystEnv.js` | Cost-analyst entitlement + env helpers |
| `lib/customerKey.js` | BYO API key resolution + set/rotate/revoke + audit (used by every LLM call site) |
| `lib/dealAuth.js` | Deal-role auth checks (owner / collaborator / participant) |
| `lib/dealStatus.js` | Deal status state machine |
| `lib/deal-analysis/prompts.js` | Prompts for synergy / comparison / redesign deal-analysis (injects `FINDINGS_SHAPE_PROMPT_BLOCK`) |
| `lib/deal-analysis/findingsShape.js` | Canonical finding shape + `findingKey()` + `normaliseFindings()` + prompt block |
| `lib/deal-analysis/applyReviews.js` | Filter / merge analysis result against `deal_finding_reviews` for viewerMode |
| `lib/deal-analysis/chunkSearch.js` | Wrapper over `search_deal_chunks` RPC; embeds query via Voyage |

### Deal documents UI
| File | Purpose |
|------|---------|
| `components/diagnostic/chat/DealWorkspaceModal.jsx` | Full deal surface inside the chat workspace: data-room (drag-drop upload + multi-file picker + status polling), expected-docs checklist, Q&A queue, findings list with inline review / tags / comments / evidence drawer, scorecard view, Day-1/TSA/Separation cross-cut |
| `components/deals/EvidenceModal.jsx` | Citation click-through modal: shows the cited chunk + neighbours OR the source file inline (PDF iframe / signed download for others) |
| `lib/exporters/dealDiligenceToPptx.js` | PptxGenJS deck builder used by the diligence export route (Exec Summary / Tech / Ops / Org / Red Flags / Day-1+TSA+Separation cross-cut / Key Takeaways). APPROVED findings only |
| `app/api/deals/[id]/documents/route.js` | GET / POST / DELETE documents; POST enqueues Inngest event |
| `app/api/deals/[id]/documents/[docId]/preview/route.js` | Chunk-with-context preview + signed-URL raw-bytes mode |
| `app/api/deals/[id]/documents/[docId]/reprocess/route.js` | Reset status + re-emit Inngest event (with optional `wipe=1`) |
| `app/api/deals/[id]/analyses/[analysisId]/reviews/route.js` | GET / PATCH per-finding reviews (upsert by `(analysis_id, finding_key)`) |
| `app/api/deals/[id]/export-diligence-pptx/route.js` | Builds + streams the .pptx; APPROVED findings only |
| `lib/exporters/dealDiligenceToPptx.js` | PptxGenJS deck builder used by the export route |

### Embeddings + Inngest worker
| File | Purpose |
|------|---------|
| `lib/ai/embeddings.js` | Voyage AI wrapper (`voyage-3-large`, 1024 dims); `embedQuery`, `embedDocuments`, `embeddingsConfigured` |
| `lib/inngest/client.js` | Inngest client + `sendEvent()` (no-op when unconfigured) |
| `lib/inngest/functions/processDealDocument.js` | The deal-document.uploaded function: parse → chunk → embed → ready |
| `lib/inngest/functions/extractText.js` | Buffer → segments[] (DOCX / PPTX / PDF / XLSX / CSV / text) with locator metadata |
| `lib/inngest/functions/chunker.js` | Segment-aware chunker (~600 target tokens, 900 max, never crosses locator boundary) |
| `app/api/inngest/route.js` | Serve handler; register new functions in the `functions` array |

### Exporters
| File | Purpose |
|------|---------|
| `lib/exporters/reportToPptx.js` | Builds the .pptx returned by `/api/export-pptx` |

### Top-level shared components
| File | Purpose |
|------|---------|
| `components/CostAccessPanel.jsx` | Entitlement-aware cost gate UI |
| `components/CostCopilotPanel.jsx` | Streaming cost Q&A panel (calls `/api/cost-copilot`) |
| `components/ThemeProvider.jsx`, `components/ThemeToggle.jsx` | Theme context + light/dark toggle |

### Tests
| File | Purpose |
|------|---------|
| `tests/findingsShape.test.mjs` | Canonical finding shape + `findingKey` + normalisation |
| `tests/verifyEvidence.test.mjs` | Evidence validator: invalid chunk_id drop, snippet match/mismatch, confidence floor, section coverage |
| `tests/applyReviews.test.mjs` | Reviewer visibility filter + summariser |
| `tests/chunker.test.mjs` | Segment-aware document chunker |
| `tests/embeddings.test.mjs` | Voyage wrapper no-op behaviour |
| `tests/dealDiligenceToPptx.test.mjs` | Diligence PPTX builder smoke |
| `tests/searchDealDocumentsAuth.test.mjs` | Regression: chat tool refuses unverified deal access |
| `tests/cronAuth.test.mjs` | Cron `Authorization: Bearer $CRON_SECRET` gate |
| `tests/costGuard.test.mjs` | Pre-flight + record-usage paths for the org token budget |
| `tests/customerKey.test.mjs` | BYO key: mask/fingerprint, rotation maths, customer/platform resolution + cache, validate-then-store, 401 rejection |
| `tests/orgModels.test.mjs` | Per-org model allowlist resolver + catalogue helpers + setOrgAllowedModels validation |
| `tests/modelCatalogueHelpers.test.mjs` | Multi-vendor catalogue: vendor field, userPickableIds (drops unsupported), suggestedModelIdForPhase tier mapping |
| `tests/dealDocumentVisibility.test.mjs` | Per-party doc visibility: every branch of canSeeDocument (owner_only/all_editors/role-scoped), per-deal-type option mapping, validation |
| `tests/findingsRepo.test.mjs` | Round-trip persist→load→hydrate, section/order ordering, executiveSummary singleton, table-overrides-JSONB rule |
| `tests/diagnostic-context.test.mjs` | Diagnostic reducer (pre-existing) |
| `tests/reconcileEdges.test.mjs` | Decision-branch edge reconciliation (pre-existing) |
| `tests/e2e/*.spec.mjs` | Playwright E2E |
| `playwright.config.mjs` | Playwright config |

---

## Updating this document

When you add a route, agent tool, table, or module: **edit this file in the same PR**. Specifically:

- **New API route** → add a row to [API routes](#api-routes).
- **New chat tool** → bump the count in the heading, add the tool to its category, and confirm it's in the `MUTATING` set if it mutates state.
- **New table or column** → add to [Database schema](#database-schema) and to the migration list.
- **New pillar or feature module** → add to [Module system](#module-system-4-audience-pillars) and update `MODULES` / `FEATURE_MODULES` in `lib/modules/index.js`.
- **New page** → add to [Top-level routes](#top-level-routes) with auth model.
