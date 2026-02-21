# Diagnostics Flow — Capabilities Document

> **Last updated:** 2026-02-20
> This document describes every screen, feature, and capability of the diagnostic tool in `diagnostic.html`. It should be updated whenever changes are made to the diagnostics flow.

---

## Table of Contents

1. [Flow Overview](#flow-overview)
2. [Screen-by-Screen Breakdown](#screen-by-screen-breakdown)
3. [Core Features](#core-features)
4. [Data Persistence & Resume](#data-persistence--resume)
5. [Flowchart Rendering](#flowchart-rendering)
6. [Automation Classification](#automation-classification)
7. [Report Generation & Export](#report-generation--export)
8. [Team Diagnostics](#team-diagnostics)
9. [Handover](#handover)

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

### Screen 0 — Welcome
- Landing page with a readiness checklist.
- Two entry points: **Start Diagnostic** (standard) or **Start a Team Diagnostic** (collaborative).
- Option to resume a saved draft or load a report by ID.

### Screen Team — Team Diagnostic Setup
- Full-page setup (not a modal) matching the standard screen layout.
- Select a process from a grid of templates or enter a custom one.
- Enter company name, creator name, and email.
- **Create session** via `/api/team?action=create` — returns a team code and shareable join link.
- **Join session** by entering a team code.

### Screen 1 — Process Selection
- Grid of 9 pre-defined process templates (e.g., Invoice Processing, Employee Onboarding).
- Option to type a custom process name.
- Single-select; highlights chosen card.

### Screen 2 — Name Your Process
- Free-text input to name the specific instance of the process.
- Pre-filled from the template chosen in screen 1 (editable).

### Screen 3 — Define Process Boundaries
- **Starts when**: Free text describing what triggers the process.
- **Completes when**: Free text describing what constitutes completion.
- **Complexity**: Radio group with 4 levels (Straightforward → Complex multi-path).
- **Departments involved**: Checkbox grid of 8 standard departments + custom entry.

### Screen 4 — Last Real Example
- Name of the last real instance of this process.
- Start date, end date (date pickers).
- Calculated elapsed days displayed automatically.

### Screen 5 — Your Time Investment
Structured inputs replacing vague "how many hours" questions:
- **Meetings**: Radio (None / 1–2 / 3–5 / 6+) → mapped to hour values.
- **Emails & messages**: Radio (None / 1–5 / 6–15 / 16+) → mapped to hour values.
- **Execution level**: Radio (Mostly waiting / Some active work / Heavy execution / Constant involvement).
- **Waiting portion**: Radio (Minimal / Some / Significant / Mostly waiting).
- **Rework level**: Radio (None / Minor / Moderate / Major).
- Total hours auto-calculated from selections.

### Screen 6 — Performance Assessment
- **Typical timing**: Radio (Faster than target / On target / Slower / Much slower).
- **Issues encountered**: Checkbox list of 11 common issues (unclear handoffs, waiting for approvals, manual data entry, etc.) + free-text "Other".
- **Biggest delay**: Dropdown auto-populated from checked issues.
- **Delay details**: Free text for specifics.

### Screen 7 — Step Breakdown
The most feature-rich screen. Users build the process step-by-step.

**Per step:**
- Step name (text input).
- Department (select with 17+ options, including custom departments from screen 3).
- Internal / External radio toggle.
- **Decision toggle**: Checkbox to mark a step as a decision/routing point.
  - When checked, shows branch rows with label + target inputs.
  - "Add another route" button for 3+ branches.
  - Targets resolved by step number ("Step 5") or name match.

**Step management:**
- **Add step** button, **Insert before first** button, **Insert after** button on each step.
- **Remove step** button on each step.
- **Drag-and-drop reordering** via drag handle (grip icon).
- Step numbers auto-renumber after any change.
- Minimum 3 steps, maximum 50.

**Import:**
- **Upload file**: Drag-and-drop or click to upload an image (PNG, JPG, GIF, WebP) or PDF (≤10 MB). Sent to `/api/analyze-symptoms` with mode `extract-steps`. AI extracts steps automatically.
- **Paste text**: Paste a process description; AI extracts steps from text.
- **AI suggestions**: After 3+ steps, an AI can suggest missing steps as clickable chips.

**Live Flow Preview:**
- Toggle "Show Live Flow Preview" to see an SVG flowchart built in real time.
- Updates on every step name, department, decision toggle, branch edit, reorder, add, or remove.
- Uses serpentine grid layout matching the final report renderer.
- Decision nodes rendered as diamonds with colour-coded branch arrows.
- Loop-backs route through the left margin; forward-skips route through inter-row gaps.
- Text wraps within nodes (up to 3 lines) to prevent overflow.
- Branch labels rendered as pills on their path.

**Process Health Score:**
- A progress bar visible from screen 7 onward.
- Score based on recency, detail, handoff clarity, system coverage, etc.

### Screen 8 — Handoff Analysis
For each transition between consecutive steps:
- **Method**: Radio group (Email, Chat, In-person, System notification, Shared document, Phone, Other).
- **Clarity**: Radio group (Clear first time / Sometimes unclear / Often unclear with rework / Major breakdowns).

### Screen 9 — Bottleneck Identification
- **Longest step**: Dropdown populated from step list.
- **Why it takes longest**: Radio (Waiting for someone, Manual data work, Approval delays, System limitations, Knowledge gaps, Coordination overhead, Compliance requirements, Other).
- **Biggest bottleneck**: Dropdown of all steps.

### Screen 10 — Systems & Tools
Dynamic list of systems used in the process:
- System name.
- Purpose description.
- Action checkboxes: Read, Copy out, Copy in, Reconcile.

### Screen 11 — Approvals & Decisions
- **Number of approvals** (0–10 selector).
- Per approval: Name, approver, number of rounds, assessment (rubber stamp → substantial review).

### Screen 12 — Knowledge & Documentation
- Where someone looks first for help (radio: documented procedure, ask colleague, figure it out, check system).
- Who they ask (radio: specific person, anyone in team, manager, external).
- Impact if that person is on vacation (radio: no impact → process stops).
- Time to get an answer (radio: minutes to days+).

### Screen 13 — New Hire Reality
- How new hires learn (checkbox: shadow, written guide, trial & error, formal training, video, mentor, self-service, other).
- Time to competence (radio: days to 6+ months).
- What they struggle with most (free text).

### Screen 14 — Frequency & Volume
- **Frequency**: Radio (Multiple times daily → Quarterly or less).
- **Annual instances**: Auto-calculated from frequency, editable.
- **Currently in-flight**: Number input.
- **Progressing normally**: Number input.
- **Stuck / delayed**: Number input.
- **Waiting for external**: Number input.

### Screen 15 — Cost Calculation
- **Hourly rate** (£/$/€): Number input.
- Auto-calculated per-instance cost (hours × rate).
- Auto-calculated annual cost (instances × per-instance cost).

### Screen 16 — Team Cost & Savings
- **Team size** working on this process.
- **Total annual team cost** (calculated).
- **"50% faster" savings** projection.
- **Expected impact** (radio: 10% → 50%+ time savings).
- **What would you do with saved time?** (checkboxes: more throughput, quality, new initiatives, reduce overtime, training, customer focus, other).

### Screen 17 — Priority Assessment
- **Priority level** (radio: Critical → Low).
- **Why this priority** (free text).
- **Analyse another process?** (radio: Yes / No). If "Yes", loops back to screen 1 for the next process.

### Dependency Mapping (between screens 17 and 18)
- Shown when 2+ processes have been assessed.
- For each pair of processes, user selects: A blocks B / B blocks A / Shared resource bottleneck / No dependency.
- Produces a dependency graph in the report.

### Screen 18 — Contact Details
- Name, email, company, job title.
- Industry (select: Technology, Financial Services, Healthcare, Manufacturing, Retail, Professional Services, Government, Education, Other).
- Team size (radio: 1–5 → 200+).

### Screen 19 — Results & Report
Final analysis output with multiple sections:

- **Process summary cards** for each assessed process.
- **AI or rule-based recommendations** (collapsible sections).
- **Automation Readiness Score** — percentage gauge built from step classifications.
- **Flowchart diagrams** — Grid and Swimlane views, togglable.
- **90-Day Improvement Roadmap** — phased action plan.
- **ROI Projection Calculator** — interactive sliders.
- **Process Dependency Graph** (if multiple processes).
- **Edit buttons** on each section to go back and modify data.

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
- Decision nodes suppress sequential arrows — branch arrows handle outgoing connections.

### Live Flow Preview (Screen 7)
- Real-time SVG rendering as users add/edit steps.
- Serpentine grid layout (odd rows reverse direction).
- Department-coloured nodes; diamond shapes for decisions.
- Branch arrow routing:
  - **Same-row immediate next**: Direct horizontal line.
  - **Same-row skip**: Routes through gap above the row.
  - **Forward to different row**: Routes through gap below source row.
  - **Loop-back**: Routes through left margin with allocated channels.
- Branch labels as coloured pills on paths.
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
  - Loop-backs route through left margin.
  - Forward routes use right margin for multi-row skips.
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
