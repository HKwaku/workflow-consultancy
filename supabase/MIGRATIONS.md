# Migration order

Apply migrations in the order below when bootstrapping a new database. Files live in two folders for historical reasons:

- `supabase/` — newer migrations, managed alongside Supabase dashboard
- `scripts/` — older migrations from before the `supabase/` folder existed

Both are required. Run them via the Supabase SQL editor or `psql` against your `DATABASE_URL`.

## Order

| # | File | Folder | Adds |
|---|------|--------|------|
| 1 | `migration.sql` | `supabase/` | Base schema: `diagnostic_reports`, `diagnostic_progress`, `process_instances`, `team_diagnostics`, `team_responses`, RLS |
| 2 | `migration-v2.sql` | `scripts/` | v2 schema additions |
| 3 | `migration-schema-fixes.sql` | `scripts/` | Fixes from v2 rollout |
| 4 | `migration-schema-fixes-2.sql` | `scripts/` | Round 2 fixes |
| 5 | `migration-schema-fixes-3.sql` | `scripts/` | Round 3 fixes |
| 6 | `migration-create-diagrams-bucket.sql` | `scripts/` | Supabase storage bucket for flow diagrams |
| 7 | `migration-add-segment.sql` | `scripts/` | `diagnostic_mode` segment column on `diagnostic_reports` |
| 8 | `migration-add-contributor-emails.sql` | `scripts/` | `contributor_emails TEXT[]` on `diagnostic_reports` for portal sharing |
| 9 | `migration-display-code.sql` | `supabase/` | Short display code on diagnostic reports |
| 10 | `migration-report-redesigns-name.sql` | `supabase/` | `name` column on `report_redesigns` |
| 11 | `migration-deals.sql` | `scripts/` | `deals`, `deal_participants` base tables |
| 12 | `migration-deal-flows.sql` | `scripts/` | `deal_flows`, `deal_analyses`, `collaborator_emails` |
| 13 | `migration-add-high-risk-ops-segment.sql` | `scripts/` | High-risk-ops pillar enum value |
| 14 | `migration-chat-history.sql` | `supabase/` | `chat_sessions`, `chat_messages` + RLS |
| 15 | `migration-chat-snapshot.sql` | `supabase/` | Extends chat tables for snapshot persistence |
| 16 | `migration-chat-artefacts.sql` | `supabase/` | `chat_artefacts` table + message FK |
| 17 | `migration-org-rbac.sql` | `supabase/` | `organizations`, `organization_members`, `is_org_admin`, `entitlements` JSONB |
| 18 | `migration-deal-diligence.sql` | `supabase/` | `deal_documents`, `deal_document_chunks` (pgvector + FTS), `deal_finding_reviews`, `search_deal_chunks` RPC, `deal-documents` storage bucket |
| 19 | `migration-cost-guardrails.sql` | `supabase/` | `organizations.monthly_token_budget` + `tokens_consumed_this_month` columns, `token_usage_ledger` table, `bump_token_usage` + `reset_monthly_budgets` RPCs |
| 20 | `migration-customer-api-keys.sql` | `supabase/` | `customer_api_keys` (encrypted via pgcrypto + `MODEL_KEY_ENCRYPTION_SECRET`), `customer_api_key_audit` (append-only), set/get/revoke/audit RPCs |
| 21 | `migration-org-model-allowlist.sql` | `supabase/` | `organizations.allowed_models text[]` + `default_model text` for per-org model picker |
| 22 | `migration-deal-doc-visibility-and-hash.sql` | `supabase/` | `deal_documents.visibility` ENUM (per-party RLS), `deal_documents.content_hash` (SHA-256 dedupe with unique partial index) |
| 23 | `migration-gdpr-account-deletion.sql` | `supabase/` | `user_deletion_requests` table for GDPR Art. 17 soft-delete with 30-day grace |
| 24 | `migration-deal-findings-table.sql` | `supabase/` | `deal_findings` relational table + backfill from existing `deal_analyses.result` JSONB. JSONB stays as raw audit archive; relational table is the canonical read source going forward. |
| 25 | `migration-async-analyse.sql` | `supabase/` | `deal_analyses.progress_message` + `estimated_tokens` columns + covering index. Pairs with the SSE→poll refactor in `runDealAnalysis` Inngest function. |
| 26 | `migration-audit-logs.sql` | `supabase/` | General-purpose `audit_logs` append-only table + `audit_log_event()` RPC + RLS (org-admin read) + `audit_logs_recent_30d` view. SOC 2 evidence (CC2.1, CC4.2). |
| 27 | `migration-cron-run-log.sql` | `supabase/` | `cron_run_log` table + `cron_run_open()` / `cron_run_close()` RPCs + `cron_run_log_30d_rollup` view. Wrap each cron handler so monthly evidence pulls cron history without depending on Vercel logs. SOC 2 evidence (CC4.1, CC7.2, A1.2). |
| 28 | `migration-chat-deal-binding.sql` | `supabase/` | `chat_sessions.deal_id` (nullable FK to `deals`) + partial index. Lets each (user, deal) own a persistent copilot thread that resumes when the user re-picks the deal in the rail. |
| 29 | `migration-deal-doc-stored-and-category.sql` | `supabase/` | Adds `stored` to the `deal_documents.status` CHECK (terminal state for files we accept but can't text-extract — images, audio, video, archives) + new `category` text column with index for grouping the doc list (Financial, Legal, HR, IP, Tech, Commercial, Operational, Other). Pairs with the open-format dataroom. |
| 30 | `migration-deal-analysis-auto-trigger.sql` | `supabase/` | Adds `deal_analyses.auto_triggered boolean DEFAULT false` so the workspace can distinguish auto-queued delta runs (after a new doc finished processing) from user-initiated analyses. New covering index `(deal_id, status, created_at DESC)` for the throttle lookup. |
| 31 | `migration-deal-workspace-collab.sql` | `supabase/` | Bundles four additions for workspace collaboration: (a) `deal_qa_items` — structured Q&A queue with assignment to participants and evidence linkage; (b) `deal_finding_comments` — threaded discussion per finding with @-mention support; (c) `deal_findings.tags text[]` — vocabulary `deal_breaker / re_trade / disclose / mitigate / monitor` with GIN index; (d) `deal_findings.stale boolean` + `stale_reason` + `stale_at` flipped when a cited document is reprocessed or replaced. |
| 32 | `migration-deal-connectors.sql` | `supabase/` | Connector adapter layer for external document sources (SharePoint, Google Drive, Datasite, Box). Adds `org_integrations` (per-org OAuth tokens, pgcrypto-encrypted) and `deal_connector_bindings` (per-deal "sync from this folder" pointer with delta cursor). Adds `deal_documents.connector_binding_id` + `source_external_id` for provenance/dedup, and `archived` status for soft-deletes when files vanish at the source. The sync worker fans out into the existing `deal-document.uploaded` event, so chunking/embedding/categorisation/findings work unchanged. |
| 33 | `migration-deal-connectors-rpcs.sql` | `supabase/` | Three SECURITY DEFINER RPCs for `org_integrations` token storage: `set_org_integration_tokens` (insert-or-rotate), `get_org_integration_tokens` (decrypted read for the sync worker), `rotate_org_integration_access_token` (cheap post-refresh path). Reuses the same `model_key_encryption_secret` Vault secret as `customer_api_keys`. |
| 34 | `migration-user-trial-allowance.sql` | `supabase/` | Per-user one-shot trial allowance against the platform LLM keys (default 50,000 tokens — enough for one process audit + a few chat turns + one redesign). `user_trial_allowance` table + `bump_user_trial_usage` (atomic increment, returns post-bump exhausted state) + `get_user_trial_allowance` (lazy-creates on first read so existing users get the trial). Once exhausted, the chat / analyse / categorise paths block with a "create an org and paste your Anthropic key" gate. Distinct from `organizations.monthly_token_budget` because the conversion path is BYO key, not waiting out a reset. |
| 35 | `migration-diagnostic-mode-pillars.sql` | `supabase/` | Widens `diagnostic_reports.diagnostic_mode` CHECK constraint to accept the four-pillar values (`pe`, `ma`, `scaling`, `high-risk-ops`) alongside the legacy values (`comprehensive`, `map-only`, `team`, `quick`). The original constraint from `migration-schema-fixes-2.sql` predated the pillar refactor and silently rejected pillar-tagged inserts (PGRST 23514). Idempotent. |

## Optional dev seeding

After all migrations:

- `supabase/seed-team-alignment.sql` — populates a sample team alignment session for local dev
- `scripts/seed-dummy-diagnostics.js` — Node script that calls the API to create dummy diagnostic rows

## When adding a new migration

1. Place the file in `supabase/` (not `scripts/` — that folder is frozen)
2. Append a row to the table above
3. If it depends on another migration, mention the dependency in the file header comment

## Re-running

Migrations are written to be idempotent where practical (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`). Schema-fix migrations are not idempotent and should only run once on the original v2 install.
