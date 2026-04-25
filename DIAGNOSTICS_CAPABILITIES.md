# Workflow Consultancy — Developer Guide

> **Last updated:** 2026-04-25
> Reference document for engineers working on the workflow-consultancy app. Covers the full surface area: routes, agents, persistence, modules, deals, RBAC. Update this file when you add a route, table, agent tool, or module.

---

## Contents

1. [What this app does](#what-this-app-does)
2. [Tech stack](#tech-stack)
3. [Top-level routes](#top-level-routes)
4. [Module system (4 audience pillars)](#module-system-4-audience-pillars)
5. [Diagnostic flow](#diagnostic-flow)
6. [Chat agent (48 tools)](#chat-agent-48-tools)
7. [Other AI agents](#other-ai-agents)
8. [Model tiers](#model-tiers)
9. [Report system](#report-system)
10. [PE / M&A / Scaling deals](#pe--ma--scaling-deals)
11. [Portal & org admin](#portal--org-admin)
12. [Entitlements & RBAC](#entitlements--rbac)
13. [Chat persistence (sessions, messages, artefacts)](#chat-persistence-sessions-messages-artefacts)
14. [Workflow exports](#workflow-exports)
15. [Database schema](#database-schema)
16. [API routes](#api-routes)
17. [Authentication](#authentication)
18. [External integrations](#external-integrations)
19. [Where to look (file index)](#where-to-look-file-index)

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
| `/portal` | Authenticated hub: reports, deals, org admin, analytics | Required |
| `/portal/org-admin` | Manage org members + entitlements | Org admin |
| `/portal/analytics` | Cross-report benchmarking | `analytics` entitlement |
| `/portal/reports/[reportId]` | Edit a saved diagnostic | Owner / collaborator |
| `/deals` | Deal portal landing | `deals` entitlement |
| `/deals/[id]` | PE / M&A / Scaling deal page (per-type renderer) | Owner / collaborator |
| `/cost-analysis` | Standalone labour-rate + ROI editor (also embedded as iframe) | `cost_analyst` |
| `/build` | Pick a build platform after redesign accepted | Owner of report |
| `/survey` | Static survey shim → `public/survey.html` (legacy team flow) | Public |
| `/monitor` | Static monitor shim → `public/monitor.html` (legacy ops view) | Public |
| `/team-results` | Static team results shim → `public/team-results.html` | Public (URL-coded) |

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

`components/diagnostic/screens/`:

| Screen | File | Modes | Purpose |
|--------|------|-------|---------|
| 0 | `IntroChatScreen.jsx` | All | Path/mode selection + intake chat |
| 1 | `Screen1SelectTemplate.jsx` | Team + Comprehensive | Pillar + process template selection |
| 2 | `DiagnosticWorkspace.jsx` | All | The main canvas: chat + step editor + flow preview + cost panel + report panel |
| 4 | `Screen4Cost.jsx` | Comprehensive | Frequency, hours, hourly rate, bottleneck → savings calc |
| 5 | `Screen5YourDetails.jsx` | All | Contact info (pre-filled from auth) |
| 6 | `Screen6Complete.jsx` | All | Auto-submit + redirect to `/report?id=…` |
| -2 | `ScreenTeam.jsx` | Team only | Create/join a team session by code |
| PE | `ScreenPEDealSetup.jsx` | PE deal | Configure PE deal participant before diagnostic |

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

## Chat agent (48 tools)

The diagnostic chat (`/api/diagnostic-chat`) is a LangGraph `StateGraph` with an agent + `ToolNode` loop. The agent uses Claude **Sonnet 4.6** (primary chat tier).

```
__start__ ──► agent ──tool_calls──► tools ──results──► agent ──no_calls──► __end__
```

State: `messages[]` (append reducer) + `systemPrompt` (replace reducer). Tools return result strings; **client** applies state mutations via `processActions()`. The server is stateless w.r.t. canvas state — it only reads what the client passes in `processData`.

### All 48 tools (`lib/agents/chat/tools.js`)

**Step CRUD (6):** `add_step`, `update_step`, `remove_step`, `set_handoff`, `add_custom_department`, `replace_all_steps`

**Connectors (4):** `add_connector`, `remove_connector`, `redirect_connector`, `insert_step_between`

**Branches (5):** `set_branch_target`, `set_branch_probability`, `set_branch_label`, `remove_branch`, `add_branch`

**Step ordering & metadata (8):** `reorder_step`, `set_process_name`, `set_process_definition`, `set_step_details`, `set_cost_input`, `set_bottleneck`, `set_frequency_details`, `set_pe_context`

**Step systems (2):** `add_step_system`, `remove_step_system`

**Checklist & departments (4):** `add_checklist_item`, `toggle_checklist_item`, `remove_checklist_item`, `remove_custom_department`

**Triggers & snapshots (2):** `trigger_redesign`, `pin_flow_snapshot`

**Read-only queries (5):** `get_bottlenecks`, `get_critical_path`, `get_step_metrics`, `get_cost_summary`, `get_recommendations`

**Cross-report (2):** `list_reports`, `load_report_summary`

**Cost editing (3):** `set_labour_rate`, `set_non_labour_cost`, `set_investment`

**UI (2):** `highlight_step`, `open_panel`

**Generation (2):** `generate_report`, `generate_cost`

**Misc (3):** `undo_last_action`, `propose_change`, `ask_discovery`

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
| **Fast** | `claude-haiku-4-5-20251001` | 4 096 | 0.3 | Recommendations, team analysis, survey analysis, redesign summarizer, flow extraction |
| **Chat (primary)** | `claude-sonnet-4-6` | 16 384 | 0.3 | Diagnostic chat, redesign-chat, cost-chat |
| **Deep** | `claude-opus-4-7` | 16 000 | 0 | Redesign planner/repair |

Override any with `getXModel({ temperature, maxTokens, model })`.

---

## Report system

The report is rendered at `/report?id=<reportId>` and re-renders on edit at `/portal/reports/[reportId]`.

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

| Type | Page | Use case |
|------|------|----------|
| `pe_rollup` | `DealPagePE.jsx` | PE roll-up: benchmark portfolio companies, find synergies |
| `ma` | `DealPageMA.jsx` | M&A: acquirer + target flow comparison, integration planning |
| `scaling` | `DealPageScaling.jsx` | Single-company: optimisation roadmap |

### Flow

1. Owner creates deal → `POST /api/deals` (returns 8-char `deal_code`)
2. Owner adds participants → `POST /api/deals/[id]/participants`
3. Owner invites by email → `POST /api/deals/[id]/invite` (token-based acceptance)
4. Each participant fills a `deal_flow` slot at `/process-audit?dealFlowId=…` — when they save the diagnostic, `deal_flows.report_id` is populated
5. Owner runs analysis → `POST /api/deals/[id]/analyse?mode=comparison|synergy|redesign`
6. Result stored in `deal_analyses`; renderer in `DealPagePE.jsx` (synergy/redesign sub-renderers)

### Tables

`deals` → `deal_participants` → `deal_flows` → `diagnostic_reports`. `deal_collaborators_emails` is a `TEXT[]` on `deals` (collaborators can edit but aren't participants). Cross-flow analyses live in `deal_analyses` with `source_flow_ids UUID[]` + `mode`.

### Auth model

`lib/orgAdmin.js` and a deal auth helper enforce three roles: **owner**, **collaborator** (in `collaborator_emails`), and **participant** (via `deal_participants.email`). Anonymous flow resolution by code: `POST /api/deals/resolve` (used when a participant clicks an invite link).

---

## Portal & org admin

`app/portal/`:

| File | Purpose |
|------|---------|
| `PortalAuth.jsx` | Supabase login/signup; reused by `TeamAuthGate` |
| `PortalDashboard.jsx` | Hub page; tiles for reports, deals, org admin, analytics |
| `DealsPanel.jsx` | Company-centric deal list with create/filter/invite |
| `OrgAdminClient.jsx` | Org member management UI |
| `DiagnosticEdit.jsx` | Reopen a saved diagnostic — full editor for `processData` and "legacy" detail fields (userTime, biggestDelay, approvals, timeAccuracy, performance, newHire, priority) |
| `PortalAnalyticsPanel.jsx` | Cross-report benchmarking, metrics rollup |

Subroutes: `/portal/analytics`, `/portal/org-admin`, `/portal/reports/[reportId]`.

---

## Entitlements & RBAC

`lib/entitlements.js` defines four boolean keys stored in `organization_members.entitlements` (JSONB):

| Key | Default | Gates |
|-----|---------|-------|
| `portal` | `true` | `/portal` and authenticated diagnostic |
| `cost_analyst` | `false` | `/cost-analysis`, cost copilot, labour-rate edits |
| `deals` | `false` | `/deals` create/edit |
| `analytics` | `false` | `/portal/analytics` |

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

### Diagnostic core
- **`diagnostic_reports`** (text id) — submitted reports. `contact_email`, `diagnostic_data` (full processData JSON), `cost_analysis_status`, `recommendations`, `diagnostic_mode` (`comprehensive | pe | ma | scaling`), `user_id`
- **`diagnostic_progress`** — mid-session resume state by email; `intake_state` JSONB
- **`process_instances`** — team member survey responses; `email`, `process_name`, `responses` JSONB, `report_id` FK
- **`report_redesigns`** — named AI redesigns; `redesign_data`, `decisions`, `status` (pending/accepted), `name`
- **`followup_events`** — email/SMS campaign tracking (e.g., `e2_sent`, `d3_sent`)

### Chat
- **`chat_sessions`** (uuid) — conversation containers; FTS on `title`+`summary`
- **`chat_messages`** (uuid) — turns with `role`, `content`, `actions`, `attachments`, `artefact_id`
- **`chat_artefacts`** (uuid) — durable outputs (`flow_snapshot | report | cost_analysis | deal_analysis`)

### Deals
- **`deals`** (uuid) — `deal_code` (8-char), `type`, `name`, `process_name`, `owner_email`, `owner_user_id`, `status`, `settings` JSONB, `collaborator_emails` TEXT[]
- **`deal_participants`** — companies/entities; `role`, `status`
- **`deal_flows`** — process slot per participant; `report_id` FK populated when diagnostic saved
- **`deal_analyses`** — cross-flow output; `mode`, `source_flow_ids` UUID[], `source_report_ids` TEXT[], `result` JSONB

### Org & RBAC
- **`organizations`** — tenant container
- **`organization_members`** — `is_org_admin` boolean, `entitlements` JSONB

### Team alignment (legacy team flow)
- **`team_diagnostics`** — team session metadata (code, process, status)
- **`team_responses`** — individual perspectives (upserted by email)

### Migration files

**Active migrations** (`supabase/`): `migration.sql` (base), `migration-display-code.sql`, `migration-report-redesigns-name.sql`, `migration-chat-history.sql`, `migration-chat-snapshot.sql`, `migration-org-rbac.sql`, `migration-chat-artefacts.sql`. Plus `seed-team-alignment.sql` for dev seeding.

**Older migrations** (`scripts/`): `migration-v2.sql`, `migration-add-segment.sql`, `migration-add-high-risk-ops-segment.sql`, `migration-add-contributor-emails.sql`, `migration-create-diagrams-bucket.sql`, `migration-deals.sql`, `migration-deal-flows.sql`, `migration-schema-fixes*.sql` (1, 2, 3). Apply in order if bootstrapping a new database.

---

## API routes

42 endpoints under `app/api/`. Grouped:

### Diagnostic
| Method + path | Purpose | Auth |
|---|---|---|
| `POST /api/diagnostic-chat` | Chat agent (48 tools), `maxDuration: 60` | Optional |
| `POST /api/process-diagnostic` | Generate report from processData (recommendations) | Public |
| `POST /api/send-diagnostic-report` | Persist report, trigger n8n, send email link | Rate-limited |
| `GET/PATCH /api/get-diagnostic` | Fetch / update a report | Owner |
| `POST /api/update-diagnostic` | Save processData + intake state | Owner |
| `GET /api/get-dashboard` | Dashboard summary, prunes old reports | Required |
| `GET/POST /api/progress` | Cloud save / resume by id | Public by id |
| `POST /api/get-followups` | Followup campaign timeline | Owner |

### Chat persistence
| `POST /api/chat-sessions` | Create session | Required |
| `GET/PATCH /api/chat-sessions/[id]` | Fetch session + messages + artefacts | Owner |
| `POST /api/chat-messages` | Append message | Required |

### Redesign
| `POST /api/generate-redesign` | Run redesign agent, store, pin artefact | Required |
| `POST /api/save-redesign` | Save selected variant | Owner |
| `POST /api/rename-redesign` | Rename | Owner |
| `GET /api/report-redesigns` | List for a report | Owner |

### Cost analysis
| `GET/POST/PATCH /api/cost-analysis` | Fetch / update labour rates, savings, ROI | `cost_analyst` |
| `POST /api/cost-analysis/suggest-savings` | AI labour-rate suggestions | `cost_analyst` |
| `POST /api/cost-authorized-emails` | Set who can access cost panel | Owner |
| `POST /api/share-cost-analysis` | Email cost link with expiry token | Rate-limited |
| `GET /api/cost-copilot` | Streaming cost Q&A | `cost_analyst` |

### Deals
| `GET/POST/PATCH /api/deals` | List / create / bulk update | Required |
| `GET/PATCH /api/deals/[id]` | Detail / update | Owner / collab |
| `POST /api/deals/[id]/analyse` | Run comparison/synergy/redesign analysis | Owner |
| `GET/PATCH /api/deals/[id]/analyses` (+ `/[analysisId]`) | List / fetch / save analysis | Owner |
| `GET/POST/PATCH /api/deals/[id]/collaborators` | Manage edit-rights emails | Owner |
| `GET/POST/PATCH /api/deals/[id]/flows` (+ `/[flowId]`) | Flow slots + metadata | Owner / participant |
| `GET/POST/PATCH /api/deals/[id]/invite` | Send invites; create/accept tokens | Owner |
| `GET/POST/PATCH /api/deals/[id]/participants` (+ `/[participantId]`) | Roster management | Owner |
| `POST /api/deals/resolve` | Resolve flow by code (anon) | Public |

### Org & portal
| `GET/POST/PATCH /api/organizations` | Create / list orgs | Admin |
| `GET/POST/PATCH /api/organizations/[orgId]/members` (+ `/[userId]`) | Member CRUD + entitlements | Org admin |

### Misc
| `POST /api/team` | Team session CRUD + AI analysis (action param) | Email-gated |
| `GET/POST /api/process-instances` | Live instance tracking | Required |
| `POST /api/generate-workflow-export` | n8n/Zapier/etc JSON | Required |
| `POST /api/recommend-workflow-platform` | Suggest a build platform | Required |
| `POST /api/survey-submit` | Survey feedback | Rate-limited |
| `GET /api/public-config` | Feature flags | Public |
| `GET /api/health` | Health check | Public |

---

## Authentication

Supabase Auth (email + password) is required for:
- All authenticated portal routes
- Comprehensive diagnostic (gate triggered after process selection)
- Team alignment (gate before team setup)
- Deals routes
- Cost analysis

`components/diagnostic/TeamAuthGate.jsx` wraps `PortalAuth` and stores the resolved user as `authUser` in `DiagnosticContext`. From there, name/email pre-populate Screen 5 and creator identity for team sessions.

Required env vars (client):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Server uses `lib/supabase.js` for the service-role client.

---

## External integrations

| Service | What we use | Env vars |
|---------|-------------|----------|
| Anthropic | All LLM calls (chat agent, redesign, recommendations, cost copilot, structured analysis) | `ANTHROPIC_API_KEY` |
| Supabase | Auth + Postgres + storage (diagrams bucket) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| n8n | Webhook for report email + followup campaigns; HMAC-SHA256 signed | `N8N_*_WEBHOOK_URL` family + `WEBHOOK_SIGNING_SECRET` |

No Resend, OpenAI, Gemini, or direct SMTP — all email goes through n8n.

---

## Where to look (file index)

### Diagnostic
| File | Purpose |
|------|---------|
| `app/process-audit/page.jsx` | Route entry |
| `components/diagnostic/DiagnosticClient.jsx` | Top-level client + resume logic |
| `components/diagnostic/DiagnosticContext.jsx` | Central reducer + save/restore |
| `components/diagnostic/screens/DiagnosticWorkspace.jsx` | The main canvas (chat + editor + flow + cost + report) |
| `components/diagnostic/screens/Screen*.jsx` | Individual intake screens |
| `components/diagnostic/IntroChatScreen.jsx` | Welcome + path selection |
| `components/diagnostic/TeamAuthGate.jsx` | Auth wrapper |
| `components/diagnostic/ChatPanel.jsx` | Chat surface |
| `components/diagnostic/ChatHistoryPanel.jsx` | Session history rail |
| `components/diagnostic/ChatMessageContent.jsx` | Markdown + artefact pill renderer |

### Agents & prompts
| File | Purpose |
|------|---------|
| `lib/agents/models.js` | `getFastModel`, `getChatModel`, `getDeepModel` |
| `lib/agents/chat/graph.js` | Chat agent StateGraph + executor |
| `lib/agents/chat/tools.js` | 48 tool schemas |
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
| `lib/diagnostic/intakePhases.js` | 6-phase intake state machine |
| `lib/diagnostic/handoffOptions.js` | Handoff method picklist |
| `lib/diagnostic/processData.js` | Shape validator + normaliser |
| `lib/diagnostic/savedSnippets.js` | User-saved chat snippet library |
| `lib/diagnostic/stepConstants.js` | Default departments + system names |

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
| `lib/chatPersistence.js` (or equivalent) | Session + message + artefact CRUD |

### Tests
| File | Purpose |
|------|---------|
| `tests/*.test.mjs` | Node test runner unit tests |
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
