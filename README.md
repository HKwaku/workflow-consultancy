# Workflow Consultancy (Vesno)

AI-native operating-model + M&A diligence platform. Chat-first UI ("Reina" copilot) over a living process workspace and per-deal data room, with semantic + keyword retrieval, agentic findings with reviewer workflow, and an open-format dataroom that accepts any file.

> **Architecture diagram** (start here): open [`docs/ARCHITECTURE.html`](./docs/ARCHITECTURE.html) in a browser for the visual map of pages, routes, services, workers, and data.
> **Subsystem deep-dives**: see [`DIAGNOSTICS_CAPABILITIES.md`](./DIAGNOSTICS_CAPABILITIES.md). Highlights of the current shape:
>
> **Living workspace** (2026-05 migration)
> - Processes are **live**, not snapshots. There is no "generate report", "run analysis", "save redesign", or "export PPTX" path — those tables are dropped and their endpoints return 410 Gone. The canvas + chat IS the deliverable.
> - All cost / savings / automation metrics derive on read from `flow_data.rawProcesses[].steps[]` via `lib/processMetrics.js`. The columns that used to cache them (`total_annual_cost`, `potential_savings`, `automation_percentage`, `automation_grade`) were dropped.
> - AI improvement suggestions land as inline rows in the `changes` table on the live process, not as a separate redesign artefact.
> - `/workspace` embeds the canvas + chat shell so clicking a process loads it in place (silent `vesno:open-process` event, `history.replaceState`, no remount).
> - **Share a process** with a colleague: `ShareProcessLink` (canvas back-bar + workspace process list) copies `/process-mapping?view=<id>`. That read-only view is public by design (the `get-diagnostic` GET read-only branch; the process UUID is the unguessable bearer); the editable path still gates on owner / RLS, so the link never grants edit. Non-deal flows only. Replaces the old `/api/progress` resume link.
>
> **Deal workspace + dataroom**
> - **Open-format dataroom** — any file uploads; text-extractable formats are searchable, others land as `stored` (downloadable + previewable). OCR fallback via Mistral Document OCR for scanned PDFs / images. Org-admin BYO key path.
> - **AI auto-categorisation** — Haiku classifies each ready document into Financial / Legal / HR / IP / Tech / Commercial / Operational / Other.
> - **Expected-docs checklist** — per-deal-type template (M&A / PE roll-up / Scaling) with received-vs-missing rendered inside the workspace modal.
> - **Per-finding evidence drawer** — lazy-loads chunk text + neighbours so reviewers verify without leaving the workspace.
> - **Workspace collaboration** — structured Q&A queue, threaded comments per finding, finding tags (deal_breaker / re_trade / disclose / mitigate / monitor), staleness flag when cited docs are reprocessed.
> - **Auth perf** — `requireAuth` cached + coalesced, eliminating the per-request Supabase Auth round-trip.
>
> **Outputs panel & artefact generation (2026-05)**
> - Persistent, model-scoped home for generated content that does not fit the canonical schema (tables, docs, code, datasets, diagrams, plans). The chat rail's **Artefacts** slider is the single list — persistent `workspace_artefacts` alongside session snapshots/reports, one unified list however produced. Selecting one opens the **Outputs** canvas, which is now render-only (its own list/sidebar was removed; the rail slider owns the list) with a single scroll region.
> - Chat tool `emit_artefact` picks a skill and briefs a focused artefact sub-agent (`lib/agents/artefacts/`). **Per-skill model tier** for speed: most text/table/diagram/code skills run on Haiku 4.5, heavy-synthesis skills on Opus 4.7, office skills on Sonnet 4.6. Prompt-cached per-skill prompts; structured outputs with a validate→repair-once fallback. Skill registry in `lib/agents/artefacts/skills.js`.
> - **Office files (`.pptx`/`.docx`/`.xlsx`) build asynchronously.** `emit_artefact` creates a placeholder Outputs row marked "Building…", returns to the chat immediately, and queues the `buildOfficeArtefact` Inngest worker (code-execution sandbox); the Outputs panel polls and the finished file appears on its own. A download is only ever offered for a real stored binary — a failed build shows an honest "regenerate" state, never a JSON file masquerading as `.pptx`. Without Inngest configured it falls back to an inline (synchronous) build.
> - Stored in `workspace_artefacts` (member-scoped read/write, schema-light `type`, version lineage via `meta.supersedes`); helpers in `lib/operatingModel/artefacts.js`.
> - Renderers by `type`: markdown/code, HTML tables, JSON, sandboxed `html`/`svg`, mermaid with pan/zoom, plus an interactive `GanttChart` (dependency-lineage highlighting, CPM critical path, today marker). Legacy mermaid Gantts auto-parsed into the interactive chart.
> - Artefact + code-execution token spend is metered into `token_usage_ledger` and respects the org budget; `deleteArtefact` removes the backing Storage object, and the GDPR erasure cron purges a deleted user's artefact binaries.
>
> **Chat agent — full CRUD parity**
> - `pickAgent` (`lib/agents/chat/router.js`) selects one of three toolsets per turn: process (`ALL_CHAT_TOOLS`, 70), model (`MODEL_AGENT_TOOLS`, 26), deal (`DEAL_AGENT_TOOLS`, 16). Counts are derived from `tools.js` — see [`DIAGNOSTICS_CAPABILITIES.md`](./DIAGNOSTICS_CAPABILITIES.md).
> - **Process lifecycle (Tier 1):** `create_process`, `duplicate_process`, `file_process`, `delete_process` — the agent can now start, copy, file, and remove a process, not just edit an open one.
> - **Operating-model edit/delete (Tier 2):** `propose_update/move/delete_function`, `propose_update/delete_role`, `propose_update/delete_system` — completes the add-only `propose_add_*` set into full CRUD. All stage a **Confirm** card; nothing is written until the user clicks.
> - Org/account governance (model allowlist, BYO keys, token budget, membership, GDPR deletion) is deliberately **not** agent-accessible — a security boundary, not a gap.
> - Migrations now run via `npm run migrate` (`scripts/run-migrations.mjs`): advisory-locked, transactional, idempotent, tracked in `public.schema_migrations` — see [`supabase/MIGRATIONS.md`](./supabase/MIGRATIONS.md).
>
> **Mobile / responsive**
> - `app/layout.jsx` exports `viewport = { width:'device-width', initialScale:1, viewportFit:'cover' }`. Without it the existing responsive layer (~30 `@media` blocks, primary `max-width:768px`) was inert on phones (browsers assumed a ~980px viewport). `viewport-fit=cover` activates the `env(safe-area-inset-*)` notch handling already in the CSS.
> - Mobile fixes extend the existing 768px block in `public/styles/diagnostic.css` (full-bleed rail panels, 40px touch targets, viewport-bounded modals). JS: `useIsMobile()` + `mobileView` chat/canvas toggle + `MobileViewGate` for flow surfaces.
>
> **Multiple operating models per org**
> - An org is no longer one model. `organization_members.preferred_operating_model_id` (migration **41**) gives each member an **active model**; `resolveDefaultModelForUser` returns it (else the org default), so Home / New chat / the chat agent all follow the chosen model instead of snapping back.
> - `/api/me/operating-models` (`GET` list, `POST {name}` create+activate, `PUT {modelId}` switch). Switcher is surfaced **from Home**: the chat-shell "Working in **&lt;Model&gt; ▾**" banner (`WorkspaceContextStrip`) drops down org models + "+ New model"; also in the Standard-scope `WorkspaceModelsTab`. One org per user by design — these are models within it. Requires migration 41 applied; degrades safely (stays on org default) until then.

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Auth & DB**: Supabase (Postgres + RLS + Vault + Storage + pgvector)
- **AI**: Anthropic Claude (chat agent, categorisation, diligence findings), Voyage AI (embeddings), Mistral Document OCR (optional dataroom OCR)
- **Async work**: Inngest (deal-document processing, connector sync, office-artefact builds)
- **Automation**: n8n webhooks
- **Hosting**: Vercel

## Project Structure

```
workflow-consultancy/
├── app/
│   ├── api/                        # API routes
│   ├── deals/[id]/workspace/       # Per-deal workspace (canvas + dataroom + findings)
│   ├── portal/                     # User portal (auth required)
│   ├── process-mapping/            # Canonical alias → /workspace/map (chat + canvas)
│   ├── process-audit/              # Back-compat redirect for old /process-audit links
│   ├── workspace/                  # Operating-model home — embeds the canvas + chat
│   └── ...
├── components/
│   ├── diagnostic/                 # Chat + canvas shell (Reina)
│   └── workspace/                  # Operating-model panels (graph, list, insights, …)
├── lib/
│   ├── agents/chat/                # Chat agent (tools, graph, prompts)
│   ├── changes/                    # Inline change-proposal repo (replaces redesign)
│   ├── operatingModel/             # Functions + roles + systems + rollups
│   ├── processMetrics.js           # Live cost / savings / automation derivation
│   ├── deal-analysis/              # Hybrid vector + keyword chunk search wrapper
│   ├── inngest/functions/          # Background workers (doc pipeline, connector sync)
│   ├── auth.js                     # Cached + coalesced Supabase auth helpers
│   └── ...
├── supabase/                       # SQL migrations
├── tests/                          # Node `node:test` unit suite + Playwright E2E
└── public/                         # Static assets
```

## Local Development

### Prerequisites

- Node.js 18+
- npm or pnpm

### Setup

1. **Clone and install**
   ```bash
   cd workflow-consultancy
   npm install
   ```

2. **Configure environment**
   ```bash
   cp .env.local.example .env.local
   # Edit .env.local with your keys (see Configuration below)
   ```

3. **Run dev server**
   ```bash
   npm run dev
   ```
   Visit: http://localhost:3000

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm test` | Node `node:test` unit suite |

## Configuration

Required environment variables (see `.env.local.example` for full list):

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key for AI features (platform fallback when an org has no BYO key) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL (client) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (client) |

Optional:

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_APP_URL` | App URL for CORS and Origin checks (e.g. https://your-app.vercel.app) |
| `LOG_LEVEL` | Log level: debug, info, warn, error |
| `PUBLIC_CONFIG_RESTRICTED` | Set to `true` to disable `/api/public-config` in production |
| `VOYAGE_API_KEY` | Voyage AI key for deal-document embeddings (`voyage-3-large`). Without it, dataroom search degrades to keyword-only. |
| `MISTRAL_API_KEY` | Platform fallback for Mistral Document OCR. Per-org keys can be set in **Org admin → API keys → Mistral (OCR)** instead — that path is preferred. Without any Mistral key, scanned PDFs / images land as `stored` (downloadable but not text-indexed). |
| `MODEL_KEY_ENCRYPTION_SECRET` | Required to store any per-org BYO API keys (Anthropic / Voyage / OpenAI / Mistral) — pgcrypto encryption secret. |
| `INNGEST_EVENT_KEY` | Required for the deal-document worker to receive events. Without it, uploads land but parsing/chunking/embedding stays at `pending`. |
| `N8N_*` | Outbound n8n webhook URLs (HMAC-signed) for transactional emails. Optional — calls soft-fail when unset. |

## Deployment

### Vercel (recommended)

1. Push to GitHub and connect repo to Vercel
2. Add environment variables in Vercel dashboard
3. Deploy: `vercel --prod`

### Manual

```bash
npm run build
npm run start
```

## API Routes

Live endpoints (auth-protected unless noted):

| Route | Description |
|-------|-------------|
| `GET /api/get-dashboard` | User's processes |
| `DELETE /api/get-dashboard` | Delete a process |
| `GET /api/get-diagnostic` | Process by id (public read for shareable links) |
| `PUT /api/update-diagnostic` | Update process steps / flow data |
| `POST /api/send-diagnostic-report` | Submit a freshly-mapped process |
| `POST /api/diagnostic-chat` | Chat with Reina (SSE) |
| `GET /api/me/recent-processes` | Continue-mapping cards. `?operatingModelId=` / `?dealId=` narrow scope |
| `GET /api/me/operating-model` | User's **active** operating model (per-member preferred → org default) |
| `GET/POST/PUT /api/me/operating-models` | List org models (+ active/default); `POST {name}` create & activate; `PUT {modelId}` switch active |
| `GET /api/operating-models/[id]` | Model + functions tree + rollups |
| `GET /api/operating-models/[id]/processes` | Processes filed under a model |
| `POST /api/operating-models/[id]/processes` | Create a process (or duplicate when `source_process_id` is sent) — backs the chat agent's `create_process`/`duplicate_process` |
| `PATCH /api/operating-models/[id]/processes/[processId]` | File / unfile a process under a function |
| `DELETE /api/operating-models/[id]/processes/[processId]` | Remove a process from the model (model-scoped) |
| `GET /api/operating-models/[id]/processes/[processId]/detail` | One process + derived metrics |
| `GET /api/operating-models/[id]/system-processes` | Processes touching a system |
| `GET /api/operating-models/[id]/system-processes` | System inventory join |
| `GET /api/operating-models/[id]/artefacts` | List Outputs artefacts (newest first; member access) |
| `POST /api/operating-models/[id]/artefacts` | Manual artefact create |
| `PATCH /api/operating-models/[id]/artefacts/[artefactId]` | Rename an artefact |
| `DELETE /api/operating-models/[id]/artefacts/[artefactId]` | Delete an artefact |
| `GET /api/deals/[id]` | Deal + participants + flows + summary |
| `GET /api/deals/[id]/flows` | Flow list with derived metrics |
| `GET /api/deals/[id]/findings` | Live diligence findings (deal-scoped) |
| `GET /api/deals/[id]/activity` | Audit + Q&A + comments timeline |
| `GET /api/diagnostic-changes/[reportId]` | Change-proposal timeline for a process |
| `PATCH /api/diagnostic-changes/[reportId]/[changeId]` | Advance a change's lifecycle state |
| `POST /api/diagnostic-changes/[reportId]/[changeId]/outcomes` | Record a measured outcome |
| `GET /api/health` | Health check (public) |
| `GET /api/public-config` | Supabase config for monitor (toggle with `PUBLIC_CONFIG_RESTRICTED`) |

Removed in the living-workspace migration (the routes are physically deleted; requests 404):

| Route | Replaced by |
|-------|-------------|
| `POST /api/generate-redesign`, `POST /api/save-redesign`, `* /api/report-redesigns`, `POST /api/rename-redesign` | AI suggestions land as inline rows in the `changes` table on the live process. No separate redesign artefact. |
| `* /api/cost-analysis*`, `POST /api/share-cost-analysis`, `* /api/cost-authorized-emails` | Cost derives live from `flow_data` via `lib/processMetrics.js`. No standalone cost surface. |
| `GET /api/export-pptx`, `* /api/deals/[id]/export-diligence-pptx`, `POST /api/generate-workflow-export`, `POST /api/recommend-workflow-platform` | No deliverable exports - the workspace is the deliverable. |
| `* /api/process-diagnostic`, `* /api/diagnostic-recommendations/[reportId]` | Recommendations land as inline change proposals through the chat agent. |
| `* /api/progress`, `* /api/get-followups` | `diagnostic_progress` + `followup_events` tables dropped; resume is handled client-side via chat sessions. |
| `* /api/deals/[id]/analyse`, `* /api/deals/[id]/analyses/...` | `deal_analyses` snapshot table dropped; findings hang on `deal_findings (deal_id, finding_key)` directly. |
| `* /api/deals/[id]/scorecard`, `GET /api/portfolio/findings` | Live derivations on the deal page replace the snapshot summaries. |
| `* /api/operating-models/[id]/processes/[id]/promote`, `/target` | Single live surface - no separate `target_data` to promote. |
| `* /api/team` | `team_diagnostics` / `team_responses` dropped; collaborate live on the process. |

## Production Checklist

- [ ] Set all required env vars in Vercel
- [ ] Set `NEXT_PUBLIC_APP_URL` for CORS
- [ ] Rate limiting is in-memory (resets on cold start); consider Redis for shared limits if needed
- [ ] Ensure `.env.local` is never committed
- [ ] Apply migrations with `DATABASE_URL=… npm run migrate` (idempotent; advisory-locked; records to `public.schema_migrations`). Preview with `npm run migrate:dry`. Order is the table in `supabase/MIGRATIONS.md`; this covers the three living-workspace files and `supabase/migration-workspace-artefacts.sql` (Outputs panel store). For an existing DB, seed `schema_migrations` with already-applied legacy `scripts/` filenames so the runner skips them.

## License

© 2026 Workflow Consultancy Partners. All rights reserved.
