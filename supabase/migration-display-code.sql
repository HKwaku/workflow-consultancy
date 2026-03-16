-- Add display_code column for human-friendly report identifiers
-- Run in Supabase SQL Editor (Dashboard → SQL Editor)
-- New reports get codes like SH-7K2M9; existing reports are backfilled from id hash.

ALTER TABLE public.diagnostic_reports
  ADD COLUMN IF NOT EXISTS display_code text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_display_code
  ON public.diagnostic_reports (display_code)
  WHERE display_code IS NOT NULL;

-- Backfill: generate display codes for existing rows (deterministic from id for uniqueness)
-- Format: SH-XXXXX (5 chars, safe alphabet)
UPDATE public.diagnostic_reports
SET display_code = 'SH-' || translate(upper(substr(md5(id), 1, 5)), '0123456789', 'GHJKLMNPQR')
WHERE display_code IS NULL;
