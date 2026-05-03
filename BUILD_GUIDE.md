# Build Guide — Workflow Consultancy / Vesno

> **Purpose.** This document is a rebuild spec. A senior full-stack engineer should be able to construct a working MVP of the platform from this guide alone.
>
> **Scope.** MVP — the working core: diagnostic chat, reports, one deal type (M&A), diligence pipeline (data room → RAG → findings → reviews → PPTX), background workers, multi-tenant auth. Items deferred for later are explicitly marked **DEFER**.
>
> **Companion.** [`DIAGNOSTICS_CAPABILITIES.md`](./DIAGNOSTICS_CAPABILITIES.md) is the engineer-in-the-codebase reference; this is the build-from-scratch spec. They will diverge over time — when in doubt, the running code wins.
>
> **Going live?** [`GO_LIVE_CHECKLIST.md`](./GO_LIVE_CHECKLIST.md) is the single source of truth for every action between "engineering done" and "real customer paying us." Tick boxes as you go.
>
> **Customer-facing docs** live in `content/docs/*.md`, rendered at `/docs`. Different audience from this file.
>
> **Conventions.** All file paths are relative to the project root. SQL is PostgreSQL 15+. JS is ES modules. React 19, Next.js 15 App Router. Anthropic-only LLMs except embeddings (Voyage).

---

## Contents

1. [Product overview](#1-product-overview)
2. [Tech stack & setup](#2-tech-stack--setup)
3. [Database schema](#3-database-schema)
4. [Authentication, RBAC & entitlements](#4-authentication-rbac--entitlements)
5. [Diagnostic chat — the core surface](#5-diagnostic-chat--the-core-surface)
6. [The report system](#6-the-report-system)
7. [Deal portal (M&A)](#7-deal-portal-ma)
8. [Diligence pipeline](#8-diligence-pipeline)
9. [Background workers (Inngest)](#9-background-workers-inngest)
10. [GDPR — data portability + erasure](#10-gdpr--data-portability--erasure)
11. [Operations, monitoring, security](#11-operations-monitoring-security)
12. [User journeys & wireframes](#12-user-journeys--wireframes)
13. [Phased rebuild plan](#13-phased-rebuild-plan)
14. [Deferred work — what we punted and why](#14-deferred-work--what-we-punted-and-why)

---

## 1. Product overview

### 1.1 What you're building

A consulting platform that does three things, in one product:

1. **Process audit** — users describe an operational process via chat with an AI assistant ("Reina"); the system maps it to a structured representation; output is a diagnostic report covering bottlenecks, costs, automation readiness, and a 90-day improvement roadmap.

2. **Process redesign + build export** — users accept an AI-generated redesign and export build guides for n8n / Zapier / Make / etc. **DEFER** for MVP — implement after the diligence pipeline.

3. **Deal diligence (M&A)** — buy-side / sell-side teams upload data room documents, optionally have each party map their process, and run AI analyses that produce evidence-cited finding memos. Findings carry severity, confidence, and Day-1/TSA/Separation impact axes; reviewers approve/reject; approved findings export to PowerPoint.

### 1.2 The three primary user types

| Role | What they do |
|------|--------------|
| **Audit user** | Maps a single process via the diagnostic chat. May be anonymous or signed in. |
| **Org admin** | Manages members + entitlements within their organisation. |
| **Deal editor** (owner or collaborator) | Creates deals, invites participants, uploads documents, runs analyses, approves findings, exports PPTX. |

### 1.3 The audience pillars

The diagnostic chat behaves slightly differently depending on the user's segment. Four pillars:

| Pillar id | Audience | Tonal shift |
|-----------|----------|-------------|
| `pe` | Private Equity | Roll-up audits, key-person risk, investor reporting impact |
| `ma` | M&A | Acquirer/target step-level consolidation, post-merger integration |
| `scaling` | High-growth single company | Manual-to-SaaS automation, scaling pain |
| `high-risk-ops` | Regulated workflows | Compliance, SOX/PCI context, audit trail |

Each pillar is a config bundle: a system-prompt segment, a set of pre-built process templates, display metadata (label, colour, tagline). MVP can ship with one pillar (`scaling`) and add the rest by copying the config pattern.

### 1.4 Brand naming

- **Vesno** — product brand (shows in the audit gate UI, marketing pages).
- **Reina** — the AI assistant persona (referenced in chat UI, system prompts).
- They are not interchangeable. Reina speaks; Vesno is the company.

---

## 2. Tech stack & setup

### 2.1 Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Next.js 15 (App Router) | Server actions + edge-compatible API routes + good Vercel deploy story |
| Language | JavaScript (no TypeScript) | Existing codebase convention. TypeScript is fine if you prefer; nothing else changes. |
| AI (LLM) | Anthropic Claude via `@langchain/anthropic` for graph agents + raw `@anthropic-ai/sdk` for streaming chat | Claude's tool-use is robust, and we need the raw SDK to stream chat tokens to the browser via SSE. **See §2.3 for what we considered and rejected.** |
| AI (embeddings) | Voyage AI `voyage-3-large` (1024 dims) | Anthropic doesn't ship embeddings; Voyage is their official recommendation |
| DB | Supabase (PostgreSQL 15 + pgvector + pg_trgm + RLS) | Auth, storage, database in one. RLS gives you multi-tenant isolation cheaply. |
| Auth | Supabase Auth (email + password) | JWT-in-cookies, integrates with RLS via `auth.jwt()` |
| Storage | Supabase Storage (private buckets) | Same vendor, signed URLs |
| Workers | Inngest (cloud + self-discovered Next.js endpoint) | Step-resumable async functions; survives Vercel timeouts |
| Email + outbound webhooks | n8n with HMAC-SHA256 signing | Already in place; could swap for Resend if greenfielding |
| Tests | Node `node:test` for unit; Playwright for E2E | Built-in test runner avoids a Jest dependency |
| Markdown | `react-markdown` + `remark-gfm` + `rehype-highlight` | Render chat messages + reports |
| Document parsing | `mammoth` (DOCX), `officeparser` (PDF/PPTX), `xlsx` | Pure-JS, no native deps |
| PPTX generation | `pptxgenjs` | Pure-JS, runs in Node serverless without binaries |

### 2.2 Required env vars

Mandatory:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
ANTHROPIC_API_KEY=sk-ant-...
WEBHOOK_SIGNING_SECRET=<32+ random chars>
```

Optional (degrade gracefully when missing):

```
VOYAGE_API_KEY=pa-...                # without this, semantic search disabled, keyword-only
MISTRAL_API_KEY=...                  # platform fallback for dataroom OCR (preferred path: per-org under /portal/org-admin → API keys → Mistral). Without any Mistral key, scanned PDFs / images land as `stored` (downloadable but not text-indexed).
MODEL_KEY_ENCRYPTION_SECRET=<...>    # required for any per-org BYO API key (Anthropic / Voyage / OpenAI / Mistral) — pgcrypto secret
INNGEST_EVENT_KEY=...                # without this, doc uploads stuck at 'pending'
INNGEST_SIGNING_KEY=signkey-...      # without this, /api/inngest rejects cloud calls
INNGEST_DEV=1                        # set in local dev to bypass signing
N8N_REPORT_WEBHOOK_URL=https://...   # email send
N8N_FOLLOWUP_WEBHOOK_URL=https://... # follow-up campaigns
```

Rate-limit (Upstash):

```
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

### 2.3 Anthropic SDK landscape — what we use, what we declined

Decision log so a rebuild doesn't accidentally re-evaluate every choice we already made. **If you're rebuilding and an item below has changed in the upstream API, re-open the decision; otherwise honour the existing one.**

#### What we use

- **`@anthropic-ai/sdk` (raw)** — for the streaming chat agent (`lib/agents/chat/graph.js`). Need direct SSE event control to emit per-token deltas to the browser; LangChain's wrapper hides too much.
- **`@langchain/anthropic`** — for non-streaming agent calls (recommendations, redesign, deal analysis). Two reasons: (a) `model.invoke([...])` ergonomics; (b) preserves an option to multi-provider later (Claude → GPT/Gemini routing) as a config change rather than a rewrite.
- **`@langchain/langgraph`** — for the redesign agent's StateGraph (planner → repair-on-failure loop). Worth the dep for actual state machines; overkill for one-shot calls.
- **Voyage AI** (plain `fetch`, no SDK) — for embeddings. Anthropic doesn't ship embeddings; Voyage is their official recommendation.
- **Mistral Document OCR** (plain `fetch`, no SDK) — optional fallback for scanned PDFs and image uploads in the data room. Picked because (a) accepts PDFs natively (no rasterisation), (b) per-page accuracy on financial / legal docs, (c) per-page billing predictable on large dumps. Per-org BYO key surfaced in **Org admin → API keys → Mistral (OCR)**; `MISTRAL_API_KEY` env is the platform fallback. See `lib/ai/ocr.js`.

#### What we evaluated and consciously declined

These are decisions, not gaps. **Each ships with a "when to revisit" trigger** so the choice can be re-opened cleanly when the underlying constraint changes.

| Offering | Why declined | When to revisit |
|----------|--------------|-----------------|
| **Files API** (`client.beta.files.upload`) | Beta. For chat attachments: adds upload latency (+2-5s), shifts data residency to Anthropic. For deal documents: doesn't fit the RAG pipeline because we still need chunks for hybrid search. Our existing parsers (mammoth/officeparser/xlsx) are good enough. | Files API exits beta AND we add a "small data room" mode that fits in a single prompt. |
| **Citations API** (`citations: { enabled: true }`) | Mutually exclusive with structured outputs (we ship JSON-shaped findings). Workaround is two LLM calls (citations → JSON coercion), doubling cost and adding disagreement-failure modes. **We replicate the value via `verifyEvidence()`** — server-side validation of model-emitted `chunk_id` references against the real chunk table. | Anthropic ships structured-outputs + citations composability. |
| **Batch API** (`messages.batches.create`) | 50% discount but ≤24h latency. Every current call is user-blocking. No fit yet. | We add bulk admin work: eval re-runs, model migration, periodic re-analysis across historical deals. |
| **Claude Agent SDK / Managed Agents** | Anthropic's docs are explicit: not for embedding in Next.js routes. Runs in their cloud, has its own SSE protocol. Our chat agent runs in-process against client-held canvas state — that's the right pattern for our UX. The Inngest worker IS long-running but deterministic; agentic behaviour adds nothing. | We add a real autonomous-research feature (e.g. background SEC monitor). |
| **Replace LangChain entirely with raw SDK** | Pure cleanup, ~5MB bundle. Cost: locks us to Claude. | We make a hard "Claude forever" call. Until then, optionality wins. |

#### The big anti-pattern, named honestly

We built a custom `evidence[]` schema + `FINDINGS_SHAPE_PROMPT_BLOCK` + `verifyEvidence()` validator. **We'd use Citations API instead if it composed with structured outputs.** It doesn't. The validator is the production replacement for Citations-grade trust:

- Drops `evidence[]` pointers whose `chunk_id` doesn't exist in `deal_document_chunks`
- Drops pointers whose `snippet` doesn't substring-match the real chunk content (60% threshold)
- Downgrades finding `confidence` by 0.2 when any pointer was invalidated
- Drops the entire finding when ALL its originally-claimed pointers were invalidated

See `lib/deal-analysis/findingsShape.js` `verifyEvidence()` and the Production guardrails section of `DIAGNOSTICS_CAPABILITIES.md`.

If you're building this from scratch and Citations + Structured Outputs are now composable, **use Citations natively** and skip this whole layer.

---

### 2.4 First-time setup script

```bash
# 1. Clone & install
git clone <repo>
cd workflow-consultancy
npm install

# 2. Provision Supabase (dashboard)
#    - Create project, enable Auth (email+password)
#    - Database settings → enable extensions: vector, pg_trgm

# 3. Run migrations (Supabase SQL editor)
#    Apply files in supabase/ then scripts/ in the order documented in
#    supabase/MIGRATIONS.md

# 4. Configure env
cp .env.example .env.local
# fill in the values from §2.2

# 5. Run dev
npm run dev                       # Next.js on :3000
npx inngest-cli@latest dev        # Inngest dev server (separate terminal)

# 6. Smoke test
open http://localhost:3000
```

---

## 3. Database schema

> **Migration discipline.** Every schema change is a numbered migration file in `supabase/`. Idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`). Apply in order; track applied state in your own infra (Supabase doesn't auto-track).

### 3.1 Required PostgreSQL extensions

```sql
CREATE EXTENSION IF NOT EXISTS vector;     -- pgvector for embeddings
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- trigram fuzzy match for hybrid search
```

### 3.2 Core diagnostic tables

#### `diagnostic_reports`

The submitted process audit. **Note**: text id (not UUID) — a short, unguessable, URL-safe identifier (e.g. `nanoid(12)`). Public access by id is intentional — the id is the access token. Do not use UUIDs for this table; the URL `/report?id=<uuid>` is too long and looks scary in emails.

```sql
CREATE TABLE diagnostic_reports (
  id              TEXT PRIMARY KEY,                  -- nanoid(12)
  display_code    TEXT,                              -- short human-friendly code, e.g. "SH-7K2M9"
  contact_name    TEXT,
  contact_email   TEXT NOT NULL,
  company         TEXT,
  diagnostic_data JSONB NOT NULL,                    -- the full processData (see §5.4)
  recommendations JSONB,                             -- AI-generated improvements
  cost_analysis_status TEXT,                         -- 'none' | 'pending' | 'complete'
  diagnostic_mode TEXT,                              -- 'comprehensive' | 'pe' | 'ma' | 'scaling' | 'high-risk-ops'
  user_id         UUID REFERENCES auth.users(id),    -- null for anonymous reports
  contributor_emails TEXT[] DEFAULT '{}',            -- portal sharing
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reports_email ON diagnostic_reports (lower(contact_email));
CREATE INDEX idx_reports_user  ON diagnostic_reports (user_id);
```

RLS:

```sql
ALTER TABLE diagnostic_reports ENABLE ROW LEVEL SECURITY;

-- Anonymous read by id (the id IS the token)
CREATE POLICY reports_read_by_id ON diagnostic_reports
  FOR SELECT TO anon, authenticated USING (true);

-- Owner / contributor write
CREATE POLICY reports_write_owner ON diagnostic_reports
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR lower(contact_email) = lower(auth.jwt() ->> 'email')
    OR (auth.jwt() ->> 'email') = ANY (
      SELECT lower(e) FROM unnest(coalesce(contributor_emails, ARRAY[]::text[])) e
    )
  );
```

#### `diagnostic_progress`

Resume state for mid-session diagnostics, keyed by email.

```sql
CREATE TABLE diagnostic_progress (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT NOT NULL,
  intake_state JSONB NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (email)
);
```

#### `report_redesigns`

Named redesigns of a report (variants the user can compare).

```sql
CREATE TABLE report_redesigns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id     TEXT NOT NULL REFERENCES diagnostic_reports(id) ON DELETE CASCADE,
  name          TEXT,                                -- user-given label
  redesign_data JSONB NOT NULL,                      -- redesigned process steps + change records
  decisions     JSONB DEFAULT '{}',                  -- per-step accept/reject decisions
  status        TEXT NOT NULL DEFAULT 'pending'      -- 'pending' | 'accepted'
                  CHECK (status IN ('pending', 'accepted')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_redesigns_report ON report_redesigns (report_id, created_at DESC);
```

### 3.3 Org & RBAC tables

#### `organizations` & `organization_members`

```sql
CREATE TABLE organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE organization_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES auth.users(id),
  email           TEXT NOT NULL,
  is_org_admin    BOOLEAN NOT NULL DEFAULT FALSE,
  entitlements    JSONB NOT NULL DEFAULT '{}',       -- see §4.3
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, email)
);
CREATE INDEX idx_org_members_email ON organization_members (lower(email));
CREATE INDEX idx_org_members_user  ON organization_members (user_id);
```

### 3.4 Chat persistence

#### `chat_sessions`, `chat_messages`, `chat_artefacts`

```sql
CREATE TABLE chat_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id),
  email       TEXT,
  report_id   TEXT REFERENCES diagnostic_reports(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('map', 'redesign', 'cost', 'copilot')),
  title       TEXT,
  summary     TEXT,
  fts         tsvector GENERATED ALWAYS AS (
                to_tsvector('english', coalesce(title,'') || ' ' || coalesce(summary,''))
              ) STORED,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_sessions_user ON chat_sessions (user_id, created_at DESC);
CREATE INDEX idx_chat_sessions_fts  ON chat_sessions USING GIN (fts);

CREATE TABLE chat_artefacts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  message_id       UUID,                             -- forward FK; set after row insert
  kind             TEXT NOT NULL
                     CHECK (kind IN ('flow_snapshot', 'report', 'cost_analysis', 'deal_analysis')),
  ref_id           TEXT,                             -- external row id
  snapshot         JSONB,                            -- inline copy for flow_snapshot
  label            TEXT,
  created_by_email TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_artefacts_session ON chat_artefacts (session_id, created_at);

CREATE TABLE chat_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content      TEXT NOT NULL,
  actions      JSONB,                                -- structured tool calls (client applies)
  attachments  JSONB,                                -- {name, type, size}[]
  artefact_id  UUID REFERENCES chat_artefacts(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_messages_session ON chat_messages (session_id, created_at);

ALTER TABLE chat_artefacts ADD CONSTRAINT chat_artefacts_message_fk
  FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE SET NULL;
```

RLS: a user can read/write a chat session only if `user_id = auth.uid()` OR `lower(email) = lower(auth.jwt() ->> 'email')`. Apply the same predicate to messages and artefacts via session membership (use `EXISTS` subqueries — or denormalise `user_id` onto messages if you want simpler policies).

### 3.5 Deals tables

For MVP, ship M&A only. PE roll-up + scaling can copy the same shape later.

```sql
CREATE TABLE deals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_code           TEXT UNIQUE NOT NULL,          -- 8-char human code (e.g. "ATLAS-7K")
  type                TEXT NOT NULL CHECK (type IN ('ma', 'pe_rollup', 'scaling')),
  name                TEXT NOT NULL,
  process_name        TEXT,
  owner_email         TEXT NOT NULL,
  owner_user_id       UUID REFERENCES auth.users(id),
  collaborator_emails TEXT[] NOT NULL DEFAULT '{}',
  status              TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'analysing' | 'closed'
  settings            JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_deals_owner_email ON deals (lower(owner_email));
CREATE INDEX idx_deals_owner_user  ON deals (owner_user_id);

CREATE TABLE deal_participants (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id           UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  role              TEXT NOT NULL,                   -- 'acquirer' | 'target' (M&A); 'platform_company' | 'portfolio_company' (PE)
  company_name      TEXT NOT NULL,
  participant_email TEXT,
  status            TEXT NOT NULL DEFAULT 'invited' -- 'invited' | 'in_progress' | 'complete'
                      CHECK (status IN ('invited', 'in_progress', 'complete')),
  report_id         TEXT REFERENCES diagnostic_reports(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_participants_deal ON deal_participants (deal_id);

CREATE TABLE deal_flows (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES deal_participants(id) ON DELETE CASCADE,
  report_id   TEXT REFERENCES diagnostic_reports(id) ON DELETE SET NULL,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE deal_analyses (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id            UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  mode               TEXT NOT NULL CHECK (mode IN ('comparison', 'synergy', 'redesign', 'diligence')),
  name               TEXT,
  source_flow_ids    UUID[] NOT NULL DEFAULT '{}',
  source_report_ids  TEXT[] NOT NULL DEFAULT '{}',
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'running', 'complete', 'failed')),
  result             JSONB,                          -- mode-specific shape, see §8.5
  error              TEXT,
  created_by_email   TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at       TIMESTAMPTZ
);
CREATE INDEX idx_analyses_deal ON deal_analyses (deal_id, created_at DESC);
```

RLS for deals: editor (owner OR email in `collaborator_emails`) for read+write. Anonymous participants get a separate token-based access path — see §4.5.

### 3.6 Diligence tables

```sql
CREATE TABLE deal_documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id           UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  filename          TEXT NOT NULL,
  mime_type         TEXT,
  byte_size         BIGINT,
  storage_path      TEXT,                            -- bucket key, see §3.7
  -- Status enum:
  --   pending → parsing → embedding → ready    (text-extractable, search-indexed)
  --                                  → stored   (terminal: file accepted but not text-indexed —
  --                                              images, audio, video, archives, scanned PDF
  --                                              without OCR. Downloadable + previewable.)
  --                                  → failed   (genuine extractor error)
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','parsing','embedding','ready','stored','failed')),
  processing_error  TEXT,
  label             TEXT,                            -- e.g. "CIM", "Q3 financials"
  source_party      TEXT,                            -- 'acquirer'|'target'|'self'|'portfolio'|'seller'
  tags              TEXT[] DEFAULT '{}',
  category          TEXT,                            -- AI-suggested: Financial / Legal / HR / IP / Tech / Commercial / Operational / Other
  visibility        TEXT,                            -- per-party gate, see lib/dealDocumentVisibility.js
  content_hash      TEXT,                            -- sha256 of bytes; unique partial index for dedup
  page_count        INTEGER,
  uploaded_by_email TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_deal_documents_deal     ON deal_documents (deal_id, created_at DESC);
CREATE INDEX idx_deal_documents_status   ON deal_documents (status);
CREATE INDEX idx_deal_documents_party    ON deal_documents (deal_id, source_party);
CREATE INDEX idx_deal_documents_category ON deal_documents (deal_id, category);
-- Dedup race-proofing: same content can't land twice for the same deal.
CREATE UNIQUE INDEX deal_documents_unique_content_per_deal
  ON deal_documents (deal_id, content_hash) WHERE content_hash IS NOT NULL;

CREATE TABLE deal_document_chunks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id   UUID NOT NULL REFERENCES deal_documents(id) ON DELETE CASCADE,
  deal_id       UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  chunk_index   INTEGER NOT NULL,
  page_number   INTEGER,
  slide_number  INTEGER,
  sheet_name    TEXT,
  cell_range    TEXT,
  section_path  TEXT,
  content       TEXT NOT NULL,
  token_count   INTEGER,
  embedding     vector(1024),                        -- voyage-3-large; nullable until embedded
  embedded_at   TIMESTAMPTZ,
  content_fts   tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(content,''))) STORED,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);
CREATE INDEX idx_chunks_deal      ON deal_document_chunks (deal_id);
CREATE INDEX idx_chunks_document  ON deal_document_chunks (document_id, chunk_index);
CREATE INDEX idx_chunks_fts       ON deal_document_chunks USING GIN (content_fts);
CREATE INDEX idx_chunks_trgm      ON deal_document_chunks USING GIN (content gin_trgm_ops);
CREATE INDEX idx_chunks_embedding ON deal_document_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE TABLE deal_finding_reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id   UUID NOT NULL REFERENCES deal_analyses(id) ON DELETE CASCADE,
  deal_id       UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  finding_key   TEXT NOT NULL,                      -- sha1(category||title)[:12]; see §8.4
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected','needs_revision')),
  reviewer_note TEXT,
  edited_title  TEXT,                                -- human override
  edited_body   TEXT,
  decided_by_email TEXT,
  decided_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (analysis_id, finding_key)
);
CREATE INDEX idx_finding_reviews_analysis ON deal_finding_reviews (analysis_id);

-- Relational findings — deal_analyses still keeps the JSONB blob as the
-- audit archive, but deal_findings is the canonical read source for the
-- workspace, scorecard, risk-score query, and cross-deal portfolio search.
CREATE TABLE deal_findings (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id     UUID        NOT NULL REFERENCES deal_analyses(id) ON DELETE CASCADE,
  deal_id         UUID        NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  finding_key     TEXT        NOT NULL,
  section         TEXT        NOT NULL,             -- executiveSummary | keyFindings | <body section>
  order_index     INT         NOT NULL DEFAULT 0,
  title           TEXT        NOT NULL,
  body            TEXT,
  category        TEXT,
  severity        TEXT        NOT NULL DEFAULT 'medium'
                    CHECK (severity IN ('low','medium','high','critical')),
  confidence      REAL        NOT NULL DEFAULT 0.5,
  impact          TEXT[]      DEFAULT '{}',         -- subset of {day_one,tsa,separation,long_term}
  evidence        JSONB       DEFAULT '[]'::jsonb,  -- [{kind,ref:{document_id,chunk_id},...}]
  recommendations TEXT[]      DEFAULT '{}',
  -- Workspace collaboration (see §3.6b):
  tags            TEXT[]      NOT NULL DEFAULT '{}',  -- recommended vocab: deal_breaker / re_trade / disclose / mitigate / monitor
  stale           BOOLEAN     NOT NULL DEFAULT false, -- flipped when a cited doc is reprocessed/replaced
  stale_reason    TEXT,
  stale_at        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (analysis_id, finding_key)
);
CREATE INDEX idx_deal_findings_analysis ON deal_findings (analysis_id, section, order_index);
CREATE INDEX idx_deal_findings_deal     ON deal_findings (deal_id, created_at DESC);
CREATE INDEX idx_deal_findings_severity ON deal_findings (deal_id, severity)
  WHERE severity IN ('high','critical');
CREATE INDEX idx_deal_findings_tags     ON deal_findings USING GIN (tags);
CREATE INDEX idx_deal_findings_stale    ON deal_findings (deal_id) WHERE stale = true;

-- Auto-trigger flag on the analysis itself + covering index for the
-- throttle lookup (see §9.4 for the worker that uses these).
ALTER TABLE deal_analyses
  ADD COLUMN IF NOT EXISTS auto_triggered BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX idx_deal_analyses_deal_status_created
  ON deal_analyses (deal_id, status, created_at DESC);
```

### 3.6b Workspace collaboration tables

The deal workspace modal is the place collaborators actually do diligence — chat, upload, ask questions, debate findings, mark them stale. Two extra tables back the Q&A queue and the per-finding discussion thread (see §8.11 for the UI surface).

```sql
-- Structured Q&A queue per deal — the seller-question list with
-- assignment to a participant + optional evidence linkage.
CREATE TABLE deal_qa_items (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id                  UUID        NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  question                 TEXT        NOT NULL,
  asked_by_email           TEXT        NOT NULL,
  asked_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Optional routing — which participant (company role) this is for.
  assigned_participant_id  UUID        REFERENCES deal_participants(id) ON DELETE SET NULL,
  assigned_company         TEXT,        -- denormalised label for display when participant is later removed
  status                   TEXT        NOT NULL DEFAULT 'open'
                             CHECK (status IN ('open','answered','skipped','obsolete')),
  answer_text              TEXT,
  answered_by_email        TEXT,
  answered_at              TIMESTAMPTZ,
  -- Optional supporting evidence pulled from the data room.
  evidence_chunk_ids       UUID[]      DEFAULT '{}',
  evidence_document_ids    UUID[]      DEFAULT '{}',
  -- Optional linkage to the finding the question is investigating.
  related_finding_key      TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_deal_qa_deal_status ON deal_qa_items (deal_id, status, asked_at DESC);
CREATE INDEX idx_deal_qa_assigned    ON deal_qa_items (assigned_participant_id) WHERE assigned_participant_id IS NOT NULL;
CREATE INDEX idx_deal_qa_finding     ON deal_qa_items (deal_id, related_finding_key) WHERE related_finding_key IS NOT NULL;

-- Threaded discussion per finding. Distinct from deal_finding_reviews.reviewer_note
-- (which is a single per-reviewer note tied to status). Anyone with deal access
-- can comment; @-mentions are parsed from the body and stored as text[].
CREATE TABLE deal_finding_comments (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id     UUID        NOT NULL REFERENCES deal_analyses(id) ON DELETE CASCADE,
  deal_id         UUID        NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  finding_key     TEXT        NOT NULL,
  author_email    TEXT        NOT NULL,
  body            TEXT        NOT NULL,
  mentions        TEXT[]      DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_deal_finding_comments_finding
  ON deal_finding_comments (analysis_id, finding_key, created_at ASC);
CREATE INDEX idx_deal_finding_comments_deal
  ON deal_finding_comments (deal_id, created_at DESC);
```

#### Hybrid search RPC

The single most important DB function. Does reciprocal-rank fusion of cosine + FTS:

```sql
CREATE OR REPLACE FUNCTION search_deal_chunks(
  p_deal_id      UUID,
  p_query_text   TEXT,
  p_query_vector vector(1024) DEFAULT NULL,
  p_limit        INTEGER      DEFAULT 12,
  p_party        TEXT         DEFAULT NULL
)
RETURNS TABLE (
  chunk_id      UUID, document_id UUID, filename TEXT,
  page_number   INTEGER, slide_number INTEGER, sheet_name TEXT,
  cell_range    TEXT, section_path TEXT, content TEXT,
  semantic_score REAL, keyword_score REAL, fused_score REAL
) LANGUAGE sql STABLE AS $$
  WITH semantic AS (
    SELECT c.id,
           CASE WHEN p_query_vector IS NOT NULL AND c.embedding IS NOT NULL
                THEN 1 - (c.embedding <=> p_query_vector) ELSE 0 END AS score,
           ROW_NUMBER() OVER (
             ORDER BY CASE WHEN p_query_vector IS NOT NULL AND c.embedding IS NOT NULL
                           THEN c.embedding <=> p_query_vector ELSE 1 END
           ) AS rnk
      FROM deal_document_chunks c JOIN deal_documents d ON d.id = c.document_id
     WHERE c.deal_id = p_deal_id AND (p_party IS NULL OR d.source_party = p_party)
     LIMIT 50
  ),
  keyword AS (
    SELECT c.id,
           ts_rank(c.content_fts, websearch_to_tsquery('english', p_query_text)) AS score,
           ROW_NUMBER() OVER (
             ORDER BY ts_rank(c.content_fts, websearch_to_tsquery('english', p_query_text)) DESC
           ) AS rnk
      FROM deal_document_chunks c JOIN deal_documents d ON d.id = c.document_id
     WHERE c.deal_id = p_deal_id
       AND (p_party IS NULL OR d.source_party = p_party)
       AND c.content_fts @@ websearch_to_tsquery('english', p_query_text)
     LIMIT 50
  ),
  fused AS (
    SELECT coalesce(s.id, k.id) AS chunk_id,
           coalesce(s.score, 0)::real AS semantic_score,
           coalesce(k.score, 0)::real AS keyword_score,
           (coalesce(1.0/(60+s.rnk), 0) + coalesce(1.0/(60+k.rnk), 0))::real AS fused_score
      FROM semantic s FULL OUTER JOIN keyword k ON s.id = k.id
  )
  SELECT f.chunk_id, c.document_id, d.filename, c.page_number, c.slide_number,
         c.sheet_name, c.cell_range, c.section_path, c.content,
         f.semantic_score, f.keyword_score, f.fused_score
    FROM fused f
    JOIN deal_document_chunks c ON c.id = f.chunk_id
    JOIN deal_documents       d ON d.id = c.document_id
   ORDER BY f.fused_score DESC LIMIT p_limit;
$$;
```

The `60` in `1/(60+rnk)` is RRF's standard constant; tunable later.

### 3.7 Storage buckets

| Bucket | Public? | Contents |
|--------|---------|----------|
| `deal-documents` | **No** | Uploaded data-room files. Path: `{deal_id}/{document_id}/{safe_filename}` |
| `diagrams` | No | Generated process flow images (optional) |

Create via dashboard or:

```sql
INSERT INTO storage.buckets (id, name, public) VALUES ('deal-documents', 'deal-documents', false)
  ON CONFLICT (id) DO NOTHING;
```

---

## 4. Authentication, RBAC & entitlements

### 4.1 Layers (the onion)

```
HTTP request
    ↓
checkOrigin()           — CSRF mitigation; reject mismatched Origin/Referer
    ↓
checkRateLimit()        — Upstash sliding-window per IP
    ↓
requireAuth()           — Verify Supabase JWT cookie or Authorization header
    ↓
requireDealEditor()     — Resource-level access (owner OR collaborator)
  / requireDealOwner()   - For owner-only actions (delete, change ownership)
    ↓
RLS at the DB layer     — Final defence; never disable
    ↓
Route handler logic
```

Each layer is independent. The DB never relies on the API doing the right thing; the API never relies on the DB catching mistakes.

### 4.2 Auth helpers (skeleton)

`lib/auth.js` runs on **every** protected API request, so the naive implementation (calling `supabase.auth.getUser(token)` every time → ~100-300ms network round-trip) is the single biggest perf hit on the whole app. With a typical surface firing 4–8 parallel API requests, that meant 4–8 simultaneous auth round-trips before any actual work began.

Three layered fixes sit in front of the network call:

1. **Local JWT shape + expiry check** (`peekJwtPayload`) — base64-decode the token's payload, reject malformed/expired tokens at near-zero cost. Doesn't verify the signature.
2. **In-memory verification cache** — `Map<sha256(token), { session, expiresAt }>`, TTL `min(60s, JWT exp)`, LRU-evicts at 1024 entries. Same JWT in the same minute → cache hit.
3. **Concurrent-request coalescing** — `Map<tokenHash, Promise>` makes 4 simultaneous calls with the same token resolve through ONE network round-trip. Without this, the first cache fill loses the parallel race and you still pay 4× the latency.

```js
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const AUTH_CACHE_TTL_MS = 60_000;
const AUTH_CACHE_MAX = 1024;
const _authCache = new Map(); // tokenHash -> { session, expiresAt }
const _inFlight  = new Map(); // tokenHash -> Promise<session|null>
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('base64');

function peekJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json);
    if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) return null;
    return payload;
  } catch { return null; }
}

export async function verifySupabaseSession(request) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : extractCookieToken(request);
  if (!token) return null;
  const payload = peekJwtPayload(token);            // local shape + exp check
  if (!payload) return null;

  const tokenHash = hashToken(token);
  const cached = _authCache.get(tokenHash);
  if (cached && cached.expiresAt > Date.now()) return cached.session;

  const inFlight = _inFlight.get(tokenHash);         // coalesce concurrent verifications
  if (inFlight) return inFlight;

  const promise = (async () => {
    try {
      const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { data, error } = await sb.auth.getUser(token);
      if (error || !data?.user) return null;
      const session = { userId: data.user.id, email: data.user.email, accessToken: token };
      const ttlExpiry = Date.now() + AUTH_CACHE_TTL_MS;
      const jwtExpiry = payload.exp * 1000;
      _authCache.set(tokenHash, { session, expiresAt: Math.min(ttlExpiry, jwtExpiry) });
      if (_authCache.size > AUTH_CACHE_MAX) _authCache.delete(_authCache.keys().next().value);
      return session;
    } finally {
      _inFlight.delete(tokenHash);
    }
  })();
  _inFlight.set(tokenHash, promise);
  return promise;
}

export async function requireAuth(request) {
  const session = await verifySupabaseSession(request);
  if (!session) return { error: { body: { error: 'Authentication required.' }, status: 401 } };
  return { ...session, error: null };
}
```

> Cache is in-memory per serverless instance. There's no shared state and no cross-instance staleness risk worse than the TTL. A revoked or rotated token can only outlive its revocation by `min(60s, JWT exp - now)`.

### 4.3 Customer-managed API keys (BYO)

Org admins can paste their own Anthropic key in `/portal/org-admin → API keys`. When set, all LLM calls billable to that org's chat / analysis surfaces use the customer's key — Anthropic charges them directly, your platform-key bill drops, and your org token-budget enforcement is bypassed for that org (you keep recording usage in the ledger as observability for the customer).

#### Storage rules

- Encrypt with `pgcrypto` `pgp_sym_encrypt` keyed on a secret stored in **Supabase Vault** (named `model_key_encryption_secret`). Vault is the platform-supported way to store cluster-level secrets without superuser privileges — `ALTER DATABASE … SET …` is rejected on Supabase with `42501: permission denied to set parameter`. The setup script `scripts/set-model-key-encryption-secret.sql` runs `vault.create_secret` (or `vault.update_secret` on rotation). The migration includes a pre-flight check that refuses to apply if the Vault row is missing or the secret is < 16 chars — fails loudly at deploy rather than silently at first key set.
- Never SELECT the encrypted column via PostgREST. All access through `SECURITY DEFINER` RPCs that accept the org id + vendor and return the decrypted key only inside the function body.
- Per-process LRU cache with 60s TTL. Invalidate on rotate / revoke.
- Display fingerprint = `${rawKey.slice(0,7)}...${rawKey.slice(-4)}`. Safe to ship to the browser.
- Validate with a 1-token Anthropic test call before storing — gives the admin instant feedback instead of a cryptic error at first use.

#### Audit log (append-only)

Every set / rotate / revoke / first-use / reminder event writes to `customer_api_key_audit` with `actor_email`, `request_id`, masked fingerprint. Org admins read; nobody updates or deletes. Required for SOC 2.

#### Cron: rotation reminders

Daily job at 06:00. For each active key whose `rotation_due_at` falls within 14 days AND for which we haven't already sent a reminder this rotation period: write a `rotation_reminder_sent` audit row. The admin UI surfaces the same data inline (overdue / soon banners). The cron exists so we have an auditable signal of "we told them" and a hook for future email/Slack send.

#### Surfaces that should use the customer key

Yes: diagnostic chat, deal analysis, recommendations, redesign, cost copilot.
No: survey-submit, marketing pages, any anonymous flow (a logged-out lead shouldn't trigger a customer's billing).

#### Failure mode

Customer key gets rejected (401 from Anthropic) → fail loudly with "your key was rejected; ask an admin to update it." Do NOT silently fall back to the platform key — that hides bills you didn't agree to pay.

#### Required schema (one migration)

`customer_api_keys` (id, organization_id, vendor enum, encrypted_key bytea, key_fingerprint, status, last_validated_at, last_used_at, rotation_due_at, set_by_email, set_at) + unique on `(organization_id, vendor, status='active')`.

`customer_api_key_audit` (organization_id, vendor, action enum, key_fingerprint, actor_email, actor_user_id, request_id, details jsonb, created_at). Append-only via RPC.

Three RPCs: `set_customer_api_key`, `get_active_customer_api_key`, `revoke_customer_api_key`, `audit_customer_key_event` — all `SECURITY DEFINER`, GRANTed only to `service_role`.

### 4.4 Per-org model allowlist

Org admins can pick which Anthropic models their users see in the chat picker. Per-org allowlist + default. Surfaces other than chat (deal analysis, recommendations, redesign) keep using the platform-tier defaults.

#### Catalogue (`lib/agents/modelCatalogue.js`)

Single source of truth. Each entry: `id`, `label`, `tier` (`fast`/`chat`/`deep`), `contextWindow`, `inputCostPer1M`, `outputCostPer1M`, `deprecated`, `blurb`. Adding a model = appending one row. Mark deprecated rather than deleting; the admin UI hides deprecated from new selection but the resolver still respects them if an org already has them in their allowlist.

#### Resolution (`lib/orgModels.js`)

```
resolveAllowedModels({ orgId, hasCustomerKey }) → { allowed, default, source }
```

1. Org has explicit `allowed_models[]` set → use that.
2. Else hasCustomerKey → full active catalogue (BYO customers paying Anthropic directly should pick anything).
3. Else → fixed `PLATFORM_ALLOWED_MODEL_IDS` (Sonnet only — prevents free-tier users from racking up Opus calls on the platform bill).

Default: `org.default_model` if valid, else first allowed, else `SAFE_FALLBACK_MODEL_ID`.

#### Storage

```sql
ALTER TABLE organizations
  ADD COLUMN allowed_models text[],
  ADD COLUMN default_model  text;
```

No CHECK constraint — catalogue lives in code; API validates before write.

#### Chat plumbing

- `DiagnosticChatInputSchema` accepts optional `model`.
- `/api/diagnostic-chat` validates against `resolveAllowedModels`. Out-of-allowlist values fall back silently to the org default — never 4xx the chat. (The picker should never offer a forbidden model; this is defence in depth.)
- `runChatAgent({ ..., modelOverride })` → `runStreamingLoop` reads `ctx.model` and passes it to `client.messages.stream({ model })`.
- `recordTokenUsage` uses the actual model so analytics splits per-model spend correctly.

#### UI rules

- **User picker** (`components/diagnostic/chat/ModelPicker.jsx`): pill above chat input. Click → popover with allowed models + tier badges. Hides itself when allowlist size ≤ 1 (no choice to make).
- **Sticks for the session.** Selection lives in `useState` in the workspace; resets on reload. We don't persist as a user preference — keeps the mental model simple ("each new chat starts at the org default unless I change it").
- **Admin panel** (`app/portal/ModelAllowlistPanel.jsx`): checkbox list + radio for default. Save → PATCH. Reset → set both columns to NULL (returns the org to the resolution-rules default).

### 4.5 Entitlements

Boolean flags stored on `organization_members.entitlements` (JSONB):

```js
// lib/entitlements.js
export const ENTITLEMENT_KEYS = ['portal', 'cost_analyst', 'deals', 'analytics'];
export function defaultEntitlements() {
  return { portal: true, cost_analyst: false, deals: false, analytics: false };
}
export function hasEntitlement(ents, key) {
  return ents?.[key] === true;
}
export function sanitizeEntitlements(raw) {
  const out = defaultEntitlements();
  for (const k of ENTITLEMENT_KEYS) if (typeof raw?.[k] === 'boolean') out[k] = raw[k];
  return out;
}
```

`is_org_admin` overrides individual entitlements at org level.

### 4.6 Deal access tiers

`lib/dealAuth.js`:

```js
export async function resolveDealAccess({ dealId, email, userId }) {
  // 1. Owner: deal.owner_user_id === userId OR deal.owner_email === email
  // 2. Collaborator: email is in deal.collaborator_emails[]
  // 3. Participant: there exists a deal_participants row with participant_email = email
  // Returns { mode, deal, canEdit, canManage, canDelete } or null
}
export async function requireDealEditor({ dealId, email, userId }) {
  const access = await resolveDealAccess({ dealId, email, userId });
  if (!access)        return { error: { error: 'Deal not found or access denied.' }, status: 404 };
  if (!access.canEdit) return { error: { error: 'Editor access required.' }, status: 403 };
  return { access };
}
```

### 4.7 The anonymous participant pattern

A diligence flow can invite someone (e.g. seller's CFO) who doesn't have an account. Pattern:

1. Owner POSTs `/api/deals/[id]/invite` with email; we store an invite token + expiry.
2. Email contains link `/process-audit?dealParticipantToken=...`.
3. The audit gate UI checks the token via `/api/deals/resolve`, which returns the deal context if valid.
4. The participant fills the diagnostic; on save, `deal_flows.report_id` is set.

Tokens are hashed in the DB; they're not credentials, so single-use is fine.

---

## 5. Diagnostic chat — the core surface

This is the platform's defining feature. A user describes their process via chat; "Reina" maps it to a structured representation; the user can also edit the canvas directly.

### 5.1 The `processData` shape

The single piece of state every screen reads from and writes to:

```js
const processData = {
  processName: "Customer onboarding",
  processDefinition: "From initial signup to first successful login",
  pillar: "scaling",                    // 'pe' | 'ma' | 'scaling' | 'high-risk-ops'
  segment: "scaling",                   // alias of pillar in some places (legacy)

  steps: [{
    name: "Receive signup form",
    department: "Sales",
    isExternal: false,
    isDecision: false,
    isMerge: false,
    parallel: false,
    workMinutes: 5,
    waitMinutes: 0,
    systems: ["HubSpot"],
    branches: [],                        // for isDecision steps
    owner: "Sarah Chen",
    checklist: ["Validate email", "Capture UTM"],
  }],

  handoffs: [{                           // handoffs[i] is the handoff AFTER step i
    method: "email",                     // 'email' | 'slack' | 'system' | 'manual' | ...
    notes: "",
  }],

  bottleneck: { reason: "approvals", why: "Legal review takes 3 days" },
  lastExample: { name: "ACME Corp signup", elapsedDays: 14 },
  hoursPerInstance: { handsOn: 2, waiting: 18 },
  performance: "typical",                // 'faster' | 'typical' | 'slower'
  frequency: { count: 50, period: "month" },

  customDepartments: [],                 // strings beyond the standard list
  cost: { labourRate: 75, nonLabourCosts: [], investments: [] },

  contact: { name: "", email: "", company: "", title: "" },
};
```

Frozen at submit; the `diagnostic_reports.diagnostic_data` column holds this exact shape inside `rawProcesses[0]`.

### 5.2 The reducer

`components/diagnostic/DiagnosticContext.jsx` exports a `DiagnosticProvider` whose state is `{ processData, phaseState, undoStack, ... }`. Mutations dispatch typed actions (`ADD_STEP`, `UPDATE_STEP`, `SET_BOTTLENECK`, ...). Each action is pure — no side effects — and pushes a snapshot onto the undo stack.

The `MUTATING` set lists every action type that mutates `processData`. Used by:
- The undo stack — only mutating actions create undo points.
- The chat tool dispatcher — server-emitted actions are matched against this set to decide whether to snapshot before applying.

If you add a new mutating action and forget to add it to `MUTATING`, undo will silently skip it. This is footgun #1.

### 5.3 Screen flow

```
                  /process-audit
                       │
                       ▼
              ┌────────────────────┐
              │  AuditGate         │  Pillar selection + contact intake
              │  (in DiagClient)   │
              └─────────┬──────────┘
                        │
                        ▼
              ┌────────────────────┐
              │  Screen1Select     │  Pillar template / process kind
              │  Template          │
              └─────────┬──────────┘
                        │
                        ▼
              ┌────────────────────┐
              │  DiagnosticWork    │  THE main canvas:
              │  space (Screen 2)  │   chat ⇄ step editor
              │                    │   + flow preview
              │                    │   + cost panel
              │                    │   + report panel
              └─────────┬──────────┘
                        │
                  user clicks Submit
                        ▼
              ┌────────────────────┐
              │  Screen6Complete   │  Auto-submit + redirect /report?id=…
              └────────────────────┘
```

### 5.4 The chat agent — architecture

`/api/diagnostic-chat` is a streaming SSE endpoint that runs an Anthropic tool-calling loop. State is held client-side; the server is stateless w.r.t. canvas state (the client passes the current `steps[]` and `handoffs[]` in every request).

```
HTTP POST /api/diagnostic-chat
  body: { message, currentSteps, currentHandoffs, processName, history,
          phaseState, attachments, dealId?, ... }
    │
    ▼
verify session → resolve dealAccess (if dealId) → drop dealId on access fail
    │
    ▼
runChatAgent({ ctx with steps, handoffs, dealId, dealAccessVerified, session })
    │
    ▼
┌──────────────────────────────────────────────────────────────────┐
│ Streaming agent loop (max 10 iterations):                        │
│                                                                  │
│   client.messages.stream({                                       │
│     model: 'claude-sonnet-4-6',                                  │
│     system: chatSystemPrompt(...),                               │
│     messages: history + new user turn,                           │
│     tools: ALL_CHAT_TOOLS,                                       │
│   })                                                             │
│                                                                  │
│   for-await each event:                                          │
│     if text_delta → emit('delta', { text }) to SSE               │
│                                                                  │
│   await stream.finalMessage()                                    │
│   for each tool_use block:                                       │
│     emit('progress', { message: 'Updating your map…' })          │
│     result = await executeTool(name, input, ctx)                 │
│     append { role: 'tool', content: result } to messages         │
│                                                                  │
│   if no tool_use → break                                         │
│ end loop                                                         │
└──────────────────────────────────────────────────────────────────┘
    │
    ▼
emit('done', { reply, actions })
```

### 5.5 Tool schemas (the canvas API)

Every UI mutation that the AI can perform is a tool. Categorise into ~7 groups:

| Group | Tools | Notes |
|-------|-------|-------|
| Step CRUD | `add_step`, `update_step`, `remove_step`, `replace_all_steps`, `set_handoff`, `add_custom_department` | 6 |
| Connectors | `add_connector`, `remove_connector`, `redirect_connector`, `insert_step_between` | 4 |
| Branches | `set_branch_target`, `set_branch_probability`, `set_branch_label`, `remove_branch`, `add_branch` | 5 |
| Step metadata | `reorder_step`, `set_process_name`, `set_process_definition`, `set_step_details`, `set_cost_input`, `set_bottleneck`, `set_frequency_details`, `set_pe_context` | 8 |
| Step systems & checklist | `add_step_system`, `remove_step_system`, `add_checklist_item`, `toggle_checklist_item`, `remove_checklist_item`, `remove_custom_department` | 6 |
| Read-only queries | `get_bottlenecks`, `get_critical_path`, `get_step_metrics`, `get_cost_summary`, `get_recommendations` | 5 |
| Cross-report / cost | `list_reports`, `load_report_summary`, `set_labour_rate`, `set_non_labour_cost`, `set_investment` | 5 |
| Triggers + UI | `trigger_redesign`, `pin_flow_snapshot`, `highlight_step`, `open_panel`, `generate_report`, `generate_cost`, `undo_last_action`, `propose_change`, `ask_discovery` | 9 |
| Deal data room | `search_deal_documents` | 1 |

**MVP can ship with ~15 tools** — the Step CRUD set + `set_bottleneck` + `set_frequency_details` + `set_cost_input` + `set_handoff` + `generate_report` + `ask_discovery` + `search_deal_documents`. Add the rest as needed.

> ⚠️ **Tool count is a known issue.** Anthropic's guidance is ~10–20 tools max before the model starts confusing them. Consolidate aggressively when rebuilding: `update_step` should subsume `set_step_details`, `set_cost_input`, `set_frequency_details`. Branch operations should be a single `update_branch` with optional fields.

#### Tool schema example

```js
export const ADD_STEP_TOOL = {
  name: 'add_step',
  description: 'Add a new process step to the flow. Use isMerge:true for a convergence point after parallel or exclusive branches.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Step name (concise, 3-8 words)' },
      department: { type: 'string', description: 'Department responsible (Sales, Finance, IT, HR, etc.)' },
      isExternal: { type: 'boolean' },
      isDecision: { type: 'boolean' },
      isMerge: { type: 'boolean' },
      workMinutes: { type: 'number' },
      waitMinutes: { type: 'number' },
      systems: { type: 'array', items: { type: 'string' } },
      branches: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            target: { type: 'string', description: 'e.g. "Step 3"' },
          },
          required: ['label', 'target'],
        },
      },
      owner: { type: 'string' },
      checklist: { type: 'array', items: { type: 'string' } },
      afterStep: { type: 'number', description: 'Insert after this step number. 0 = beginning, omit = append' },
    },
    required: ['name'],
  },
};
```

#### Tool execution — server side

Server returns a result string (for the model to read) AND emits an action object to the client (for the canvas to apply). Pattern:

```js
async function executeTool(name, input, ctx) {
  switch (name) {
    case 'add_step':
      return `Added step "${input.name}"${input.afterStep != null ? ` after step ${input.afterStep}` : ' at end'}.`;
    case 'set_bottleneck':
      return `Set bottleneck reason to ${input.reason}.`;
    case 'search_deal_documents': {
      // SECURITY: refuse unless ctx.dealAccessVerified is true.
      if (!ctx.dealAccessVerified || !ctx.dealId) {
        return 'No deal context on this chat session.';
      }
      const rows = await searchDealChunks({ ... });
      return formatChunksForModel(rows);
    }
    // ... cases for every tool
  }
}
```

The actions for client mutation are derived in the route handler from `tool_use` blocks: `{ type: name, ...input }` is appended to the `actions[]` array sent in the final `done` event.

### 5.6 Client-side action dispatcher

`DiagnosticWorkspace.jsx` has a `processActions(actions)` function that walks the array and dispatches reducer actions. **Critical pattern — every tool needs four artefacts:**

1. A schema in `lib/agents/chat/tools.js` (Zod or raw JSONSchema)
2. A server executor case in `lib/agents/chat/graph.js` (returns result string)
3. A client handler case in `processActions()` (applies to the reducer)
4. A description in `lib/prompts.js` so the model knows when to call it

Skip any of the four → the tool silently fails. Add a checklist to your PR template if you want this to stop happening.

### 5.7 System prompt structure

`lib/prompts.js` exports a `chatSystemPrompt({ processName, stepsDesc, incompleteBlock, phaseState, editingMode, redesignContext, sessionContext })` that returns a single string. Structure:

```
You are Reina, a process-mapping AI assistant for {brand}.
Your job is to help {audience} map and improve their {processName}.

# Current process map
{stepsDesc}                        ← textual rendering of all steps

{incompleteBlock}                  ← "Step 3 is missing departments"

# Phase
You are in the {phaseState.phase} phase. {phase-specific instructions}

# Audience
{pillar agentConfig.systemPromptSegment}

# Editing mode
{editing-original | editing-redesign | new}

# Cross-session context
{sessionContext — prior reports, recent conversations}

# Style
Be concise. Ask one question at a time. Cite a specific step when proposing a change.
```

Per-pillar segments live in `lib/modules/{pe,ma,scaling,high-risk-ops}/agentConfig.js`.

### 5.8 Phase state machine

The chat doesn't dump every question at once. It moves through phases:

```
intake → map → details → cost → complete
```

`lib/diagnostic/intakePhases.js` has a function `computePhaseState({ steps, handoffs, ... })` returning `{ phase, completeness, missing }`. The chat prompt steers Reina differently in each phase ("you're in `intake`; only ask about WHAT process they want to map, not HOW it works").

### 5.9 Attachments (file upload through chat)

Users can drag DOCX/PDF/Excel/images into the chat. `runChatAgent`:
1. Classifies attachments by type.
2. For text-extractable files, runs the Flow agent (`lib/agents/flow/`) — a Haiku-tier LLM that extracts a `processData` shape from raw text.
3. Calls `replace_all_steps` with the extracted shape.
4. Pins a flow_snapshot artefact.

Use `mammoth` (DOCX), `officeparser` (PDF/PPTX), `xlsx` (spreadsheets), `word-extractor` (legacy DOC). Image attachments are sent as multimodal content directly to Claude.

### 5.10 Chat persistence

Every authenticated chat creates a `chat_sessions` row. Every turn is a `chat_messages` row. Significant moments pin a `chat_artefacts` row (kind: `flow_snapshot`, `report`, `cost_analysis`, `deal_analysis`). The artefacts render as pills in the chat history rail; clicking one rehydrates that snapshot.

Create the session lazily — after the first user message, not at chat-start — to avoid orphaned empty sessions.

---

## 6. The report system

### 6.1 Layout

`/report?id=<reportId>` renders 11 components, top-to-bottom:

```
ReportReadyHero          — Process name, company, savings, "Build this" CTA
ReportAtAGlanceSummary   — 4-tile metrics grid (cycle time, cost, automation %, bottleneck)
ExecutiveSummary         — C-suite paragraph
KeyFindings              — Top 5 bottlenecks ranked by severity
ValueOpportunity         — ROI, payback, savings breakdown
ProcessViewToggle        — Swimlane vs grid flow toggle
[ Flow rendering — SVG ] — see §6.3
RoadmapRollup            — Quick wins / medium / project, phased
ImplementationTracker    — Checklist for the user to tick off
StepInsightPanel         — Per-step drill-down
ReportAppendices         — Cost tables, system mapping, audit trail
```

Each is a self-contained component that takes the `report` prop. No global state — drilling derived data through props keeps the component tree easy to reason about.

### 6.2 Generation pipeline

When the user submits the diagnostic:

1. `POST /api/send-diagnostic-report` validates + persists.
2. Synchronously calls `POST /api/process-diagnostic` which runs the Recommendations agent (Haiku, single-shot, with rule-based fallback).
3. Stores result in `diagnostic_reports.recommendations` JSONB.
4. Triggers an n8n webhook to send the email.
5. Returns the report id; client navigates to `/report?id=...`.

### 6.3 Flow rendering

`lib/flows/` produces SVG for the process flow. Two layouts:

- **Grid** (`grid.js`): serpentine left-to-right, wraps to next row at the viewport edge. Good for linear processes.
- **Swimlane** (`swimlane.js`): one row per department. Good for cross-functional processes.

Both produce `<rect>`s with `data-step-idx` attributes. The renderer adds click handlers to scroll the corresponding `StepInsightPanel` into view. Wait time is colour-coded; automation readiness is colour-coded (`lib/diagnostic/automationReadiness.js`).

### 6.4 PPTX export

`/api/export-pptx?id=<reportId>` calls `lib/exporters/reportToPptx.js`. Build with `pptxgenjs`. Five sections: Cover → Exec Summary → Operational Footprint → Findings & Recommendations → Roadmap. **Mirrors the on-screen sections exactly** so users get what they see.

```js
import PptxGenJS from 'pptxgenjs';
export async function buildReportPptx({ id, contactName, company, diagnosticData, createdAt }) {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';
  addCover(pres, { contactName, company, diagnosticData, createdAt });
  addExecutiveSummary(pres, diagnosticData);
  addOperationalFootprint(pres, diagnosticData);
  addFindings(pres, diagnosticData);
  addRoadmap(pres, diagnosticData);
  return await pres.write({ outputType: 'nodebuffer' });
}
```

---

## 7. Deal portal (M&A)

### 7.1 The M&A flow

```
1. Owner POSTs /api/deals { type: 'ma', name, participants: [{role:'acquirer'}, {role:'target'}] }
   ↓ 8-char deal_code generated
2. Owner POSTs /api/deals/[id]/invite { email: 'cfo@target.com' }
   ↓ Token email sent via n8n
3. Target's CFO clicks email → /process-audit?dealParticipantToken=...
   ↓ Audit gate validates token via /api/deals/resolve
   ↓ They map their process; on submit, deal_flows.report_id is set
4. Owner sees both participants 'complete'
   ↓
5. Owner uploads data room files via DealDocumentsPanel
   ↓ Inngest worker chunks + embeds (see §9)
6. Owner runs analysis → /api/deals/[id]/analyse { mode: 'comparison'|'synergy'|'redesign'|'diligence' }
   ↓ SSE stream of progress events; analysis row written to deal_analyses
7. Findings render in DealAnalysisSection / DealDiligenceReport
   ↓ Reviewer approves / rejects / edits findings
8. Owner clicks Export to PowerPoint → approved-only PPTX
```

### 7.2 Page rendering

`/deals/[id]/page.jsx` fetches the deal + participants + summary, then dispatches by `deal.type`:

- `'ma'` → `<DealPageMA />`
- `'pe_rollup'` → `<DealPagePE />`
- `'scaling'` → `<DealPageScaling />`

`DealPageMA.jsx` shows summary tiles (acquirer cost, target cost, combined baseline), side-by-side participant cards, a step-decision layer (keep acquirer / keep target / merge / remove for each step), the documents panel, and the analysis section.

> **Production has moved past this layout.** Phase 18 (May 2026) deleted the per-type page components in favour of a single chat-first workspace at `/process-audit?deal=<id>` with `DealWorkspaceModal` as the surface. `/deals/[id]/page.jsx` is now a redirect. The per-type architecture is fine for an MVP — it's the cheaper way to ship a working diligence flow — but if you're rebuilding for parity with what's running today, consult `DIAGNOSTICS_CAPABILITIES.md` "Deal workspace modal" and "Phase 19 portal dismantle" sections instead.

### 7.3 Analysis modes

Four modes, produced by `lib/deal-analysis/prompts.js`:

| Mode | Inputs | Output shape | When to use |
|------|--------|--------------|-------------|
| `comparison` | All participant maps | `{ summary, commonSteps[], uniqueSteps[], mergeRecommendations[], proposedProcess[] }` | Standard PE/M&A overlap analysis |
| `synergy` | All participant maps | `{ summary, overallSavingPct, opportunities[], fteOverlap[], systemsConsolidation[], integrationRisks[] }` | Quantify integration upside |
| `redesign` | All participant maps | `{ summary, redesignedProcess[], removedSteps[], phasing[], adoptionNotes[], risks[] }` | Decisive unified target operating model |
| `diligence` | Data room (primary), maps optional | `{ summary, executiveSummary, technologyLandscape[], operationalFootprint[], organisation[], redFlags[], keyFindings[] }` | The article's diligence memo template |

Diligence mode is the one that exports to PPTX. The other three render in their own UI component.

### 7.4 Async analyse: enqueue + poll

The analyse pipeline runs **off-request** in an Inngest function. The route's only job is fast preflight + enqueue:

```js
export async function POST(request, { params }) {
  if (checkOrigin(request).error) return 403;
  if (!(await checkRateLimit(...)).allowed) return 429;
  const auth = await requireAuth(request);
  const editor = await requireDealEditor({ dealId, email: auth.email });
  const { mode } = await request.json();

  // Resolve API key (BYO or platform), preflight cost guard.
  const orgId = await getOrgIdForUser({ email: auth.email });
  const key = await resolveActiveKey({ orgId, vendor: 'anthropic' });
  if (!key.key) return 503;
  if (key.source !== 'customer') {
    const pre = await preflightTokenBudget({ orgId, estimatedTokens });
    if (!pre.allowed) return 402;
  }

  // Insert pending row, capture id, enqueue worker, return.
  const row = await insertDealAnalyses({ status: 'pending', mode, ... });
  await sendEvent({
    name: 'deal-analysis.requested',
    data: { analysis_id: row.id, deal_id, mode, api_key: key.key, ... },
  });
  return NextResponse.json({
    analysis_id: row.id,
    status: 'pending',
    poll_url: `/api/deals/${dealId}/analyses/${row.id}/status`,
  }, { status: 202 });
}
```

**Why async**: holding a 60-120s connection from the route means every flaky disconnect loses the result and the user pays twice. Async + polling is disconnect-tolerant and resumable across reloads (the analysis_id is the resumption token).

**Worker** (`lib/inngest/functions/runDealAnalysis.js`) does the heavy lift in `step.run()` blocks:

```
load-deal-context → load-reports → rag-grounding → llm-call →
record-token-usage → parse-and-normalise → verify-evidence → persist-result
```

Each step is durable. If the function crashes mid-LLM, Inngest retries from the last completed step. Throughout, the worker PATCHes `deal_analyses.status` and `progress_message` so the polling client sees what's happening:

| Status | progress_message examples |
|--------|---------------------------|
| `pending` | "Queued — worker will pick this up shortly." |
| `running` | "Loading deal context…" → "Grounding in 12 document excerpts…" → "Drafting the diligence memo…" → "Validating citations…" → "Saving findings…" |
| `complete` | null (clear on completion) |
| `failed` | null (with `error` populated) |

**Polling endpoint** (`/api/deals/[id]/analyses/[analysisId]/status`): single PK lookup, returns `{ status, progress_message, complete, failed, error, ... }`. Cheap; meant to be polled every 2s. `Cache-Control: no-store`.

**Client** (`DealAnalysisSection.jsx`): POST → get analysis_id → poll status every 2s → when complete, GET full analysis (which hydrates findings from `deal_findings` — see §8.4).

**Resumability**: if the user closes the tab mid-analysis, the worker keeps running. They can come back later and the deal page's analysis history will show the now-complete row.

**Failure modes** the polling client handles:
- 5-minute ceiling on polling — beyond that, surface "taking longer than expected; reload to check status"
- Inngest unconfigured (`enqueued: false`) — surface a clear error
- Worker crashes — `runDealAnalysis` wraps the pipeline in try/catch and PATCHes status='failed' with the error message before re-throwing for Inngest visibility

---

## 8. Diligence pipeline

This is the most complex subsystem. Read this section carefully — it's the heart of the platform's value.

### 8.1 Concept

A deal can have a corpus of source documents. The platform parses them into chunks, embeds them, indexes for hybrid search, and grounds AI analyses in the citations. Every "finding" the AI emits must point back to either a document chunk, a process step, a chat turn, or a metric. Reviewers approve findings before they appear in the public report. Exports go to PowerPoint.

### 8.2 Document upload flow

#### Idempotency

Compute SHA-256 of the upload bytes on the server. The `deal_documents` table has a unique partial index on `(deal_id, content_hash WHERE content_hash IS NOT NULL)`. On upload:

1. Hash the bytes.
2. SELECT existing row by `(deal_id, content_hash)`. If found → return that row, skip insert + storage put + Inngest event. UI shows "Identical content already uploaded — re-using existing document."
3. Otherwise insert. If a concurrent upload races past the pre-check, the unique constraint raises 409 — catch it and re-fetch the winner.

Saves real money on the embedding pipeline. A double-clicked upload button used to create two rows + two embedding runs.

#### Per-party visibility

Two-sided M&A deals can't share a single document pool — buy-side shouldn't see sell-side annotations. Every upload picks a `visibility` value:

| Value | Visible to |
|-------|------------|
| `all_editors` (default) | Owner, collaborators, any participant |
| `acquirer_only` | Owner + participants with role='acquirer' |
| `target_only` | Owner + participants with role='target' |
| `seller_only` | Owner + participants with role='seller' |
| `portfolio_only` | Owner + participants with role IN ('portfolio_company','platform_company') |
| `owner_only` | Owner only |

Enforced two ways:
1. **RLS** on `deal_documents` keys reads on `deal_participants.role` for the viewer (see `migration-deal-doc-visibility-and-hash.sql`). This is the authoritative gate when callers use a user-bound JWT.
2. **API-layer filter** in `lib/dealDocumentVisibility.js` `canSeeDocument({ document, viewerRole, isOwner, isCollaborator })`. The list route uses the service-role key (which bypasses RLS), so it filters in JS — defence in depth.

The dropdown options in the upload UI are **deal-type-aware**: PE deals don't show acquirer/target options; M&A doesn't show portfolio. `validateVisibilityForDealType()` enforces this server-side at upload time.

#### Plumbing



```
User drags PDF onto DealDocumentsPanel
    ↓
POST /api/deals/[id]/documents (multipart)
    ↓
1. Insert row into deal_documents (status=pending)
2. PUT bytes into Storage at deal-documents/{deal_id}/{doc_id}/{filename}
3. PATCH storage_path onto the row
4. sendEvent('deal-document.uploaded', { deal_id, document_id, ... }) → Inngest
    ↓
[ Worker takes over — see §9 ]
```

Synchronous path returns within seconds. Long work happens async.

### 8.3 Worker pipeline

`processDealDocument` (Inngest function), wrapped in `step.run()` for resumability:

```
Trigger: deal-document.uploaded
    ↓
step('mark-parsing'): PATCH status='parsing', clear processing_error
    ↓
step('extract-text'): GET bytes from Storage → extractTextFromBuffer()
                       returns { segments[], pageCount }
                       segments carry locator metadata (page/slide/sheet/range/section_path)
    ↓
step('chunk'): chunkText(segments) → produces ~600-token chunks
                respecting segment boundaries; never crosses locator boundaries
    ↓
step('insert-chunks'): batch-insert into deal_document_chunks (no embeddings yet)
                       PATCH deal_documents.status='embedding', set page_count
    ↓
if VOYAGE_API_KEY:
  for each batch of 32:
    step(`embed-${i}`): embedDocuments(batch) → PATCH each chunk with embedding
    ↓
step('mark-ready'): PATCH status='ready'
```

If anything throws, Inngest retries up to 3× with exponential backoff. After exhausting, the function marks status='failed' with the error.

### 8.4 Findings shape (canonical)

`lib/deal-analysis/findingsShape.js` defines the contract every analysis must produce:

```js
{
  key: '<sha1(category+title)[:12]>',     // stable across re-runs
  title: 'Legacy ERP migration risk',
  body: '1-3 sentence explanation.',
  category: 'systems',                     // free-form
  severity: 'high',                        // 'low'|'medium'|'high'|'critical'
  confidence: 0.85,                        // 0..1; gates the reviewer queue
  impact: ['day_one', 'tsa'],              // any subset of these four axes
  evidence: [{
    kind: 'document_chunk',                // 'document_chunk'|'process_step'|'chat_turn'|'metric'
    ref: { chunk_id, document_id, filename, page_number, ... },
    snippet: 'verbatim text from source (≤400 chars)',
  }],
  recommendations: ['Engage a technical due diligence partner ...'],
}
```

The same module exports `FINDINGS_SHAPE_PROMPT_BLOCK` — a chunk of prompt text injected into every analysis system prompt that REQUIRES the model to produce this shape. The block MUST mention every required field name and enumerate evidence kinds + impact axes verbatim.

After the LLM returns, normalise via `normaliseFindings(result)`:

- Walk every known finding-bearing path (`mergeRecommendations`, `opportunities`, `risks`, `redFlags`, `keyFindings`, `technologyLandscape`, `operationalFootprint`, `organisation`).
- Walk singleton paths (`executiveSummary`).
- For each finding: clamp confidence to [0,1], coerce invalid severity to 'medium', filter impact[] to known axes, filter evidence[] to known kinds, generate `key` from category+title.

### Findings storage — relational + JSONB

Findings live in **two places** by design:

- **`deal_findings` table** — the canonical relational store. One row per finding with `(analysis_id, finding_key)` as a unique constraint. UPSERT on re-runs preserves linkage to `deal_finding_reviews`. Indexed on (analysis_id, section, order_index) for hydrate-time ordering.
- **`deal_analyses.result` JSONB** — the raw model output, untouched. Acts as the audit archive: if you ever want to debug "what did the model say before our normalisation/validation munged it?", this is where to look.

`lib/deal-analysis/findingsRepo.js` is the read/write surface:

- `persistFindingsForAnalysis({ analysisId, dealId, bundle, executiveSummary })` — UPSERT.
- `loadFindingsForAnalysis(analysisId)` — flat array of rows ordered by section + order_index.
- `hydrateAnalysisFromFindings(analysisRow, findings)` — rebuilds the in-memory shape (`{summary, executiveSummary, technologyLandscape: [...], ...}`) so the renderer + PPTX exporter don't change. Overwrites finding-bearing fields, preserves narrative ones (`summary`, `proposedProcess`, `phasing`, etc.).
- `loadHydratedAnalysis(analysisRow)` — convenience: load + hydrate.

**Migration path for an existing project**: `migration-deal-findings-table.sql` includes a backfill `DO` block that walks every existing `deal_analyses.result` JSONB and seeds the table. Idempotent — re-runnable. After backfill, every read path uses `loadHydratedAnalysis()`; the JSONB is kept indefinitely as the audit archive.

---

Then **verify** via `verifyEvidence(bundle, chunkIndex)`:

- Caller pre-fetches the chunks referenced in `evidence[].ref.chunk_id` from `deal_document_chunks`.
- For each `document_chunk` evidence: drop if `chunk_id` is unknown; drop if `snippet` overlap with chunk content is < 60%.
- Aggregate: downgrade `confidence` by 0.2 when any pointer was invalidated; drop the entire finding when ALL originally-claimed pointers were invalidated (findings that started with no evidence stay).
- Non-document-chunk kinds (`process_step`, `chat_turn`, `metric`) pass through.

This is the production replacement for Anthropic's Citations API — see §2.3 for why we replicated it ourselves rather than using Citations natively.

### 8.5 Reviewer state machine

```
pending  ──approve──▶  approved   (visible to all viewers)
   │ ─reject─────────▶  rejected   (hidden from everyone)
   │ ─needs-revision─▶  needs_revision (editor-only view)
```

Storage: `deal_finding_reviews` rows keyed by `(analysis_id, finding_key)`. Edited title/body in the row override the AI-generated values at render time.

`applyReviewsToAnalysis(result, reviews, viewerMode)`:

| Status | viewerMode='public' | viewerMode='editor' |
|--------|---------------------|---------------------|
| `approved` | shown | shown (with status pill) |
| `pending` / `needs_revision` | hidden | shown (greyed, with controls) |
| `rejected` | hidden | hidden |

This is a pure function. It's called server-side before PPTX export (`viewerMode='public'`) and client-side in the diligence renderer (varies by user role).

### 8.6 Diligence prompt structure

```
SYSTEM:
You are a transaction services partner producing a diligence memo.
{FINDINGS_SHAPE_PROMPT_BLOCK}

USER:
Deal: {deal.name}
Process focus: {deal.process_name}
{formatCompanySections(companyData)}    ← optional process maps as supplementary context

Relevant document excerpts (cite chunk_id in evidence[] when using):
[1] chunk_id=abc123 document_id=def456 (CIM.pdf, p.42)
    Snippet of chunk content here...
[2] ...

Produce a diligence memo organised as a slide deck. Sections:
- "executiveSummary": single object {title, body, severity, confidence, impact[], evidence[], recommendations[]}
- "technologyLandscape": findings[]
- "operationalFootprint": findings[]
- "organisation": findings[]
- "redFlags": findings[] (severity should skew high/critical)
- "keyFindings": findings[] (top 3-5 ranked)

Citation requirements (HARD):
- Every claim above the "obvious from filename" threshold needs evidence[].
- For document_chunk evidence, ref MUST include chunk_id + document_id from above.
- If a finding has no evidence, drop it rather than fabricate.

Return ONLY this JSON:
{ "summary": "...", "executiveSummary": {...}, "technologyLandscape": [...], ... }
```

Keep the system prompt terse — long instructions degrade structured-output reliability.

### 8.7 Hybrid retrieval

Caller `lib/deal-analysis/chunkSearch.js`:

```js
export async function searchDealChunks({ supabaseUrl, supabaseKey, dealId, queryText, limit = 12, party = null }) {
  let queryVector = null;
  try { queryVector = await embedQuery(queryText); }
  catch { /* keyword-only fallback */ }

  const resp = await fetch(`${supabaseUrl}/rest/v1/rpc/search_deal_chunks`, {
    method: 'POST',
    headers: { ...serviceRoleHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_deal_id: dealId,
      p_query_text: queryText.slice(0, 1000),
      p_query_vector: queryVector,
      p_limit: Math.min(limit, 50),
      p_party: party,
    }),
  });
  return resp.ok ? await resp.json() : [];
}
```

The analysis route auto-grounds: builds a query string from `${deal.name} ${deal.process_name} ${mode-specific-intent}`, fetches top-12 (top-30 for diligence mode), formats them into the prompt.

### 8.8 The chat tool — `search_deal_documents`

This is the only chat tool that touches deal data. **It MUST be access-gated.** The chat tool runs under the service-role key (bypasses RLS), so the only thing standing between an attacker and another user's documents is the access check at the route layer:

```js
// /api/diagnostic-chat — REQUIRED before forwarding dealId to the agent
if (dealId && sessionInfo) {
  const access = await resolveDealAccess({ dealId, email: sessionInfo.email, userId: sessionInfo.userId });
  if (access) {
    verifiedDealId = dealId;
    dealAccessVerified = true;
  } else {
    logger.warn('User attempted to use dealId without access', { dealId, email });
    // dealId silently dropped; chat continues without RAG
  }
}
```

Defence in depth — the tool executor must also refuse without `ctx.dealAccessVerified`:

```js
case 'search_deal_documents': {
  if (!ctx.dealAccessVerified || !ctx.dealId) {
    return 'No deal context on this chat session.';
  }
  // ... only now safe to call searchDealChunks
}
```

### 8.9 Citation click-through

`components/deals/EvidenceModal.jsx` opens when a user clicks an evidence row. Two tabs:

- **Cited passage** — fetches `/api/deals/[id]/documents/[docId]/preview?chunk_id=...&context=1` which returns the cited chunk + 1 chunk either side. Renders with the cited chunk highlighted.
- **Source file** — fetches `?raw=1` which returns a 5-min Supabase signed URL. Renders inline (PDF iframe, image, text) or falls back to a download button.

The signed URL TTL is short (5 min) so a stale modal doesn't expose documents to a user who has lost access.

### 8.10 PPTX export for diligence

Pattern matches §6.4 but slide ordering mirrors `DealDiligenceReport.jsx`:

```
Cover → Section divider: "Executive Summary" → Exec finding slide
     → Section divider: "Technology Landscape" → finding slides...
     → Section divider: "Operational Footprint" → finding slides...
     → Section divider: "Organisation" → finding slides...
     → Section divider: "Red Flags" → finding slides...
     → Single "Transition Lens — Day-1 / TSA / Separation" cross-cut slide
     → Section divider: "Key Takeaways" → finding slides
```

Per finding slide: severity badge (top-right), confidence + impact chips, body text, recommendations bullets, evidence list with locator + snippet. **Approved-only** — call `applyReviewsToAnalysis(result, reviews, 'public')` before passing to the builder.

Endpoint: `GET /api/deals/[id]/export-diligence-pptx?analysis_id=<uuid>` — editor only. Validates the analysis is `mode='diligence'`. Streams the PPTX as `application/vnd.openxmlformats-officedocument.presentationml.presentation`.

---

## 9. Background workers (Inngest)

### 9.1 Why Inngest

Three properties matter:

1. **Step-resumable.** If the function fails halfway through, only the failing step retries — already-completed steps stay completed.
2. **No infrastructure to run.** It's a SaaS that calls back into your `/api/inngest` endpoint. No worker pool to manage.
3. **Native Next.js integration.** A single `serve()` handler exposes every function.

Alternatives: Vercel Queues (newer, fewer features), Trigger.dev (similar), self-hosted BullMQ on Redis (more ops).

### 9.2 The serve handler

`app/api/inngest/route.js`:

```js
import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { processDealDocument } from '@/lib/inngest/functions/processDealDocument';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processDealDocument],
});
```

### 9.3 The client

`lib/inngest/client.js`:

```js
import { Inngest } from 'inngest';
export const inngest = new Inngest({ id: 'workflow-consultancy', eventKey: process.env.INNGEST_EVENT_KEY });

const HAS_INNGEST = !!(process.env.INNGEST_EVENT_KEY || process.env.INNGEST_SIGNING_KEY || process.env.INNGEST_DEV);

export async function sendEvent(event) {
  if (!HAS_INNGEST) return { skipped: true, reason: 'Inngest not configured' };
  return inngest.send(event);
}
```

The no-op-when-unconfigured behaviour matters: dev users without Inngest set up still get useful errors instead of crashes.

### 9.4 Function structure

```js
import { inngest } from '../client';
export const processDealDocument = inngest.createFunction(
  { id: 'process-deal-document', name: '...', retries: 3, concurrency: { limit: 4 } },
  { event: 'deal-document.uploaded' },
  async ({ event, step }) => {
    // Resolve the deal owner's org once — used by OCR + AI categorisation
    // (so org-level BYO keys win over the platform env) and for cost-metering.
    const { orgId, ownerEmail } = await step.run('resolve-org', async () => { ... });
    await step.run('mark-parsing', async () => { ... });

    // extract-text dispatches by mime to the right native extractor (mammoth /
    // officeparser / xlsx / csv / text/* / json / xml). If native extraction
    // returns no segments AND the file is image-based or a `pdf_no_text_layer`,
    // and the org has a Mistral key configured, the SAME step calls
    // ocrExtractFromBuffer and uses its output. Buffer is downloaded once.
    const extracted = await step.run('extract-text', async () => { ... });

    const chunks = await step.run('chunk', async () => { ... });

    // No chunks doesn't mean failure — for images/audio/video/archives and
    // scanned PDFs without OCR we mark `stored` (downloadable but not
    // text-indexed) instead of `failed`.
    if (!chunks.length) {
      await markStored(sb, document_id, extracted.reason || 'no_text_extracted');
      return { document_id, chunks: 0, stored: true };
    }

    await step.run('insert-chunks', async () => { ... });
    if (embeddingsConfigured()) {
      for (let i = 0; i < rows.length; i += BATCH) {
        await step.run(`embed-${i}`, async () => { ... });
      }
    }

    // Best-effort AI categorisation — Haiku-backed 8-way classifier. Uses
    // the resolved org's Anthropic key (BYO wins over platform env).
    await step.run('categorize', async () => {
      const { key: anthropicKey } = await resolveActiveKey({ orgId, vendor: 'anthropic' });
      const category = await categorizeDocument({
        filename, sampleText: chunks.slice(0, 2).map((c) => c.content).join('\n\n'),
        mimeType: mime_type, apiKey: anthropicKey,
      });
      if (category) await patchDoc(sb, document_id, { category });
    });

    await step.run('mark-ready', async () => { ... });

    // Auto-trigger a delta diligence run. Only fires when there's a prior
    // completed analysis on this deal AND the throttle window has passed
    // AND no analysis is currently in flight (see lib/deal-analysis/autoTrigger.js).
    // Best-effort — never throws into the pipeline.
    await step.run('maybe-auto-trigger-analysis', async () => {
      return maybeAutoTriggerDealAnalysis({ sb, dealId: deal_id });
    });
  }
);
```

Each `step.run()` returns its result and Inngest persists it. If the function crashes after `extract-text` succeeded, the retry skips re-extracting and resumes from `chunk`.

#### Open-format dataroom + OCR

`lib/inngest/functions/extractText.js` carries an explicit mime → handler dispatch with a `text/*` catch-all and a NON_EXTRACTABLE allow-list (image / audio / video / archive / executable / CAD extensions) that short-circuits to `{ segments: [] }`. The worker then marks the row `stored` instead of attempting to coerce binary noise into chunks.

`lib/ai/ocr.js` calls Mistral Document OCR (`mistral-ocr-latest`) with a base64 data URL when (a) native extraction returned no text AND (b) the file is image-based or a `pdf_no_text_layer`. Per-page text becomes locator-aware segments and feeds the same chunker/embedder pipeline. Key resolution: `resolveActiveKey({ orgId, vendor: 'mistral' })` so an org-level BYO key (set under `/portal/org-admin → API keys → Mistral (OCR)`) wins over the platform `MISTRAL_API_KEY` env. Without any key, OCR is silently skipped and the file lands as `stored`.

#### Auto-trigger throttling

`lib/deal-analysis/autoTrigger.js` queues a delta `deal-analysis.requested` event when ALL of:
1. There is at least one prior `complete` analysis on this deal (we never auto-run the *first* analysis — the user opts in via the explicit Analyse button).
2. No analysis is currently `pending` / `running`.
3. The most recent completed analysis finished ≥ `MIN_GAP_MS` (default 1 hour) ago. Stops a 50-doc dump from kicking off 50 analyses.
4. An Anthropic key resolves for the deal owner's org.

The inserted row sets `auto_triggered: true` so the workspace can distinguish auto-queued runs from user-initiated ones (the header sub-line shows " · auto" and findings new since the previous run get a small NEW pill).

#### Doc-staleness on reprocess

`lib/deal-analysis/staleness.js` exposes `markFindingsStaleForDocument({ sb, dealId, documentId, reason })`. Walks `deal_findings.evidence` JSONB, matches by `document_id`, and flips `stale=true` + `stale_reason` + `stale_at`. Called eagerly from `POST /api/deals/[id]/documents/[docId]/reprocess` so the workspace's yellow STALE pill appears the moment the user clicks reprocess, not only after the worker completes.

### 9.5 Local dev

```bash
npx inngest-cli@latest dev
```

Auto-discovers `/api/inngest` on the running Next.js dev server. Bypasses signing. Dashboard at `http://localhost:8288` shows event log + run replay UI.

### 9.6 Production sync

In the Inngest cloud dashboard: **Apps → Sync new app**, URL = `https://<your-host>/api/inngest`. Inngest fetches the manifest, registers all functions automatically. Re-sync after each deploy that adds or modifies a function (the Vercel integration handles this automatically if installed).

---

## 10. GDPR — data portability + erasure

If you take any EU traffic, you need both. Cheap to ship; non-trivial later.

### Article 20 — Data portability (`/api/me/export-data`)
Returns a single JSON document with every row owned by the calling user — diagnostic_reports, chat_sessions, chat_messages, chat_artefacts, owned deals, document metadata, token usage ledger. Document bytes are not inlined (download separately from the deal page). Rows where the user is a collaborator but not owner are excluded — that's the owner's data.

Rate-limited per user. JSON not ZIP — auditors accept either, JSON avoids a new dep.

### Article 17 — Right to erasure
30-day grace window. Three endpoints share `/api/me/account`:
- **DELETE** with `{ confirmation: 'DELETE MY ACCOUNT' }` schedules deletion. Inserts a `user_deletion_requests` row, sets `auth.users.banned_until` for 365 days to block sign-in.
- **GET** returns current status (so the UI can render "deletion scheduled for X").
- **POST** `{ action: 'cancel' }` cancels a pending request and lifts the auth ban.

A daily cron (`/api/cron/expunge-deleted-accounts`, 03:00) processes pending requests past the 30-day grace:

1. Anonymise `diagnostic_reports.contact_email/contact_name/company` → redacted.
2. Anonymise `chat_sessions.email/title/summary`. Messages are NOT deleted — they may include other users' content; anonymising the session is sufficient.
3. Transfer `deals` ownership to `PLATFORM_ADMIN_TRANSFER_EMAIL` so collaborators retain access. **Owned deals don't disappear when their owner deletes** — that's the contract with everyone who has visibility on the deal.
4. Redact `token_usage_ledger.user_email`.
5. Rename `auth.users.email` to `deleted-{uuid}@deleted.invalid`.
6. Mark `user_deletion_requests.status = 'completed'`.

UI lives at `/portal/settings`. Both controls visible to any signed-in user.

### Required env
- `PLATFORM_ADMIN_TRANSFER_EMAIL` — the platform-admin account that becomes new owner of expunged users' deals. Without it, the cron skips ownership transfer; deals stay accessible via `collaborator_emails` only.

---

## 10b. SOC 2 readiness baseline

This is the "policies + controls + evidence collection exists" milestone. Shipping this content does **not** make the company SOC 2 compliant — Type I requires a CPA engagement (~2-4 weeks), Type II requires 3-12 months of evidence + audit (~$25-80k). What you build here gives you the artefacts an auditor (or a Drata / Vanta / Secureframe vendor) needs to start.

### 10b.1 Directory layout

```
compliance/
├── README.md                       # gap analysis: readiness vs audit-passed
├── CONTROLS_MATRIX.md              # SOC 2 TSC → our controls, COVERED/PARTIAL/GAP
└── policies/
    ├── 01-information-security.md
    ├── 02-access-control.md
    ├── 03-change-management.md
    ├── 04-incident-response.md
    ├── 05-vendor-management.md
    ├── 06-business-continuity.md
    ├── 07-data-classification.md
    ├── 08-acceptable-use.md
    ├── 09-risk-management.md
    ├── 10-onboarding-offboarding.md
    ├── 11-vulnerability-management.md
    └── 12-backup-recovery.md
```

Each policy template has:
- Frontmatter with **Policy owner**, **Approved by**, **Approval date**, **Last reviewed**, **Review cadence**, **SOC 2 mapping**.
- A "**NOT LEGAL ADVICE**" disclaimer.
- `[COMPANY NAME]` / `[POLICY OWNER]` / `[YYYY-MM-DD]` placeholders for adoption.

### 10b.2 MFA helper

`lib/mfaCheck.js`:

```js
import { createClient } from '@supabase/supabase-js';
import { requireSupabase } from './api-helpers.js';

export async function getUserMfaStatus(userId) {
  const sb = requireSupabase();
  const admin = createClient(sb.url, sb.key, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
  if (error) return { enabled: false, factorCount: 0, factors: [], error: error.message };
  const factors = (data?.factors || []).map((f) => ({
    id: f.id, type: f.factor_type || f.type, status: f.status, createdAt: f.created_at,
  }));
  const verified = factors.filter((f) => f.status === 'verified');
  return { enabled: verified.length > 0, factorCount: factors.length, verifiedCount: verified.length, factors };
}

export async function getOrgMfaReport(orgId) { /* iterate organization_members */ }
export async function getAllOrgsMfaReport({ limit = 500, offset = 0 } = {}) { /* iterate organizations */ }
```

Expose as `GET /api/organizations/[orgId]/mfa-status` (org-admin / platform-admin gated). The admin UI shows a banner on the Members tab — green if `fullyEnforced`, amber otherwise — that tells admins exactly how many members still need to enrol. Auditor evidence for **CC6.2**.

### 10b.3 Evidence-collection script

`scripts/collect-soc2-evidence.mjs` — node script (.mjs so it can `import` from `lib/`). Run monthly. Writes a timestamped folder under `compliance/evidence/YYYY-MM-DD/`.

Eight artefacts:

| File | What it captures | TSC mapping |
|------|-------------------|-------------|
| 01-rls-policies.json | pg_policies dump | CC6.1, CC6.3, C1.1 |
| 02-cron-runs.json | last 30 days `cron_run_log` rollup | CC4.1, CC7.2, A1.2 |
| 03-audit-log-summary.json | `audit_logs` 30-day count + 50-row sample | CC2.1, CC4.2 |
| 04-mfa-status.json | every org via `getAllOrgsMfaReport` | CC6.2 |
| 05-token-usage.json | `token_usage_ledger` 30-day per-org rollup | CC9.1 |
| 06-vendor-inventory.json | `package.json` deps + env-var prefixes | CC9.2 |
| 07-migration-history.json | `supabase/MIGRATIONS.md` + `git log -- supabase/` | CC8.1 |
| 08-customer-key-status.json | `customer_api_keys` w/ ageDays + rotationDue flags | CC6.5, P-series |
| 00-MANIFEST.md | Index + control mapping for the auditor | — |

The script:
- Loads `.env.local` itself (no Next.js dep).
- Uses the service-role key.
- Catches per-collector errors so a single failure doesn't abandon the snapshot — failed artefacts still write a `{ error }` JSON and the manifest flags status.
- Exits non-zero if any collector failed.

### 10b.4 .gitignore

Add `compliance/evidence/` — snapshots contain customer identifiers; never commit. Upload to your compliance vendor's portal or to a private versioned object store the auditor can read.

### 10b.5 Operational expectations

- MFA enrolment by every workforce member on every system in scope (Supabase, Vercel, GitHub, Sentry, Anthropic, OpenAI, Google Workspace, Inngest, Upstash).
- Quarterly access review by Engineering Manager; output documented + signed by Security Officer.
- Annual policy review; update each `Last reviewed:` line; re-approval by [CEO/CISO].
- Monthly `collect-soc2-evidence.mjs` run (or whatever cadence the chosen compliance vendor demands).

### 10b.6 What's *not* in this baseline

- Management-signed adoption of every policy
- Background-check vendor contract (Checkr / Certn)
- Security-training vendor contract (KnowBe4 / Curricula)
- Penetration test (Cobalt / HackerOne / Bishop Fox)
- Quarterly access-review sign-offs
- Customer-facing trust page
- Compliance-automation vendor contract (Drata / Vanta / Secureframe)

These are documented as gaps in `compliance/README.md` and `CONTROLS_MATRIX.md`; reopen the items as they get adopted.

---

## 11. Operations, monitoring, security

### 10.1 Required cron

| Cadence | Job | What it does |
|---------|-----|--------------|
| Every 15 min | Stuck-document reaper | `SELECT * FROM deal_documents WHERE status='pending' AND created_at < now() - '15 min'` → re-emit `deal-document.uploaded` for each. Recovers from Inngest outages. |
| Daily | Storage reconciler | Compare bucket contents vs `deal_documents.storage_path`. Soft-delete orphans after 7 days. |
| Daily | Old report pruner | Delete `diagnostic_reports` rows older than N days where `user_id IS NULL` and never accessed. Configurable. |

Use Vercel Cron or Supabase pg_cron — either is fine.

### 10.2 Logging

`lib/logger.js` is a thin wrapper over `console`. Every API route should:

```js
const reqId = getRequestId(request);
logger.info('Action started', { requestId: reqId, action: 'analyse', dealId });
// ... work ...
logger.error('Action failed', { requestId: reqId, error: err.message, stack: err.stack });
```

Forward `x-request-id` from the inbound request if present; generate a UUID otherwise. Propagate to downstream tool calls via `ctx.requestId` so a single user action is traceable end-to-end.

### 10.3 Rate limiting

Every mutation route: `lib/rate-limit.js` wraps Upstash Redis sliding-window. Default: 30 requests / minute per IP. The chat endpoint and analysis endpoints share the same limiter; tighten if needed.

### 10.4 CSRF mitigation

`checkOrigin(request)` rejects when Origin/Referer doesn't match `NEXT_PUBLIC_SITE_URL`. Apply to every POST/PATCH/DELETE.

### 10.5 RLS conventions

- **Always** enable RLS (`ALTER TABLE foo ENABLE ROW LEVEL SECURITY`).
- Default to **deny**. Only add policies for paths you've thought about.
- Prefer `auth.uid()` over `auth.jwt() ->> 'email'` — emails are mutable; user_ids are stable.
- Index every column referenced by a policy (RLS runs the predicate per row scanned).

### 10.6 Service-role key handling

The service-role key bypasses RLS. Only use it server-side (`requireSupabase()` returns it). Never ship it to the browser. Log a loud warning if it appears in any client bundle.

### 10.7 Secrets rotation

Document a rotation procedure for: Anthropic API key, Voyage API key, Inngest signing key, Supabase service role key, n8n signing secret. Rotate at least annually.

### 10.8 Cost guardrails (DEFER — but design now)

The architecture has no spending ceiling. A user uploading a 5,000-page PDF and re-running diligence 10× can quietly cost $50–$200 in Voyage + Anthropic.

**Plan**: add `organizations.monthly_token_budget` (BIGINT) + `organizations.tokens_consumed_this_month`. Increment in the analysis route + Inngest function. Soft-block when 80% reached (banner); hard-block at 100%. Reset on the 1st of the month via cron.

### 10.9 Backups

Supabase auto-backups daily on Pro tier; PITR available. Configure retention to 7 days minimum. Test restore quarterly.

---

## 12. User journeys & wireframes

These are sketches, not design specs. Build the UI with the user research you have; this section documents the user paths the data model + API supports.

### 11.1 Solo audit (anonymous)

```
Landing /                                 [ "Audit your process" CTA ]
   ↓
/process-audit
   ┌────────────────────────────────────────────────────────────┐
   │  AuditGate                                                  │
   │  Vesno.                                                     │
   │  Start your process audit                                   │
   │                                                             │
   │  [ Pillar selector: Scaling | M&A | PE | High-Risk Ops ]    │
   │  [ Name      ] [ Email     ]                                │
   │  [ Company   ] [ Job title ]                                │
   │  [ Start audit → ]                                          │
   └────────────────────────────────────────────────────────────┘
   ↓
   ┌────────────────────────────────────────────────────────────┐
   │  Screen1SelectTemplate                                      │
   │  What do you want to map?                                   │
   │  [ Customer onboarding ]                                    │
   │  [ Invoice approval    ]                                    │
   │  [ Or describe your own ▾ ]                                 │
   └────────────────────────────────────────────────────────────┘
   ↓
   ┌────────────────────────────────────────────────────────────┐
   │  DiagnosticWorkspace (Screen 2)                             │
   │  ┌─────────────┬───────────────────────────┬──────────────┐ │
   │  │ Chat        │ Step Editor               │ Flow Preview │ │
   │  │ ─────       │ ─────────                 │ ───────────  │ │
   │  │ Reina: ...  │ Step 1 ▾ Receive form    │  [ SVG ]     │ │
   │  │ You: ...    │ Step 2 ▾ Validate         │              │ │
   │  │ [type      ] │ + Add step                │              │ │
   │  └─────────────┴───────────────────────────┴──────────────┘ │
   │  ProgressBar: Diagnostic depth 64%                          │
   └────────────────────────────────────────────────────────────┘
   ↓ (user clicks "Generate report" or Reina calls generate_report)
   ↓
/report?id=xyz                           [ Full report — see §6.1 ]
```

### 11.2 Deal owner — diligence flow

```
/portal                                  [ "Deals" tile — gated by `deals` entitlement ]
   ↓
/deals                                   [ List of deals; "+ New deal" ]
   ↓
[ Modal: type=M&A, name="Project Atlas", participants=[acquirer, target] ]
   ↓
/deals/<id>
   ┌────────────────────────────────────────────────────────────┐
   │  Project Atlas (M&A)                                        │
   │  Summary tiles: acquirer cost / target cost / combined      │
   │                                                             │
   │  ┌─────────── Acquirer ────────┐ ┌──── Target ─────┐        │
   │  │ Acme Co (complete)          │ │ Beta Co (in pr) │        │
   │  │ £450K · 35% auto · 24 steps │ │ Invite copied   │        │
   │  └─────────────────────────────┘ └─────────────────┘        │
   │                                                             │
   │  StepDecisionLayer (when both complete)                     │
   │  Acquirer step ↔ Target step  → [Keep A | Keep T | Merge]   │
   │                                                             │
   │  Data room  [drag PDFs here]                                │
   │  • CIM.pdf            (acquirer · CIM)  Ready  [Re-run] [×] │
   │  • Q3-financials.xlsx (target)          Embedding…          │
   │                                                             │
   │  Run analysis: [Comparison] [Synergy] [Redesign] [Diligence]│
   │                                                             │
   │  ┌── Analysis result ──────────────────────────────────┐    │
   │  │ Diligence memo (generated 2026-04-25)               │    │
   │  │ 3 approved · 2 pending     [ Export to PowerPoint ] │    │
   │  │                                                      │    │
   │  │ ★ Executive Summary                                  │    │
   │  │   ┌────────────────────────────────────────────────┐ │    │
   │  │   │ Sound integration story but key-person risk in │ │    │
   │  │   │ Engineering [HIGH · conf 78% · Day 1, TSA]    │ │    │
   │  │   │ ▸ 2 evidence sources                           │ │    │
   │  │   │ [ Approve ] [ Reject / revise… ]               │ │    │
   │  │   └────────────────────────────────────────────────┘ │    │
   │  │ ⚙ Technology Landscape                               │    │
   │  │ 🏭 Operational Footprint                             │    │
   │  │ 👥 Organisation                                      │    │
   │  │ ⚠ Red Flags                                          │    │
   │  │ 📅 Transition Lens (Day 1 / TSA / Separation)        │    │
   │  │ 📌 Key Takeaways                                     │    │
   │  └──────────────────────────────────────────────────────┘    │
   └────────────────────────────────────────────────────────────┘
```

Click an evidence row → in-modal evidence drawer (no separate `EvidenceModal` — the chunk loads inline below the finding row via `EvidenceRow`'s "Inspect" button):

```
┌─────────────────────────────────────────────────────────────────┐
│  Finding: Key-person risk in Engineering   [HIGH · 78%]          │
│  ▸ Body, recommendations, evidence rows...                       │
│                                                                  │
│  Evidence (3)                                                    │
│  • CIM.pdf · p.42                          [Inspect] [Open]      │
│    "..the founding engineer holds 80% of system context.."       │
│    ┌─── inline drawer (lazy-loaded on Inspect) ─────┐            │
│    │ CIM.pdf · p.41                                  │            │
│    │ Previous chunk content...                       │            │
│    │ CIM.pdf · p.42 [target]                         │            │
│    │ Highlighted chunk text.                         │            │
│    │ CIM.pdf · p.43                                  │            │
│    │ Next chunk content.                             │            │
│    └─────────────────────────────────────────────────┘            │
│                                                                  │
│  Tags: [Deal-breaker] [Re-trade] [Disclose] [Mitigate] [Monitor] │
│  💬 Discussion (2)                                                │
│  • alice@…  Looks like the same engineer is on the next slide.   │
│  • bob@…    Confirmed via a follow-up Q. See QA #14.             │
│  ▸ [comment composer]                                            │
└─────────────────────────────────────────────────────────────────┘
```

The chunk preview endpoint (`GET /api/deals/[id]/documents/[docId]/preview?chunk_id=…&context=1`) is open to any deal viewer (was previously editor-only) so participants can verify findings; per-doc visibility is enforced via `canSeeDocument`. The signed-URL endpoint stays at any deal viewer.

#### 8.11 Workspace collaboration

The deal-workspace modal is the chat-side replacement for `/deals/[id]`. Built on top of the schemas in §3.6 + §3.6b:

| Surface | Endpoint | Notes |
|---|---|---|
| **Q&A queue** | `GET /POST /PATCH /DELETE /api/deals/[id]/qa` | Editor writes; assigned participants can answer their own. Section between Documents and Findings with composer + assignee dropdown + per-item answer composer + reopen. |
| **Finding comments** | `/api/deals/[id]/analyses/[id]/findings/[key]/comments` | `@email` mentions parsed and stored in `mentions[]` for a future webhook send. Lazy-loaded on row expand. |
| **Finding tags** | `PATCH /api/deals/[id]/analyses/[id]/findings/[key]` | Vocabulary in `lib/deal-analysis/findingTags.js`: `deal_breaker / re_trade / disclose / mitigate / monitor`. Free-form at the DB layer. Editor-only toggles. |
| **Stale clearance** | `PATCH /api/deals/[id]/analyses/[id]/findings/[key]` with `{ stale: false }` | Setting `stale=true` is worker-only — clearing is editor-only. |
| **Expected-docs checklist** | `GET /api/deals/[id]/checklist` | Per-deal-type template in `lib/dealDocumentChecklist.js` matched against the actual data room. Visibility-filtered. |
| **Auto-filled scorecard** | `GET /api/deals/[id]/scorecard` | Read-only — regenerates fresh on every call from the latest completed analysis + reviews + docs. Top-N risks by severity × confidence; rule-based recommended action. |

Modal load is parallelised: deal + documents + Q&A + analyses-list all fire in one `Promise.all`. Findings detail starts as soon as the analyses list returns. Loading is split into `loadingCore` and `loadingFindings` so the modal paints progressively. A module-level cache keyed by `dealId` (max 8 entries, LRU) renders the previous snapshot instantly on re-open and refreshes in the background.

### 11.3 Anonymous deal participant

```
Email arrives                            [ "Map your invoice approval process for Project Atlas" ]
   ↓
/process-audit?dealParticipantToken=abc...
   ↓
AuditGate (deal-bound mode)
   ┌────────────────────────────────────────────────────────────┐
   │  You've been invited to map a process                       │
   │  Project Atlas · Invoice approval                           │
   │  mapping for Beta Co.                                       │
   │                                                             │
   │  🔒 Your process map will be shared with the deal           │
   │  coordinator. Other participants cannot see your data.      │
   │                                                             │
   │  Your role: Target — your baseline will be used for         │
   │  integration planning                                       │
   │                                                             │
   │  [ Name ] [ Email (locked to invite) ]                      │
   │  [ Company (locked) ] [ Job title ]                         │
   │  [ Continue → ]                                             │
   └────────────────────────────────────────────────────────────┘
   ↓
[ Same DiagnosticWorkspace as a solo audit; on submit, deal_flows.report_id is set ]
```

---

## 13. Phased rebuild plan

### Phase 1 — Skeleton (1 week)

- [ ] Next.js project + Supabase project
- [ ] Auth helpers + a basic `/portal` login
- [ ] `diagnostic_reports` + `chat_sessions` + `chat_messages` migrations
- [ ] `/process-audit` page with AuditGate + a stub Workspace
- [ ] `/api/diagnostic-chat` with the streaming agent loop, ZERO tools
- [ ] Reina answers as text only

### Phase 2 — Step canvas (1 week)

- [ ] `processData` shape + `DiagnosticContext` reducer
- [ ] `Screen1SelectTemplate` + flow rendering (grid only — defer swimlane)
- [ ] First 6 chat tools: `add_step`, `update_step`, `remove_step`, `set_handoff`, `set_bottleneck`, `generate_report`
- [ ] `processActions()` client dispatcher
- [ ] Per-pillar prompt structure (single pillar — `scaling`)

### Phase 3 — Reports (1 week)

- [ ] `/api/send-diagnostic-report` + n8n email webhook
- [ ] `/report?id=…` page with the 11 components
- [ ] Recommendations agent (Haiku, single-shot, with rule-based fallback)
- [ ] `/api/export-pptx` for the report

### Phase 4 — Multi-tenancy (3 days)

- [ ] `organizations` + `organization_members` migrations
- [ ] Entitlements helper + gates on portal routes
- [ ] `/portal/org-admin` UI

### Phase 5 — Deal portal MVP (1 week)

- [ ] Deal tables migration
- [ ] `/deals` + `/deals/[id]` pages with `DealPageMA`
- [ ] `/api/deals/[id]/analyse` with `comparison` mode only (defer synergy/redesign/diligence)
- [ ] Invite token flow

### Phase 6 — Diligence pipeline (2 weeks)

- [ ] `migration-deal-diligence.sql` (documents + chunks + reviews + RPC + bucket)
- [ ] `lib/ai/embeddings.js` (Voyage)
- [ ] `lib/inngest/*` + `processDealDocument`
- [ ] `DealDocumentsPanel` UI
- [ ] `lib/deal-analysis/findingsShape.js` + `applyReviews.js`
- [ ] Diligence prompt + analysis route mode='diligence'
- [ ] `DealDiligenceReport` UI + reviewer controls
- [ ] `dealDiligenceToPptx.js` + `/api/deals/[id]/export-diligence-pptx`

### Phase 7 — Citation click-through + reprocess (3 days)

- [ ] `/api/deals/[id]/documents/[docId]/preview` route (open to any deal viewer; per-doc visibility check)
- [ ] In-modal evidence drawer (`EvidenceRow` lazy-loads chunk + neighbours; no separate modal)
- [ ] `/api/deals/[id]/documents/[docId]/reprocess` route + Retry/Re-run UI
- [ ] `lib/deal-analysis/staleness.js` — call `markFindingsStaleForDocument` from the reprocess route + worker so cited findings get the yellow STALE pill immediately
- [ ] `PATCH /api/deals/[id]/analyses/[id]/findings/[key]` — editor-only `stale=false` clearance after manual re-verification

### Phase 8 — Open-format dataroom + AI categorisation (3 days)

- [ ] `migration-deal-doc-stored-and-category.sql` — `stored` status + `category` column + index
- [ ] Drop the MIME whitelist on `POST /api/deals/[id]/documents` (keep size + dedup)
- [ ] `lib/inngest/functions/extractText.js` — explicit mime → handler dispatch with `text/*` catch-all and NON_EXTRACTABLE allow-list
- [ ] `lib/ai/ocr.js` — Mistral Document OCR adapter, env-gated via `resolveActiveKey({ orgId, vendor: 'mistral' })`
- [ ] Add `mistral` to `SUPPORTED_VENDORS` in `lib/customerKey.js` + the org-admin BYO API-keys panel
- [ ] `lib/ai/categorizeDoc.js` — Haiku-backed classifier; wire into `processDealDocument` `categorize` step
- [ ] `lib/dealDocumentChecklist.js` — per-deal-type templates + `GET /api/deals/[id]/checklist`
- [ ] `PATCH /api/deals/[id]/documents/[docId]` — editor overrides for category / label / source_party / tags / visibility

### Phase 9 — Workspace collaboration (1 week)

- [ ] `migration-deal-analysis-auto-trigger.sql` — `auto_triggered` flag + throttle index
- [ ] `lib/deal-analysis/autoTrigger.js` + the `maybe-auto-trigger-analysis` step in `processDealDocument`
- [ ] `migration-deal-workspace-collab.sql` — `deal_qa_items`, `deal_finding_comments`, `deal_findings.tags/stale`
- [ ] Q&A endpoints + workspace section
- [ ] Finding comment endpoints + thread component
- [ ] Finding tags vocab + chip toggles
- [ ] `GET /api/deals/[id]/scorecard` + `DealScorecard` component
- [ ] Severity-weighted risk score in `GET /api/deals` + Deals rail panel sorting + colour pill

### Phase 10 — Auth + workspace perf (1 day)

- [ ] `requireAuth` cache: local JWT shape check + `Map<sha256(token), {session, expiresAt}>` with `min(60s, JWT exp)` TTL + concurrent-request coalescing
- [ ] Workspace modal: parallelise fetches, split `loading` into `loadingCore` + `loadingFindings`, render progressively, add module-level cache keyed by `dealId`
- [ ] `GET /api/deals` — fold the `deal_findings` risk-score query into the same `Promise.all` as the three deal-source queries (eliminates the second round-trip)

### Phase 8 — Hardening (ongoing)

- [ ] Cost guardrails (§10.8)
- [ ] Stuck-document reaper cron
- [ ] Storage reconciler cron
- [ ] Per-party document visibility (add `visibility` enum to `deal_documents`)
- [ ] Token-budget per organisation
- [ ] Real audit trail on finding edits
- [ ] Tests across all new routes

### What to defer beyond MVP

- PE roll-up + Scaling deal types (the M&A code paths generalise, but each adds analysis modes)
- Process redesign + workflow exports (n8n/Zapier/etc.) — different value path
- Cost copilot (a separate streaming chat surface)
- Team alignment (legacy multi-perspective survey) — separate flow
- Cross-report analytics (`/portal/analytics`)
- Marketing site (`MarketingClient.jsx`)

---

## 14. Deferred work — what we punted and why

This is a decision register, not a backlog. Each item is something we **consciously chose not to ship yet**, with the trigger that should make us reopen it. If you're rebuilding from scratch, treat each row as "skip this until the trigger fires" — building everything up-front is how MVPs die.

### 🔴 Critical (will block first paying customer)

| Item | Why deferred | Reopen when |
|------|--------------|-------------|
| **Stripe / payment integration** | Out-of-scope for engineering until business decides plan tiers. Infra (token ledger, budget) is ready to plug in. | First customer wants to pay you. |
| **ToS / Privacy / DPA / MSA contracts** | Legal-team work, not engineering. ~$2-5k cost. | Before any signed deal above SMB. |
| **Status page vendor signup** | App-side code shipped: polished `/api/health` synthetic target, public `/status` route (vendor link-out OR self-reported fallback), `<StatusBadge />` footer pill. Pending: vendor signup (Better Stack / Statuspage / Instatus) — see `RUNBOOK_STATUS_PAGE.md`. | First paying customer. |
| **External uptime monitoring** | Same — synthetic-check target ready. Vendor signup pending. | Same trigger as status page. |

### 🟠 High (week-one customer pain)

| Item | Why deferred | Reopen when |
|------|--------------|-------------|
| **Voyage / OpenAI BYO key in runtime** | Schema + admin UI + catalogue all ready. Wiring requires a new SDK + per-vendor client construction across 4 surfaces (chat, analyse, recommendations, redesign). v1 ships Anthropic-only. | A customer's bill is dominated by embeddings (Voyage) or wants OpenAI parity. |
| **Customer-facing documentation site** | **Code shipped** — `/docs` route + 10 starter pages in `content/docs/`. Pending: more pages as users ask for them; embed in the marketing footer. | First customer asks for something not covered. |
| ~~**SOC 2 readiness baseline**~~ | **Closed.** `compliance/` directory shipped: README, CONTROLS_MATRIX, 12 policy templates, `lib/mfaCheck.js` + `/api/organizations/[orgId]/mfa-status` + admin banner, `scripts/collect-soc2-evidence.mjs`. **Not** audit-passed: Type I requires CPA engagement (~2-4 weeks); Type II requires 3-12 months of evidence + audit (~$25-80k). | Closed (readiness). Reopen as "SOC 2 Type II audit engagement" when first procurement asks. |
| **Customer support tooling** | Ticketing (Linear/Intercom) + impersonate-user-for-debug. | First customer outage you can't reproduce. |

### 🟡 Medium (month-one polish)

| Item | Why deferred | Reopen when |
|------|--------------|-------------|
| **Audit trail history on findings + reviews** | Today: only latest version of `edited_title`/`edited_body`. Compliance audit will want "who changed what when". | First compliance-driven customer or any disputed finding. |
| **Email deliverability monitoring** | n8n sends report emails. Are they hitting spam? Unverified. SPF/DKIM/DMARC not documented. | First "I never got the report" complaint. |
| **Cookie consent banner** | Required for EU traffic + analytics cookies. | First EU user signs up. |
| **Accessibility audit (WCAG 2.1 AA)** | Required for public-sector + most enterprise. Run axe DevTools. | RFP that requires it. |
| **CSP + security headers** | `Content-Security-Policy`, `X-Frame-Options`, etc. ~2 hours of Next.js middleware. | Next quarter regardless — cheap insurance. |
| **`SECURITY.md` + responsible disclosure** | 30-min job. Friendly researchers have nowhere to send bug reports. | This week — there's no reason not to. |
| **Internal admin dashboard** | Per-org token consumption / active users / failed Inngest runs / trial-paid funnel. ~1 day for a basic `/admin` route. | Customer #5. |
| **Per-finding edit history** | Soft-delete pattern + `pg_audit` extension. ~4 hours. | When a customer asks for it. |

### 🟣 Architecture debt (refactor before scale)

| Item | Why deferred | Reopen when |
|------|--------------|-------------|
| ~~**Findings out of JSONB → relational table**~~ | **Closed.** `deal_findings` is now the canonical store; JSONB stays as raw audit archive. See §8.4 of the build guide. | Closed |
| ~~**SSE → enqueue + poll for `/api/deals/[id]/analyse`**~~ | **Closed.** Route enqueues `deal-analysis.requested` to Inngest + returns `{ analysis_id, poll_url }`. `runDealAnalysis` worker does the LLM + persistence. Client polls every 2s. See §9 + §7. | Closed |
| **49 chat tools → consolidate to ~15** | Anthropic guidance is ≤20. Overlap in `update_step` / `set_step_details` / `set_cost_input`. | When adding more chat tools makes the model start picking wrong ones. |
| **Duplicate analysis state** | `deal_analyses` table + `deals.settings.analysis` JSONB both written. Can diverge. ~2 hours. | When you next touch the analysis route. |
| **`dealId` session-vs-turn validation** | A user with multiple deal tabs can leak context across them via stale chat-session state. ~2 hours. | Before second customer with multiple deals. |
| **Decode JWT locally instead of `auth.getUser()` round-trip** | ~200ms per authenticated request × every chat turn. ~3 hours. | First "the chat is slow" complaint. |
| **Per-process `_cache` → Upstash Redis** | `costGuard.js` and `customerKey.js` cache in process memory; Vercel runs across many Lambdas, so invalidation only hits one. Up to 60s of stale data after rotation. | Scale where serverless cold-start variance becomes visible (~10+ concurrent paid users). |

### 🔵 Operational gaps

| Item | Why deferred | Reopen when |
|------|--------------|-------------|
| **Cron failure alerts (Sentry capture)** | Crons return 200 + JSON; if they 500 every time for a month, you find out from a customer. ~1 hour. | This week — same effort as flipping a switch. |
| **Vault rotation drill** | Procedure documented, never tested end-to-end. Encryption-secret rotation breaks every customer key by design; you want this rehearsed before you need it. | Quarterly, starting now. |
| **Backup restore drill** | Supabase auto-backups daily. Have you ever restored from one? Vault state is included in pg_dump but a cross-project restore needs the original `model_key_encryption_secret`. | Quarterly. |
| **Inngest function manifest in CI** | Cloud-side registration can drift from code. `inngest sync` should be a CI step. | When you next change a function's `retries` / `concurrency`. |
| **Component / E2E tests** | 178 tests cover deterministic logic. Picker / chat / diligence flows have zero E2E coverage. Playwright + jsdom. | Before a UI refactor that could regress silently. |
| **Multi-region deployment** | Vercel Edge is global; Supabase isn't. EU enterprise customers want EU residency. | First EU enterprise lead. |
| **Load testing** | k6 or Artillery scenario for diligence pipeline. | Before a customer with >100 concurrent users. |
| **Performance SLOs** | p50/p95/p99 for chat first-token, document upload→ready, analysis end-to-end. | When SOC 2 Type II prep starts. |
| **Browser compatibility matrix** | Tested on dev's Chrome. Specify supported browsers + BrowserStack quarterly. | First "it doesn't work in Safari" report. |
| **Dependency security scanning** | Dependabot + Snyk. ~30 npm deps; one will be CVE'd within a year. | Before any SOC 2 audit prep. |

### What I would NOT defer

If your first paying customer ships in the next month, these have to land:

1. **`PLATFORM_ADMIN_TRANSFER_EMAIL`** set in Vercel — the GDPR cron silently skips deal-transfer without it.
2. **`SECURITY.md`** — 30 minutes; closing it embarrasses no-one.
3. **Cron failure alerts** — wire `Sentry.captureException` in each cron's catch path.
4. **Backup restore drill** — at least once. Confirms your Vault secret is in the runbook.
5. **ToS / Privacy / DPA** — legal can take 1-2 weeks; start now even if everything else is ready.

---

## Appendix A — File layout

A working tree at MVP scope:

```
workflow-consultancy/
├── app/
│   ├── layout.jsx
│   ├── page.jsx                                 # Landing
│   ├── portal/
│   │   ├── page.jsx + PortalAuth.jsx + PortalDashboard.jsx
│   │   └── org-admin/
│   ├── process-audit/page.jsx
│   ├── report/page.jsx
│   ├── deals/
│   │   ├── page.jsx                             # Deal list
│   │   ├── deals.css
│   │   └── [id]/
│   │       ├── page.jsx                         # Dispatches by deal.type
│   │       ├── DealPageMA.jsx
│   │       ├── DealAnalysisSection.jsx
│   │       └── DealAnalysisSection sub-components
│   ├── api/
│   │   ├── diagnostic-chat/route.js
│   │   ├── send-diagnostic-report/route.js
│   │   ├── process-diagnostic/route.js
│   │   ├── get-diagnostic/route.js
│   │   ├── export-pptx/route.js
│   │   ├── chat-sessions/route.js + [id]/route.js
│   │   ├── chat-messages/route.js
│   │   ├── deals/route.js + [id]/...
│   │   │   ├── analyse/route.js
│   │   │   ├── analyses/[analysisId]/route.js
│   │   │   ├── analyses/[analysisId]/reviews/route.js
│   │   │   ├── documents/route.js
│   │   │   ├── documents/[docId]/preview/route.js
│   │   │   ├── documents/[docId]/reprocess/route.js
│   │   │   └── export-diligence-pptx/route.js
│   │   ├── inngest/route.js
│   │   ├── organizations/...
│   │   └── health/route.js
│   └── globals.css
├── components/
│   ├── diagnostic/
│   │   ├── DiagnosticClient.jsx
│   │   ├── DiagnosticContext.jsx
│   │   ├── ChatPanel-equivalent (folded into Workspace)
│   │   └── screens/{DiagnosticWorkspace,Screen1SelectTemplate,Screen6Complete}.jsx
│   ├── deals/
│   │   ├── DealDocumentsPanel.jsx
│   │   ├── FindingCard.jsx
│   │   ├── EvidenceModal.jsx
│   │   └── DealDiligenceReport.jsx
│   └── report/
│       └── { 11 report components }
├── lib/
│   ├── auth.js + dealAuth.js
│   ├── api-helpers.js + api-fetch.js
│   ├── rate-limit.js + sanitize.js
│   ├── entitlements.js + orgAdmin.js
│   ├── supabase.js + logger.js
│   ├── prompts.js
│   ├── ai-schemas.js + ai-retry.js
│   ├── triggerWebhook.js (n8n HMAC)
│   ├── chatPersistence.js
│   ├── ai/embeddings.js
│   ├── inngest/{client.js, functions/{processDealDocument,extractText,chunker}.js}
│   ├── deal-analysis/{prompts,findingsShape,applyReviews,chunkSearch}.js
│   ├── exporters/{reportToPptx,dealDiligenceToPptx}.js
│   ├── agents/
│   │   ├── models.js (getFastModel/getChatModel/getDeepModel)
│   │   ├── chat/{graph,tools}.js
│   │   ├── recommendations/{graph,tools,industry-knowledge,methodology-knowledge}.js
│   │   └── flow/{graph,tools}.js
│   ├── modules/
│   │   ├── index.js + pillars.js
│   │   └── scaling/agentConfig.js + templates.js
│   ├── flows/{index,grid,automation,flowModel}.js
│   └── diagnostic/{processTemplates,detectBottlenecks,automationReadiness,intakePhases,buildLocalResults,handoffOptions,processData,stepConstants}.js
├── supabase/
│   ├── migration.sql
│   ├── migration-chat-history.sql
│   ├── migration-chat-artefacts.sql
│   ├── migration-org-rbac.sql
│   ├── migration-deal-diligence.sql
│   └── MIGRATIONS.md
├── tests/
│   ├── findingsShape.test.mjs
│   ├── applyReviews.test.mjs
│   ├── chunker.test.mjs
│   ├── embeddings.test.mjs
│   ├── dealDiligenceToPptx.test.mjs
│   └── searchDealDocumentsAuth.test.mjs
├── package.json
├── playwright.config.mjs
├── next.config.mjs
├── jsconfig.json
└── .env.example
```

---

## Appendix B — Trade-offs we'd reconsider

If starting fresh today, we'd:

1. **TypeScript.** The lack of types has cost us several silent bugs (most recently the `dealAccessVerified` plumbing). Cost to retrofit is non-trivial.
2. **Promote findings out of JSONB.** `deal_findings` as a real table with FK to `deal_finding_reviews` would solve the rename-fragility problem. JSONB stays only for prompt fidelity.
3. **Send the analysis to Inngest.** Holding a 60-second SSE connection from `/api/deals/[id]/analyse` means every disconnect loses the result. Better: enqueue + return analysis_id, poll for completion, render when ready.
4. **Per-org isolation, not per-email.** RLS keying on `lower(email) = lower(auth.jwt() ->> 'email')` breaks when users change emails or leave the company. Use `organization_id` consistently and check org membership.
5. **Consolidate chat tools.** 49 tools is too many for the model. Consolidate to ~15–20. `update_step` should subsume `set_step_details`, `set_cost_input`, `set_frequency_details`. Branch ops should be a single `update_branch`.
6. **One source of truth for analysis state.** Today both `deal_analyses` (real table) and `deals.settings.analysis` (JSONB blob) are written. Pick one — the table is correct.

---

## Appendix C — Glossary

| Term | Meaning |
|------|---------|
| **Pillar** | Audience segment (`pe`, `ma`, `scaling`, `high-risk-ops`). Drives tonal shifts in Reina's prompts and the available process templates. |
| **Reina** | The AI assistant persona. Always third-person inside the codebase ("Reina says…"). |
| **Vesno** | The product brand. Surfaced in user-facing UI (audit gate, marketing). |
| **Diagnostic** | A single process audit — one user mapping one process. |
| **Report** | The submitted result of a diagnostic. Has a public-by-id URL. |
| **Deal** | A multi-participant container (M&A / PE roll-up / scaling). Owns documents and analyses. |
| **Participant** | A company/entity within a deal. Each may have a `deal_flows.report_id` pointing at their own diagnostic. |
| **Analysis** | A single AI run against the deal's data (one of four modes). Stored in `deal_analyses`. |
| **Finding** | One unit of insight inside an analysis result. Has the canonical shape (§8.4). |
| **Finding key** | sha1(category+title)[:12]. Stable across re-runs so reviewer decisions persist. |
| **Evidence** | A pointer from a finding to its source (chunk / step / chat turn / metric). |
| **Artefact** | A pinned moment in a chat session (flow snapshot, generated report, etc). Renders as a pill in the chat history rail. |
| **Phase** | Stage of the diagnostic intake state machine (`intake → map → details → cost → complete`). |
| **Tool** | A function the chat agent can invoke. Schema in `tools.js`, server case in `graph.js`, client case in `processActions()`, prompt in `prompts.js`. |
