-- =============================================================================
-- Schema additions migration (part 3)
-- Adds columns that were defined after migration-schema-fixes-2.sql was run.
-- Safe to run multiple times - all statements use IF NOT EXISTS.
-- =============================================================================

-- Cost analysis token expiry (30-day validity for manager cost-analysis links)
ALTER TABLE public.diagnostic_reports
  ADD COLUMN IF NOT EXISTS cost_analysis_token_expires_at timestamptz;

-- Promoted automation grade (companion to automation_percentage)
ALTER TABLE public.diagnostic_reports
  ADD COLUMN IF NOT EXISTS automation_grade text;

-- Index on diagnostic_progress.email for progress GET queries
CREATE INDEX IF NOT EXISTS idx_diagnostic_progress_email
  ON public.diagnostic_progress (lower(email))
  WHERE email IS NOT NULL;
