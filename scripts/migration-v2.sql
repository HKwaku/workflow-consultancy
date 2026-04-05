-- Migration v2: Implementation tracker + re-audit linkage
-- Run in Supabase SQL editor

-- Feature: Implementation tracker
-- Stores per-recommendation completion status as a JSONB map { "0": "done", "1": "in-progress" }
ALTER TABLE public.diagnostic_reports
  ADD COLUMN IF NOT EXISTS implementation_status jsonb DEFAULT '{}';

-- Feature: Before/After re-audit linkage
-- Links a re-audit report back to the original
ALTER TABLE public.diagnostic_reports
  ADD COLUMN IF NOT EXISTS parent_report_id text REFERENCES public.diagnostic_reports(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reports_parent
  ON public.diagnostic_reports (parent_report_id)
  WHERE parent_report_id IS NOT NULL;
