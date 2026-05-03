# Workflow Consultancy (Vesno)

AI-native M&A diligence + process mapping platform. Chat-first UI ("Reina" copilot) over a per-deal data room with semantic + keyword retrieval, agentic findings with reviewer workflow, and an open-format dataroom that accepts any file.

> **Recent additions** (deal workspace + dataroom): see [`DIAGNOSTICS_CAPABILITIES.md`](./DIAGNOSTICS_CAPABILITIES.md). Highlights:
> - **Open-format dataroom** — any file uploads; text-extractable formats are searchable, others land as `stored` (downloadable + previewable). OCR fallback via Mistral Document OCR for scanned PDFs / images. Org-admin BYO key path.
> - **AI auto-categorisation** — Haiku classifies each ready document into Financial / Legal / HR / IP / Tech / Commercial / Operational / Other.
> - **Expected-docs checklist** — per-deal-type template (M&A / PE roll-up / Scaling) with received-vs-missing rendered inside the workspace modal.
> - **Per-finding evidence drawer** — lazy-loads chunk text + neighbours so reviewers verify without leaving the workspace.
> - **Auto-rerun analysis** — `processDealDocument` queues a delta diligence run after a new doc lands (throttled, only after a prior completed analysis exists). Workspace badges new findings.
> - **Severity-weighted risk score** — `Σ(severity × confidence)` per deal, surfaced as a coloured pill on the Deals rail and used to sort the panel.
> - **Auto-filled scorecard** — one-page IC summary (thesis, top risks, mitigants, rule-based recommended action, doc coverage). Inline in the workspace modal.
> - **Workspace collaboration** — structured Q&A queue, threaded comments per finding, finding tags (deal_breaker / re_trade / disclose / mitigate / monitor), staleness flag when cited docs are reprocessed.
> - **Auth perf** — `requireAuth` cached + coalesced, eliminating the per-request Supabase Auth round-trip.

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Auth & DB**: Supabase (Postgres + RLS + Vault + Storage + pgvector)
- **AI**: Anthropic Claude (chat agent, redesign, recommendations, categorisation), Voyage AI (embeddings), Mistral Document OCR (optional dataroom OCR)
- **Async work**: Inngest (deal-document processing, deal-analysis runs, auto-trigger)
- **Automation**: n8n webhooks
- **Hosting**: Vercel

## Project Structure

```
workflow-consultancy/
├── app/
│   ├── api/              # API routes
│   ├── build/            # Build page
│   ├── diagnostic/       # Diagnostic flow
│   ├── portal/           # User portal (auth required)
│   ├── report/           # Report view
│   └── ...
├── lib/
│   ├── agents/           # AI agents (redesign, chat, etc.)
│   ├── auth.js           # Supabase auth helpers
│   ├── rate-limit.js     # Rate limiting
│   └── ...
├── public/               # Static assets, HTML pages
├── .env.local.example    # Env template
└── README.md
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

## Configuration

Required environment variables (see `.env.local.example` for full list):

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key for AI features |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL (client) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (client) |
| `N8N_SAVE_PROGRESS_WEBHOOK_URL` | n8n webhook for save-progress email |
| `N8N_HANDOVER_WEBHOOK_URL` | n8n webhook for handover email |
| `N8N_DIAGNOSTIC_COMPLETE_WEBHOOK_URL` | n8n webhook for diagnostic-complete email |
| `FOLLOWUP_API_KEY` | API key for `/api/get-followups` (n8n cron) |

Optional:

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_APP_URL` | App URL for CORS and Origin checks (e.g. https://your-app.vercel.app) |
| `LOG_LEVEL` | Log level: debug, info, warn, error |
| `PUBLIC_CONFIG_RESTRICTED` | Set to `true` to disable `/api/public-config` in production |
| `VOYAGE_API_KEY` | Voyage AI key for deal-document embeddings (`voyage-3-large`). Without it, dataroom search degrades to keyword-only. |
| `MISTRAL_API_KEY` | Platform fallback for Mistral Document OCR. Per-org keys can be set in **Org admin → API keys → Mistral (OCR)** instead — that path is preferred. Without any Mistral key, scanned PDFs / images land as `stored` (downloadable but not text-indexed). |
| `MODEL_KEY_ENCRYPTION_SECRET` | Required to store any per-org BYO API keys (Anthropic / Voyage / OpenAI / Mistral) — pgcrypto encryption secret. |
| `INNGEST_EVENT_KEY` | Required for the deal-document and deal-analysis workers to receive events. Without it, uploads land but parsing/chunking/embedding stays at `pending`. |

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

| Route | Auth | Description |
|-------|------|-------------|
| `GET /api/get-dashboard` | Yes | User's reports |
| `DELETE /api/get-dashboard` | Yes | Delete report |
| `GET /api/get-diagnostic` | Editable only | Report by ID (read-only public for shareable links) |
| `PATCH /api/get-diagnostic` | Yes | Update report steps |
| `POST /api/send-diagnostic-report` | No (rate-limited) | Submit diagnostic |
| `POST /api/process-diagnostic` | No (rate-limited) | Run process analysis |
| `POST /api/diagnostic-chat` | No (rate-limited) | AI chat for diagnostic |
| `POST /api/survey-submit` | No (rate-limited) | Submit survey |
| `POST /api/progress` | No (rate-limited) | Save/load diagnostic progress |
| `POST /api/team` | No (rate-limited) | Team alignment (create, invite, submit, close, analyze) |
| `GET /api/team` | No | Team info/results |
| `POST /api/generate-redesign` | Yes | Generate AI redesign |
| `PUT /api/update-diagnostic` | Yes | Update report/redesign |
| `POST /api/generate-workflow-export` | Yes | Export workflow |
| `POST /api/recommend-workflow-platform` | Yes | Platform recommendations |
| `POST /api/process-instances` | Yes | Log process instance |
| `GET /api/process-instances` | Yes | Get process instances |
| `GET /api/get-followups` | API key | Pending follow-ups (n8n) |
| `POST /api/get-followups` | API key | Mark follow-up sent |
| `GET /api/health` | No | Health check |
| `GET /api/public-config` | No | Supabase config (for monitor; set `PUBLIC_CONFIG_RESTRICTED=true` to disable in prod) |

## Production Checklist

- [ ] Set all required env vars in Vercel
- [ ] Add `FOLLOWUP_API_KEY` and configure n8n to pass it
- [ ] Set `NEXT_PUBLIC_APP_URL` for CORS
- [ ] Rate limiting is in-memory (resets on cold start); consider Redis for shared limits if needed
- [ ] Ensure `.env.local` is never committed

## License

© 2026 Workflow Consultancy Partners. All rights reserved.
