# Workflow Consultancy (Sharpin)

Technology-agnostic workflow optimization and process mapping. Next.js app with AI-powered diagnostics, Supabase backend, and n8n webhooks.

## Tech Stack

- **Framework**: Next.js 15
- **Auth & DB**: Supabase
- **AI**: Anthropic Claude (LangChain)
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
