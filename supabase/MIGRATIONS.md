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
