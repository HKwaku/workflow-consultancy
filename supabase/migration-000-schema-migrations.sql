-- ============================================================
-- schema_migrations: the migration ledger
--
-- Apply this FIRST (it is also created automatically by
-- `npm run migrate`). It records which migration files have been
-- applied so the runner can skip already-applied files and so drift
-- between environments is detectable.
--
-- The runner (`scripts/run-migrations.mjs`) reads the ordered list of
-- migrations from `supabase/MIGRATIONS.md`, takes a session advisory
-- lock, and applies each file not present here inside a transaction,
-- inserting a row on success. Re-running is safe — applied files are
-- skipped.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  filename    text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.schema_migrations IS
  'Migration ledger. One row per applied supabase/ or scripts/ SQL file. Managed by scripts/run-migrations.mjs.';
