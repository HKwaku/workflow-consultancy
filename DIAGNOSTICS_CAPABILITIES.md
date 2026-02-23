# Diagnostics Flow - Capabilities Document

> **Last updated:** 2026-02-22
> This document describes every screen, feature, and capability of the diagnostic tool in `diagnostic.html`. It should be updated whenever changes are made to the diagnostics flow.

---

## Table of Contents

1. [Client Journey Paths](#client-journey-paths)
2. [Flow Overview](#flow-overview)
3. [Screen-by-Screen Breakdown](#screen-by-screen-breakdown)
4. [User Experience & Navigation](#user-experience--navigation)
5. [Core Features](#core-features)
6. [Data Persistence & Resume](#data-persistence--resume)
7. [Flowchart Rendering](#flowchart-rendering)
8. [Automation Classification](#automation-classification)
9. [Report Generation & Export](#report-generation--export)
10. [Team Diagnostics](#team-diagnostics)
11. [Handover](#handover)
12. [Database Schema](#database-schema)

---

## Client Journey Paths

Six distinct paths through the diagnostic tool, each touching different screens, APIs, and database tables.

```
                                ┌─────────────────┐
                                │   Welcome Page   │
                                │    (screen 0)    │
                                └────────┬────────┘
                   ┌─────────────────────┼─────────────────────┐
                   │                     │                     │
                   ▼                     ▼                     ▼
        ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
        │  START DIAGNOSTIC │  │  TEAM DIAGNOSTIC  │  │  RESUME / LOAD   │
        │   (Individual)    │  │  (Collaborative)  │  │  (Saved Draft)   │
        └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘
                 │                     │                     │
                 ▼                     ▼                     │
        ┌──────────────────┐  ┌──────────────────┐           │
        │ Screens 1 → 17   │  │  Team Setup       │           │
        │ Define, Measure,  │  │  Create session   │           │
        │ Map, Assess,      │  │  Share team code  │           │
        │ Quantify          │  └────────┬─────────┘           │
        │                   │           │                     │
        │  ┌──────────┐    │           ▼                     │
        │  │ HANDOVER  │◄───┤  ┌──────────────────┐           │
        │  │ (screen 7)│    │  │ Team Members Join │           │
        │  │ Save &    │    │  │ Each completes    │           │
        │  │ share link│    │  │ their own view    │           │
        │  └─────┬─────┘    │  │ of the process    │           │
        │        │          │  └────────┬─────────┘           │
        │        ▼          │           │                     │
        │  Colleague        │           ▼                     │
        │  resumes from     │  ┌──────────────────┐           │
        │  screen 7         │  │ Gap Analysis &    │           │
        │                   │  │ Team Results      │           │
        └────────┬─────────┘  └──────────────────┘           │
                 │                                            │
                 ▼                                            │
        ┌──────────────────┐                                  │
        │ Contact Details   │                                  │
        │ (screen 18)       │                                  │
        └────────┬─────────┘                                  │
                 │                                            │
                 ▼                                            │
        ┌──────────────────┐                                  │
        │ Results & Report  │◄─────────────────────────────────┘
        │ (screen 19)       │
        │                   │
        │ Flowcharts, AI    │
        │ recommendations,  │
        │ roadmap, exports  │
        └────────┬─────────┘
                 │
        ┌────────┴─────────────────────────┐
        │                                  │
        ▼                                  ▼
┌──────────────────┐            ┌──────────────────┐
│  PORTAL: View    │            │  PORTAL: Edit    │
│  Read-only report│            │  Re-enter from   │
│  with PDF export │            │  screen 7 with   │
│                  │            │  original data    │
└──────────────────┘            └──────────────────┘
```

### Path Summary

| # | Path | Entry Point | Key Screens | Database Tables |
|---|------|-------------|-------------|-----------------|
| 1 | **New Individual Diagnostic** | Welcome → Start Diagnostic | 0 → 1–17 → 18 → 19 | `diagnostic_progress` (mid-session), `diagnostic_reports` (on submit) |
| 2 | **Team Diagnostic** | Welcome → Start Team | 0 → Team Setup → Members join | `team_diagnostics` (session), `team_responses` (each submission) |
| 3 | **Resume Saved Draft** | Welcome → Resume | 0 → last saved screen → continue | `diagnostic_progress` (read), then path 1 continues |
| 4 | **View Report** | Portal → View | 19 (read-only) | `diagnostic_reports` (read) |
| 5 | **Edit Report** | Portal → Edit | 7 → 17 → 18 → 19 | `diagnostic_reports` (read + write) |
| 6 | **Handover** | Screen 7 → Hand over | 7 (save) → colleague resumes at 7 | `diagnostic_progress` (write + read) |

---

## Flow Overview

The diagnostic tool guides users through a structured assessment of one or more business processes. It collects data across 20 screens, produces a comprehensive analysis report with flowchart visualisation, automation readiness scoring, cost projections, and a 90-day improvement roadmap.

**High-level flow:**

```
Welcome (screen0)
  → Process Selection (screen1)
    → Process Definition (screens 2–6)
      → Step Breakdown & Mapping (screens 7–9)
        → Systems, Approvals, Knowledge (screens 10–13)
          → Volume & Cost (screens 14–16)
            → Priority & Dependencies (screen17, dependencyMapping)
              → Contact Details (screen18)
                → Results & Report (screen19)
```

Users can loop back to add more processes (from screen17) before viewing final results.

---

## Screen-by-Screen Breakdown

### Screen 0 - Welcome
- Landing page with a readiness checklist.
- Two entry points: **Start Diagnostic** (standard) or **Start a Team Diagnostic** (collaborative).
- Option to resume a saved draft or load a report by ID.

### Screen Team - Team Diagnostic Setup
- Full-page setup (not a modal) matching the standard screen layout.
- Select a process from a grid of templates or enter a custom one.
- Enter company name, creator name, and email.
- **Create session** via `/api/team?action=create` - returns a team code and shareable join link.
- **Join session** by entering a team code.

### Screen 1 - Process Selection
- Grid of 9 pre-defined process templates (e.g., Invoice Processing, Employee Onboarding).
- Option to type a custom process name.
- Single-select; highlights chosen card.

### Screen 2 - Name Your Process
- Free-text input to name the specific instance of the process.
- Pre-filled from the template chosen in screen 1 (editable).

### Screen 3 - Define Process Boundaries
- **Starts when**: Free text describing what triggers the process.
- **Completes when**: Free text describing what constitutes completion.
- **Complexity**: Radio group with 4 levels (Straightforward → Complex multi-path).
- **Departments involved**: Checkbox grid of 8 standard departments + custom entry.

### Screen 4 - Last Real Example
- Name of the last real instance of this process.
- Start date, end date (date pickers).
- Calculated elapsed days displayed automatically.

### Screen 5 - Your Time Investment
Structured inputs replacing vague "how many hours" questions:
- **Meetings**: Radio (None / 1–2 / 3–5 / 6+) → mapped to hour values.
- **Emails & messages**: Radio (None / 1–5 / 6–15 / 16+) → mapped to hour values.
- **Execution level**: Radio (Mostly waiting / Some active work / Heavy execution / Constant involvement).
- **Waiting portion**: Radio (Minimal / Some / Significant / Mostly waiting).
- **Rework level**: Radio (None / Minor / Moderate / Major).
- Total hours auto-calculated from selections.

### Screen 6 - Performance Assessment
- **Typical timing**: Radio (Faster than target / On target / Slower / Much slower).
- **Issues encountered**: Checkbox list of 11 common issues (unclear handoffs, waiting for approvals, manual data entry, etc.) + free-text "Other".
- **Biggest delay**: Dropdown auto-populated from checked issues.
- **Delay details**: Free text for specifics.

### Screen 7 - Step Breakdown
The most feature-rich screen. Users build the process step-by-step.

**Contextual guidance:**
- A blue tip box at the top reads: "Start by listing the major steps in order. You can add details, decisions, and branches later."
- The import section is collapsed behind a toggle link ("Have a process map or step list? Import it") to reduce initial cognitive load.
- The decision toggle on each step is hidden until the step has a name entered (progressive disclosure).

**Per step:**
- Step name (text input).
- Department (select with 17+ options, including custom departments from screen 3).
- Internal / External radio toggle.
- **Decision toggle**: Checkbox to mark a step as a decision/routing point (visible only after step name is entered).
  - When checked, shows branch rows with label + target inputs.
  - "Add another route" button for 3+ branches.
  - Targets resolved by step number ("Step 5") or name match.

**Step management:**
- **Add step** button, **Insert before first** button, **Insert after** button on each step.
- **Remove step** button on each step.
- **Drag-and-drop reordering** via drag handle (grip icon).
- Step numbers auto-renumber after any change.
- Minimum 3 steps, maximum 50.

**Import (collapsed by default):**
- **Upload file**: Drag-and-drop or click to upload an image (PNG, JPG, GIF, WebP) or PDF (≤10 MB). Sent to `/api/analyze-symptoms` with mode `extract-steps`. AI extracts steps automatically.
- **Paste text**: Paste a process description; AI extracts steps from text.
- **AI suggestions**: After 3+ steps, an AI can suggest missing steps as clickable chips.

**Handover button:**
- "Hand over to colleague" button in the action bar with explanatory hint: "Don't know all the steps? Send to a colleague to continue."

**Live Flow Preview:**
- Toggle "Show Live Flow Preview" to see an SVG flowchart built in real time.
- Updates on every step name, department, decision toggle, branch edit, reorder, add, or remove.
- Uses serpentine grid layout matching the final report renderer.
- Decision nodes rendered as diamonds with colour-coded branch arrows.
- All branch routes go through inter-row gaps (not margins); labels at diamond tips.
- Text wraps within nodes (up to 3 lines) to prevent overflow.
- Branch labels rendered as pills on their path.

**Process Health Score:**
- A progress bar visible from screen 7 onward.
- Score based on recency, detail, handoff clarity, system coverage, etc.

### Screen 8 - Handoff Analysis
For each transition between consecutive steps:
- **Method**: Radio group (Email, Chat, In-person, System notification, Shared document, Phone, Other).
- **Clarity**: Radio group (Clear first time / Sometimes unclear / Often unclear with rework / Major breakdowns).

### Screen 9 - Bottleneck Identification
- **Longest step**: Dropdown populated from step list.
- **Why it takes longest**: Radio (Waiting for someone, Manual data work, Approval delays, System limitations, Knowledge gaps, Coordination overhead, Compliance requirements, Other).
- **Biggest bottleneck**: Dropdown of all steps.

### Screen 10 - Systems & Tools
Dynamic list of systems used in the process:
- System name.
- Purpose description.
- Action checkboxes: Read, Copy out, Copy in, Reconcile.

### Screen 11 - Approvals & Decisions
- **Number of approvals** (0–10 selector).
- Per approval: Name, approver, number of rounds, assessment (rubber stamp → substantial review).

### Screen 12 - Knowledge & Documentation
- Where someone looks first for help (radio: documented procedure, ask colleague, figure it out, check system).
- Who they ask (radio: specific person, anyone in team, manager, external).
- Impact if that person is on vacation (radio: no impact → process stops).
- Time to get an answer (radio: minutes to days+).

### Screen 13 - New Hire Reality
- How new hires learn (checkbox: shadow, written guide, trial & error, formal training, video, mentor, self-service, other).
- Time to competence (radio: days to 6+ months).
- What they struggle with most (free text).

### Screen 14 - Frequency & Volume
- **Frequency**: Radio (Multiple times daily → Quarterly or less).
- **Annual instances**: Auto-calculated from frequency, editable.
- **Currently in-flight**: Number input.
- **Progressing normally**: Number input.
- **Stuck / delayed**: Number input.
- **Waiting for external**: Number input.

### Screen 15 - Cost Calculation
- **Hourly rate** (£/$/€): Number input.
- Auto-calculated per-instance cost (hours × rate).
- Auto-calculated annual cost (instances × per-instance cost).

### Screen 16 - Team Cost & Savings
- **Team size** working on this process.
- **Total annual team cost** (calculated).
- **"50% faster" savings** projection.
- **Expected impact** (radio: 10% → 50%+ time savings).
- **What would you do with saved time?** (checkboxes: more throughput, quality, new initiatives, reduce overtime, training, customer focus, other).

### Screen 17 - Priority Assessment
- **Priority level** (radio: Critical → Low).
- **Why this priority** (free text).
- **Analyse another process?** (radio: Yes / No). If "Yes", loops back to screen 1 for the next process.

### Dependency Mapping (between screens 17 and 18)
- Shown when 2+ processes have been assessed.
- For each pair of processes, user selects: A blocks B / B blocks A / Shared resource bottleneck / No dependency.
- Produces a dependency graph in the report.

### Screen 18 - Contact Details
- Name, email, company, job title.
- Industry (select: Technology, Financial Services, Healthcare, Manufacturing, Retail, Professional Services, Government, Education, Other).
- Team size (radio: 1–5 → 200+).
- **Two-step submit confirmation**: First click changes button to "Confirm and Generate" with a pulsing highlight; second click submits. Auto-resets after 5 seconds if the user doesn't confirm.

### Screen 19 - Results & Report
Final analysis output with multiple sections:

- **Process summary cards** for each assessed process.
- **AI or rule-based recommendations** (collapsible sections).
- **Automation Readiness Score** - percentage gauge built from step classifications.
- **Flowchart diagrams** - Grid and Swimlane views, togglable.
- **90-Day Improvement Roadmap** - phased action plan.
- **ROI Projection Calculator** - interactive sliders.
- **Process Dependency Graph** (if multiple processes).
- **Edit buttons** on each section to go back and modify data.

---

## User Experience & Navigation

### Progress Bar & Phase Labels
- A gradient progress bar at the top of every screen shows completion percentage.
- Text reads "Step X of 18 - Phase: Screen Name" (e.g., "Step 5 of 18 - Measure: Time Investment").
- Below the bar, five phase dots provide a mental map of the journey:
  - **Define** (screens 1–3): Process selection and boundaries.
  - **Measure** (screens 4–6): Real example, time, and performance data.
  - **Map** (screens 7–9): Step breakdown, handoffs, and bottlenecks.
  - **Assess** (screens 10–13): Systems, approvals, knowledge, new hire experience.
  - **Quantify** (screens 14–18): Volume, cost, savings, priority, and contact.
- Active phase is highlighted; completed phases are struck through.
- Phase dots are hidden on the welcome (screen 0) and results (screen 19) screens.

### Contextual Helper Text
Every screen includes a "why this matters" helper line connecting the question to the analysis value:
- Screen 8: Defines what a "handoff" is and why handoff delays matter.
- Screen 9: "The step where time stalls most reveals your highest-impact improvement opportunity."
- Screen 10: "Knowing which systems are involved helps identify integration and automation opportunities."
- Screen 11: "Approval bottlenecks are one of the top causes of process delays."
- Screen 12: "How people find answers reveals whether your process relies on documentation or on specific people."
- Screen 13: "How fast new hires ramp up reveals how well the process is documented and transferable."
- Screen 14: "Volume drives the business case - even small per-instance savings compound dramatically."
- Screen 15: "Putting a real number on process cost makes the case for improvement tangible."
- Screen 16: "Your time is just part of the picture. The full team cost reveals the true organisational impact."
- Screen 17: "Your assessment helps us focus recommendations on what matters most to you right now."

### Soft Validation Nudges
Screens without hard validation requirements (8, 9, 10, 11, 12, 13, 15, 16, 17) show a gentle nudge when the user clicks Continue without entering data:
- Message: "Skipping this? Your analysis will be more accurate with this data."
- Two buttons: "Skip anyway" (proceeds) and "Fill it in" (dismisses the nudge).
- Once dismissed for a screen, the nudge does not appear again for that screen.

### Navigation
- **Back**: "← Back" button on every screen (consistent label).
- **Continue**: "Continue →" on screens 1–17.
- **Submit**: "Generate My Analysis →" on screen 18 with two-step confirmation.
- **Transitions**: Fade-in animation (0.3s ease with translateY) and smooth scroll to top.

### Time Estimate
- Welcome screen displays: "Evidence-based workflow analysis. 12–15 minutes per process."
- Screen 17 reminds: "You can analyse up to 3 processes total. Each takes about 12–15 minutes."

---

## Core Features

### Drag-and-Drop Step Reordering
- Each step has a grip handle (visible at 25% opacity, full on hover).
- `mousedown`/`touchstart` on the handle enables dragging.
- Steps can be reordered freely; insert dividers appear between steps during drag.
- `dragend` resets the handle flag; renumbers all steps.

### Decision Nodes & Branching
- Any step can be toggled as a decision point.
- Two default branch rows (expandable to any number).
- Branch targets resolve by step number or partial name match.
- Decision nodes suppress sequential arrows - branch arrows handle outgoing connections.

### Live Flow Preview (Screen 7)
- Real-time SVG rendering as users add/edit steps.
- Serpentine grid layout (odd rows reverse direction).
- Department-coloured nodes; diamond shapes for decisions.
- Branch arrow routing (all routes use inter-row gaps, not margins):
  - **Same-row adjacent**: Direct horizontal line from diamond side to target side.
  - **Same-row non-adjacent**: Routes through gap above the row.
  - **Forward cross-row**: Exits BOTTOM of diamond, routes through gap below source row.
  - **Loop-back**: Exits TOP of diamond, routes through gap above source row.
- Branch labels positioned at LEFT/RIGHT tips of diamond (like YES/NO).
- Text wraps within nodes (max 3 lines, auto font-size reduction).
- Orphan node detection with dashed fallback arrows.

### AI-Powered Step Import
- Upload an image or PDF of a process diagram or document.
- Paste a text description of a process.
- AI (via `/api/analyze-symptoms`) extracts structured steps.
- AI can also suggest missing steps based on existing ones.

### Process Health Score
- Visible from screen 7 onward as a progress bar.
- Factors: recency of example, detail level, handoff clarity, system coverage, approval documentation, knowledge documentation.
- Updates as data is added across screens.

---

## Data Persistence & Resume

### Local Storage
- **Key**: `processDiagnosticProgress`
- **Auto-saves** on every screen transition (`goToScreen`) and every 30 seconds.
- **Payload**: current screen, all process data, completed processes, custom departments, step count, editing report ID, timestamp.
- **Resume**: Offered on page load if saved data exists and is less than 24 hours old.

### Cloud Save (via `/api/progress`)
- **Save**: `POST /api/progress` with email and full state → returns `progressId` and `resumeUrl`.
- **Resume**: `GET /api/progress?id=<progressId>` → restores full state including step DOM, systems, radio selections.

### Report Persistence (via `/api/send-diagnostic-report`)
- Completed reports are saved to Supabase with a unique `reportId`.
- Supports both `POST` (new report) and `PATCH` (update existing report via `editingReportId`).
- Reports viewable at `?id=<reportId>`, editable at `?id=<reportId>&editable=true&email=<email>`.

---

## Flowchart Rendering

### Grid View (`buildGridSVG`)
- Serpentine layout (configurable columns based on step count).
- Department-coloured rounded rectangles for normal steps.
- Purple diamonds for decision steps with word-wrapped text.
- Animated dashed arrows with flow particles.
- Automation badges (S = Simple, A = Agent, H = Human-in-Loop, M = Multi-Agent).
- Bottleneck highlighting (red pulse), approval badges (amber), unclear handoff indicators.
- Branch routing contract:
  - `LINE_GAP` (32px) between parallel routing lines.
  - Global channel allocator per inter-row gap.
  - **Smart vertex assignment**: branches distributed across all 4 diamond vertices (top, right, bottom, left) to avoid label pile-up.
  - Pass 1: detect sequential entry side, compute ideal exit per branch, resolve conflicts with preference order (bottom, right, left, top).
  - Pass 2: route and draw - exit from assigned vertex; entry on target from facing side (same-row left/right, cross-row top).
  - Loop-backs prefer TOP; forward cross-row prefer BOTTOM; same-row prefer LEFT/RIGHT.
  - Same-row adjacent branches use direct horizontal lines; non-adjacent route through gap.
  - LEFT/RIGHT exit to gap: horizontal arm from vertex → vertical turn to gap → horizontal in gap → vertical to target.
  - Labels positioned at actual exit vertex with stacking for shared vertices (left/right: pill beside vertex; top/bottom: pill above/below).
  - Labels rendered after all paths and nodes (always in front).
  - Label collision avoidance.

### Swimlane View (`buildSwimlaneSVG`)
- Horizontal lanes grouped by department.
- Steps placed in their department's lane.
- Decision diamonds and branch lines.
- Bottleneck, approval, and unclear handoff visual indicators.

### View Switching
- Toggle buttons on the report page to switch between Grid and Swimlane.
- Zoom and pan controls on the flowchart container.

---

## Automation Classification

**Function**: `classifyAutomation(step, stepIdx, process)`

Each step is classified into one of four automation categories based on its name, handoff quality, systems used, and cross-departmental context:

| Category | Badge | Colour | When Applied |
|----------|-------|--------|--------------|
| **Simple Automation** | S | Green | Notifications, data entry, system sync, status updates, report generation, same-dept handoff fixes |
| **AI Agent** | A | Blue | Match/reconcile, schedule/prioritise, follow-up/chase, classify/triage, cross-system operations, bad handoff bridges |
| **Human-in-the-Loop** | H | Amber | Approvals, reviews, QA/audit, validation, escalations, exceptions, complex configuration |
| **Multi-Agent Orchestration** | M | Purple | Cross-dept with bad handoffs on both sides, multi-dept onboarding/provisioning, cross-team coordination |

The classification feeds into the **Automation Readiness Score** shown on the report.

---

## Report Generation & Export

### Generation Pipeline
1. Client collects all process data via `collectAllProcessData()`.
2. Submits to `/api/process-diagnostic` with processes, contact info, quality score.
3. API computes per-process quality, generates AI recommendations (Claude) or rule-based fallback.
4. Optionally triggers n8n webhook for flow diagram generation.
5. Returns analysis with recommendations, flow diagram URL, quality score.
6. Client renders results locally even if API fails (graceful fallback via `buildLocalResults()`).

### Auto-Save
- Report auto-saved to Supabase via `/api/send-diagnostic-report` on completion.
- Returns a `reportId` for future retrieval and editing.

### Export Formats
| Format | Description |
|--------|-------------|
| **PDF** | Full report with flowcharts, recommendations, roadmap (`downloadPDFReport`) |
| **CSV** | Tabular data export |
| **Notion Markdown** | Formatted for pasting into Notion |
| **JSON** | Raw data export |
| **BPMN** | Standard BPMN XML with tasks, gateways, sequence flows, and diagram shapes |

---

## Team Diagnostics

- **Create**: Organiser selects a process, enters company/name/email, creates a session.
- **Share**: Team code and join URL generated for distribution.
- **Join**: Team members enter the code or use the link to join.
- **Collaborate**: Multiple contributors can add steps; contributor badges track who added what.
- **Submit**: Team responses submitted via `/api/team?action=respond`.

---

## Handover

- **Initiate**: User opens the handover modal from screen 7, enters their name and colleague's email.
- **Save**: Progress saved to cloud via `/api/progress` with handover metadata.
- **Share**: Generates a handover URL with `?resume=<id>&handover=true`.
- **Resume**: Colleague opens the link, sees a handover banner, continues from screen 7.
- **Attribution**: Steps added after handover are tagged with the contributor's name.

---

## Database Schema

All data is stored in Supabase (PostgreSQL). Five active tables serve distinct purposes across the diagnostic lifecycle.

```
┌─────────────────────────┐       ┌─────────────────────────┐
│   diagnostic_progress   │       │   diagnostic_reports    │
│  (in-progress drafts)   │──────▶│  (completed reports)    │
│                         │ submit│                         │
│  id, email, progress_   │       │  id, contact_email,     │
│  data, created_at,      │       │  contact_name, company, │
│  updated_at             │       │  lead_score, lead_grade,│
│                         │       │  diagnostic_data (JSON),│
│  API: /api/progress     │       │  pdf_base64, created_at │
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

| Table | Purpose | Lifecycle Stage | Key APIs |
|-------|---------|-----------------|----------|
| `diagnostic_progress` | Saves mid-session state so users can resume later | In-progress | `GET/POST /api/progress` |
| `diagnostic_reports` | Stores completed diagnostic reports with full JSON data and PDF | Completed | `/api/save-diagnostic-report`, `/api/get-diagnostic`, `/api/get-dashboard`, `/api/generate-redesign` |
| `team_diagnostics` | Stores team diagnostic sessions (process name, team code, status) | Team session | `POST /api/team?action=create`, `GET /api/team?action=results` |
| `team_responses` | Stores each team member's individual perspective on a process | Team submission | `POST /api/team?action=submit`, `GET /api/team?action=results`, `POST /api/team?action=analyze` |
| `process_instances` | Tracks live running instances of mapped processes | Operational | `/api/process-instances` |

### Data Flow

```
User starts diagnostic
        │
        ├──▶ Auto-save every 30s ──▶ localStorage (processDiagnosticProgress)
        │
        ├──▶ Cloud save (optional) ──▶ diagnostic_progress
        │
        └──▶ Submit final report ──▶ diagnostic_reports
                                          │
                                          ├──▶ Portal: View / Edit
                                          ├──▶ Dashboard: /api/get-dashboard
                                          └──▶ AI Redesign: /api/generate-redesign
```
