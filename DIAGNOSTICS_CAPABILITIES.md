# Diagnostics Flow - Capabilities Document

> **Last updated:** 2026-04-05
> This document describes the current diagnostic tool: screens, features, and client experience. The diagnostic is implemented as React components in `components/diagnostic/` and served from `app/process-audit/`. Update this doc when making changes.

---

## Table of Contents

1. [Client Journey Paths](#client-journey-paths)
2. [Flow Overview](#flow-overview)
3. [Screen-by-Screen Breakdown](#screen-by-screen-breakdown)
4. [Authentication](#authentication)
5. [User Experience & Navigation](#user-experience--navigation)
6. [Core Features](#core-features)
7. [Data Persistence & Resume](#data-persistence--resume)
8. [Flowchart Rendering](#flowchart-rendering)
9. [Automation Classification](#automation-classification)
10. [AI Agent Architecture](#ai-agent-architecture)
11. [Report Generation & Export](#report-generation--export)
12. [Team Alignment](#team-alignment)
13. [Handover](#handover)
14. [Database Schema](#database-schema)

---

## Client Journey Paths

The diagnostic tool has three primary paths, all beginning from a single chat-first welcome screen.

```
                            ┌────────────────────┐
                            │   Welcome Screen    │
                            │  (Sharp chatbot)    │
                            │   screen 0          │
                            └─────────┬──────────┘
               ┌──────────────────────┼──────────────────────┐
               │                      │                      │
               ▼                      ▼                      ▼
     ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
     │  PROCESS MAP     │   │  COMPREHENSIVE   │   │ TEAM ALIGNMENT  │
     │  (Map only)      │   │  DIAGNOSTIC      │   │ (Collaborative) │
     │  ~15 min          │   │  ~30 min          │   │                 │
     └────────┬─────────┘   └────────┬─────────┘   └────────┬────────┘
              │                      │                       │
              │               ┌──────┴──────┐         ┌──────┴──────┐
              │               │  AUTH GATE   │         │  AUTH GATE  │
              │               │  (Supabase)  │         │  (Supabase) │
              │               └──────┬──────┘         └──────┬──────┘
              │                      │                       │
              │               Chat collects:          ┌──────┴──────┐
              │               last example,           │ Team Setup  │
              │               dates, time,            │ (screen -2) │
              │               performance,            │ Create/Join │
              │               frequency,              └──────┬──────┘
              │               priority                       │
              │                      │                       │
              ├──────────────────────┼───────────────────────┘
              ▼                      ▼
     ┌─────────────────────────────────────────┐
     │         Screen 2 - Map Steps            │
     │  AI Chat  |  Step Editor  |  Flow View  │
     │  Handover modal, per-step save links    │
     └────────────────────┬────────────────────┘
                          │
          ┌───────────────┼────────────────┐
          │ (map-only)    │ (comprehensive)│
          │               ▼                │
          │    ┌──────────────────┐        │
          │    │ Screen 4 - Cost  │        │
          │    │ & Impact         │        │
          │    └────────┬─────────┘        │
          │             │                  │
          └──────┬──────┘                  │
                 ▼                         │
     ┌─────────────────┐                   │
     │ Screen 5 - Your │◄──────────────────┘
     │ Details (pre-    │
     │ filled from auth)│
     └────────┬────────┘
              ▼
     ┌─────────────────┐
     │ Screen 6 -      │
     │ Auto-redirect    │
     │ to Report page   │
     └────────┬────────┘
              ▼
     ┌─────────────────┐
     │ /report          │
     │ Flowcharts, AI   │
     │ recommendations, │
     │ cost analysis,   │
     │ roadmap, exports │
     └─────────────────┘
```

### Path Summary

| # | Path | Auth Required | Screens | Database Tables |
|---|------|--------------|---------|-----------------|
| 1 | **Map Only** | No | 0 → 2 → 5 → 6 → /report | `diagnostic_progress`, `diagnostic_reports` |
| 2 | **Comprehensive** | Yes (Supabase) | 0 → auth → 2 → 4 → 5 → 6 → /report | `diagnostic_progress`, `diagnostic_reports` |
| 3 | **Team Alignment** | Yes (Supabase) | 0 → auth → -2 → 1 → 2 → 5 → 6 → /team-results | `team_diagnostics`, `team_responses` |
| 4 | **Resume** | No | /process-audit?resume=ID → last screen → continue | `diagnostic_progress` |
| 5 | **Handover** | No | /process-audit?resume=ID&step=N → video landing → screen 2 | `diagnostic_progress` |
| 6 | **Team Join** | Yes (Supabase) | /process-audit?team=CODE → auth → -2 → 1 → 2 → ... | `team_responses` |

---

## Flow Overview

The diagnostic is a **chat-first** experience powered by "Sharp", an AI process-mapping assistant. Users interact conversationally to define their process, then map steps visually, and optionally quantify costs. The tool produces a comprehensive analysis report with flowchart visualisation, automation readiness scoring, cost projections, and a 90-day improvement roadmap.

**Screen sequence:**

| Screen | Name | Modes |
|--------|------|-------|
| 0 | Intro Chat (Sharp) | All |
| -2 | Team Setup | Team only |
| 1 | Guided Chat | Team + Comprehensive |
| 2 | Map Steps | All |
| 4 | Cost & Impact | Comprehensive only |
| 5 | Your Details | All |
| 6 | Complete (auto-redirect) | All |

**Map-only:** 0 → 2 → 5 → 6
**Comprehensive:** 0 → 2 → 4 → 5 → 6
**Team:** 0 → -2 → 1 → 2 → 5 → 6

---

## Screen-by-Screen Breakdown

### Screen 0 - Intro Chat (Sharp)

`components/diagnostic/IntroChatScreen.jsx`

The welcome screen is entirely chat-driven. Sharp (the chatbot avatar) greets the user and guides them through initial decisions.

**Chat flow:**
1. **Path selection** - "Process Map" or "Team Alignment" (rendered as large cards, not just chips).
2. **Mode selection** (Process Map path) - "Map only (~15 min)" or "Full diagnostic (~30 min)" (rendered as detailed mode cards showing what each includes).
3. **Process selection** - Grid of 9 templates (Customer Onboarding, Sales to Delivery, etc.) or free-text custom process name.
4. **Process naming** - Refine the process name.

For comprehensive mode, additional prompts follow:
5. **Last example** - Name of the last real instance.
6. **Start/end dates** - Natural language date parsing (e.g. "started 3 Jan, finished 18 Jan" or "took about 2 weeks") → calculates `elapsedDays`.
7. **Time spent** - Distinguishes hands-on work vs waiting time. Chips: Under 1 hour, 1-4 hours, Half a day, Full day, Multiple days. Parses to `hoursPerInstance`.
8. **Performance** - Was this instance faster, typical, or slower than usual?
9. **Frequency** - Daily, few per week, weekly, monthly.
10. **Priority** - Critical, High, Medium, Low.

All data collected in the chat is merged into `processData` in the diagnostic context and carried forward.

### Screen -2 - Team Setup

`components/diagnostic/screens/ScreenTeam.jsx`

Team Alignment setup screen (accessed only via auth gate).

**Create mode:**
- Select a process from templates or enter a custom name.
- Company name (optional).
- Creator identity is taken from the authenticated Supabase user - no duplicate name/email fields.
- Creates a team session via `POST /api/team?action=create` → returns team code and shareable join URL.

**Join mode:**
- Enter an existing team code (or auto-filled from `?team=CODE` URL).
- Validates and joins via `GET /api/team?action=info`.

### Screen 2 - Map Steps

`components/diagnostic/screens/Screen2MapSteps.jsx`

The most feature-rich screen. A three-panel layout with AI Chat, Step Editor, and Flow Preview.

**Layout:**
- **Pill toggle** switches between AI Chat and Step Editor views (mutually exclusive).
- **Flow Preview** always visible alongside the active panel.
- Panels can be floated (undocked) or resized via column drag.
- Flexbox layout with `flex: 1 1 0%` ensures panels don't squeeze each other.

**AI Chat panel:**
- Full conversation with Sharp (Anthropic-powered via `/api/diagnostic-chat`).
- Sharp proactively asks about missing step details after adding steps: decision points, departments, systems, handoffs, approvals.
- Supports drag-and-drop file upload (Excel, images, PDFs) for process extraction.
- Automatic retry on transient API errors (429, 503, 529).
- Messages tagged with Sharp avatar ("S" badge).

**Step Editor panel:**
- Per-step editing with progressive disclosure:
  - Step name and number.
  - **Decision point** (pill toggle Yes/No at the top of expanded details) with branch inputs.
  - **Owner** - Department dropdown + Internal/External toggle.
  - **Systems** - Tag/chip input with suggestions (Salesforce, HubSpot, etc.).
  - **Handoff → Step N** - Tag/chip input with 5 core methods: Email, Slack/Teams, Meeting/call, Shared doc, They just knew.
  - **Clarification needed?** - Frequency chips: No issues, Once, 2-3x, 4+x.
- Section headers (Owner, Systems, Handoff, Clarification) with light grey backgrounds for clear visual separation.
- **Insert steps** between existing steps via `+` buttons in the step strip.
- **Per-step save link** - "Save & get link" generates a cloud-saved resume URL for that specific step.
- Step strip bar with numbered pills; horizontal scrolling for many steps.

**Flow Preview panel:**
- Real-time SVG flowchart rendered as steps are added/edited.
- Clicking a node in the preview navigates to and expands that step in the editor.
- Department-coloured nodes; diamond shapes for decision steps.
- Serpentine grid layout matching the final report.

**Handover modal:**
- Triggered from the nav bar "Handover" button.
- Fields: Recipient email, sender name, comments.
- Saves to cloud with step index → generates deep-link URL (`?resume=ID&step=N`).
- Option to copy link or send via email (n8n webhook).

### Screen 4 - Cost & Impact

`components/diagnostic/screens/Screen4Cost.jsx`

Comprehensive mode only. Combines data from several formerly separate screens.

**Sections:**
- **Frequency & volume** - Pre-filled from chat; editable dropdown + annual instances calculation.
- **Person-hours per instance** - Pre-filled from chat (`hoursPerInstance`); label shows "Sharp estimated Xh based on your answers - adjust if needed".
- **Hourly rate** - Number input (default £50).
- **Calculated results** - Per-instance cost, annual cost, potential annual savings (grounded, not arbitrary).
- **Cycle time badge** - Displays `elapsedDays` collected from chat date parsing.
- **Bottleneck** - Radio buttons: Waiting for approvals, Manual data entry, Coordination overhead, System limitations, Knowledge gaps, Other. Optional detail input.

**Savings calculation:**
`estimateSavingsPercent()` dynamically calculates potential savings (capped at 60%) based on:
- Number of distinct departments (handoff overhead).
- Handoff clarity (unclear handoffs = more savings potential).
- Bottleneck type (manual work and coordination overhead = higher savings).
- Decision points (routing complexity).

### Screen 5 - Your Details

`components/diagnostic/screens/Screen5YourDetails.jsx`

Contact details form. Pre-populated from the authenticated Supabase user (`authUser.name`, `authUser.email`) when available.

**Fields:**
- Name * (required).
- Email * (required).
- Company (optional).
- Department (optional - shown for team mode).
- Job title (optional).
- Team size (radio: 1-10, 11-50, 51-200, 201-500, 500+).
- Industry (dropdown: Technology, Finance, Healthcare, etc.).

Two-step submit confirmation: first click → "Confirm and Generate"; second click → submits. Auto-resets after 5 seconds.

### Screen 6 - Complete

`components/diagnostic/screens/Screen6Complete.jsx`

Auto-submits and redirects. No placeholder resting state - shows "Generating your report..." with a spinner, then automatically redirects to `/report?id=...` via `router.push`. The user never sees a "Diagnostic Complete!" page.

---

## Authentication

### Auth Gate (`components/diagnostic/TeamAuthGate.jsx`)

Supabase Auth is required for:
- **Team Alignment** - sign in before accessing team setup.
- **Comprehensive Diagnostic** - sign in before the process definition chat.

The gate reuses `PortalAuth` (from `app/portal/PortalAuth.jsx`) with `getSupabaseClient()` from `lib/supabase.js`.

**Behaviour:**
1. On mount, checks for an existing Supabase session.
2. If already signed in → passes through silently (extracts `user.email` and `user.user_metadata.full_name`).
3. If not signed in → renders the sign-in/sign-up form with contextual subtitle.
4. On success → stores `{ name, email }` as `authUser` in `DiagnosticContext`.

**Auth user data flows to:**
- `ScreenTeam` - creator name/email sent to API (no duplicate fields).
- `Screen5YourDetails` - name/email pre-populated.
- `localStorage` - persisted in the save/restore cycle for session continuity.

**Environment variables required (client-side):**
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## User Experience & Navigation

### Progress Bar & Labels

`components/diagnostic/ProgressBar.jsx`

- Gradient progress bar at the top of every screen.
- Text: "Step X of N - Screen Name" (e.g. "Step 2 of 5 - Map Steps").
- Progress percentage calculated from index position within the active screen list.
- **Diagnostic Depth** score (formerly "Process Health") - a data-completeness percentage shown from screen 2 onward. Rewards granular data: step count, departments, handoffs, systems, cost data, cycle time, bottleneck, example name.

### Save & Get Link

- "Save & get link" button visible in the progress bar on **every** screen.
- Opens a modal to save progress to the cloud and get a resume URL.

### Navigation Bar

`components/diagnostic/DiagnosticNavContext.jsx`

- **Back** button on all screens.
- **Handover** button on screens 2 (Map Steps) and 4 (Cost & Impact) (opens the handover modal).
- **Continue →** button on all screens.
- Rendered as siblings to the progress bar to prevent overlap.

### Sharp - AI Chatbot Avatar

- Teal circular avatar with "S" letter, displayed on all assistant messages.
- Greeting: "Hello, I'm Sharp! I'll help you map your process and find where time and money are leaking."

---

## Core Features

### Three-Panel Step Mapping (Screen 2)

The map steps screen uses a flexible three-panel layout:
- **Panel 1** - AI Chat or Step Editor (pill toggle).
- **Panel 2** - Flow Preview (always visible).
- Column resize via drag handle between panels.
- Float/dock toggle per panel for undocked mode.

### Proactive AI Chatbot

After adding or updating steps, the AI proactively asks about:
1. Decision points and branch outcomes.
2. Department ownership.
3. Systems and tools used.
4. Handoff methods.
5. Approval requirements.

Asks about 1-2 steps at a time conversationally, not as a checklist.

### Drag-and-Drop File Upload

Users can drag Excel, images, PDFs, and other files directly into the AI chat panel. The AI extracts process steps from the uploaded content.

### Insert Steps Between Existing Steps

The step strip bar shows `+` buttons between each step pill, allowing users to insert new steps at any position in the flow.

### Flowchart Click Navigation

Clicking any node in the flow preview:
1. Switches to editor view if chat is active.
2. Expands the corresponding step in the editor.
3. Scrolls the step strip pill into view.

### Per-Step Save & Link

Each expanded step has a "Save & get link" button that:
1. Saves progress to cloud with the current step index.
2. Generates a resume URL: `/process-audit?resume=ID&step=N`.
3. Allows the user (or a colleague) to continue from that exact step.

### Intelligent Time & Cost Collection

Instead of asking users to guess hours directly, the chat flow:
1. Asks for start and end dates of the last example → parses natural language into `elapsedDays`.
2. Asks about actual hands-on work vs waiting → maps to `hoursPerInstance`.
3. Pre-fills the cost screen with these values; users can refine if needed.
4. Labels show "Sharp estimated Xh based on your answers - adjust if needed."

### Grounded Savings Calculation

Replaces arbitrary 50% savings with `estimateSavingsPercent()`:
- More departments → more handoff overhead → higher savings potential.
- Unclear handoffs → more rework → higher savings.
- Manual bottlenecks → more automatable → higher savings.
- Capped at 60%.

---

## Data Persistence & Resume

### Local Storage

- **Key:** `processDiagnosticProgress`
- **Auto-saves** on screen transitions and every 30 seconds.
- **Payload:** currentScreen, processData, completedProcesses, customDepartments, stepCount, diagnosticMode, teamMode, authUser, timestamp.
- **Resume:** Offered on page load if saved data exists and is less than 24 hours old.
- **Team-aware:** Team sessions (with `teamMode.code`) are resumable even from negative screen numbers.

### Resume Popup Logic

- Shows a toast: "You have saved progress from [date]. Continue / Start fresh."
- **Suppressed** when `?team=CODE` is in the URL and saved progress belongs to a different team (prevents looping to individual diagnostics).
- Cloud-resumed progress (`?resume=ID`) shows handover landing page if applicable.

### Handover Landing Page

When a recipient opens a handover link:
- Full-screen video background (same as marketing hero).
- Frosted glass card showing: sender name, process name, comments.
- "Accept & continue" / "Decline" buttons.

### Cloud Save (via `/api/progress`)

- **Save:** `POST /api/progress` with email, full state, optional step index, sender name, comments → returns `progressId` and `resumeUrl`.
- **Resume:** `GET /api/progress?id=<progressId>` → restores full state.
- Deep-links include `&step=N` to jump to a specific step in screen 2. URL format: `/process-audit?resume=ID&step=N`.

### Report Persistence (via `/api/send-diagnostic-report`)

- Completed reports saved to Supabase with unique `reportId`.
- Supports `POST` (new) and `PATCH` (update) via `editingReportId`.
- Viewable at `/report?id=<reportId>`.

---

## Flowchart Rendering

### Grid View (`buildGridSVG`)

- Serpentine layout (configurable columns based on step count).
- Department-coloured rounded rectangles; purple diamonds for decisions.
- Animated dashed arrows with flow particles.
- Automation badges (S = Simple, A = Agent, H = Human-in-Loop, M = Multi-Agent).
- Bottleneck highlighting, approval badges, unclear handoff indicators.
- `data-step-idx` attributes on nodes enable click-to-navigate.
- Branch routing:
  - Same-row adjacent: direct horizontal.
  - Same-row non-adjacent: routes through inter-row gap.
  - Forward cross-row: exits bottom of diamond.
  - Loop-back: exits top of diamond.
  - Labels positioned at diamond vertices with collision avoidance.

### Swimlane View (`buildSwimlaneSVG`)

- Horizontal lanes grouped by department.
- Steps placed in their department's lane.
- Decision diamonds with branch lines.
- Visual indicators for bottlenecks, approvals, unclear handoffs.

### View Switching

- Toggle buttons on the report page for Grid and Swimlane views.
- Zoom and pan controls on the flowchart container.

---

## Automation Classification

**Function:** `classifyAutomation(step, stepIdx, process)`

| Category | Badge | Colour | When Applied |
|----------|-------|--------|--------------|
| **Simple Automation** | S | Green | Notifications, data entry, system sync, status updates, report generation |
| **AI Agent** | A | Blue | Match/reconcile, schedule/prioritise, follow-up/chase, classify/triage |
| **Human-in-the-Loop** | H | Amber | Approvals, reviews, QA/audit, validation, escalations, exceptions |
| **Multi-Agent Orchestration** | M | Purple | Cross-dept with bad handoffs, multi-dept provisioning, cross-team coordination |

Feeds into the **Automation Readiness Score** in the report.

---

## AI Agent Architecture

All AI features use the **LangChain/LangGraph** framework with Anthropic Claude models. Prompts are centralized in `lib/prompts.js`. Model configuration is centralized in `lib/agents/models.js`. Tool schemas use **Zod**.

### Framework Stack

| Package | Version | Purpose |
|---------|---------|---------|
| `@langchain/core` | ^1.1.29 | Base message types, tool primitives |
| `@langchain/anthropic` | ^1.3.21 | `ChatAnthropic` model wrapper |
| `@langchain/langgraph` | ^1.2.0 | `StateGraph`, `Annotation`, `ToolNode` for agent graphs |
| `zod` | ^4.3.6 | Tool input schema validation |

### Model Tiers

Two model tiers are configured in `lib/agents/models.js`:

| Tier | Model | Max Tokens | Temperature | Used For |
|------|-------|-----------|-------------|----------|
| **Fast** | `claude-haiku-4-5-20251001` | 4096 | 0.3 (default) | Chat, recommendations, team analysis, survey analysis, redesign summarizer |
| **Deep** | `claude-sonnet-4-20250514` | 8192 | 0 | Redesign planner and repair |

Factory functions `getFastModel(overrides)` and `getDeepModel(overrides)` create instances with optional temperature/token overrides.

### Shared Persona

All system prompts share a common identity defined in `lib/prompts.js`:

```
You are Vesno's AI operating-model consultant - concise, expert, and actionable.
```

The chat agent uses a separate persona: "Sharp, a friendly process mapping assistant."

---

### Agent 1: Redesign Agent (Tool-Calling)

**Files:** `lib/agents/redesign/graph.js`, `lib/agents/redesign/tools.js`
**API route:** `POST /api/generate-redesign` (`maxDuration: 60`)
**Model:** Deep (Sonnet) for planner/repair, Fast (Haiku) for summarizer

**Architecture:** Single-pass tool-calling with programmatic validation and repair.

```
User request
    │
    ▼
┌─────────────────────────┐
│  PLANNER (Deep model)   │  ← bindTools(3 tools)
│  Single LLM call makes  │
│  ALL tool calls at once │
└───────────┬─────────────┘
            │ extract tool_calls args
            ▼
┌─────────────────────────┐
│  VALIDATE (programmatic)│  ← validateRedesign()
│  Check step counts,     │
│  handoff counts, cost   │
│  summary consistency    │
└───────────┬─────────────┘
     ┌──────┴──────┐
     │valid        │invalid
     ▼             ▼
     │    ┌─────────────────┐
     │    │  REPAIR (Deep)  │  ← One retry with error context
     │    └────────┬────────┘
     │             │ merge corrections
     ├─────────────┘
     ▼
┌─────────────────────────┐
│  SUMMARIZER (Fast model)│  ← Generates executiveSummary +
│  Single LLM call        │    implementationPriority
└───────────┬─────────────┘
            ▼
     Return redesign JSON
```

**Tools (Zod-validated):**

| Tool | Description | Schema |
|------|-------------|--------|
| `optimize_process` | Submit full optimised step list for one process. All original steps included; removed steps marked `status: "removed"`. Handoffs = active steps - 1. | `{ processName, steps[], handoffs[] }` |
| `record_change` | Log a single modification (removal, automation, merge, etc.) with time/cost estimates. | `{ process, stepName, type, description, estimatedTimeSavedMinutes, estimatedCostSavedPercent }` |
| `calculate_cost_summary` | Aggregate step counts and savings percentages across all processes. Must be consistent with recorded changes. | `{ originalStepsCount, optimisedStepsCount, stepsRemoved, stepsAutomated, estimatedTimeSavedPercent, estimatedCostSavedPercent }` |

**System prompt (Planner):**

```
You are Vesno's AI operating-model consultant. You redesign business processes
by analyzing diagnostic data and producing optimised process flows.

You have tools to build the redesign. In a SINGLE response, make ALL required tool calls:
1. Call optimize_process ONCE per process.
2. Call record_change for EVERY modification. Do not skip any.
3. Call calculate_cost_summary ONCE at the end.

Rules:
- Include ALL original steps, marking removed ones with status "removed".
- Active steps are those with status != "removed".
- The handoffs array must have exactly (active steps count - 1) entries.
- Time and cost estimates must be realistic and grounded in the diagnostic data.
- Preserve domain-specific terminology from the original steps.
```

**User prompt:** `"Here is the diagnostic data for this organisation:\n\n{diagnosticContext}\n\nRedesign the operating model. Make ALL tool calls in a single response."`

**System prompt (Summarizer):**

```
You are Vesno's AI operating-model consultant. Given a completed redesign, produce:
1. An executive summary (2-3 sentences covering the key improvements)
2. An implementation priority list (3-6 concrete actions, ordered by impact)

Return ONLY valid JSON: { "executiveSummary": "...", "implementationPriority": ["...", "..."] }
```

**Validation rules (`validateRedesign`):**
- Every process must have optimised steps.
- Handoff count must equal active steps minus one per process.
- Modified steps must have corresponding change records.
- `costSummary` counts must match actual step totals.

**Output shape:** `{ executiveSummary, optimisedProcesses[], changes[], costSummary, implementationPriority[] }`

---

### Agent 2: Chat Agent - Sharp (LangGraph StateGraph)

**Files:** `lib/agents/chat/graph.js`, `lib/agents/chat/tools.js`
**API route:** `POST /api/diagnostic-chat` (`maxDuration: 60`)
**Model:** Fast (Haiku), temperature 0.3

**Architecture:** LangGraph `StateGraph` with agent + `ToolNode` loop.

```
┌──────────┐
│ __start__│
└────┬─────┘
     ▼
┌──────────┐    tool_calls    ┌──────────┐
│  agent   │ ───────────────▶ │  tools   │
│ (LLM)   │ ◀─────────────── │(ToolNode)│
└────┬─────┘   tool results   └──────────┘
     │ no tool_calls
     ▼
┌──────────┐
│ __end__  │
└──────────┘
```

**State:** `ChatState` with `messages[]` (append reducer) and `systemPrompt` (replace reducer).

**Tools (Zod-validated):**

| Tool | Description |
|------|-------------|
| `add_step` | Add a new step (name, department, isDecision, systems, branches, afterStep) |
| `update_step` | Update step properties by number (partial update) |
| `remove_step` | Remove a step by number |
| `set_handoff` | Set handoff method and clarity between consecutive steps |
| `add_custom_department` | Add a department to the picklist |
| `replace_all_steps` | Replace the entire step list (bulk creation) |

Tools return confirmation strings. Actual state mutation happens client-side - the API returns `{ reply, actions[] }` and the client's `processActions()` callback applies each action to local React state.

**System prompt (dynamic, built per request):**

```
You are Sharp, a friendly process mapping assistant helping build a step-by-step
flow for "{processName}".

CURRENT STEPS:
{stepsDesc}

[Guidelines for tool use, proactive detail gathering, conversational style...]
```

The system prompt includes the current step list, handoff details, and any incomplete step information so the agent has full context for each turn.

**User prompt:** The user's chat message, optionally with image/file attachments.

---

### Single-Shot LLM Calls (Non-Agentic)

Three features use `ChatAnthropic.invoke()` directly (no graph, no tools):

#### Recommendations (`/api/process-diagnostic`)

| | |
|---|---|
| **Model** | Fast (Haiku), temperature 0.5 |
| **System prompt** | `"{PERSONA} Analyse business processes and produce specific, prioritised recommendations. Return ONLY a JSON array."` |
| **User prompt** | Process descriptions with step lists, durations, frequencies, costs → asks for 3-6 JSON recommendations. |
| **Output** | `[{ process, type, text }]` |
| **Fallback** | Rule-based `generateRuleBasedRecommendations()` if AI fails. |

#### Team Alignment Analysis (`/api/team?action=analyze`)

| | |
|---|---|
| **Model** | Fast (Haiku), temperature 0.4 |
| **System prompt** | `"{PERSONA} Analyse team alignment exercises... Identify root causes of misalignment..."` |
| **User prompt** | Respondent summaries (name, department, step count, elapsed days, handoff count) + consensus score. |
| **Output** | `{ executiveSummary, rootCauses[], hiddenInefficiencies[], recommendations[], alignmentActions[] }` |
| **Fallback** | `buildRuleBasedAnalysis()` if AI fails. |

#### Survey Workflow Analysis (`/api/survey-submit`)

| | |
|---|---|
| **Model** | Fast (Haiku), temperature 0.5 |
| **System prompt** | `"{PERSONA} Analyse workflow survey data and produce structured insights with estimated savings."` |
| **User prompt** | Workflow summaries with step counts, elapsed time, work/wait percentages. |
| **Output** | `{ summary, keyFindings[], bottlenecks[], recommendations[], estimatedSavings }` |
| **Fallback** | Returns `null` (analysis skipped) if AI fails. |

---

### Prompt Management

All prompt text is centralized in `lib/prompts.js`:

| Export | Used By |
|--------|---------|
| `redesignSystemPrompt()` | (Legacy - kept for reference. Active redesign uses agent-specific prompts in `lib/agents/redesign/graph.js`) |
| `redesignUserPrompt(context)` | (Legacy) |
| `chatSystemPrompt({ processName, stepsDesc, incompleteBlock })` | Chat agent (`lib/agents/chat/graph.js`) |
| `recommendationsSystemPrompt()` | `/api/process-diagnostic` |
| `recommendationsUserPrompt(processDescriptions)` | `/api/process-diagnostic` |
| `teamAnalysisSystemPrompt()` | `/api/team` |
| `teamAnalysisUserPrompt({ processName, responseCount, consensusScore, respondentSummaries })` | `/api/team` |
| `surveyAnalysisSystemPrompt()` | `/api/survey-submit` |
| `surveyAnalysisUserPrompt(workflowSummaries)` | `/api/survey-submit` |

### File Reference (AI Agents)

| File | Purpose |
|------|---------|
| `lib/agents/models.js` | Shared `ChatAnthropic` factory functions (`getFastModel`, `getDeepModel`) |
| `lib/agents/redesign/graph.js` | Redesign agent: planner + validation + repair + summarizer |
| `lib/agents/redesign/tools.js` | 3 LangChain tools (`optimize_process`, `record_change`, `calculate_cost_summary`) + `validateRedesign()` |
| `lib/agents/redesign/state.js` | LangGraph `Annotation.Root` state schema (legacy - from initial multi-node graph, retained for reference) |
| `lib/agents/chat/graph.js` | Chat agent: LangGraph `StateGraph` with agent + `ToolNode` loop |
| `lib/agents/chat/tools.js` | 6 LangChain tools (`add_step`, `update_step`, `remove_step`, `set_handoff`, `add_custom_department`, `replace_all_steps`) |
| `lib/agents/workflow-export/` | Workflow export: N8N JSON, Unqork definition, platform-specific instructions |
| `lib/prompts.js` | Centralized system/user prompt definitions for all AI features |

### Environment Variables (AI)

| Variable | Required | Purpose |
|----------|----------|---------|
| `ANTHROPIC_API_KEY` | Yes | Authenticates all LLM calls via `@langchain/anthropic` |

---

## Report Generation & Export

### Pipeline

1. Client collects all process data.
2. Submits to `POST /api/process-diagnostic` with processes, contact info, quality score.
3. API computes per-process quality, generates AI recommendations (Claude) or rule-based fallback.
4. Optionally triggers n8n webhook for flow diagram generation.
5. Returns analysis with recommendations, flow diagram URL.
6. Client renders results locally if API fails (graceful fallback via `buildLocalResults()`).

### Cycle Time

Derived from chat-collected date range (`lastExample.elapsedDays`), not arbitrary input. Displayed as "X days" in the report.

### Savings

Calculated per-process using `estimateSavingsPercent()` based on actual process characteristics, not a fixed percentage.

### Export Formats

| Format | Description |
|--------|-------------|
| **CSV** | Tabular data export |
| **Notion Markdown** | Formatted for pasting into Notion |
| **JSON** | Raw data export |
| **BPMN** | Standard BPMN XML with tasks, gateways, sequence flows |

### Workflow Automation Exports (Post-Redesign)

After the user **accepts** the redesigned operating model, a **Build this** button appears on the dashboard and report. This leads to `/build?id=REPORT_ID` - a page with integration tiles for each supported platform.

| Platform | Output | Use Case |
|----------|--------|----------|
| **N8N** | Valid N8N workflow JSON | Import into n8n for a proof-of-concept: Manual Trigger → Set nodes (one per step). |
| **Unqork** | Unqork workflow definition JSON | Build guide for Unqork Workflow Builder: Start → Task nodes → End, swimlanes. |
| **Make** | Scenario build guide JSON | Structured guide for Make scenarios: trigger + modules per step. |
| **Zapier** | Zap build guide JSON | Trigger + actions per step, suggested apps. |
| **Power Automate** | Flow build guide JSON | Trigger + actions per step, suggested connectors. |
| **Pipedream** | Workflow build guide JSON | Trigger + steps per action, suggested components. |

- **API:** `POST /api/generate-workflow-export` with `{ reportId, platform }`
- **Agent:** `lib/agents/workflow-export/` - deterministic generators (no LLM)
- **UI:** `/build` page with tiles; "Build this" on dashboard (when redesign accepted) and in report finalised banner

---

## Team Alignment

Formerly "Team Diagnostics" - renamed throughout the application.

### Flow

1. Creator selects "Team Alignment" → signs in via Supabase auth gate.
2. Creates a session: selects process, enters company name. Creator identity comes from auth.
3. Shares the team code (6-character) with colleagues.
4. Each team member signs in, joins by code, and independently maps the process.
5. AI compares all responses to reveal perception gaps.

### APIs

| Action | Endpoint | Method |
|--------|----------|--------|
| Create session | `/api/team?action=create` | POST |
| Get session info | `/api/team?action=info&code=CODE` | GET |
| Submit response | `/api/team?action=submit` | POST |
| Get results | `/api/team?action=results&code=CODE` | GET |
| AI analysis | `/api/team?action=analyze` | POST |

### Deduplication

- **Submit:** Upsert logic - checks for existing response by email (or name). Updates if found, inserts if new.
- **Results:** Client-side deduplication keeps only the most recent response per respondent.

### Results Page

`/team-results` - standalone HTML page showing:
- Team consensus score with progress bar.
- Respondent cards with avatars.
- Aggregated metrics.
- Perception gaps with warning indicators.
- AI-generated analysis.

---

## Handover

### Flow

1. User clicks "Handover" in the nav bar on screen 2 (Map Steps) or screen 4 (Cost & Impact).
2. Modal opens: recipient email, sender name, comments.
3. Saves progress to cloud with current step index and handover metadata.
4. Generates URL: `/process-audit?resume=ID&step=N`.
5. Optionally sends email via n8n webhook.
6. Recipient opens link → sees full-screen video landing page with sender info.
7. Accepts → resumes at the exact step where handover was initiated.

### Handover Modal

- Sender name and comments fields.
- Recipient email for auto-delivery.
- "Copy link" button for manual sharing.
- Success state shows the generated URL.

### Handover Landing

- Full-screen video background (`/videos/hero-bg.mp4`).
- Dark overlay with frosted glass card.
- Shows: sender name, process name, comments.
- "Accept & continue" and "Decline" buttons.

---

## Database Schema

```
┌─────────────────────────┐       ┌─────────────────────────┐
│   diagnostic_progress   │       │   diagnostic_reports    │
│  (in-progress drafts)   │──────▶│  (completed reports)    │
│                         │submit │                         │
│  id, email, progress_   │       │  id, contact_email,     │
│  data, created_at,      │       │  contact_name, company, │
│  updated_at             │       │  lead_score, lead_grade,│
│                         │       │  diagnostic_data (JSON),│
│  API: /api/progress     │       │  created_at, updated_at │
└─────────────────────────┘       │                         │
                                  │  APIs: /api/save-diag,  │
                                  │  /api/get-diagnostic,   │
                                  │  /api/get-dashboard,    │
                                  │  /api/generate-redesign │
                                  └─────────────────────────┘

┌─────────────────────────┐       ┌─────────────────────────┐
│   team_diagnostics      │       │   team_responses        │
│  (team sessions)        │──1:N─▶│  (member submissions)   │
│                         │       │                         │
│  id, team_code,         │       │  id, team_id,           │
│  created_by_email,      │       │  team_code,             │
│  created_by_name,       │       │  respondent_name,       │
│  process_name, company, │       │  respondent_email,      │
│  description, status,   │       │  respondent_department, │
│  created_at             │       │  response_data (JSON),  │
│                         │       │  created_at             │
│  API: /api/team         │       │                         │
│  (?action=create)       │       │  API: /api/team         │
│                         │       │  (?action=submit)       │
└─────────────────────────┘       └─────────────────────────┘

┌─────────────────────────┐
│   process_instances     │
│  (live process tracking)│
│                         │
│  Tracks individual      │
│  running instances of   │
│  mapped processes       │
└─────────────────────────┘
```

### Table Reference

| Table | Purpose | Key APIs |
|-------|---------|----------|
| `diagnostic_progress` | Mid-session state for resume and handover | `GET/POST /api/progress` |
| `diagnostic_reports` | Completed reports with full JSON data | `/api/send-diagnostic-report`, `/api/get-diagnostic` |
| `team_diagnostics` | Team alignment sessions (code, process, status) | `POST /api/team?action=create` |
| `team_responses` | Individual team member perspectives (upsert) | `POST /api/team?action=submit` |
| `process_instances` | Live running instances of mapped processes | `/api/process-instances` |

### Data Flow

```
User starts diagnostic
        │
        ├──▶ Auto-save every 30s ──▶ localStorage (processDiagnosticProgress)
        │                            includes: teamMode, authUser, screen, data
        │
        ├──▶ Cloud save (optional) ──▶ diagnostic_progress
        │                              includes: step index, handover metadata
        │
        └──▶ Submit final report ──▶ diagnostic_reports
                                          │
                                          ├──▶ Portal: View / Edit
                                          ├──▶ Dashboard: /api/get-dashboard
                                          └──▶ AI Redesign: /api/generate-redesign
```

---

## File Reference

| File | Purpose |
|------|---------|
| `app/process-audit/page.jsx` | Route entry point (`/process-audit`) |
| `app/process-audit/layout.jsx` | Layout + diagnostic CSS import |
| `components/diagnostic/DiagnosticClient.jsx` | Top-level client component, resume logic, auth gate for `?team=` URLs |
| `components/diagnostic/DiagnosticContext.jsx` | Central state: reducer, save/restore, cloud save, authUser |
| `components/diagnostic/IntroChatScreen.jsx` | Screen 0: Sharp chat, path/mode selection, auth gate triggers |
| `components/diagnostic/TeamAuthGate.jsx` | Supabase auth wrapper for team + comprehensive flows |
| `components/diagnostic/GuidedChatScreen.jsx` | Screen 1: guided chat for team flow |
| `components/diagnostic/screens/Screen2MapSteps.jsx` | Screen 2: three-panel step mapping |
| `components/diagnostic/screens/Screen4Cost.jsx` | Screen 4: cost & impact (comprehensive) |
| `components/diagnostic/screens/Screen5YourDetails.jsx` | Screen 5: contact details (pre-filled from auth) |
| `components/diagnostic/screens/Screen6Complete.jsx` | Screen 6: auto-submit and redirect |
| `components/diagnostic/screens/ScreenTeam.jsx` | Screen -2: team creation/joining |
| `components/diagnostic/ProgressBar.jsx` | Progress bar + diagnostic depth + save button |
| `components/diagnostic/DiagnosticNavContext.jsx` | Nav bar: Back, Handover, Continue |
| `components/diagnostic/ChatPanel.jsx` | Floating AI chat widget (non-screen-2) |
| `components/diagnostic/SaveProgressModal.jsx` | Cloud save modal |
| `lib/diagnostic/guidedPrompts.js` | Chat prompt definitions |
| `lib/diagnostic/constants.js` | Screen labels, phases, screen lists |
| `lib/diagnostic/handoffOptions.js` | Handoff methods and clarity options |
| `lib/diagnostic/buildLocalResults.js` | Client-side fallback report builder |
| `lib/flows/grid.js` | Grid flowchart SVG renderer |
| `lib/flows/swimlane.js` | Swimlane flowchart SVG renderer |
| `public/styles/diagnostic.css` | All diagnostic-specific styles |
| `app/globals.css` | Global styles and CSS variables |
| `app/api/diagnostic-chat/route.js` | AI chat API (Anthropic) |
| `app/api/progress/route.js` | Cloud save/resume API |
| `app/api/process-diagnostic/route.js` | Report generation API |
| `app/api/team/route.js` | Team alignment CRUD + analysis |
