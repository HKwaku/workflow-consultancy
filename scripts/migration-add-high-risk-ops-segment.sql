-- Migration: add 'high-risk-ops' to the segment CHECK constraint
-- The original migration-add-segment.sql only allowed ('scaling', 'ma', 'pe', 'highstakes').
-- 'highstakes' was renamed to 'high-risk-ops' in the UI - this migration adds it to the DB.
--
-- Run in Supabase SQL editor.

-- 1. Drop the old anonymous CHECK constraint
--    PostgreSQL auto-names it diagnostic_reports_segment_check; adjust if yours differs.
ALTER TABLE public.diagnostic_reports
  DROP CONSTRAINT IF EXISTS diagnostic_reports_segment_check;

-- 2. Add the updated constraint that includes both the legacy id and the new id
ALTER TABLE public.diagnostic_reports
  ADD CONSTRAINT diagnostic_reports_segment_check
  CHECK (segment IN ('scaling', 'ma', 'pe', 'highstakes', 'high-risk-ops'));

-- 3. Backfill: normalise any stored 'highstakes' rows to 'high-risk-ops'
--    (optional - only needed if old reports should show the new module banner)
-- UPDATE public.diagnostic_reports
--   SET segment = 'high-risk-ops'
--   WHERE segment = 'highstakes';
